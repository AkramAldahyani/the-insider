/**
 * The office map, drawn with Phaser.
 *
 * Office materials use the existing Tiled geometry; original temporary pixel
 * sprites supply four-direction animation. The scene does two jobs:
 *
 *  - once, at start: draw the things that never move (floor, walls, furniture,
 *    cameras, room names, desks);
 *  - every frame: read the public state the server sent and move the players,
 *    recolour the monitors, and open or close the doors to match.
 *
 * A closed door is a solid slab across the doorway. An open door is drawn as
 * two thin stubs at the frame. The small box beside a door is its badge
 * reader: white normally, green while access is granted, red after refusal.
 *
 * The scene never decides anything. Positions come from the server; the scene
 * only glides each character towards its latest known position
 * ("interpolation"), so 20 updates per second look smooth at 60 frames.
 */
import Phaser from 'phaser';
import {
  INTERACT_DISTANCE, TAP_DISTANCE, distanceToRect, nearestDesk, nearestReaderDoor, roomAt,
  type MapDesk, type MapDoor, type OfficeMap, type PublicDesk, type PublicDoor, type PublicPlayer,
} from '@insider/shared';
import { playSound } from './sound';
import type { Store } from './store';
import { characterSheet, DIRECTIONS, FRAME_H, FRAME_W } from './characterArt';
import { drawOffice } from './officeArt';

const COLORS = {
  deskEdge: 0x4a3622,
  door: 0xb98a3c,
  doorRestricted: 0x9a4b4b,
  camera: 0xe5484d,
  badge: 0x3ecf8e,
  screenLogin: 0x5d6b7c,
  screenLocked: 0xf2b134,
  screenUnlocked: 0x3ecf8e,
};
const LABEL = { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '11px', color: '#e6e8ee', resolution: 2 };

interface PlayerView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  /** Shown while the person is visibly busy at a PC (crouched, fiddling with it). */
  busy: Phaser.GameObjects.Text;
  walkTime: number;
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
  let highlight: Phaser.GameObjects.Graphics;

  class OfficeScene extends Phaser.Scene {
    constructor() {
      super('office');
    }

    create(): void {
      map = store.map!;
      this.cameras.main.setBackgroundColor('#0d0f14');
      this.cameras.main.setBounds(0, 0, map.width, map.height);
      drawOffice(this, map, tileColors(store));
      for (const desk of map.desks) this.drawDesk(desk);
      for (const door of map.doors) this.addDoor(door);
      highlight = this.add.graphics().setDepth(4);
    }

    /** A door (redrawn when it opens or closes) and, if it has one, its badge reader. */
    private addDoor(def: MapDoor): void {
      const slab = this.add.graphics().setDepth(3);
      const reader = map.badgeReaders.find((r) => r.props.door === def.code);
      let light: Phaser.GameObjects.Rectangle | null = null;
      if (reader) {
        this.add.rectangle(reader.x, reader.y, 16, 22, 0x132131).setStrokeStyle(2, 0x718292).setDepth(3);
        light = this.add.rectangle(reader.x, reader.y - 2, 6, 6, 0xffffff).setDepth(4);
        this.add.rectangle(reader.x, reader.y + 6, 7, 2, 0x8497a4).setDepth(4);
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
      g.fillStyle(0x101b29, 0.6).fillRect(d.x, d.y, d.width, d.height);
      g.lineStyle(1, 0xd5be87, 0.45).strokeRect(d.x + 2, d.y + 2, d.width - 4, d.height - 4);
      if (door.look === 'open') {
        // Two short stubs at the frame: the doorway is clear.
        g.fillStyle(color, 0.9);
        if (across) g.fillRect(d.x, d.y + d.height / 2 - 4, 7, 8).fillRect(d.x + d.width - 7, d.y + d.height / 2 - 4, 7, 8);
        else g.fillRect(d.x + d.width / 2 - 4, d.y, 8, 7).fillRect(d.x + d.width / 2 - 4, d.y + d.height - 7, 8, 7);
      } else {
        g.fillStyle(color, 1).lineStyle(1, 0x000000, 0.7);
        if (across) g.fillRect(d.x, d.y + d.height / 2 - 6, d.width, 12).strokeRect(d.x, d.y + d.height / 2 - 6, d.width, 12);
        else g.fillRect(d.x + d.width / 2 - 6, d.y, 12, d.height).strokeRect(d.x + d.width / 2 - 6, d.y, 12, d.height);
        g.lineStyle(1, 0xffe5b1, 0.7);
        if (across) {
          g.lineBetween(d.x + 3, d.y + d.height / 2 - 4, d.x + d.width - 3, d.y + d.height / 2 - 4);
          g.lineStyle(2, 0x3f3d3e).lineBetween(d.x + d.width / 2, d.y + d.height / 2 - 5, d.x + d.width / 2, d.y + d.height / 2 + 5);
        } else g.lineBetween(d.x + d.width / 2 - 4, d.y + 3, d.x + d.width / 2 - 4, d.y + d.height - 3);
      }
      view.light?.setFillStyle(door.look === 'denied' ? COLORS.camera : door.look === 'open' ? COLORS.badge : 0xffffff);
    }

    /** A desk: table, chair, monitor (recoloured live) and two text lines. */
    private drawDesk(desk: MapDesk): void {
      const g = this.add.graphics().setDepth(3);
      g.fillStyle(0x111c2b, 0.35).fillEllipse(desk.seatX + 2, desk.seatY + 4, 28, 16);
      g.fillStyle(0x243247).fillRoundedRect(desk.seatX - 11, desk.seatY - 8, 22, 18, 4);
      g.lineStyle(1, 0x7d8b9e).strokeRoundedRect(desk.seatX - 11, desk.seatY - 8, 22, 18, 4);
      g.fillStyle(0x516178).fillRoundedRect(desk.seatX - 9, desk.seatY + 4, 18, 6, 2);
      g.fillStyle(0x192333, 0.4).fillRect(desk.x + 2, desk.y + 7, desk.width - 4, desk.height - 7);
      g.fillStyle(0xb29377, 1).fillRoundedRect(desk.x + 1, desk.y + 2, desk.width - 2, desk.height - 7, 3);
      g.lineStyle(1, COLORS.deskEdge, 1).strokeRoundedRect(desk.x + 1, desk.y + 3, desk.width - 2, desk.height - 5, 3);
      g.lineStyle(1, 0xe3c5a2, 0.7).lineBetween(desk.x + 4, desk.y + 4, desk.x + desk.width - 4, desk.y + 4);
      g.fillStyle(0x364456).fillRect(desk.x + 7, desk.y + 7, 7, 12);
      g.fillStyle(0x253344).fillRect(desk.seatX - 11, desk.y + 21, 22, 5);
      g.lineStyle(1, 0x8997a3, 0.5).lineBetween(desk.seatX - 9, desk.y + 23, desk.seatX + 8, desk.y + 23);
      g.fillStyle(0xdce5de).fillRoundedRect(desk.x + desk.width - 12, desk.y + 13, 5, 7, 2);
      const screen = this.add.rectangle(desk.x + desk.width / 2, desk.y + 11, 26, 14, COLORS.screenLogin).setStrokeStyle(2, 0x101216).setDepth(4);
      this.add.rectangle(desk.seatX - 4, desk.y + 7, 15, 1, 0xffffff, 0.35).setDepth(4);
      this.add.text(desk.x + desk.width / 2, desk.y - 23, desk.hostname, { ...LABEL, fontSize: '9px', backgroundColor: '#172638', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(6);
      const status = this.add.text(desk.x + desk.width / 2, desk.y - 7, '', { ...LABEL, fontSize: '9px', color: '#aab0bd' }).setOrigin(0.5).setDepth(6);
      desks.set(desk.hostname, { screen, status, last: '' });
    }

    private addPlayer(p: PublicPlayer): PlayerView {
      const department = store.getUi().employees.find((e) => e.id === p.id)?.department ?? '';
      const key = `employee-${p.id}`;
      if (!this.textures.exists(key)) {
        const texture = this.textures.addCanvas(key, characterSheet(p.id, department))!;
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        for (let row = 0; row < 4; row++) for (let frame = 0; frame < 4; frame++) {
          texture.add(row * 4 + frame, 0, frame * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
        }
      }
      const shadow = this.add.ellipse(0, 9, 27, 10, 0x07111e, 0.35);
      const sprite = this.add.image(0, 10, key, 0).setOrigin(0.5, 1);
      const self = p.id === store.getUi().playerId;
      const name = this.add.text(0, 17, self ? `${p.name} (you)` : p.name, { ...LABEL, fontFamily: 'Segoe UI, sans-serif', fontSize: '10px', backgroundColor: '#132131', padding: { x: 4, y: 2 }, color: self ? '#9fe8d0' : '#e6e8ee' }).setOrigin(0.5, 0);
      // A little "..." bubble: what anybody walking past sees when someone fiddles with a PC.
      const busy = this.add.text(12, -34, '···', { ...LABEL, fontSize: '13px', color: '#ffd27a', backgroundColor: '#2b2113', padding: { x: 3, y: 0 } }).setOrigin(0.5).setVisible(false);
      const container = this.add.container(p.x, p.y, [shadow, sprite, name, busy]).setDepth(10);
      if (self) {
        const marker = this.add.triangle(0, -37, 0, 0, 8, 0, 4, 5, 0x8fe3cd).setStrokeStyle(1, 0x143b45);
        container.add(marker);
      }
      const view = { container, sprite, busy, walkTime: 0, targetX: p.x, targetY: p.y };
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
        const walking = !p.seatedAt && Math.hypot(dx, dy) > 0.8 && blend !== 1;
        view.walkTime = walking ? view.walkTime + deltaMs : 0;
        const frame = walking ? [1, 2, 3, 2][Math.floor(view.walkTime / 130) % 4] : 0;
        view.sprite.setFrame(DIRECTIONS.indexOf(p.facing) * 4 + frame);
        view.container.setDepth(10 + p.y / map.height);
        view.container.setAlpha(p.seatedAt ? 0.9 : 1);
        // Crouched at a PC: lower the body a little and show the bubble.
        const atPc = p.activity === 'at-pc';
        view.busy.setVisible(atPc);
        view.sprite.setScale(1, atPc ? 0.85 : 1);
      });
      for (const [id, view] of players) {
        if (!alive.has(id)) {
          view.container.destroy();
          players.delete(id);
        }
      }
      state.desks.forEach((desk) => this.updateDesk(desk));
      state.doors?.forEach((door) => this.updateDoor(door));
      // Read the same existing proximity facts as the E-key prompt; never grant interaction here.
      highlight.clear();
      const ui = store.getUi();
      const target = ui.nearDesk ? map.desks.find((d) => d.hostname === ui.nearDesk) : map.doors.find((d) => d.code === ui.nearDoor);
      if (target && !ui.seatedAt) {
        highlight.lineStyle(2, 0x8fe3cd, 0.9).strokeRoundedRect(target.x - 3, target.y - 3, target.width + 6, target.height + 6, 4);
      }

      // HUD facts, a few times per second (not every frame: React does not need 60 updates a second).
      hudTimer += deltaMs;
      if (hudTimer < 120) return;
      hudTimer = 0;
      const me = state.players.get(selfId);
      if (!me) return;
      const near = nearestDesk(map, me.x, me.y);
      const door = nearestReaderDoor(map, me.x, me.y);
      const atDoor = !me.seatedAt && door && door.distance <= TAP_DISTANCE - 4 ? door.door : null;
      // The CCTV monitors in the security office (furniture of kind "monitors").
      const station = map.furniture.find((f) => f.kind === 'monitors');
      const atMonitors = !me.seatedAt && !!station && distanceToRect(station, me.x, me.y) <= INTERACT_DISTANCE - 4;
      // Walking away from the monitors switches them off.
      if (!atMonitors && store.getUi().monitors) store.set({ monitors: null, monitorFrame: null });
      store.set({
        nearMonitors: atMonitors,
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
