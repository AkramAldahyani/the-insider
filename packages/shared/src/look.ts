/**
 * How a player's own character looks (the lobby). Only small numbers, so that a
 * browser can send it and the server can check it in one line.
 *
 * Where it is seen: in the lobby (everybody sees everybody's), and in a match
 * by the player themself only. The others in a match always see the employee
 * the player plays: a look of one's own would tell people from the computer's
 * colleagues.
 */
export interface Look {
  /** Hair style (0-7). */
  style: number;
  /** Skin (0-5). */
  skin: number;
  /** Hair colour (0-5). */
  hair: number;
  /** Jacket colour (0-7). */
  outfit: number;
  glasses: boolean;
}

export const LOOK_STYLES = ['Short', 'Long', 'Bun', 'Headscarf', 'Side part', 'Bob', 'Beard', 'Headset'] as const;
export const LOOK_SKINS = ['#efc6a0', '#e5ae83', '#cc956f', '#ba805c', '#8f5f43', '#6b4532'] as const;
export const LOOK_HAIR = ['#242937', '#47352f', '#805537', '#b98a4e', '#8a8f99', '#a34a3f'] as const;
/** Jackets: the departments' colours of the office, and two more. */
export const LOOK_OUTFITS = ['#78bdec', '#d99bc5', '#e4bc70', '#74cbbb', '#dd8993', '#b6a2e4', '#f09a6b', '#a6b99a'] as const;

export const DEFAULT_LOOK: Look = { style: 0, skin: 1, hair: 0, outfit: 3, glasses: false };

/** Takes a look from a browser: anything that is not a valid look becomes the default. */
export function parseLook(value: unknown): Look {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_LOOK };
  const v = value as Record<string, unknown>;
  const pick = (x: unknown, size: number, fallback: number) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < size ? x : fallback);
  return {
    style: pick(v.style, LOOK_STYLES.length, DEFAULT_LOOK.style),
    skin: pick(v.skin, LOOK_SKINS.length, DEFAULT_LOOK.skin),
    hair: pick(v.hair, LOOK_HAIR.length, DEFAULT_LOOK.hair),
    outfit: pick(v.outfit, LOOK_OUTFITS.length, DEFAULT_LOOK.outfit),
    glasses: v.glasses === true,
  };
}

/** A look for somebody new, from their name (so that two new players rarely look alike). */
export function lookFromName(name: string): Look {
  const n = [...name].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  return { style: n % LOOK_STYLES.length, skin: (n >>> 3) % LOOK_SKINS.length, hair: (n >>> 6) % LOOK_HAIR.length, outfit: (n >>> 9) % LOOK_OUTFITS.length, glasses: (n >>> 12) % 3 === 0 };
}
