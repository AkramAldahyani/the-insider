/**
 * Which levels of the two ladders this browser has won, and how well: the
 * hacker ladder (Infiltration) and the defender ladder (Investigation; there
 * level 0 is the training day). There are no accounts yet, so it is kept in the
 * browser: another browser, or cleared site data, starts again at level 1.
 * Storage can be missing or blocked; the game works without it (then only level
 * 1 is open).
 */
export const HACKER_LADDER = 'insider-ladder';
export const DEFENDER_LADDER_KEY = 'insider-defender-ladder';

export type LadderProgress = Record<number, string>;

/** Ratings from best to worst: a better one replaces a worse one. */
const RANK = ['Like a ghost', 'Clean getaway', 'By a hair', 'Case proven', 'Case proven, at a price', 'Lucky guess'];
const rank = (rating: string) => (RANK.includes(rating) ? RANK.indexOf(rating) : RANK.length);

export function readLadder(key = HACKER_LADDER): LadderProgress {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    if (typeof value !== 'object' || value === null) return {};
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => /^[0-9]$/.test(k) && typeof v === 'string').map(([k, v]) => [Number(k), String(v).slice(0, 40)]));
  } catch {
    return {};
  }
}

/** Remembers a win (the better rating, if the level was won before). */
export function saveWin(level: number, rating: string, key = HACKER_LADDER): LadderProgress {
  const progress = readLadder(key);
  if (progress[level] === undefined || rank(rating) < rank(progress[level])) progress[level] = rating;
  try {
    window.localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // Nothing to do: the win still counts until the page is closed or reloaded.
  }
  return progress;
}

/** Level 1 is always open; the others when the one before was won. */
export const isOpen = (level: number, progress: LadderProgress): boolean => level === 1 || progress[level - 1] !== undefined;
