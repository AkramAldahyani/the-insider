/**
 * Phase 5a, part H: whole solo matches, for a long time. A browser is told no
 * secrets in either mode, nobody gets stuck, what is capped stays capped, and
 * somebody who only does their job is never accused.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, SOLO_DIFFICULTIES, isFree, type DebriefView, type SoloChoice } from '@insider/shared';
import { soloGameOptions } from '../src/solo';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small' };

/** A solo match exactly as the room starts it. */
function start(choice: SoloChoice, seed: number): { r: Recorder; me: (typeof scenario.players)[number] } {
  const o = soloGameOptions(base, choice, seed);
  const r = new Recorder({ ...o, botOptions: { ...o.botOptions, hackerPace: undefined } });
  r.connect('me');
  return { r, me: scenario.players.find((p) => p.id === o.soloPlayer)! };
}

/** Plays on for a number of game minutes, checking the bodies twice a minute. */
function live(r: Recorder, minutes: number): void {
  for (let i = 0; i < minutes * 600 && !r.game.over; i++) {
    r.game.tick(100);
    if (i % 10 === 0) r.flush();
    if (i % 300 !== 0) continue;
    for (const p of Object.values(r.game.publicState().players)) {
      if (!isFree(r.map, p.x, p.y, PLAYER_RADIUS)) throw new Error(`${p.name} is inside something at ${p.x},${p.y}`);
    }
  }
  r.flush();
}

/** Everything this browser was sent before the end of the match. */
function before(r: Recorder): string {
  const all = r.sent.get('me')!;
  const end = all.findIndex((m) => m.type === 'match.over');
  return JSON.stringify(end < 0 ? all : all.slice(0, end));
}

describe('Investigation, played by somebody who does nothing', () => {
  it.each(SOLO_DIFFICULTIES)('%s: it ends, and nothing secret arrives before the end', (difficulty) => {
    for (const seed of [21, 22]) {
      const { r, me } = start({ mode: 'investigation', role: 'guard', difficulty }, seed);
      const flag = r.file('ADMIN-SRV-01', '/root/flag.txt').trim();
      live(r, 90);
      expect(r.game.over?.winner, `seed ${seed}`).toBe('hacker');
      const text = before(r);
      expect(text).not.toContain(flag);
      for (const [user, password] of Object.entries(PW)) if (user !== me.account) expect(text, user).not.toContain(password);
      for (const word of ['"debrief"', 'shown"', 'mission.trail', 'hacker:', 'convening', 'suspected']) expect(text).not.toContain(word);
      const types = r.sent.get('me')!.map((m) => m.type);
      expect(types.filter((t) => t === 'debrief')).toHaveLength(1);
      expect(types.indexOf('debrief')).toBeGreaterThan(types.indexOf('match.over'));
      expect(r.game.bots!.list().filter((b) => b.failure && b.playerId !== r.game.world.mission.hackers[0])).toEqual([]);
      // Nobody accuses anybody in Investigation except the player.
      expect(r.game.meetings.history).toEqual([]);
      expect(r.game.detentions).toEqual([]);
    }
  }, 60_000);
});

describe('Infiltration, played by somebody who only works', () => {
  it.each(SOLO_DIFFICULTIES)('%s: two hours, and they are left alone', (difficulty) => {
    const { r, me } = start({ mode: 'infiltration', role: 'any', difficulty }, 31);
    expect(r.sitAt('me', me.id, me.desk)).toBe(true);
    if (r.screen('me').screen === 'login') r.type('me', me.account);
    if (r.screen('me').screen !== 'shell') r.type('me', PW[me.account]);
    for (let half = 0; half < 4; half++) {
      r.type('me', 'ssh ADMIN-SRV-01');
      r.type('me', PW[me.account]);
      r.type('me', 'uptime');
      r.type('me', 'exit');
      live(r, 30);
    }
    expect(r.game.over).toBeNull();
    expect(r.game.meetings.history).toEqual([]);
    expect(r.game.detentions).toEqual([]);
    expect(r.game.reputation).toBe(100);
    expect(r.game.board.items.length).toBeLessThanOrEqual(40);
    expect(r.game.bots!.list().filter((b) => b.failure)).toEqual([]);
    expect(Object.keys(r.game.publicState().players)).toHaveLength(scenario.players.length);
    // The hacker's browser learns nothing about the others either.
    const text = before(r);
    for (const [user, password] of Object.entries(PW)) if (user !== me.account) expect(text, user).not.toContain(password);
    for (const word of ['shown"', 'convening', 'suspected', 'weakness']) expect(text).not.toContain(word);
    // What is capped stays capped, and the world a modest size.
    for (const p of scenario.players) expect(r.game.bots!.findings(p.id).length).toBeLessThanOrEqual(40);
    expect(Object.keys(r.game.world.sessions).length).toBeLessThan(40);
    expect(r.game.world.events.length).toBeLessThan(80_000);
  }, 120_000);

  it('a caught hacker gets the debrief once, with the rating, and passwords hidden', () => {
    const o = soloGameOptions({ ...base, weaknesses: ['plaintext-password'] }, { mode: 'infiltration', role: 'any', difficulty: 'hard' }, 32);
    const r = new Recorder({ ...o, meetingTimes: { ...o.meetingTimes, discussionMs: 20_000, votingMs: 15_000, resultMs: 1000 } });
    r.connect('me');
    const me = scenario.players.find((p) => p.id === o.soloPlayer)!;
    r.sitAt('me', me.id, me.desk);
    if (r.screen('me').screen === 'login') r.type('me', me.account);
    if (r.screen('me').screen !== 'shell') r.type('me', PW[me.account]);
    r.type('me', 'ssh ADMIN-SRV-01');
    r.type('me', PW[me.account]);
    const script = r.type('me', 'cat /srv/shared/old/backup-2025.sh');
    r.type('me', 'su');
    r.type('me', /ROOT_PW='([^']+)'/.exec(script)![1]);
    r.type('me', 'cat /root/flag.txt');
    live(r, 20);
    expect(r.game.over?.winner).toBe('defenders');
    const sent = r.sent.get('me')!.filter((m) => m.type === 'debrief');
    expect(sent).toHaveLength(1);
    const d = (sent[0].payload as { debrief: DebriefView }).debrief;
    expect(d.rating!.lines.length).toBeGreaterThanOrEqual(2);
    for (const password of Object.values(PW)) expect(JSON.stringify(d)).not.toContain(password);
    // After the end nothing changes any more.
    const end = JSON.stringify(r.game.world);
    for (let i = 0; i < 600; i++) r.game.tick(100);
    expect(JSON.stringify(r.game.world)).toBe(end);
  }, 60_000);
});

describe('many matches', () => {
  it('the same seed and the same player behaviour give the same match', () => {
    const run = () => {
      const { r } = start({ mode: 'investigation', role: 'any', difficulty: 'normal' }, 41);
      live(r, 60);
      return { over: r.game.over, events: r.game.world.events.length, hacker: r.game.world.mission.hackers[0] };
    };
    expect(run()).toEqual(run());
  }, 60_000);

  it('a match costs the server little: at least a hundred at once would fit on one processor', () => {
    const { r } = start({ mode: 'infiltration', role: 'any', difficulty: 'hard' }, 42);
    for (let i = 0; i < 600; i++) r.game.tick(100); // everybody arrives
    const ticks = 20 * 120; // two minutes
    const began = process.hrtime.bigint();
    for (let i = 0; i < ticks; i++) {
      r.game.tick(50);
      r.game.publicState();
      r.game.drain();
    }
    const perSecond = Number(process.hrtime.bigint() - began) / 1e6 / 120;
    // Measured 0.1 to 0.9 ms per second of play; ten times that still passes, so a busy machine does not fail this.
    expect(perSecond).toBeLessThan(10);
  }, 30_000);
});
