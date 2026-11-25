import { describe, expect, it } from 'vitest';
import { queryEvents, type WeaknessId } from '@insider/engine';
import { loadGameOptions } from '../src/app';
import type { HackerDifficulty } from '../src/bots/hacker-knowledge';
import { clone, PW, Recorder, scenario } from './helpers';

function match(weaknesses: WeaknessId[] = ['plaintext-password'], seed = 1): Recorder {
  // Preserve Part F's fully informed route checks; difficulty coverage below exercises the new default.
  return new Recorder({ bots: true, botOptions: { hacker: true, hackerDifficulty: 'hard' }, weaknesses, seed });
}

/** Real movement and normal paced input; avoid recording a snapshot on every tick. */
function until(r: Recorder, done: () => boolean, seconds = 1200): void {
  for (let i = 0; i < seconds * 10 && !done(); i++) {
    r.game.tick(100);
    if (i % 10 === 0) r.flush();
  }
  r.flush();
  expect(done(), JSON.stringify(r.game.bots?.list())).toBe(true);
}

function hackerId(r: Recorder): string { return r.game.world.mission.hackers[0]!; }
const hasEvent = (r: Recorder, type: string) => r.game.world.events.some((e) => e.type === type && e.actor === hackerId(r));

describe('Phase 5 F: automatic hacker', () => {
  it('selects employees uniformly without following mistaken sudo or enabled weaknesses', () => {
    const counts = new Map<string, number>();
    const seeds = 210;
    let matchesSudo = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = match(['extra-sudo'], seed);
      const selected = r.game.world.players.find((p) => p.id === hackerId(r))!;
      expect(selected.role).toBe('employee');
      counts.set(selected.id, (counts.get(selected.id) ?? 0) + 1);
      if (selected.account === r.game.world.mission.extraSudoAccount) matchesSudo++;
      if (seed <= 12) {
        expect(hackerId(match([], seed))).toBe(selected.id);
        const changed = clone(scenario);
        changed.mission!.extraSudo!.candidates = [selected.account];
        const other = new Recorder({ scenario: changed, bots: true, botOptions: { hacker: true }, weaknesses: ['extra-sudo'], seed });
        expect(hackerId(other)).toBe(selected.id);
      }
    }
    const n = scenario.players.filter((p) => p.role === 'employee').length;
    const expected = seeds / n;
    // Fixed seeds plus broad bounds catch selection bias without relying on a lucky sample.
    expect(counts.size).toBe(n);
    for (const count of counts.values()) expect(Math.abs(count - expected)).toBeLessThan(expected * 0.7);
    expect(Math.abs(matchesSudo - expected)).toBeLessThan(expected * 0.7);
  });

  it.each([1, 7, 19])('can win without owning mistaken sudo (seed %i)', (seed) => {
    const r = match(['extra-sudo'], seed);
    const selected = r.game.world.players.find((p) => p.id === hackerId(r))!;
    expect(selected.account).not.toBe(r.game.world.mission.extraSudoAccount);
    until(r, () => r.game.over !== null, 7200); // waiting for the administrator is a matter of luck
    expect(r.game.over?.winner).toBe('hacker');
    expect(hasEvent(r, 'keylogger.capture') || hasEvent(r, 'shoulder.surf')).toBe(true);
  });

  it('is enabled in normal server settings, seed-stable, and disabled independently of employee bots', () => {
    expect(loadGameOptions().botOptions?.hacker).toBe(true);
    expect(loadGameOptions({ botHacker: false }).botOptions?.hacker).toBe(false);
    const first = match();
    expect(hackerId(first)).toBe(hackerId(match()));
    expect(first.game.bots?.has(hackerId(first))).toBe(true);
    expect(new Recorder({ bots: true }).game.world.mission.hackers).toEqual([]);
    expect(new Recorder({ bots: false, botOptions: { hacker: true } }).game.world.mission.hackers).toEqual([]);
    const plain = clone(scenario);
    delete plain.mission;
    expect(new Recorder({ scenario: plain, bots: true, botOptions: { hacker: true } }).game.world.mission.hackers).toEqual([]);
  });

  it.each(['plaintext-password', 'extra-sudo', 'weak-admin-password'] as WeaknessId[])('finishes a whole bot-only match using %s, with ordinary evidence and no direct flag grant', (weakness) => {
    let r = match([weakness]);
    if (weakness === 'extra-sudo') {
      // This route test deliberately grants sudo to the independently selected hacker.
      // Separate tests above exercise the more common case where somebody else has it.
      const content = clone(scenario);
      content.mission!.extraSudo!.candidates = [r.game.world.players.find((p) => p.id === hackerId(r))!.account];
      r = new Recorder({ scenario: content, bots: true, botOptions: { hacker: true, hackerDifficulty: 'hard' }, weaknesses: [weakness] });
    }
    const actor = hackerId(r);
    until(r, () => r.game.over !== null);
    expect(r.game.over?.winner).toBe('hacker');
    const reads = queryEvents(r.game.world, { type: 'file.read', actor }).filter((e) => e.details.path === '/root/flag.txt' && !e.details.denied);
    expect(reads).toHaveLength(1);
    expect(queryEvents(r.game.world, { type: 'mission.won', actor })).toHaveLength(1);
    expect(hasEvent(r, 'ssh.accept')).toBe(true);
    const commands = queryEvents(r.game.world, { type: 'command', actor }).map((e) => String(e.details.command));
    expect(commands).not.toContain('find / -type f'); // Hard keeps Part F's direct, informed routes.
    expect(r.file('ADMIN-SRV-01', '/var/log/audit/audit.log')).toContain('flag-read');
    expect(r.file('ADMIN-SRV-01', '/var/log/auth.log')).toContain('Accepted password');
    const finished = JSON.stringify(r.game.world);
    r.game.tick(60_000);
    expect(JSON.stringify(r.game.world)).toBe(finished);
  });

  it('learns changed root and flag values from terminal output, and keeps them off public state and defender messages', () => {
    const content = clone(scenario);
    const server = content.hosts.find((h) => h.hostname === content.mission!.flagHost)!;
    server.rootPassword!.password = 'Only-in-this-fixture!61';
    server.files!.find((f) => f.path === content.mission!.flagPath)!.content = 'TRAINING{fresh-fictional-flag}';
    const r = new Recorder({ scenario: content, bots: true, botOptions: { hacker: true }, weaknesses: ['plaintext-password'] });
    const defender = r.game.world.players.find((p) => p.id !== hackerId(r))!;
    r.connect('defender', defender.id);
    r.connect('lobby');
    until(r, () => r.game.over !== null);
    expect(r.last('defender', 'match.over')?.payload).toMatchObject({ winner: 'hacker' });
    const seen = JSON.stringify({ messages: [...r.sent], states: r.states });
    expect(seen).not.toContain(server.rootPassword!.password);
    expect(seen).not.toContain('TRAINING{fresh-fictional-flag}');
    expect(seen).not.toContain('hacker: backup');
    expect(r.messages('defender', 'welcome')[0].payload).toMatchObject({ mission: null });
  });

  it.each([1, 7, 19, 42])('finishes a default randomized office with seed %i', (seed) => {
    const r = new Recorder({ bots: true, botOptions: { hacker: true }, weaknesses: 'random', seed });
    until(r, () => r.game.over !== null, 1800);
    expect(r.game.over?.winner).toBe('hacker');
  });

  it('replays the same seeded bot-only match with the same actions and timing', () => {
    const first = match(['plaintext-password'], 7);
    const second = match(['plaintext-password'], 7);
    until(first, () => first.game.over !== null);
    until(second, () => second.game.over !== null);
    expect(second.game.over).toEqual(first.game.over);
    expect(second.game.world.events).toEqual(first.game.world.events);
  });

  it('lets a human take over the same hacker identity without duplicating the controller', () => {
    const r = match();
    const id = hackerId(r);
    r.connect('human', id);
    expect(hackerId(r)).toBe(id);
    expect(r.game.bots?.has(id)).toBe(false);
    expect((r.last('human', 'welcome')?.payload as { mission: unknown }).mission).not.toBeNull();
    for (let i = 0; i < 600; i++) r.game.tick(100);
    expect(hasEvent(r, 'mission.won')).toBe(false);
    r.game.disconnect('human');
    until(r, () => r.game.over !== null);
    expect(r.game.over?.winner).toBe('hacker');
  });

  it('stops the old controller when a human chooses another employee as the hacker', () => {
    const r = match();
    const previous = hackerId(r);
    until(r, () => r.game.bots!.list().some((b) => b.playerId === previous && b.doing.startsWith('hacker:')));
    r.connect('human');
    const next = r.game.world.players.find((p) => p.id !== previous)!.id;
    r.send('human', 'choose', { playerId: next, hacker: true });
    const before = r.game.world.events.length;
    for (let i = 0; i < 1200; i++) r.game.tick(100);
    expect(hackerId(r)).toBe(next);
    expect(r.game.bots!.list().find((b) => b.playerId === previous)?.doing).not.toMatch(/^hacker:/);
    expect(r.game.world.events.slice(before).filter((e) => e.actor === previous && e.type === 'mission.won')).toEqual([]);
    expect(r.game.over).toBeNull();
  });
});

describe('bot hacker difficulty in complete matches', () => {
  const cases = (['easy', 'normal', 'hard'] as HackerDifficulty[]).flatMap((difficulty) =>
    [1, 7, 19].map((seed) => ({ difficulty, seed })));

  it.each(cases)('$difficulty finds a fallback after false rumours (seed $seed)', ({ difficulty, seed }) => {
    // All three direct rumours are false. No plaintext password, mistaken sudo or weak password
    // is available: success must come from the existing physical simulation and observed input.
    const r = new Recorder({ bots: true, botOptions: { hacker: true, hackerDifficulty: difficulty }, weaknesses: [], seed });
    until(r, () => r.game.over !== null, 7200); // waiting for the administrator is a matter of luck
    expect(r.game.over?.winner).toBe('hacker');
    expect(hasEvent(r, 'keylogger.capture') || hasEvent(r, 'shoulder.surf')).toBe(true);
    if (difficulty !== 'hard') {
      const log = r.file('ADMIN-SRV-01', '/var/log/auth.log');
      const actor = r.game.world.players.find((p) => p.id === hackerId(r))!;
      expect(log.replace(/\s+/g, ' ')).toContain(`sudo: ${actor.account} : user NOT in sudoers`);
      expect(log).toContain('Failed password for k.nasser');
      const commands = queryEvents(r.game.world, { type: 'command', actor: actor.id }).map((e) => e.details.command);
      expect(commands).toContain('find / -type f');
    }
  });

  it('Easy discovers a changed backup path through its terminal, not scenario metadata', () => {
    const content = clone(scenario);
    content.mission!.plaintextPassword!.path = '/srv/shared/old/maintenance.sh';
    const r = new Recorder({ scenario: content, bots: true, botOptions: { hacker: true, hackerDifficulty: 'easy' }, weaknesses: ['plaintext-password'] });
    until(r, () => r.game.over !== null);
    const commands = queryEvents(r.game.world, { type: 'command', actor: hackerId(r) }).map((e) => String(e.details.command));
    const find = commands.indexOf('find / -type f');
    const read = commands.findIndex((line) => line.includes('cat') && line.includes('/srv/shared/old/maintenance.sh'));
    expect(find).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(find);
    expect(commands.join('\n')).not.toContain('backup-2025');
    expect(r.game.over?.winner).toBe('hacker');
  });

  it('Normal replays both knowledge-driven route choices and evidence exactly', () => {
    const options = { bots: true, botOptions: { hacker: true, hackerDifficulty: 'normal' as const }, weaknesses: 'random' as const, seed: 7 };
    const a = new Recorder(options);
    const b = new Recorder(options);
    until(a, () => a.game.over !== null, 3600);
    until(b, () => b.game.over !== null, 3600);
    expect(hackerId(a)).toBe(hackerId(b));
    expect(a.game.over).toEqual(b.game.over);
    expect(a.game.world.events).toEqual(b.game.world.events);
  });
});

describe('physical hacker routes and defender intervention', () => {
  function physical(): Recorder {
    const r = match(['careless-admin']);
    r.connect('admin', 'p5');
    // Isolate the two bodies for deliberate input timing; both still obey the real game rules.
    for (const b of r.game.bots!.list()) if (b.playerId !== hackerId(r)) r.game.bots!.remove(b.playerId);
    r.sitAt('admin', 'p5', 'IT-WS-02');
    r.type('admin', PW['k.nasser']);
    return r;
  }

  it('uses only partial views while standing behind the administrator, then authenticates normally', () => {
    const r = physical();
    const chair = r.map.desks.find((d) => d.hostname === 'IT-WS-02')!;
    until(r, () => {
      const p = r.game.publicState().players[hackerId(r)];
      return !!p && Math.hypot(p.x - chair.seatX, p.y - chair.seatY - 32) < 3;
    });
    for (let i = 0; i < 24; i++) {
      r.type('admin', 'loginctl lock-session');
      r.type('admin', PW['k.nasser']);
    }
    expect(hasEvent(r, 'shoulder.surf')).toBe(true);
    until(r, () => r.game.over !== null);
    expect(r.game.over?.winner).toBe('hacker');
    expect(r.game.world.toolkit.backdoors).toHaveLength(0);
  });

  it('uses a real USB hold at an unattended PC, then learns the password from its simulated recorder output', () => {
    const r = physical();
    r.send('admin', 'stand');
    until(r, () => hasEvent(r, 'keylogger.install'));
    expect(hasEvent(r, 'usb.insert')).toBe(true);
    expect(hasEvent(r, 'backdoor.install')).toBe(true);
    expect(r.sitAt('admin', 'p5', 'IT-WS-02')).toBe(true);
    r.type('admin', 'loginctl lock-session');
    r.type('admin', PW['k.nasser']);
    expect(hasEvent(r, 'keylogger.capture')).toBe(true);
    until(r, () => r.game.over !== null);
    expect(r.game.over?.winner).toBe('hacker');
  });

  it('does not invent access when a backup is removed and the target stays locked', () => {
    const r = match();
    r.connect('admin', 'p5');
    for (const b of r.game.bots!.list()) if (b.playerId !== hackerId(r)) r.game.bots!.remove(b.playerId);
    const shared = r.game.world.hosts['ADMIN-SRV-01'].fs.children!.srv.children!.shared.children!.old.children!;
    delete shared['backup-2025.sh'];
    for (let i = 0; i < 9000; i++) r.game.tick(100);
    expect(r.game.over).toBeNull();
    expect(hasEvent(r, 'mission.won')).toBe(false);
    expect(r.game.world.toolkit.backdoors).toHaveLength(0);
    expect(r.game.bots!.list().find((b) => b.playerId === hackerId(r))?.doing).toContain('physical');
  });

  it('a defender can remove the recorder before typing; the bot cannot recover the deleted data', () => {
    const r = physical();
    r.send('admin', 'stand');
    until(r, () => hasEvent(r, 'keylogger.install'));
    const record = r.game.world.toolkit.keyloggers[0];
    r.sitAt('admin', 'p5', 'IT-WS-02');
    r.type('admin', `rm ${record.path}`);
    r.type('admin', 'loginctl lock-session');
    r.type('admin', PW['k.nasser']);
    for (let i = 0; i < 1800; i++) r.game.tick(100);
    expect(hasEvent(r, 'keylogger.capture')).toBe(false);
    expect(r.game.over).toBeNull();
    expect(r.file('IT-WS-02', record.path)).toBe('');
  });

  it('can resume reading an already installed recorder after a meeting', () => {
    const r = physical();
    r.connect('caller', 'p9');
    const button = r.map.furniture.find((f) => f.kind === 'button')!;
    r.walkTo('caller', 'p9', button.x + button.width / 2, button.y + button.height + 14);
    r.send('admin', 'stand');
    until(r, () => hasEvent(r, 'keylogger.install'));
    r.send('caller', 'meeting.call');
    expect(r.game.meetings.current).not.toBeNull();
    until(r, () => r.game.meetings.current === null, 160);
    r.sitAt('admin', 'p5', 'IT-WS-02');
    r.type('admin', 'loginctl lock-session');
    r.type('admin', PW['k.nasser']);
    until(r, () => r.game.over !== null);
    expect(r.game.over?.winner).toBe('hacker');
    expect(r.game.world.toolkit.keyloggers).toHaveLength(1);
  });

  it('a helpdesk lock interrupts a pending password step without typing that password into a shell', () => {
    const r = match();
    const help = r.game.world.players.find((p) => p.role === 'helpdesk')!;
    const hacker = r.game.world.players.find((p) => p.id === hackerId(r))!;
    r.connect('help', help.id);
    r.sitAt('help', help.id, help.desk);
    if (r.screen('help').screen === 'login' && !r.screen('help').masked) r.type('help', help.account);
    r.type('help', PW[help.account]);
    until(r, () => {
      const mind = r.game.bots!.mind(hacker.id);
      return mind?.doing === 'hacker: backup / script' && mind.screen?.awaitingInput?.masked === true;
    });
    expect(r.type('help', `helpdesk lock ${hacker.desk}`)).toContain('locked');
    for (let i = 0; i < 60; i++) r.game.tick(100);
    expect(r.game.over).toBeNull();
    const commands = queryEvents(r.game.world, { type: 'command', actor: hacker.id }).map((e) => e.details.command);
    expect(commands).not.toContain(PW[hacker.account]);
    // It gave up and went back to ordinary work for a while.
    expect(r.game.bots!.list().find((b) => b.playerId === hacker.id)?.doing).not.toContain('hacker:');
  });

  it('a meeting pauses the hacker and it can resume through checked terminal actions afterwards', () => {
    const r = new Recorder({ bots: true, botOptions: { hacker: true }, weaknesses: ['plaintext-password'],
      meetingTimes: { discussionMs: 20_000, votingMs: 5000, resultMs: 1000 } });
    r.connect('caller', 'p9');
    const button = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('caller', 'p9', button.x + button.width / 2, button.y + button.height + 14)).toBe(true);
    until(r, () => r.game.bots!.list().some((b) => b.playerId === hackerId(r) && b.doing === 'hacker: backup / script'));
    r.send('caller', 'meeting.call');
    expect(r.game.meetings.current).not.toBeNull();
    const before = r.game.world.events.length;
    const at = r.game.publicState().players[hackerId(r)];
    for (let i = 0; i < 100; i++) r.game.tick(100);
    expect(r.game.publicState().players[hackerId(r)]).toEqual(at);
    expect(r.game.world.events.slice(before).filter((e) => e.actor === hackerId(r) && e.type === 'command')).toEqual([]);
    until(r, () => r.game.over !== null);
    expect(r.game.over?.winner).toBe('hacker');
  });

  it('the guard can detain the bot hacker; no more bot actions or role changes occur after the win', () => {
    const r = match();
    const guard = r.game.world.players.find((p) => p.role === 'guard')!;
    r.connect('guard', guard.id);
    const player = r.game.world.players.find((p) => p.id === hackerId(r))!;
    until(r, () => r.game.publicState().players[player.id]?.seatedAt === player.desk);
    const chair = r.map.desks.find((d) => d.hostname === player.desk)!;
    expect(r.walkTo('guard', guard.id, chair.seatX, chair.seatY + 32)).toBe(true);
    r.send('guard', 'detain', { target: player.id });
    expect(r.game.over?.winner).toBe('defenders');
    const state = JSON.stringify(r.game.world);
    r.connect('late');
    r.send('late', 'choose', { playerId: 'p4', hacker: true });
    r.game.tick(60_000);
    expect(JSON.stringify(r.game.world)).toBe(state);
  });

  it('a meeting can vote out the bot hacker and finish the match for defenders', () => {
    const r = new Recorder({ bots: true, botOptions: { hacker: true }, weaknesses: ['plaintext-password'],
      meetingTimes: { discussionMs: 5000, votingMs: 5000, resultMs: 1000 } });
    for (const b of r.game.bots!.list()) if (b.playerId !== hackerId(r)) r.game.bots!.remove(b.playerId);
    r.connect('caller', 'p9');
    const player = r.game.world.players.find((p) => p.id === 'p9')!;
    r.sitAt('caller', player.id, player.desk);
    r.type('caller', PW[player.account]);
    for (const command of ['hostname', 'whoami', 'pwd']) {
      r.send('caller', 'evidence.pin', { kind: 'screen', text: r.type('caller', command).trim() });
    }
    r.send('caller', 'stand');
    const button = r.map.furniture.find((f) => f.kind === 'button')!;
    r.walkTo('caller', 'p9', button.x + button.width / 2, button.y + button.height + 14);
    until(r, () => r.game.bots!.isPresent(hackerId(r)));
    r.send('caller', 'meeting.call');
    r.send('caller', 'meeting.accuse', { suspect: hackerId(r), evidence: r.game.board.items.map((item) => item.id) });
    for (let i = 0; i < 55; i++) r.game.tick(100);
    r.send('caller', 'meeting.vote', { target: hackerId(r) });
    until(r, () => r.game.over !== null, 20);
    expect(r.game.over?.winner).toBe('defenders');
  });
});
