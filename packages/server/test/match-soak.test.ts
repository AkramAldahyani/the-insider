/**
 * Soak test of WHOLE MATCHES (Phase 5, part J): a full office of bots, one of
 * them the hacker, at the pace of a real game, from the first minute to the
 * debrief. Two questions:
 *
 *  - is a match healthy? It ends, nothing secret leaks before the end, the
 *    debrief describes it, nobody is stuck, and nothing happens afterwards;
 *  - is a match fair? The hacker does not win before a defender could have
 *    reacted, harder hackers are faster, and a defender who follows the
 *    evidence (and nothing else) can still win after the LAST alert.
 */
import { describe, expect, it } from 'vitest';
import { queryEvents, type GameEvent } from '@insider/engine';
import { PLAYER_RADIUS, isFree, type DebriefView } from '@insider/shared';
import { loadGameOptions } from '../src/app';
import type { HackerDifficulty } from '../src/bots/hacker-knowledge';
import { FAST_PACE, paceFor } from '../src/bots/hacker-pace';
import { PW, Recorder, scenario } from './helpers';

const LEVELS: HackerDifficulty[] = ['easy', 'normal', 'hard'];
const SEEDS = [1, 2, 3, 4, 5, 6];
const MINUTE = 60_000;
const START = Date.parse(scenario.startTime);
/** Ten steps a second: fine enough for walking, and a match of half an hour takes about a second. */
const STEP_MS = 100;

/** A match as a real server starts it: random weaknesses, and the hacker at the pace of its difficulty. */
function match(hackerDifficulty: HackerDifficulty, seed: number): Recorder {
  return new Recorder({ bots: true, weaknesses: 'random', seed, botOptions: { hacker: true, hackerDifficulty, hackerPace: undefined } });
}

/** Plays on until `done`, looking at everything the clients received once a second. */
function play(r: Recorder, done: () => boolean, minutes = 180): void {
  for (let i = 0; i < (minutes * MINUTE) / STEP_MS && !done(); i++) {
    r.game.tick(STEP_MS);
    if (i % 10 === 0) r.flush();
  }
  r.flush();
  expect(done(), JSON.stringify(r.game.bots!.list())).toBe(true);
}

const flagReads = (r: Recorder): GameEvent[] => queryEvents(r.game.world, { type: 'file.read', actor: r.game.world.mission.hacker! })
  .filter((e) => e.details.path === scenario.mission!.flagPath && !e.details.denied);

/** How long each match took, by level (filled by the first test, read by the second). */
const durations: Record<HackerDifficulty, number[]> = { easy: [], normal: [], hard: [] };

describe('soak: whole matches with nobody investigating', () => {
  it.each(LEVELS.flatMap((level) => SEEDS.map((seed) => ({ level, seed }))))('$level, seed $seed', ({ level, seed }) => {
    const r = match(level, seed);
    const pace = paceFor(level);
    const world = r.game.world;
    const hacker = world.mission.hacker!;
    const flagText = r.file(world.mission.flag!.host, world.mission.flag!.path).trim();
    expect(flagText.length).toBeGreaterThan(5);
    // Somebody who plays (and does nothing), and somebody still on the start screen.
    r.connect('player', 'p11');
    r.connect('lobby');
    let checked = 0;
    play(r, () => {
      if (++checked % 50 === 0) {
        for (const p of Object.values(r.game.publicState().players)) {
          if (!isFree(r.map, p.x, p.y, PLAYER_RADIUS)) throw new Error(`${p.name} is inside something at ${p.x},${p.y}`);
        }
      }
      return r.game.over !== null;
    });

    // ── Healthy ──
    const over = r.game.over!;
    expect(over.winner).toBe('hacker'); // nobody stopped it
    expect(r.game.bots!.list().filter((b) => b.failure && b.playerId !== hacker)).toEqual([]);
    for (const client of ['player', 'lobby']) {
      const types = r.sent.get(client)!.map((m) => m.type);
      expect(types.filter((t) => t === 'match.over')).toHaveLength(1);
      expect(types.filter((t) => t === 'debrief')).toHaveLength(1);
      // Before the end: no flag, nobody else's password, and not who the hacker is.
      const before = JSON.stringify(r.sent.get(client)!.slice(0, types.indexOf('match.over')));
      expect(before).not.toContain(flagText);
      for (const [user, password] of Object.entries(PW)) if (user !== 'h.rahman') expect(before, user).not.toContain(password);
      expect(before).not.toContain('hacker:');
    }
    const debrief = (r.last('lobby', 'debrief')!.payload as { debrief: DebriefView }).debrief;
    expect(debrief.totals.steps).toBeGreaterThan(0);
    // (Nobody looked at anything, but a bot working on the server may have had a line on its screen: "seen".)
    expect(debrief.totals).toMatchObject({ pinned: 0 });
    expect(debrief.steps.at(-1)!.title).toBe('Handed in the flag');
    expect(debrief.steps.some((s) => s.title.startsWith('Read the flag'))).toBe(true);
    for (const password of Object.values(PW)) expect(JSON.stringify(debrief)).not.toContain(password);
    // It did its own job too: its trail lies between ordinary commands.
    expect(queryEvents(world, { type: 'command', actor: hacker }).length).toBeGreaterThan(10);

    // ── Fair ──
    const arrived = queryEvents(world, { type: 'badge.tap', actor: hacker })[0].time;
    const sessions = queryEvents(world, { type: 'command', actor: hacker }).filter((e) => /^(ssh '|~\/\.tools|scp )/.test(String(e.details.command)));
    // (Its ordinary work includes ssh to the server as well; the hacker quotes the address.)
    expect(sessions[0].time - arrived, 'first attempt after ordinary work').toBeGreaterThan((pace.coverMinutes[0] - 0.5) * MINUTE);
    // Reading the flag raises a HIGH alert. From then on there is time to act.
    const read = flagReads(r).at(-1)!;
    expect(over.at - read.time, 'time between reading the flag and handing it in').toBeGreaterThanOrEqual(pace.handInMinutes[0] * MINUTE);
    expect(r.messages('player', 'alert').length).toBeGreaterThan(0);
    durations[level].push((over.at - START) / MINUTE);

    // ── Over is over ──
    const end = JSON.stringify(world);
    r.game.tick(MINUTE);
    expect(JSON.stringify(r.game.world)).toBe(end);
  }, 60_000);

  it('a match leaves time to play, and a harder hacker is a faster one', () => {
    const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    for (const level of LEVELS) expect(durations[level]).toHaveLength(SEEDS.length);
    // Before part J every one of these was over within 3 to 7 minutes.
    expect(Math.min(...durations.easy)).toBeGreaterThan(14);
    expect(Math.min(...durations.normal)).toBeGreaterThan(10);
    expect(Math.min(...durations.hard)).toBeGreaterThan(7);
    expect(median(durations.easy)).toBeGreaterThan(median(durations.normal));
    expect(median(durations.normal)).toBeGreaterThan(median(durations.hard));
    // Nor do they drag on for hours.
    expect(Math.max(...LEVELS.flatMap((l) => durations[l]))).toBeLessThan(60);
  });
});

describe('a defender who follows the evidence wins', () => {
  /**
   * Huda, the SOC analyst, played the way a person would: she does nothing
   * until the SIEM shows that somebody READ THE FLAG (the last alert there is),
   * then works out who it was from her own screen:
   *
   *   alert -> the address it came from -> the PC that has this address -> whose PC that is (the staff list).
   */
  it.each(LEVELS.flatMap((level) => [1, 2, 3].map((seed) => ({ level, seed }))))('$level, seed $seed: even when she only reacts to the last alert', ({ level, seed }) => {
    const r = match(level, seed);
    r.connect('soc', 'p11');
    expect(r.sitAt('soc', 'p11', 'SOC-WS-01')).toBe(true);
    r.type('soc', PW['h.rahman']);
    let row = '';
    let waited = 0;
    play(r, () => {
      // A look at the alerts every 20 seconds.
      if (waited++ % 200 === 0) row = r.type('soc', 'siem source=alert rule=flag-read').split('\n').find((l) => l.includes('rule=flag-read')) ?? '';
      return row !== '' || r.game.over !== null;
    });
    expect(r.game.over).toBeNull();

    const pin = (text: string) => r.send('soc', 'evidence.pin', { kind: 'screen', text });
    pin(row);
    const ip = /src_ip=(\S+)/.exec(row)![1];
    const lease = r.type('soc', `siem source=dhcp ip=${ip} | tail 1`).split('\n').find((l) => l.includes('client='))!;
    pin(lease);
    const pc = /client=(\S+)/.exec(lease)![1];
    const login = r.type('soc', `siem source=auth host=ADMIN-SRV-01 action=login src_ip=${ip} | tail 1`).split('\n').find((l) => l.includes('action=login'))!;
    pin(login);
    expect(r.game.board.items).toHaveLength(3);
    // The staff list says who works at that PC (everybody may know that).
    const suspect = scenario.players.find((p) => p.desk === pc)!.id;
    expect(suspect).toBe(r.game.world.mission.hacker);

    r.send('soc', 'stand');
    const button = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('soc', 'p11', button.x + button.width / 2, button.y + button.height + 14)).toBe(true);
    r.send('soc', 'meeting.call');
    expect(r.game.meetings.current, r.notice('soc')).not.toBeNull();
    r.send('soc', 'meeting.accuse', { suspect, evidence: r.game.board.items.map((i) => i.id) });
    play(r, () => r.game.meetings.current?.phase === 'voting', 3);
    r.send('soc', 'meeting.vote', { target: suspect });
    play(r, () => r.game.over !== null, 3);

    expect(r.game.over!.winner).toBe('defenders');
    const debrief = (r.last('soc', 'debrief')!.payload as { debrief: DebriefView }).debrief;
    expect(debrief.steps.find((s) => s.title.startsWith('Read the flag'))).toMatchObject({ status: 'pinned' });
    expect(debrief.meetings[0]).toMatchObject({ calledBy: 'Huda Rahman', wasHacker: true, accusations: [{ right: true }] });
    expect(debrief.steps.some((s) => s.title === 'Handed in the flag')).toBe(false);
  }, 60_000);

  it('the guard can walk up to the hacker in that time, too', () => {
    const r = match('normal', 2);
    const hacker = r.game.world.mission.hacker!;
    r.connect('guard', 'p10');
    play(r, () => flagReads(r).length > 0, 60);
    for (let tries = 0; tries < 20 && !r.game.over; tries++) {
      const at = r.position(hacker);
      const desk = r.map.desks.find((d) => d.hostname === r.game.publicState().players[hacker].seatedAt);
      r.walkTo('guard', 'p10', desk ? desk.seatX : at.x, desk ? desk.seatY + 32 : at.y);
      r.send('guard', 'detain', { target: hacker });
    }
    expect(r.game.over?.winner).toBe('defenders');
  }, 60_000);
});

describe('the pace setting', () => {
  it('belongs to the difficulty unless BOT_HACKER_PACE=fast', () => {
    expect(loadGameOptions().botOptions?.hackerPace).toBeUndefined();
    expect(loadGameOptions({ botHackerPace: 'normal' }).botOptions?.hackerPace).toBeUndefined();
    expect(loadGameOptions({ botHackerPace: 'fast' }).botOptions?.hackerPace).toBe(FAST_PACE);
    expect(() => loadGameOptions({ botHackerPace: 'slow' })).toThrow('BOT_HACKER_PACE');
  });

  it('a meeting makes the hacker lie low for a while before it goes on', () => {
    const r = new Recorder({
      bots: true, weaknesses: ['plaintext-password'], seed: 2, botOptions: { hacker: true, hackerPace: undefined },
      meetingTimes: { discussionMs: 5000, votingMs: 5000, resultMs: 1000 },
    });
    r.connect('m', 'p9');
    const hacker = r.game.world.mission.hacker!;
    const button = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('m', 'p9', button.x + button.width / 2, button.y + button.height + 14)).toBe(true);
    play(r, () => flagReads(r).length > 0, 60);
    r.send('m', 'meeting.call');
    play(r, () => r.game.meetings.current === null, 3);
    const after = r.game.world.time;
    play(r, () => r.game.over !== null, 60);
    const next = queryEvents(r.game.world, { type: 'command', actor: hacker }).find((e) => e.time > after && /^ssh '/.test(String(e.details.command)))!;
    expect(next.time - after).toBeGreaterThanOrEqual(paceFor('normal').restMinutes[0] * MINUTE);
    // Interrupted before it could hand the flag in, it had to read it again: a second chance for the defenders.
    expect(flagReads(r)).toHaveLength(2);
  });
});
