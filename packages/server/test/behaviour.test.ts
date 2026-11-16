/**
 * Bot behaviour (Phase 3, part C): the behaviour tree, desk use through the
 * real engine terminal, locking and forgetting to lock, and observations.
 */
import { describe, expect, it } from 'vitest';
import { commandNames, queryEvents } from '@insider/engine';
import { TICK_RATE } from '@insider/shared';
import { condition, selector, sequence, type Node, type Status } from '../src/bots/tree';
import { PW, Recorder, scenario } from './helpers';

const START = Date.parse(scenario.startTime);
const minutes = (m: number) => m * 60 * TICK_RATE;
const authLog = (r: Recorder, host: string) => r.file(host, '/var/log/auth.log').split('\n').filter((l) => l.startsWith('Mar  2 09:'));
/** Runs the office until `done` says so (checked once a second), at most `maxMinutes`. Returns false on timeout. */
function runUntil(r: Recorder, maxMinutes: number, done: () => boolean): boolean {
  for (let i = 0; i < minutes(maxMinutes); i++) {
    r.game.tick(1000 / TICK_RATE);
    if (i % TICK_RATE === 0 && done()) return true;
  }
  return done();
}

describe('behaviour tree', () => {
  const fixed = (status: Status, log: string[], name: string): Node<null> => () => {
    log.push(name);
    return status;
  };

  it('a sequence runs its steps in order and stops at the first that is not done', () => {
    const log: string[] = [];
    expect(sequence(fixed('success', log, 'a'), fixed('running', log, 'b'), fixed('success', log, 'c'))(null)).toBe('running');
    expect(log).toEqual(['a', 'b']);
    expect(sequence(fixed('success', log, 'a'), fixed('failure', log, 'b'))(null)).toBe('failure');
    expect(sequence<null>()(null)).toBe('success');
  });

  it('a selector tries alternatives until one does not fail', () => {
    const log: string[] = [];
    expect(selector(fixed('failure', log, 'a'), fixed('running', log, 'b'), fixed('success', log, 'c'))(null)).toBe('running');
    expect(log).toEqual(['a', 'b']);
    expect(selector(fixed('failure', log, 'a'), fixed('failure', log, 'b'))(null)).toBe('failure');
    expect(condition<number>((n) => n > 2)(3)).toBe('success');
    expect(condition<number>((n) => n > 2)(1)).toBe('failure');
  });
});

describe('bots at their desks', () => {
  it('a bot unlocks its own PC with its own password and works as itself', () => {
    const r = new Recorder({ bots: true });
    expect(runUntil(r, 8, () => queryEvents(r.game.world, { type: 'command', actor: 'p1' }).length >= 3)).toBe(true);
    expect(r.game.publicState().desks['FIN-LT-07']).toMatchObject({ screen: 'unlocked', occupantId: 'p1' });
    expect(authLog(r, 'FIN-LT-07').some((l) => l.includes('Session 2 of user s.alharbi unlocked.'))).toBe(true);
    // Every command is recorded like a human's: her account, her body, her own keyboard.
    for (const e of queryEvents(r.game.world, { type: 'command', actor: 'p1' })) {
      expect(e).toMatchObject({ host: 'FIN-LT-07', user: 's.alharbi', origin: 'physical' });
    }
  });

  it('a bot whose PC shows a login prompt logs in with username and password', () => {
    const r = new Recorder({ bots: true });
    expect(r.game.publicState().desks['FIN-LT-04'].screen).toBe('login'); // Rami's PC: nobody logged in
    expect(runUntil(r, 8, () => queryEvents(r.game.world, { type: 'command', actor: 'p2' }).length >= 1)).toBe(true);
    expect(queryEvents(r.game.world, { type: 'login.success', host: 'FIN-LT-04', since: START })).toMatchObject([{ user: 'r.mansour', actor: 'p2' }]);
  });

  it('bots only type commands that exist, with human pauses between them', () => {
    const r = new Recorder({ bots: true });
    r.tick(minutes(12));
    const known = new Set(commandNames());
    const commands = queryEvents(r.game.world, { type: 'command', since: START });
    expect(commands.length).toBeGreaterThan(100);
    for (const e of commands) expect(known.has(String(e.details.command).split(' ')[0]), String(e.details.command)).toBe(true);
    // No bot types faster than a person could: at least half a second between two lines at one keyboard.
    for (const player of scenario.players) {
      const times = commands.filter((e) => e.actor === player.id).map((e) => e.time);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });

  it('a careful office locks before leaving; a careless one leaves screens open until the owner returns', () => {
    const careful = new Recorder({ bots: true, botOptions: { forgetLock: 0 } });
    careful.tick(minutes(15));
    const leaves = queryEvents(careful.game.world, { type: 'terminal.leave', since: START });
    const manual = queryEvents(careful.game.world, { type: 'session.lock', since: START }).filter((e) => e.details.via === 'loginctl');
    expect(leaves.length).toBeGreaterThan(8);
    expect(manual.length).toBeGreaterThanOrEqual(leaves.length - 2); // (a bot that could not log in has nothing to lock)
    expect(manual.every((e) => e.origin === 'physical' && e.actor !== null)).toBe(true);

    expect(careful.game.world.unattended.filter((w) => w.from > START)).toEqual([]); // nobody ever left a PC open

    const careless = new Recorder({ bots: true, botOptions: { forgetLock: 1 } });
    careless.tick(minutes(15));
    const world = careless.game.world;
    // Nothing locks a screen by itself: no lock at all.
    expect(queryEvents(world, { type: 'session.lock', since: START })).toEqual([]);
    // Every departure left the PC open until its owner came back, and the record says so.
    const windows = world.unattended.filter((w) => w.from > START);
    expect(windows.length).toBeGreaterThan(5);
    for (const w of windows) expect(w.endedBy === 'owner returned' || w.to === null, `${w.host} ${String(w.endedBy)}`).toBe(true);
    expect(windows.every((w) => w.account === scenario.players.find((p) => p.id === w.ownerPlayer)?.account)).toBe(true);
  });

  it('by default some departures are locked and some are forgotten (about one in four)', () => {
    const r = new Recorder({ bots: true });
    r.tick(minutes(60));
    const locks = queryEvents(r.game.world, { type: 'session.lock', since: START }).length;
    const forgotten = r.game.world.unattended.filter((w) => w.from > START).length;
    expect(locks).toBeGreaterThan(20);
    expect(forgotten).toBeGreaterThan(3);
    const rate = forgotten / (locks + forgotten);
    expect(rate).toBeGreaterThan(0.12);
    expect(rate).toBeLessThan(0.4);
  });

  it('the task pace is configurable: about one task every 3 game minutes by default', () => {
    const run = (taskMinutes?: number) => {
      const r = new Recorder({ bots: true, botOptions: taskMinutes ? { taskMinutes } : {} });
      r.tick(minutes(60));
      return scenario.players.reduce((n, p) => n + r.game.tasks.completed(p.id), 0) / scenario.players.length;
    };
    const normal = run();
    expect(normal).toBeGreaterThan(12); // 60 minutes / 3 = 20, minus arriving and breaks
    expect(normal).toBeLessThan(24);
    expect(run(6)).toBeLessThan(normal * 0.75);
  }, 30_000);

  it('between tasks bots are often idle: no command for a while', () => {
    const r = new Recorder({ bots: true });
    r.tick(minutes(30));
    const times = queryEvents(r.game.world, { type: 'command', actor: 'p1', since: START }).map((e) => e.time);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(gaps.filter((g) => g >= 40_000).length).toBeGreaterThanOrEqual(5);
  });

  it('one occupant per PC also holds between a human and a bot', () => {
    const r = new Recorder({ bots: true });
    r.connect('a', 'p1'); // the human plays Sara...
    r.sitAt('a', 'p1', 'FIN-LT-07');
    r.send('a', 'stand');
    // ...walks over to Rami's desk in the same room and sits there before Rami arrives.
    expect(r.sitAt('a', 'p1', 'FIN-LT-04')).toBe(true);
    expect(r.position('p1')).toMatchObject({ seatedAt: 'FIN-LT-04' });
    r.tick(minutes(6));
    // Rami (a bot) is in the building but could not sit down.
    expect(r.game.publicState().players.p2).toMatchObject({ seatedAt: '' });
    expect(r.game.publicState().desks['FIN-LT-04'].occupantId).toBe('p1');
    expect(queryEvents(r.game.world, { type: 'command', actor: 'p2' })).toEqual([]);
    // She gets up; sooner or later Rami sits at his own desk.
    r.send('a', 'stand');
    expect(runUntil(r, 8, () => r.game.publicState().players.p2?.seatedAt === 'FIN-LT-04')).toBe(true);
  });

  it('a human who takes over an employee finds the PC as the bot left it', () => {
    const r = new Recorder({ bots: true });
    expect(runUntil(r, 8, () => r.game.publicState().desks['HR-LT-03'].occupantId === 'p3')).toBe(true);
    r.connect('a', 'p3');
    expect(r.game.publicState().desks['HR-LT-03']).toMatchObject({ occupantId: '', screen: 'unlocked' });
    r.sitAt('a', 'p3', 'HR-LT-03');
    expect(r.screen('a')).toMatchObject({ screen: 'shell', prompt: 'l.haddad@HR-LT-03:~$ ' });
  });
});

describe('what a human receives while bots work', () => {
  it("nothing from a bot's screen, and no bot's password", () => {
    const r = new Recorder({ bots: true });
    r.connect('a', 'p9'); // Maha, standing in Reception
    r.tick(minutes(10));
    expect(queryEvents(r.game.world, { type: 'command', since: START }).length).toBeGreaterThan(50); // bots really worked
    // She got her start screen, her card and her own task list - and nothing else, in particular no screen text.
    expect([...new Set(r.messages('a').map((m) => m.type))].sort()).toEqual(['lobby', 'tasks', 'welcome']);
    const everything = JSON.stringify({ sent: [...r.sent.values()], states: r.states });
    for (const account of scenario.accounts) {
      if (account.username !== 'm.yousef') expect(everything.includes(PW[account.username]), account.username).toBe(false);
    }
    expect(everything).not.toContain('invoices_feb'); // a file name Sara's bot typed
    expect(everything.toLowerCase()).not.toContain('bot');
  });
});

describe('observations', () => {
  it('a bot remembers who it saw in its room, and when they sat down', () => {
    const r = new Recorder({ bots: true });
    r.connect('a', 'p2'); // a human plays Rami, who shares the Finance room with Sara
    r.connect('b', 'p6'); // another human, in HR: a different room
    expect(runUntil(r, 8, () => r.game.bots!.observations('p1').some((o) => o.who === 'p2'))).toBe(true);
    const first = r.game.bots!.observations('p1').find((o) => o.who === 'p2')!;
    expect(first).toMatchObject({ name: 'Rami Mansour', room: 'Finance', desk: '' });
    expect(first.time).toBeGreaterThan(START);

    // Rami sits down: a new observation with the desk.
    r.sitAt('a', 'p2', 'FIN-LT-04');
    r.tick(TICK_RATE * 3);
    expect(r.game.bots!.observations('p1').at(-1)).toMatchObject({ who: 'p2', room: 'Finance', desk: 'FIN-LT-04' });
    // Standing in view for a while adds nothing: only changes are recorded.
    const count = r.game.bots!.observations('p1').length;
    r.tick(TICK_RATE * 20);
    expect(r.game.bots!.observations('p1').filter((o) => o.who === 'p2')).toHaveLength(r.game.bots!.observations('p1').slice(0, count).filter((o) => o.who === 'p2').length);
    // Walls block sight: everything Sara saw so far was in a room she was in herself.
    for (const o of r.game.bots!.observations('p1').filter((x) => x.who === 'p6')) expect(o.room).not.toBe('HR');
  });

  it('the security guard patrols: he leaves his office again and again', () => {
    const r = new Recorder({ bots: true });
    r.tick(minutes(20));
    const exits = r.file('SEC-SRV-01', '/var/log/badge/access.log').split('\n').filter((l) => l.startsWith('2026-03-02') && l.includes('DOOR=SEC-OFFICE') && l.includes('USER=t.omar') && l.endsWith('DIR=OUT'));
    expect(exits.length).toBeGreaterThanOrEqual(3);
    const rooms = new Set(r.game.bots!.observations('p10').map((o) => o.room));
    expect(rooms.size).toBeGreaterThanOrEqual(2); // he saw people in more than one room
  });
});

describe('developer views of the living office (development servers only)', () => {
  const show = (r: Recorder, what: string, arg?: string) => {
    r.send('a', 'dev.show', { what, arg });
    return (r.last('a', 'dev.result')?.payload as { text: string } | undefined)?.text ?? '';
  };

  it('show bots, tasks, doors, the badge log, a camera, what a bot saw, and any file', () => {
    const r = new Recorder({ bots: true, dev: true });
    r.connect('a', 'p9');
    r.tick(minutes(6));
    const bots = show(r, 'bots');
    expect(bots).toContain('Bots (9) and humans (1)');
    expect(bots).toMatch(/p1 +Sara Alharbi +FIN-LT-07 +tasks done +\d+ +(working|task: )/);
    expect(bots).toMatch(/p9 +Maha Yousef +HUMAN/);
    expect(show(r, 'tasks')).toMatch(/p5 +Khalid Nasser +done +\d+ +next: /);
    expect(show(r, 'doors')).toMatch(/MAIN-ENT +badge +(closed|OPEN)/);
    expect(show(r, 'badges')).toContain('DOOR=MAIN-ENT');
    expect(show(r, 'cctv', 'CAM-01')).toMatch(/CAM-01 Reception \(watches Reception; \d+ snapshots stored\)[\s\S]*Maha Yousef +tile \d+,\d+/);
    expect(show(r, 'saw', 'p1')).toMatch(/What p1 noticed[\s\S]*Rami Mansour +in Finance/);
    expect(show(r, 'file', 'ADMIN-SRV-01:/var/log/squid/access.log')).toContain('ms TCP_MISS DIRECT/');
    expect(show(r, 'file', 'ADMIN-SRV-01:/no/such/file')).toContain('(no file /no/such/file on ADMIN-SRV-01)');
    expect(show(r, 'unlocked')).toMatch(/PCs left unlocked by their user[\s\S]*HR-LT-03 +l\.haddad/);
    expect(show(r, 'nonsense')).toContain('Unknown view');
  });

  it('a production server answers none of it', () => {
    const r = new Recorder({ bots: true, dev: false });
    r.connect('a', 'p9');
    r.tick(minutes(1));
    for (const what of ['bots', 'tasks', 'doors', 'badges', 'cctv', 'saw', 'file']) expect(show(r, what, 'ADMIN-SRV-01:/etc/shadow')).toBe('');
    expect(r.messages('a', 'dev.result')).toEqual([]);
  });
});
