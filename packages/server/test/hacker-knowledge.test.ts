import { describe, expect, it } from 'vitest';
import { ALL_WEAKNESSES, HACKER_RUMOURS, briefing } from '@insider/engine';
import { hackerKnowledge } from '../src/bots/hacker-knowledge';
import { loadGameOptions } from '../src/app';
import { Recorder } from './helpers';

describe('bot hacker information boundary', () => {
  it('Easy has exactly the human rumours and never inspects enabled-weakness data', () => {
    const forbidden = new Proxy([], { get() { throw new Error('Easy accessed match truth'); } });
    const knowledge = hackerKnowledge('easy', 1, forbidden);
    expect(knowledge.confirmed).toEqual({});
    expect(knowledge.rumours.map((id) => HACKER_RUMOURS[id])).toEqual(briefing(new Recorder().game.world).rumours.slice(0, -1));
    expect(hackerKnowledge('easy', 42, ALL_WEAKNESSES)).toEqual(knowledge);
  });

  it('Hard confirms all enabled and disabled weaknesses', () => {
    const known = hackerKnowledge('hard', 1, ['extra-sudo']);
    for (const id of ALL_WEAKNESSES) expect(known.confirmed[id]).toBe(id === 'extra-sudo');
  });

  it('Normal confirms a deterministic proper subset, never false rumours or disabled facts', () => {
    const selections = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const known = hackerKnowledge('normal', seed, ALL_WEAKNESSES);
      expect(known).toEqual(hackerKnowledge('normal', seed, [...ALL_WEAKNESSES].reverse()));
      expect(Object.keys(known.confirmed)).toHaveLength(2);
      expect(Object.values(known.confirmed)).toEqual([true, true]);
      selections.add(JSON.stringify(known.confirmed));
      const partial = hackerKnowledge('normal', seed, ['extra-sudo', 'plaintext-password']);
      expect(Object.keys(partial.confirmed)).toHaveLength(1);
      expect(partial.confirmed['weak-admin-password']).toBeUndefined();
      expect(hackerKnowledge('normal', seed, [])).toEqual(hackerKnowledge('easy', seed, []));
    }
    expect(selections.size).toBeGreaterThan(1);
  });

  it('defaults to Normal, accepts all three levels, and rejects typos', () => {
    expect(loadGameOptions().botOptions?.hackerDifficulty).toBe('normal');
    expect(new Recorder({ bots: true }).game.bots?.hackerDifficulty).toBe('normal');
    for (const difficulty of ['easy', 'normal', 'hard']) {
      expect(loadGameOptions({ botHackerDifficulty: difficulty }).botOptions?.hackerDifficulty).toBe(difficulty);
    }
    expect(() => loadGameOptions({ botHackerDifficulty: 'expert' })).toThrow('BOT_HACKER_DIFFICULTY');
  });

  it('shows difficulty only through the protected developer mission view', () => {
    for (const dev of [false, true]) {
      const r = new Recorder({ bots: true, dev, botOptions: { hacker: false, hackerDifficulty: 'easy' } });
      r.connect('human', 'p1');
      expect(JSON.stringify([...r.sent])).not.toContain('difficulty');
      r.send('human', 'dev.show', { what: 'mission' });
      if (dev) expect((r.last('human', 'dev.result')!.payload as { text: string }).text).toContain('bot hacker difficulty: easy');
      else expect(r.messages('human', 'dev.result')).toEqual([]);
    }
  });
});
