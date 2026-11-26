/**
 * The training day and the defender ladder: every level is the job and the
 * office it promises, and in every one the computer hacker really does
 * something a defender can find (here nobody stops it, so it gets the flag out).
 */
import { describe, expect, it } from 'vitest';
import { DEFENDER_LADDER, TRAINING_CHOICE, defenderChoice, defenderLevel, hackerLevel, parseSoloChoice, type DebriefView, type SoloChoice } from '@insider/shared';
import { DEFENDER_SETTINGS, TRAINING_SETTINGS } from '../src/ladder';
import { soloGameOptions } from '../src/solo';
import { Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small' };
const ROLE_TITLE = { soc: 'soc', guard: 'guard', sysadmin: 'sysadmin', helpdesk: 'helpdesk', employee: 'employee' } as const;

/** Plays a solo match with nobody at the keyboard until it is over (at most `minutes` game minutes). */
function unattended(choice: SoloChoice, minutes: number): { r: Recorder; player: string } {
  const o = soloGameOptions(base, choice, 1);
  const r = new Recorder({ ...o, botOptions: { ...o.botOptions } });
  r.connect('me');
  for (let i = 0; i < minutes * 600 && !r.game.over; i++) {
    r.game.tick(100);
    if (i % 50 === 0) r.flush();
  }
  r.flush();
  return { r, player: o.soloPlayer! };
}

describe('what a browser may ask for', () => {
  it('the training day is always the same, and a defender level decides the job', () => {
    expect(parseSoloChoice({ mode: 'training', role: 'guard', difficulty: 'hard', level: 3 })).toEqual(TRAINING_CHOICE);
    expect(parseSoloChoice({ mode: 'investigation', role: 'employee', difficulty: 'normal', level: 3 })).toEqual({ ...defenderChoice(3), role: 'guard' });
    expect(parseSoloChoice(defenderChoice(5))).toEqual(defenderChoice(5));
    for (const level of [0, 6, 1.5, '2', -1]) expect(parseSoloChoice({ mode: 'investigation', role: 'soc', difficulty: 'normal', level })).toBeNull();
    // The two ladders do not mix.
    expect(defenderLevel(defenderChoice(2))?.name).toBe(DEFENDER_LADDER[1].name);
    expect(hackerLevel(defenderChoice(2))).toBeUndefined();
    expect(defenderLevel({ mode: 'infiltration', role: 'any', difficulty: 'normal', level: 2 })).toBeUndefined();
  });

  it('every level: the job it names, the weaknesses it fixes, and the player is never the hacker', () => {
    expect(DEFENDER_SETTINGS).toHaveLength(DEFENDER_LADDER.length);
    const all: [SoloChoice, (typeof DEFENDER_SETTINGS)[number], string][] = [
      [TRAINING_CHOICE, TRAINING_SETTINGS, 'soc'],
      ...DEFENDER_LADDER.map((l, i) => [defenderChoice(i + 1), DEFENDER_SETTINGS[i], l.role] as [SoloChoice, (typeof DEFENDER_SETTINGS)[number], string]),
    ];
    for (const [choice, settings, role] of all) {
      const o = soloGameOptions(base, choice, 99);
      const player = scenario.players.find((p) => p.id === o.soloPlayer)!;
      expect(player.role ?? 'employee', JSON.stringify(choice)).toBe(ROLE_TITLE[role as keyof typeof ROLE_TITLE]);
      expect(o.weaknesses).toEqual(settings.weaknesses);
      expect(o.seed).toBe(settings.seed);
      expect(o.botOptions?.hacker).toBe(true);
      expect(o.botOptions?.hackerNot).toBe(player.id);
      // Always the same, whatever seed the room had.
      expect(soloGameOptions(base, choice, 7).soloPlayer).toBe(o.soloPlayer);
    }
  });
});

describe('the computer hacker acts in every one', () => {
  const runs: [string, SoloChoice][] = [['training day', TRAINING_CHOICE], ...DEFENDER_LADDER.map((l, i) => [`level ${i + 1}, ${l.name}`, defenderChoice(i + 1)] as [string, SoloChoice])];
  for (const [name, choice] of runs) {
    it(`${name}: left alone, the hacker gets the flag out, and the debrief shows how`, () => {
      const { r, player } = unattended(choice, 150);
      expect(r.game.over?.winner, name).toBe('hacker');
      const debrief = (r.sent.get('me')!.find((m) => m.type === 'debrief')!.payload as { debrief: DebriefView }).debrief;
      expect(debrief.steps.length).toBeGreaterThan(2);
      // Long enough for a beginner to look, short enough to finish in one sitting.
      expect((debrief.at - debrief.startedAt) / 60_000, name).toBeGreaterThan(choice.mode === 'training' ? 18 : 8);
      expect((debrief.at - debrief.startedAt) / 60_000, name).toBeLessThan(45);
      expect(debrief.hackers).not.toContain(scenario.players.find((p) => p.id === player)!.name);
    }, 120_000);
  }
});
