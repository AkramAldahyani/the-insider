/**
 * The office map, drawn with Phaser.
 *
 * Everything here is placeholder art made of rectangles, circles and text
 * (DESIGN.md section 13: real art comes in Phase 7). The scene does two jobs:
 *
 *  - once, at start: draw the things that never move (floor, walls, furniture,
 *    cameras, room names, desks);
 *  - every frame: read the public state the server sent and move the players,
 *    recolour the monitors, and open or close the doors to match.
 *
 * A closed door is a solid slab across the doorway. An open door is drawn as
 * two thin stubs at the frame. The small box beside a door is its badge
 * reader: green normally, red for a moment after a badge was refused.
 *
 * The scene never decides anything. Positions come from the server; the scene
 * only glides each character towards its latest known position
 * ("interpolation"), so 20 updates per second look smooth at 60 frames.
 */
import Phaser from 'phaser';
import {
  INTERACT_DISTANCE, TAP_DISTANCE, nearestDesk, nearestReaderDoor, roomAt,
  type MapDesk, type MapDoor, type OfficeMap, type PublicDesk, type PublicDoor, type PublicPlayer,
} from '@insider/shared';
import { playSound } from './sound';
import type { Store } from './store';

const COLORS = {
  wall: 0x181a20,
  wallEdge: 0x2c303a,
  desk: 0x7a5a3a,
  deskEdge: 0x4a3622,
  chair: 0x30343c,
  furniture: 0x4b5160,
  door: 0xb98a3c,
  doorRestricted: 0x9a4b4b,
  camera: 0xe5484d,
  badge: 0x3ecf8e,
  screenLogin: 0x5d6b7c,
  screenLocked: 0xf2b134,
  screenUnlocked: 0x3ecf8e,
};
/** Body colours for players; picked by player number so everyone looks different. */
const BODY_COLORS = [0x4f9dde, 0xe07a5f, 0x81b29a, 0xf2cc8f, 0xb388eb, 0xef6f8e, 0x5bc0be, 0xd4a373, 0x9bc53d, 0xc9ada7];
const LABEL = { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '11px', color: '#e6e8ee', resolution: 2 };

interface PlayerView {
  container: Phaser.GameObjects.Container;
  nose: Phaser.GameObjects.Triangle;
  /** Latest position reported by the server. */
  targetX: number;
  targetY: number;
}

interface DoorView {
  def: MapDoor;
  /** The slab, redrawn when the door's look changes. */
  slab: Phaser.GameObjects.Graphics;
  /** The badge reader's light (doors without a reader have none). */
  light: Phaser.GameObjects.Rectangle | null;
  last: string;
}

interface DeskView {
  screen: Phaser.GameObjects.Rectangle;
  status: Phaser.GameObjects.Text;
  last: string;
}

/** Colours of the placeholder tiles, read from the map file's tileset. */
function tileColors(store: Store): Map<number, number> {
  const colors = new Map<number, number>();
  const raw = store.rawMap as { tilesets?: { firstgid: number; tiles?: { id: number; properties?: { name: string; value: unknown }[] }[] }[] } | null;
  for (const set of raw?.tilesets ?? []) {
    for (const tile of set.tiles ?? []) {
      const color = tile.properties?.find((p) => p.name === 'color')?.value;
      if (typeof color === 'string') colors.set(set.firstgid + tile.id, parseInt(color.slice(1), 16));
    }
  }
  return colors;
}

export function createOfficeScene(store: Store): Phaser.Scene {
  const players = new Map<string, PlayerView>();
  const desks = new Map<string, DeskView>();
  const doors = new Map<string, DoorView>();
  let map: OfficeMap;
  let hudTimer = 0;

  class OfficeScene extends Phaser.Scene {
    constructor() {
      super('office');
    }

    create(): void {
      map = store.map!;
      this.cameras.main.setBackgroundColor('#0d0f14');
      this.cameras.main.setBounds(0, 0, map.width, map.height);
      this.drawStatic();
      for (const desk of map.desks) this.drawDesk(desk);
      for (const door of map.doors) this.addDoor(door);
    }

    /** Floor, walls, furniture, cameras and room names. Drawn once. */
    private drawStatic(): void {
      const g = this.add.graphics();
      const colors = tileColors(store);
      const t = map.tile;
      for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
          const floor = map.floor[r][c];
          if (floor) {
            g.fillStyle(colors.get(floor) ?? 0x4a4c52, 1).fillRect(c * t, r * t, t, t);
            g.lineStyle(1, 0x000000, 0.08).strokeRect(c * t, r * t, t, t);
          }
          if (map.walls[r][c]) {
            g.fillStyle(COLORS.wall, 1).fillRect(c * t, r * t, t, t);
            g.lineStyle(1, COLORS.wallEdge, 1).strokeRect(c * t + 0.5, r * t + 0.5, t - 1, t - 1);
          }
        }
      }
      for (const f of map.furniture) {
        g.fillStyle(COLORS.furniture, 1).fillRoundedRect(f.x + 2, f.y + 2, f.width - 4, f.height - 4, 4);
        g.lineStyle(1, 0x000000, 0.4).strokeRoundedRect(f.x + 2, f.y + 2, f.width - 4, f.height - 4, 4);
        if (f.width >= 3 * t || f.height >= 3 * t) {
          this.add.text(f.x + f.width / 2, f.y + f.height / 2, f.name, { ...LABEL, fontSize: '9px', color: '#aab0bd' }).setOrigin(0.5).setDepth(2);
        }
      }
      for (const cam of map.cameras) {
        g.fillStyle(COLORS.camera, 1).fillTriangle(cam.x - 7, cam.y - 6, cam.x + 7, cam.y - 6, cam.x, cam.y + 7);
        g.lineStyle(1, 0x000000, 0.6).strokeTriangle(cam.x - 7, cam.y - 6, cam.x + 7, cam.y - 6, cam.x, cam.y + 7);
        this.add.text(cam.x + 10, cam.y - 6, cam.name.split(' ')[0], { ...LABEL, fontSize: '8px', color: '#ff9da0' }).setDepth(2);
      }
      // Room names. A room made of two rectangles (IT) is labelled once.
      const named = new Set<string>();
      for (const room of map.rooms) {
        if (named.has(room.name) || room.name === 'Corridor') continue;
        named.add(room.name);
        this.add.text(room.x + room.width / 2, room.y + room.height - 14, room.name.toUpperCase(), { ...LABEL, fontSize: '12px', color: '#ffffff' })
          .setOrigin(0.5).setAlpha(0.45).setDepth(2);
      }
    }

    /** A door (redrawn when it opens or closes) and, if it has one, its badge reader. */
    private addDoor(def: MapDoor): void {
      const slab = this.add.graphics().setDepth(3);
      const reader = map.badgeReaders.find((r) => r.props.door === def.code);
      let light: Phaser.GameObjects.Rectangle | null = null;
      if (reader) {
        this.add.rectangle(reader.x, reader.y, 12, 16, 0x15171c).setStrokeStyle(1, 0x000000).setDepth(3);
        light = this.add.rectangle(reader.x, reader.y - 2, 6, 6, COLORS.badge).setDepth(4);
      }
      const view: DoorView = { def, slab, light, last: '' };
      doors.set(def.code, view);
      this.updateDoor({ id: def.code, look: 'closed' });
    }

    private updateDoor(door: PublicDoor): void {
      const view = doors.get(door.id);
      if (!view || view.last === door.look) return;
      // A sound for doors close enough to hear (not on the very first draw).
      const me = store.room?.state.players?.get(store.getUi().playerId);
      const audible = view.last !== '' && me && Math.hypot(me.x - (view.def.x + view.def.width / 2), me.y - (view.def.y + view.def.height / 2)) < 260;
      if (audible && door.look === 'denied') playSound('badge-denied');
      if (audible && door.look === 'open' && view.def.reader) playSound('badge-granted');
      view.last = door.look;

      const d = view.def;
      const g = view.slab.clear();
      const color = d.restricted ? COLORS.doorRestricted : COLORS.door;
      const across = d.axis === 'y'; // the slab lies left-to-right in a horizontal wall
      if (door.look === 'open') {
        // Two short stubs at the frame: the doorway is clear.
        g.fillStyle(color, 0.9);
        if (across) g.fillRect(d.x, d.y + d.height / 2 - 4, 7, 8).fillRect(d.x + d.width - 7, d.y + d.height / 2 - 4, 7, 8);
        else g.fillRect(d.x + d.width / 2 - 4, d.y, 8, 7).fillRect(d.x + d.width / 2 - 4, d.y + d.height - 7, 8, 7);
      } else {
        g.fillStyle(color, 1).lineStyle(1, 0x000000, 0.7);
        if (across) g.fillRect(d.x, d.y + d.height / 2 - 6, d.width, 12).strokeRect(d.x, d.y + d.height / 2 - 6, d.width, 12);
        else g.fillRect(d.x + d.width / 2 - 6, d.y, 12, d.height).strokeRect(d.x + d.width / 2 - 6, d.y, 12, d.height);
      }
      view.light?.setFillStyle(door.look === 'denied' ? COLORS.camera : door.look === 'open' ? 0xffffff : COLORS.badge);
    }

    /** A desk: table, chair, monitor (recoloured live) and two text lines. */
    private drawDesk(desk: MapDesk): void {
      const g = this.add.graphics().setDepth(3);
      g.fillStyle(COLORS.chair, 1).fillCircle(desk.seatX, desk.seatY, 9);
      g.fillStyle(COLORS.desk, 1).fillRoundedRect(desk.x + 1, desk.y + 3, desk.width - 2, desk.height - 5, 3);
      g.lineStyle(1, COLORS.deskEdge, 1).strokeRoundedRect(desk.x + 1, desk.y + 3, desk.width - 2, desk.height - 5, 3);
      const screen = this.add.rectangle(desk.x + desk.width / 2, desk.y + desk.height / 2 + 1, 26, 14, COLORS.screenLogin).setStrokeStyle(2, 0x101216).setDepth(4);
      this.add.text(desk.x + desk.width / 2, desk.y - 18, desk.hostname, { ...LABEL, fontSize: '10px' }).setOrigin(0.5).setDepth(6);
      const status = this.add.text(desk.x + desk.width / 2, desk.y - 7, '', { ...LABEL, fontSize: '9px', color: '#aab0bd' }).setOrigin(0.5).setDepth(6);
      desks.set(desk.hostname, { screen, status, last: '' });
    }

    private addPlayer(p: PublicPlayer): PlayerView {
      const index = Math.max(0, parseInt(p.id.replace(/\D/g, ''), 10) - 1) % BODY_COLORS.length;
      const body = this.add.circle(0, 0, 11, BODY_COLORS[index]).setStrokeStyle(2, 0x101216);
      // The "nose": a small triangle showing which way the character faces.
      const nose = this.add.triangle(0, 0, -5, 4, 5, 4, 0, -5, 0xffffff).setOrigin(0, 0);
      const self = p.id === store.getUi().playerId;
      const name = this.add.text(0, 15, self ? `${p.name} (you)` : p.name, { ...LABEL, color: self ? '#ffe08a' : '#e6e8ee' }).setOrigin(0.5, 0);
      const container = this.add.container(p.x, p.y, [body, nose, name]).setDepth(5);
      const view = { container, nose, targetX: p.x, targetY: p.y };
      players.set(p.id, view);
      if (self) this.cameras.main.startFollow(container, true, 0.15, 0.15);
      return view;
    }

    private updateDesk(desk: PublicDesk): void {
      const view = desks.get(desk.hostname);
      const key = `${desk.screen}|${desk.lockUser}|${desk.occupantId}`;
      if (!view || view.last === key) return;
      view.last = key;
      view.screen.setFillStyle(desk.screen === 'locked' ? COLORS.screenLocked : desk.screen === 'unlocked' ? COLORS.screenUnlocked : COLORS.screenLogin);
      view.screen.setStrokeStyle(2, desk.occupantId ? 0xffffff : 0x101216);
      const text = desk.screen === 'locked' ? `LOCKED ${desk.lockUser}` : desk.screen === 'unlocked' ? 'UNLOCKED' : 'LOGIN';
      view.status.setText(text).setColor(desk.screen === 'locked' ? '#f2b134' : desk.screen === 'unlocked' ? '#3ecf8e' : '#aab0bd');
    }

    override update(_time: number, deltaMs: number): void {
      const state = store.room?.state;
      if (!state?.players) return;
      const selfId = store.getUi().playerId;

      // Players: create, move, remove.
      const alive = new Set<string>();
      state.players.forEach((p) => {
        alive.add(p.id);
        const view = players.get(p.id) ?? this.addPlayer(p);
        view.targetX = p.x;
        view.targetY = p.y;
        // Glide towards the server's position; jump if it is far away (teleport, first frame).
        const dx = p.x - view.container.x;
        const dy = p.y - view.container.y;
        const blend = Math.hypot(dx, dy) > 96 ? 1 : Math.min(1, deltaMs / 70);
        view.container.setPosition(view.container.x + dx * blend, view.container.y + dy * blend);
        const [nx, ny, angle] = p.facing === 'up' ? [0, -13, 0] : p.facing === 'down' ? [0, 13, 180] : p.facing === 'left' ? [-13, 0, -90] : [13, 0, 90];
        view.nose.setPosition(nx, ny).setAngle(angle);
        view.container.setAlpha(p.seatedAt ? 0.85 : 1);
      });
      for (const [id, view] of players) {
        if (!alive.has(id)) {
          view.container.destroy();
          players.delete(id);
        }
      }
      state.desks.forEach((desk) => this.updateDesk(desk));
      state.doors?.forEach((door) => this.updateDoor(door));

      // HUD facts, a few times per second (not every frame: React does not need 60 updates a second).
      hudTimer += deltaMs;
      if (hudTimer < 120) return;
      hudTimer = 0;
      const me = state.players.get(selfId);
      if (!me) return;
      const near = nearestDesk(map, me.x, me.y);
      const door = nearestReaderDoor(map, me.x, me.y);
      const atDoor = !me.seatedAt && door && door.distance <= TAP_DISTANCE - 4 ? door.door : null;
      store.set({
        nearDoor: atDoor?.code ?? '',
        nearDoorName: atDoor?.name ?? '',
        clock: Math.floor(state.clock / 1000) * 1000,
        speed: state.speed,
        roomName: roomAt(map, me.x, me.y),
        nearDesk: !me.seatedAt && near && near.distance <= INTERACT_DISTANCE - 4 ? near.desk.hostname : '',
      });
    }
  }

  return new OfficeScene();
}
