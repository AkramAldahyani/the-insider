/**
 * Phase 5a, part G: the scenario ladder. Every level can be won the way its
 * briefing hints at, and from level to level it gets harder to be careless.
 */
import { describe, expect, it } from 'vitest';
import { LADDER, defenderChoice, ladderLevel, parseOfficeMap, parseSoloChoice, withCameras, type DebriefView, type MissionBriefing } from '@insider/shared';
import { LADDER_SETTINGS } from '../src/ladder';
import { checkMapAgainstScenario } from '../src/mapCheck';
import { soloGameOptions } from '../src/solo';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small' };
const choice = (level: number) => ({ mode: 'infiltration' as const, role: 'any' as const, difficulty: 'normal' as const, level });
const EASY_PASSWORD = scenario.mission!.weakAdminPassword!.password;

type How = 'own desk' | 'borrowed chair' | 'other machine';

/**
 * Plays a level like a person who has made a plan: a few seconds between lines,
 * back to the own business, and the flag handed in when the contact is there
 * (again and again, because a meeting may be going on just then).
 */
function play(level: number, how: How, startMinutes: number): Recorder {
  const o = soloGameOptions(base, choice(level), 1);
  const r = new Recorder({ ...o, botOptions: { ...o.botOptions, hackerPace: undefined } });
  r.connect('me');
  const me = scenario.players.find((p) => p.id === o.soloPlayer)!;
  const wait = (minutes: number, done: () => boolean = () => false): boolean => {
    for (let i = 0; i < minutes * 600 && !r.game.over && !done(); i++) {
      r.game.tick(100);
      if (i % 10 === 0) r.flush();
    }
    r.flush();
    return done();
  };
  const type = (text: string) => {
    wait(0.12);
    return r.type('me', text);
  };
  wait(startMinutes);

  let { desk, account } = me;
  if (how === 'borrowed chair') {
    // An open PC in a department, its owner away, and nobody near.
    const found = wait(25, () => scenario.players.some((p) => {
      const now = r.game.publicState();
      const at = r.map.desks.find((d) => d.hostname === p.desk)!;
      if (p.id === me.id || p.role !== 'employee' || p.desk === 'REC-PC-01' || now.desks[p.desk].screen !== 'unlocked' || now.players[p.id]?.seatedAt) return false;
      if (Object.values(now.players).some((q) => q.id !== me.id && Math.hypot(q.x - at.seatX, q.y - at.seatY) < 330)) return false;
      desk = p.desk;
      account = p.account;
      return true;
    }));
    expect(found, 'an open PC with nobody near').toBe(true);
    expect(r.sitAt('me', me.id, desk)).toBe(true);
    expect(r.screen('me').screen).toBe('shell');
  } else {
    r.sitAt('me', me.id, desk);
    if (r.screen('me').screen === 'login') r.type('me', account);
    if (r.screen('me').screen !== 'shell') r.type('me', PW[account]);
  }
  if (how === 'other machine') {
    type(`ssh k.nasser@${level === 5 ? 'MKT-LT-09' : 'FIN-LT-04'}`);
    type(EASY_PASSWORD);
  }
  let flag: string;
  if (LADDER_SETTINGS[level - 1].weaknesses.includes('weak-admin-password')) {
    type('ssh k.nasser@ADMIN-SRV-01');
    type(EASY_PASSWORD);
    type('sudo cat /root/flag.txt');
    flag = type(EASY_PASSWORD).trim();
  } else {
    type(`ssh ${account}@ADMIN-SRV-01`);
    type(PW[account]);
    const script = type('cat /srv/shared/old/backup-2025.sh');
    type('su');
    type(/ROOT_PW='([^']+)'/.exec(script)![1]);
    flag = type('cat /root/flag.txt').trim();
  }
  if (r.game.over) return r;
  expect(flag).toMatch(/NEXORA\{.+\}/);
  for (let i = 0; i < 5 && !r.screen('me').prompt.startsWith(`${account}@${desk}`); i++) type('exit');
  r.send('me', 'stand');
  wait(o.handInMinutes! + 0.1);
  for (let i = 0; i < 20 && !r.game.over; i++) {
    r.send('me', 'flag.submit', { text: flag });
    r.flush();
    wait(0.2);
  }
  return r;
}
const winner = (r: Recorder) => r.game.over?.winner;

describe('asking for a level', () => {
  it('a whole number of a level that exists; in an Investigation it is a level of the defender ladder', () => {
    expect(parseSoloChoice(choice(1))).toEqual(choice(1));
    expect(parseSoloChoice(choice(LADDER.length))).toEqual(choice(LADDER.length));
    for (const level of [0, 6, -1, 1.5, '1', null, NaN, Infinity, [1]]) expect(parseSoloChoice({ ...choice(1), level }), String(level)).toBeNull();
    expect(parseSoloChoice({ ...choice(1), mode: 'investigation' })).toEqual(defenderChoice(1));
    expect(parseSoloChoice({ mode: 'infiltration', role: 'any', difficulty: 'easy', level: undefined })).toEqual({ mode: 'infiltration', role: 'any', difficulty: 'easy' });
  });

  it('every level has its texts and its settings', () => {
    expect(LADDER).toHaveLength(5);
    expect(LADDER_SETTINGS).toHaveLength(LADDER.length);
    for (const l of LADDER) for (const text of [l.name, l.briefing, l.lesson]) expect(text.length).toBeGreaterThan(5);
    expect(ladderLevel(2)).toBe(LADDER[1]);
    expect(ladderLevel(undefined)).toBeUndefined();
    expect(ladderLevel(9)).toBeUndefined();
    for (const s of LADDER_SETTINGS) expect(scenario.players.find((p) => p.id === s.playerId)?.role).toBe('employee');
  });

  it('is always the same, whatever the server is set to', () => {
    const a = soloGameOptions(base, choice(3), 1);
    const b = soloGameOptions({ ...base, weaknesses: ['tailgate'], escalationMinutes: 1, botOptions: { hacker: true } }, { ...choice(3), difficulty: 'hard' }, 999);
    for (const key of ['seed', 'soloPlayer', 'soloHacker', 'weaknesses', 'escalationMinutes', 'handInMinutes'] as const) expect(b[key], key).toEqual(a[key]);
    expect(b.botOptions).toEqual(a.botOptions);
    expect(a).toMatchObject({ soloHacker: true, soloPlayer: 'p7' });
    const r = new Recorder(soloGameOptions(base, choice(3), 1));
    r.connect('me');
    expect((r.last('me', 'welcome')!.payload as { mission: MissionBriefing }).mission.handInMinutes).toBe(LADDER_SETTINGS[2].handInMinutes);
  });
});

describe('more cameras', () => {
  it('are added to a copy of the map, in rooms that exist, with their own names', () => {
    const before = JSON.stringify(tiledMap);
    for (const level of LADDER) {
      const map = parseOfficeMap(withCameras(tiledMap, level.cameras));
      expect(() => checkMapAgainstScenario(map, scenario, 'office-small')).not.toThrow();
      expect(map.cameras).toHaveLength(parseOfficeMap(tiledMap).cameras.length + (level.cameras?.length ?? 0));
    }
    expect(JSON.stringify(tiledMap)).toBe(before);
    expect(withCameras(tiledMap)).toBe(tiledMap);
  });

  it('really record: a department is no blind spot on level 4', () => {
    const seen = (level: number) => {
      const o = soloGameOptions(base, choice(level), 1);
      const r = new Recorder(o);
      r.connect('me');
      r.sitAt('me', o.soloPlayer!, scenario.players.find((p) => p.id === o.soloPlayer)!.desk);
      for (let i = 0; i < 100; i++) r.game.tick(100);
      return r.game.cctv.cameras.some((c) => r.game.cctv.recording(c.id).some((s) => s.people.some((p) => p.playerId === o.soloPlayer && p.seatedAt !== '')));
    };
    expect(seen(3)).toBe(false);
    expect(seen(4)).toBe(true);
    expect(seen(5)).toBe(true);
  });
});

describe('every level can be won', () => {
  it.each([1, 2])('level %i from the own desk, whenever one starts', (level) => {
    for (const start of [0.5, 4, 9]) {
      const r = play(level, 'own desk', start);
      expect(winner(r), `start ${start}`).toBe('hacker');
      expect((r.last('me', 'debrief')!.payload as { debrief: DebriefView }).debrief.rating!.title).toMatch(/Like a ghost|Clean getaway|By a hair/);
    }
  }, 30_000);

  it('level 3 from a borrowed chair: its owner gets the blame', () => {
    const r = play(3, 'borrowed chair', 1);
    expect(winner(r)).toBe('hacker');
    const blamed = [...r.game.fired, ...r.game.detentions.map((d) => d.targetId)];
    expect(blamed.length).toBeGreaterThan(0);
    expect(blamed).not.toContain(r.game.world.mission.hackers[0]);
  }, 30_000);

  it.each([4, 5])('level %i through another machine, most of the time', (level) => {
    const results = [0.5, 1, 4, 9].map((start) => winner(play(level, 'other machine', start)));
    expect(results.filter((w) => w === 'hacker').length, results.join()).toBeGreaterThanOrEqual(3);
  }, 30_000);
});

describe('carelessness costs more from level to level', () => {
  it('working from the own desk mostly fails on levels 3 and 4, and always on 5', () => {
    const wins = (level: number) => [0.5, 1, 4, 6, 9].filter((start) => winner(play(level, 'own desk', start)) === 'hacker').length;
    expect(wins(3)).toBeLessThanOrEqual(1);
    expect(wins(4)).toBeLessThanOrEqual(1);
    expect(wins(5)).toBe(0);
  }, 60_000);
});
