/**
 * The player's career: points for every match, ranks, and jackets that come
 * with a rank. Kept in this browser (localStorage) until there are accounts,
 * like the ladders. It changes nothing in a match: it is only a reason to come
 * back, and something to show in the wardrobe.
 *
 * (A player can edit their own browser's storage, and so wear an earned jacket
 * early. That is harmless: a jacket is only seen in the lobby.)
 */
import { FREE_OUTFITS, type DebriefView } from '@insider/shared';

const KEY = 'insider-career';

export const RANKS = [
  { name: 'Intern', points: 0 },
  { name: 'Junior analyst', points: 100 },
  { name: 'Analyst', points: 300 },
  { name: 'Senior analyst', points: 700 },
  { name: 'Incident lead', points: 1500 },
] as const;

/** The jackets that are earned: index in LOOK_OUTFITS -> the rank (index in RANKS) that brings it. */
export const EARNED_OUTFITS: Record<number, number> = { [FREE_OUTFITS]: 1, [FREE_OUTFITS + 1]: 2, [FREE_OUTFITS + 2]: 3 };
export const OUTFIT_NAMES: Record<number, string> = { [FREE_OUTFITS]: 'Charcoal jacket', [FREE_OUTFITS + 1]: 'Gold jacket', [FREE_OUTFITS + 2]: 'White jacket' };

export interface Career {
  points: number;
  matches: number;
  wins: number;
  /** Pieces of the hacker's evidence pinned in matches this player defended. */
  found: number;
  /** The last matches already counted (so that a match seen twice, after a reload, counts once). */
  counted: string[];
}

const EMPTY: Career = { points: 0, matches: 0, wins: 0, found: 0, counted: [] };

export function readCareer(): Career {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Career>;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
    return { points: n(v.points), matches: n(v.matches), wins: n(v.wins), found: n(v.found), counted: Array.isArray(v.counted) ? v.counted.filter((k) => typeof k === 'string').slice(-20) : [] };
  } catch {
    return { ...EMPTY };
  }
}

function saveCareer(career: Career): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(career));
  } catch {
    // Not remembered; it still counts for this visit.
  }
}

/** The rank for so many points, and the next one (if any). */
export function rankOf(points: number): { index: number; name: string; next: { name: string; points: number } | null; from: number } {
  let index = 0;
  while (index + 1 < RANKS.length && points >= RANKS[index + 1].points) index++;
  const next = RANKS[index + 1];
  return { index, name: RANKS[index].name, next: next ? { name: next.name, points: next.points } : null, from: RANKS[index].points };
}

export const outfitOpen = (outfit: number, points: number): boolean => (EARNED_OUTFITS[outfit] ?? 0) <= rankOf(points).index;

/** What one match was worth, and why. */
export interface Gain {
  points: number;
  reasons: string[];
  /** A new rank reached with this match ("" = none). */
  rankUp: string;
  /** Jackets that came with it. */
  unlocked: string[];
}

/**
 * Points for a finished match, seen from the player's side:
 *   10 for playing, 40 for a win;
 *   defending: 10 for every step of the hacker whose evidence was pinned;
 *   the hacker: 20 or 40 more for a clean or invisible win;
 *   30 the first time a level of a ladder (or the training day) is won.
 */
export function score(d: DebriefView, side: 'hacker' | 'defenders', firstLevelWin: boolean): { points: number; reasons: string[] } {
  const reasons: string[] = ['+10 for playing'];
  let points = 10;
  const won = d.winner === side;
  if (won) {
    points += 40;
    reasons.push('+40 for the win');
  }
  if (side === 'defenders' && d.totals.pinned > 0) {
    points += 10 * d.totals.pinned;
    reasons.push(`+${10 * d.totals.pinned} for evidence on the board`);
  }
  if (side === 'hacker' && won && d.rating) {
    const bonus = d.rating.title === 'Like a ghost' ? 40 : d.rating.title === 'Clean getaway' ? 20 : 0;
    if (bonus) {
      points += bonus;
      reasons.push(`+${bonus}: ${d.rating.title.toLowerCase()}`);
    }
  }
  if (firstLevelWin) {
    points += 30;
    reasons.push('+30 for a new level won');
  }
  return { points, reasons };
}

/** Counts a finished match once. Null when it was counted before. */
export function countMatch(d: DebriefView, side: 'hacker' | 'defenders', firstLevelWin: boolean): { career: Career; gain: Gain } | null {
  const career = readCareer();
  const key = `${d.startedAt}-${d.at}-${d.winner}-${d.steps.length}`;
  if (career.counted.includes(key)) return null;
  const { points, reasons } = score(d, side, firstLevelWin);
  const before = rankOf(career.points);
  const next: Career = {
    points: career.points + points,
    matches: career.matches + 1,
    wins: career.wins + (d.winner === side ? 1 : 0),
    found: career.found + (side === 'defenders' ? d.totals.pinned : 0),
    counted: [...career.counted, key].slice(-20),
  };
  const after = rankOf(next.points);
  const unlocked = after.index > before.index
    ? Object.entries(EARNED_OUTFITS).filter(([, rank]) => rank > before.index && rank <= after.index).map(([outfit]) => OUTFIT_NAMES[Number(outfit)])
    : [];
  saveCareer(next);
  return { career: next, gain: { points, reasons, rankUp: after.index > before.index ? after.name : '', unlocked } };
}

/** For the wardrobe: why a jacket is still closed. */
export const outfitNeeds = (outfit: number): string => `${OUTFIT_NAMES[outfit] ?? `Jacket ${outfit + 1}`}: reach the rank ${RANKS[EARNED_OUTFITS[outfit] ?? 0].name}`;



