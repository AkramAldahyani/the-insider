/**
 * The browser's learning helpers, without a browser: the notebook's reading of
 * a typed line, the hints, the training guide, the career, and Tab in the line
 * editor. (Storage is a small fake: these run in Node.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE_OUTFITS, LOOK_OUTFITS, lookFromName, type DebriefView } from '@insider/shared';
import { commandsIn } from '../src/game/notebook';
import { HINT_AFTER_MS, nextHint, type HintFacts } from '../src/game/hints';
import { TRAINING_STEPS, trainingStep, type TrainingFacts } from '../src/game/training';
import { EARNED_OUTFITS, RANKS, countMatch, outfitOpen, rankOf, score } from '../src/game/career';
import { LineEditor } from '../src/ui/lineEditor';

/** A fake `window.localStorage`, fresh for every test. */
beforeEach(() => {
  const data = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
  };
});

describe('the notebook reads only command names', () => {
  it('the first word of every command, and what follows sudo and man', () => {
    expect(commandsIn('ls -la')).toEqual(['ls']);
    expect(commandsIn('sudo grep x /var/log/auth.log | wc -l')).toEqual(['sudo', 'grep', 'wc']);
    expect(commandsIn('cd /tmp && ls; last -n 5 || whoami')).toEqual(['cd', 'ls', 'last', 'whoami']);
    expect(commandsIn('man journalctl')).toEqual(['man', 'journalctl']);
    expect(commandsIn('sudo -l')).toEqual(['sudo']);
    // Never anything else from the line: no passwords, paths or arguments.
    expect(commandsIn('S3cret!Pass')).toEqual([]);
    expect(commandsIn('./script.sh; /bin/ls')).toEqual([]);
    expect(commandsIn('')).toEqual([]);
  });
});

describe('hints', () => {
  const facts = (f: Partial<HintFacts> = {}): HintFacts => ({ sat: false, used: new Set(), pins: 0, role: 'Employee', monitors: false, ...f });

  it('the first one the player still needs, never twice, and job hints only for that job', () => {
    expect(nextHint(facts(), new Set())?.id).toBe('sit');
    expect(nextHint(facts({ sat: true }), new Set())?.id).toBe('logs');
    expect(nextHint(facts({ sat: true, role: 'SOC analyst' }), new Set())?.id).toBe('siem');
    expect(nextHint(facts({ sat: true, role: 'Security guard' }), new Set())?.id).toBe('monitors');
    expect(nextHint(facts({ sat: true }), new Set(['logs']))?.id).toBe('last');
    expect(nextHint(facts({ sat: true, used: new Set(['tail', 'last', 'grep', 'nslookup', 'mail']), pins: 3 }), new Set())?.id).toBe('notebook');
    expect(nextHint(facts({ sat: true, used: new Set(['tail', 'last', 'grep', 'nslookup', 'mail']), pins: 3 }), new Set(['notebook']))).toBeNull();
  });

  it('come sooner on Easy, later on Normal, never on Hard', () => {
    expect(HINT_AFTER_MS.easy!).toBeLessThan(HINT_AFTER_MS.normal!);
    expect(HINT_AFTER_MS.hard).toBeNull();
  });
});

describe('the training guide', () => {
  const facts = (f: Partial<TrainingFacts> = {}): TrainingFacts => ({ cardOpen: true, seated: false, shell: false, used: new Set(), alert: false, pins: 0, meeting: false, over: false, ...f });

  it('goes on step by step, may skip what is already done, and never goes back', () => {
    expect(trainingStep(-1, facts())).toBe(0);
    expect(trainingStep(0, facts({ cardOpen: false }))).toBe(1);
    expect(trainingStep(1, facts({ cardOpen: false, seated: true, shell: true }))).toBe(3);
    // The card opened again later does not restart it.
    expect(trainingStep(3, facts({ cardOpen: true, seated: true, shell: true }))).toBe(3);
    expect(trainingStep(3, facts({ cardOpen: false, seated: true, shell: true, used: new Set(['siem']), alert: true, pins: 3 }))).toBe(8);
    expect(trainingStep(8, facts({ meeting: true, over: true }))).toBe(TRAINING_STEPS.length - 1);
    expect(trainingStep(TRAINING_STEPS.length - 1, facts())).toBe(TRAINING_STEPS.length - 1);
  });
});

describe('the career', () => {
  const debrief = (winner: 'hacker' | 'defenders', pinned: number, extra: Partial<DebriefView> = {}): DebriefView => ({
    winner, reason: '', hacker: 'Omar Farouk', hackers: ['Omar Farouk'], startedAt: 1000, at: 2000 + pinned, reputation: 100, steps: [],
    totals: { steps: pinned, pinned, seen: 0, missed: 0 }, weaknesses: [], witnesses: [], meetings: [], detentions: [], paths: [], ...extra,
  });

  it('ranks: from Intern up, with the next one and how far it is', () => {
    expect(rankOf(0)).toMatchObject({ index: 0, name: 'Intern', next: { name: 'Junior analyst', points: 100 } });
    expect(rankOf(299).name).toBe('Junior analyst');
    expect(rankOf(300).name).toBe('Analyst');
    expect(rankOf(99_999)).toMatchObject({ name: RANKS[RANKS.length - 1].name, next: null });
  });

  it('points: playing, winning, evidence for defenders, a clean getaway for the hacker, a first level', () => {
    expect(score(debrief('defenders', 3), 'defenders', false).points).toBe(10 + 40 + 30);
    expect(score(debrief('hacker', 3), 'defenders', false).points).toBe(10 + 30);
    expect(score(debrief('hacker', 0, { rating: { title: 'Like a ghost', lines: [] } }), 'hacker', true).points).toBe(10 + 40 + 40 + 30);
    expect(score(debrief('defenders', 0), 'hacker', false).points).toBe(10);
  });

  it('a match counts once; a new rank brings its jacket', () => {
    const first = countMatch(debrief('defenders', 3), 'defenders', true)!;
    expect(first.career).toMatchObject({ points: 110, matches: 1, wins: 1, found: 3 });
    expect(first.gain).toMatchObject({ points: 110, rankUp: 'Junior analyst', unlocked: ['Charcoal jacket'] });
    expect(countMatch(debrief('defenders', 3), 'defenders', true)).toBeNull();
    const second = countMatch(debrief('hacker', 1), 'defenders', false)!;
    expect(second.gain.rankUp).toBe('');
    expect(second.career.points).toBe(110 + 20);
  });

  it('earned jackets are closed before their rank, and nobody starts with one', () => {
    expect(Object.keys(EARNED_OUTFITS).map(Number).every((n) => n >= FREE_OUTFITS && n < LOOK_OUTFITS.length)).toBe(true);
    expect(outfitOpen(0, 0)).toBe(true);
    expect(outfitOpen(FREE_OUTFITS, 0)).toBe(false);
    expect(outfitOpen(FREE_OUTFITS, 100)).toBe(true);
    expect(outfitOpen(FREE_OUTFITS + 2, 699)).toBe(false);
    for (const name of ['Anna', 'Ben', 'Cleo', 'Dora', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kai', 'Lea']) expect(lookFromName(name).outfit).toBeLessThan(FREE_OUTFITS);
  });
});

describe('Tab in the line editor', () => {
  function editor() {
    const written: string[] = [];
    const asked: string[] = [];
    const lines: string[] = [];
    const e = new LineEditor({ write: (text) => void written.push(text), cols: 80 }, {
      onLine: (text) => void lines.push(text), onCancel: () => undefined, onEscape: () => undefined, onSwitchUser: () => undefined,
      onComplete: (text) => void asked.push(text),
    });
    e.show('', '$ ', false);
    return { e, written, asked, lines };
  }

  it('asks the server, and uses the answer only if the line is unchanged', () => {
    const { e, asked, lines } = editor();
    e.input('wh');
    e.input('\t');
    expect(asked).toEqual(['wh']);
    e.completed('wh', 'whoami ', []);
    e.input('\r');
    expect(lines).toEqual(['whoami ']);
    // Keys typed while the answer is on its way wait for it, as in bash: Enter runs the completed line.
    e.show('', '$ ', false);
    e.input('whoa');
    e.input('\t');
    e.input('\r');
    expect(lines).toHaveLength(1);
    e.completed('whoa', 'whoami ', []);
    expect(lines.at(-1)).toBe('whoami ');
  });

  it('without an answer the keys go on after a moment, and a late answer is ignored', () => {
    vi.useFakeTimers();
    const { e, lines } = editor();
    e.input('ca');
    e.input('\t');
    e.input('t');
    e.input('\r');
    expect(lines).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(lines).toEqual(['cat']);
    e.completed('ca', 'cal ', []);
    expect(lines).toEqual(['cat']);
    vi.useRealTimers();
  });

  it('several possibilities are listed under the line; never in a password', () => {
    const { e, written, asked } = editor();
    e.input('l');
    e.input('\t');
    e.completed('l', 'l', ['last', 'less', 'ls']);
    expect(written.join('')).toContain('last');
    e.show('', 'Password: ', true);
    e.input('se');
    e.input('\t');
    expect(asked).toEqual(['l']);
  });
});
