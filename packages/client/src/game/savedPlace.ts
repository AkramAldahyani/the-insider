/**
 * Where this browser TAB was playing, so that it can go back after a reload
 * (Phase 6, part F). The token is a secret the server gave this player when
 * they joined; it is worth nothing to anybody while they are connected, and it
 * changes with every return. It is kept for this tab only (sessionStorage):
 * two tabs are two players.
 */
import { parseSoloChoice, type SoloChoice } from '@insider/shared';

const KEY = 'insider-place';

export interface SavedPlace {
  token: string;
  /** The solo match, or null for a lobby. */
  solo: SoloChoice | null;
  /** The lobby's code, or "". */
  code: string;
}

export function savePlace(place: SavedPlace | null): void {
  try {
    if (place) window.sessionStorage.setItem(KEY, JSON.stringify(place));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Not remembered: a reload then cannot go back, nothing else.
  }
}

export function readPlace(): SavedPlace | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as Partial<SavedPlace> | null;
    if (typeof value?.token !== 'string' || typeof value.code !== 'string') return null;
    return { token: value.token, code: value.code, solo: value.solo ? parseSoloChoice(value.solo) : null };
  } catch {
    return null;
  }
}
