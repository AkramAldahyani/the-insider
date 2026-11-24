/**
 * The scenario ladder (DESIGN.md section 1a, Phase 5a part G): five fixed
 * Infiltration matches, each harder than the one before, each with its own
 * lesson. Unlike an ordinary match a level is always the same: same person, same
 * weaknesses, same seed.
 *
 * Here is what the PLAYER is told (and the extra cameras, which are on the map
 * for everybody to see). What the server does with a level is in
 * server/src/ladder.ts.
 */
import type { TiledMap } from './map';

export interface ExtraCamera {
  /** "CAM-07 Finance": the first word is its id. */
  name: string;
  /** Position on the map, in tiles. */
  col: number;
  row: number;
  /** The room it watches. */
  covers: string;
}

export interface LadderLevel {
  name: string;
  /** Shown in the menu and at the top of the mission. */
  briefing: string;
  /** Shown after the match: what this level is about. */
  lesson: string;
  cameras?: ExtraCamera[];
}

/** Cameras in the department rooms, which are blind spots otherwise. */
const DEPARTMENT_CAMERAS: ExtraCamera[] = [
  { name: 'CAM-07 Finance', col: 1.5, row: 1.5, covers: 'Finance' },
  { name: 'CAM-08 HR', col: 15.5, row: 1.5, covers: 'HR' },
  { name: 'CAM-09 Marketing', col: 39.5, row: 1.5, covers: 'Marketing' },
];

export const LADDER: LadderLevel[] = [
  {
    name: 'Old habits',
    briefing: 'Your first job. Somebody on the admin server never cleans up: look for an old script in the shared folder, and read it. Your colleagues are slow today.',
    lesson: 'Passwords in scripts stay there until somebody reads them. And even a quiet job leaves a login, a su and a HIGH alert behind.',
  },
  {
    name: 'The company password',
    briefing: 'Nothing lies around this time. But the system administrator (k.nasser) loves simple passwords: the name of the company, in small letters, and the year.',
    lesson: 'A guessed password makes you look like its owner, but the address of your own PC is in every log line. That difference is what gives people away.',
  },
  {
    name: 'The borrowed chair',
    briefing: 'The old script is back, but the investigators are awake: what you do at your own desk leads to you within minutes. Your colleagues often leave their PCs open. Use one, when nobody is in the room.',
    lesson: 'An address leads to a PC, and a PC to its owner, whoever sat at it. That is why people lock their screens, and why investigators ask for more than an address.',
  },
  {
    name: 'Eyes everywhere',
    briefing: 'There are cameras in the departments now, so borrowing a chair is risky. The administrator still has his simple password, and an account on EVERY PC. A login can come from a PC you are not sitting at.',
    lesson: 'Going through another machine hides where you are from the next one. But the machine in the middle remembers where you came from: look at its own logins.',
    cameras: DEPARTMENT_CAMERAS,
  },
  {
    name: 'Locked down',
    briefing: 'Everybody locks their screen, everybody checks their PC, the guard is quick, and the contact takes his time. You know all the tricks by now. Use them together.',
    lesson: 'Nobody is invisible. The quiet ones only make sure that by the time somebody looks, the trail points somewhere else.',
    cameras: DEPARTMENT_CAMERAS,
  },
];

/** The level with this number (1 to 5), or undefined. */
export const ladderLevel = (level: number | undefined): LadderLevel | undefined => (level === undefined ? undefined : LADDER[level - 1]);

/** A copy of a map with more cameras on it. The server records with them and the page draws them. */
export function withCameras(map: TiledMap, cameras: ExtraCamera[] = []): TiledMap {
  if (cameras.length === 0) return map;
  return {
    ...map,
    layers: map.layers.map((layer) => layer.name !== 'cameras' ? layer : {
      ...layer,
      objects: [...(layer.objects ?? []), ...cameras.map((c, i) => ({
        id: 9000 + i, name: c.name, x: c.col * map.tilewidth, y: c.row * map.tilewidth, width: 0, height: 0,
        properties: [{ name: 'covers', type: 'string', value: c.covers }, { name: 'range', type: 'float', value: 16 }],
      }))],
    }),
  } as TiledMap;
}
