/**
 * Generates maps/office-small.json (a Tiled map) and maps/office-tiles.png
 * (its placeholder tileset).
 *
 *   pnpm map
 *
 * WHY A SCRIPT? A Tiled map stores every tile as a number in one long list.
 * Typing 1,792 numbers by hand is a recipe for mistakes, so this script
 * describes the office as rooms, doors and desks and writes the file.
 *
 * The JSON it writes is a normal Tiled map: open it in Tiled
 * (https://www.mapeditor.org), move things, save, and the game uses your
 * version. You only need this script again if you want to regenerate the
 * office from scratch (that overwrites manual edits).
 *
 * This script is a build tool: it is the only place besides the server and
 * the CLI that writes files. The game never runs it.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const TILE = 32;
const COLS = 56;
// Rows 0-31 are the building; row 32 is the pavement outside the main entrance; row 33 closes the map.
const ROWS = 34;
const BUILDING_ROWS = 32;

// ── Tiles: id -> [name, colour]. Id 0 means "empty". ──
const TILES: [string, [number, number, number]][] = [
  ['floor-finance', [58, 77, 92]],
  ['floor-hr', [92, 70, 84]],
  ['floor-marketing', [96, 82, 58]],
  ['floor-it', [56, 84, 80]],
  ['floor-server', [40, 48, 66]],
  ['floor-corridor', [74, 76, 82]],
  ['floor-reception', [84, 88, 70]],
  ['floor-security', [70, 62, 62]],
  ['floor-cafeteria', [98, 86, 70]],
  ['floor-printer', [78, 78, 70]],
  ['floor-storage', [66, 60, 52]],
  ['floor-bathroom', [70, 88, 96]],
  ['wall', [24, 26, 32]],
  // New tiles go at the END, so the numbers of the tiles above never change.
  ['floor-outside', [44, 52, 48]],
];
const tileId = (name: string) => TILES.findIndex((t) => t[0] === name) + 1;
const WALL = tileId('wall');

// ── Rooms: outer rectangle in tiles (walls included), floor tile, door gap in the wall facing the corridor. ──
interface RoomDef {
  name: string;
  /** Short door name for the badge logs. */
  code: string;
  /** Badge reader on the door? `zone` set = restricted to badges listing it. */
  reader?: boolean;
  zone?: string;
  floor: string;
  x0: number; y0: number; x1: number; y1: number; // inclusive outer bounds
  /** Tiles removed from the wall to make the doorway. */
  door: [number, number][];
}
const ROOMS: RoomDef[] = [
  { name: 'Finance', code: 'FIN', reader: true, floor: 'floor-finance', x0: 0, y0: 0, x1: 15, y1: 13, door: [[7, 13], [8, 13]] },
  { name: 'HR', code: 'HR', reader: true, floor: 'floor-hr', x0: 15, y0: 0, x1: 27, y1: 13, door: [[21, 13], [22, 13]] },
  { name: 'Marketing', code: 'MKT', reader: true, floor: 'floor-marketing', x0: 27, y0: 0, x1: 41, y1: 13, door: [[33, 13], [34, 13]] },
  { name: 'IT department', code: 'IT', reader: true, floor: 'floor-it', x0: 41, y0: 0, x1: 55, y1: 13, door: [[44, 13], [45, 13]] },
  // The server room is a box in the top-right corner of IT; its door opens into IT.
  { name: 'Server room', code: 'SRV-ROOM', reader: true, zone: 'server-room', floor: 'floor-server', x0: 49, y0: 0, x1: 55, y1: 8, door: [[49, 4], [49, 5]] },
  { name: 'Reception', code: 'RECEPTION', floor: 'floor-reception', x0: 0, y0: 18, x1: 12, y1: 31, door: [[5, 18], [6, 18]] },
  { name: 'Security office', code: 'SEC-OFFICE', reader: true, zone: 'security-office', floor: 'floor-security', x0: 12, y0: 18, x1: 20, y1: 31, door: [[15, 18], [16, 18]] },
  { name: 'Cafeteria / meeting room', code: 'CAFETERIA', floor: 'floor-cafeteria', x0: 20, y0: 18, x1: 34, y1: 31, door: [[26, 18], [27, 18]] },
  { name: 'Printer room', code: 'PRINTER', floor: 'floor-printer', x0: 34, y0: 18, x1: 40, y1: 31, door: [[36, 18], [37, 18]] },
  { name: 'Storage', code: 'STORAGE', floor: 'floor-storage', x0: 40, y0: 18, x1: 46, y1: 31, door: [[42, 18], [43, 18]] },
  { name: 'Bathrooms', code: 'BATHROOMS', floor: 'floor-bathroom', x0: 46, y0: 18, x1: 55, y1: 31, door: [[50, 18], [51, 18]] },
];

// ── Desks: [hostname, column, row] of the desk's left tile. Desks are 2 tiles wide; the chair is below. ──
const DESKS: [string, number, number][] = [
  ['FIN-LT-04', 3, 3], ['FIN-LT-07', 9, 3],
  ['HR-LT-03', 17, 3], ['HR-LT-05', 23, 3],
  ['MKT-LT-09', 30, 3], ['MKT-LT-11', 36, 3],
  ['IT-WS-01', 43, 3], ['IT-WS-02', 46, 3],
  ['ADMIN-SRV-01', 51, 3],
  ['REC-PC-01', 4, 23], ['SEC-WS-01', 15, 23],
];

// ── Things you cannot walk through, without any logic: [name, kind, col, row, width, height]. ──
const FURNITURE: [string, string, number, number, number, number][] = [
  ['Server racks', 'rack', 50, 1, 5, 1],
  ['IT shelves', 'shelf', 42, 11, 5, 1],
  ['Filing cabinets', 'shelf', 1, 11, 4, 1],
  ['HR cabinets', 'shelf', 16, 11, 3, 1],
  ['Marketing whiteboard', 'board', 28, 1, 5, 1],
  ['Reception sofa', 'sofa', 9, 21, 2, 4],
  ['CCTV monitors', 'monitors', 13, 30, 6, 1], // on the back wall: the door is in the top wall
  ['Meeting table', 'table', 24, 22, 7, 2],
  ['Cafeteria table', 'table', 23, 27, 3, 2],
  ['Cafeteria table', 'table', 29, 27, 3, 2],
  ['Printer', 'printer', 35, 20, 2, 1],
  ['Paper stock', 'shelf', 35, 28, 4, 2],
  ['Storage shelves', 'shelf', 41, 21, 1, 8],
  ['Storage shelves', 'shelf', 45, 21, 1, 8],
  ['Stalls', 'stall', 47, 27, 8, 1],
  ['Sinks', 'sink', 47, 19, 2, 1],
];

// ── Build the two tile layers. ──
const floor = new Array<number>(COLS * ROWS).fill(tileId('floor-corridor'));
const walls = new Array<number>(COLS * ROWS).fill(0);
const at = (c: number, r: number) => r * COLS + c;

// Outer border, so the corridor ends are closed too.
for (let c = 0; c < COLS; c++) for (const r of [0, BUILDING_ROWS - 1, ROWS - 1]) walls[at(c, r)] = WALL;
for (let r = 0; r < ROWS; r++) for (const c of [0, COLS - 1]) walls[at(c, r)] = WALL;
// The pavement outside.
for (let c = 1; c < COLS - 1; c++) floor[at(c, BUILDING_ROWS)] = tileId('floor-outside');

for (const room of ROOMS) {
  for (let r = room.y0; r <= room.y1; r++) {
    for (let c = room.x0; c <= room.x1; c++) {
      const edge = r === room.y0 || r === room.y1 || c === room.x0 || c === room.x1;
      if (edge) walls[at(c, r)] = WALL;
      else {
        floor[at(c, r)] = tileId(room.floor);
        walls[at(c, r)] = 0; // the server room is carved out of IT
      }
    }
  }
}
// Doorways last, so no later room can wall them up again.
for (const room of ROOMS) for (const [c, r] of room.door) { walls[at(c, r)] = 0; floor[at(c, r)] = tileId(room.floor); }
// The main entrance: a gap in Reception's outer wall, leading to the pavement.
const ENTRANCE: [number, number][] = [[5, BUILDING_ROWS - 1], [6, BUILDING_ROWS - 1]];
for (const [c, r] of ENTRANCE) { walls[at(c, r)] = 0; floor[at(c, r)] = tileId('floor-reception'); }

// ── Object layers. ──
let nextId = 1;
type Prop = { name: string; type: string; value: string | number | boolean };
const prop = (name: string, value: string | number | boolean): Prop => ({ name, type: typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool' : 'float', value });
const rect = (name: string, c: number, r: number, w: number, h: number, properties: Prop[] = [], type = '') => ({
  id: nextId++, name, type, x: c * TILE, y: r * TILE, width: w * TILE, height: h * TILE, rotation: 0, visible: true, properties,
});
const point = (name: string, c: number, r: number, properties: Prop[] = [], type = '') => ({
  id: nextId++, name, type, x: c * TILE, y: r * TILE, width: 0, height: 0, rotation: 0, visible: true, point: true, properties,
});

const roomObjects = [
  rect('Corridor', 1, 14, COLS - 2, 4),
  rect('Outside', 1, BUILDING_ROWS, COLS - 2, 1),
  ...ROOMS.filter((r) => r.name !== 'IT department').map((r) => rect(r.name, r.x0 + 1, r.y0 + 1, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1)),
  // IT is L-shaped around the server room: two rectangles with the same name.
  rect('IT department', 42, 1, 7, 12),
  rect('IT department', 49, 9, 6, 4),
];

const doorObjects = [
  ...ROOMS.map((room) => {
    const [c, r] = room.door[0];
    const vertical = room.door[1][0] === c;
    return rect(`${room.name} door`, c, r, vertical ? 1 : 2, vertical ? 2 : 1, [
      prop('code', room.code),
      prop('room', room.name),
      prop('reader', room.reader ?? false),
      prop('restricted', !!room.zone),
      prop('zone', room.zone ?? room.name.toLowerCase().split(' ')[0]),
    ]);
  }),
  rect('Main entrance', ENTRANCE[0][0], ENTRANCE[0][1], 2, 1, [
    prop('code', 'MAIN-ENT'), prop('room', 'Reception'), prop('reader', true), prop('restricted', false), prop('zone', 'building'),
  ]),
];

const deskObjects = DESKS.map(([hostname, c, r]) => rect(hostname, c, r, 2, 1, [prop('hostname', hostname)], 'desk'));
const furnitureObjects = FURNITURE.map(([name, kind, c, r, w, h]) => rect(name, c, r, w, h, [prop('kind', kind)], 'furniture'));

const spawnObjects = [
  // Each employee appears two tiles below their own chair.
  ...DESKS.map(([hostname, c, r]) => point(`${hostname} spawn`, c + 1, r + 3.5, [prop('desk', hostname)])),
  point('default', 6.5, 28),
  // Arriving employees appear on the pavement in front of the main entrance.
  point('outside', 6, BUILDING_ROWS + 0.5),
];

// `covers` is the room a camera watches; `range` is how far it sees, in tiles.
// The two corridor cameras overlap in the middle, so the whole corridor is covered.
const cameraObjects = [
  point('CAM-01 Reception', 1.5, 19.5, [prop('covers', 'Reception'), prop('range', 18)]),
  point('CAM-02 Corridor west', 2, 14.5, [prop('covers', 'Corridor'), prop('range', 30)]),
  point('CAM-03 Corridor east', 54, 14.5, [prop('covers', 'Corridor'), prop('range', 30)]),
  // Watches the server room door from the IT side. It does not see into the server room, nor the far end of IT.
  point('CAM-04 Server room door', 48.5, 2.5, [prop('covers', 'IT department'), prop('range', 9)]),
  point('CAM-05 Cafeteria', 33.5, 19.5, [prop('covers', 'Cafeteria / meeting room'), prop('range', 20)]),
  // No cameras in the printer room, storage or bathrooms: blind spots (DESIGN.md section 2).
];

// One reader per badge door, drawn on the wall beside the doorway. `door` is the door's code.
const badgeObjects = [
  point('BR-01 Main entrance', 7.5, 31.5, [prop('door', 'MAIN-ENT')]),
  point('BR-02 Server room', 49.5, 6.5, [prop('door', 'SRV-ROOM')]),
  point('BR-03 Security office', 17.5, 18.5, [prop('door', 'SEC-OFFICE')]),
  point('BR-04 Finance', 9.5, 13.5, [prop('door', 'FIN')]),
  point('BR-05 HR', 23.5, 13.5, [prop('door', 'HR')]),
  point('BR-06 Marketing', 35.5, 13.5, [prop('door', 'MKT')]),
  point('BR-07 IT', 46.5, 13.5, [prop('door', 'IT')]),
];

const objectLayer = (id: number, name: string, objects: unknown[], color: string) => ({
  id, name, type: 'objectgroup', draworder: 'topdown', color, opacity: 1, visible: true, x: 0, y: 0, objects,
});
const tileLayer = (id: number, name: string, data: number[]) => ({
  id, name, type: 'tilelayer', data, width: COLS, height: ROWS, opacity: 1, visible: true, x: 0, y: 0,
});

const map = {
  type: 'map',
  version: '1.10',
  tiledversion: '1.11.0',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  compressionlevel: -1,
  width: COLS,
  height: ROWS,
  tilewidth: TILE,
  tileheight: TILE,
  nextlayerid: 10,
  nextobjectid: 0,
  tilesets: [{
    firstgid: 1,
    name: 'office-tiles',
    image: 'office-tiles.png',
    imagewidth: TILES.length * TILE,
    imageheight: TILE,
    tilewidth: TILE,
    tileheight: TILE,
    tilecount: TILES.length,
    columns: TILES.length,
    margin: 0,
    spacing: 0,
    // The colours are repeated here so the game can draw the placeholder tiles without loading the image.
    tiles: TILES.map(([name, rgb], id) => ({ id, type: name, properties: [prop('color', `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`)] })),
  }],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    objectLayer(3, 'rooms', roomObjects, '#ffffff'),
    objectLayer(4, 'furniture', furnitureObjects, '#a0a0a4'),
    objectLayer(5, 'desks', deskObjects, '#00aaff'),
    objectLayer(6, 'doors', doorObjects, '#ffaa00'),
    objectLayer(7, 'cameras', cameraObjects, '#ff0000'),
    objectLayer(8, 'badge_readers', badgeObjects, '#00ff7f'),
    objectLayer(9, 'spawns', spawnObjects, '#ff00ff'),
  ],
};
map.nextobjectid = nextId;

// One number per line would make a huge file; keep each tile row on one line instead.
const json = JSON.stringify(map, null, 1).replace(/\[\n\s+(\d[\d,\s]*)\]/g, (_m, list: string) => {
  const numbers = list.split(',').map((n) => n.trim());
  const lines: string[] = [];
  for (let i = 0; i < numbers.length; i += COLS) lines.push(numbers.slice(i, i + COLS).join(','));
  return `[\n${lines.join(',\n')}]`;
});
writeFileSync(join(HERE, 'office-small.json'), `${json}\n`);

// ── The tileset image: a tiny PNG encoder (flat colours with a darker edge). ──
function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}
const width = TILES.length * TILE;
const raw = Buffer.alloc((width * 3 + 1) * TILE);
for (let y = 0; y < TILE; y++) {
  const row = y * (width * 3 + 1);
  raw[row] = 0; // PNG filter type "none"
  for (let x = 0; x < width; x++) {
    const [, rgb] = TILES[Math.floor(x / TILE)];
    const edge = x % TILE === 0 || y === 0;
    for (let k = 0; k < 3; k++) raw[row + 1 + x * 3 + k] = Math.round(rgb[k] * (edge ? 0.86 : 1));
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(TILE, 4);
header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB
writeFileSync(join(HERE, 'office-tiles.png'), Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));

console.log(`Wrote maps/office-small.json (${COLS}x${ROWS} tiles, ${DESKS.length} desks) and maps/office-tiles.png`);
