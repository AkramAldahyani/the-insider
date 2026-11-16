/** Presentation only. Every solid prop stays inside its existing Tiled footprint. */
import Phaser from 'phaser';
import type { MapFurniture, OfficeMap } from '@insider/shared';
import { departmentColor } from './characterArt';

const hex = (color: string) => parseInt(color.slice(1), 16);
const textStyle = { fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', color: '#d9e5ef', resolution: 2 };

function plant(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x09121c, 0.3).fillEllipse(x + 2, y + 6, 23, 10);
  g.fillStyle(0x8b9ca6).fillRoundedRect(x - 6, y, 12, 10, 3);
  g.fillStyle(0x2b3940).fillEllipse(x, y, 12, 5);
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7;
    g.fillStyle(i % 2 ? 0x6e9c61 : 0x466d50).fillEllipse(x + Math.cos(a) * 6, y - 5 + Math.sin(a) * 5, 9, 5);
  }
  g.fillStyle(0x9bbf70).fillEllipse(x - 1, y - 7, 4, 7);
}

function furniture(g: Phaser.GameObjects.Graphics, f: MapFurniture): void {
  const x = f.x + 2, y = f.y + 2, w = f.width - 4, h = f.height - 4;
  g.fillStyle(0x0b111b, 0.4).fillRoundedRect(x, y + 3, w, h - 2, 3);
  const frame = (color: number) => {
    g.fillStyle(color).fillRoundedRect(x, y, w, h - 3, 3);
    g.lineStyle(1, 0x14202d).strokeRoundedRect(x, y, w, h - 3, 3);
    g.lineStyle(1, 0xffffff, 0.16).lineBetween(x + 3, y + 2, x + w - 3, y + 2);
  };
  switch (f.kind) {
    case 'rack':
      frame(0x283545);
      for (let dx = 4; dx < w - 12; dx += 30) {
        g.fillStyle(0x0b1420).fillRect(x + dx, y + 4, 24, h - 12);
        for (let dy = 7; dy < h - 9; dy += 5) {
          g.fillStyle(0x455469).fillRect(x + dx + 3, y + dy, 14, 2);
          g.fillStyle(0x7ee0ad).fillRect(x + dx + 19, y + dy, 2, 2);
        }
      }
      break;
    case 'shelf': {
      frame(0x66717a);
      const vertical = h > w;
      const length = vertical ? h : w;
      for (let d = 5; d < length - 10; d += 26) {
        const bx = x + (vertical ? 4 : d), by = y + (vertical ? d : 4);
        g.fillStyle(0x303e4b).fillRect(bx, by, vertical ? w - 8 : 23, vertical ? 23 : h - 12);
        for (let b = 0; b < 3; b++) {
          g.fillStyle([0xb68e64, 0x809caa, 0xc0b295][b]).fillRect(bx + 2 + b * 6, by + 3, 4, 12);
          g.fillStyle(0xe0d8c1).fillRect(bx + 2 + b * 6, by + 6, 4, 2);
        }
      }
      if (w > 100 && h < 40) plant(g, x + w - 15, y + 6);
      break;
    }
    case 'board':
      frame(0xa8b5ba);
      g.fillStyle(0xd9ded5).fillRect(x + 4, y + 4, w - 8, h - 11);
      for (let n = 0; n < 5; n++) {
        g.fillStyle([0x8aaec3, 0xe6c67b, 0xcc9fbb][n % 3]).fillRect(x + 10 + n * 24, y + 7, 13, 9);
      }
      break;
    case 'sofa':
      frame(0x293344);
      for (let d = 8; d < h - 20; d += 28) {
        g.fillStyle(0x677185).fillRoundedRect(x + 7, y + d, w - 18, 25, 4);
        g.fillStyle(0x8a91a0, 0.4).fillRect(x + 10, y + d + 2, w - 25, 2);
      }
      g.fillStyle(0x434f64).fillRoundedRect(x + w - 12, y + 6, 9, h - 16, 3);
      g.fillStyle(0xc3a16e).fillRoundedRect(x + 12, y + 13, 14, 14, 2);
      break;
    case 'table':
      frame(0x4a3a32);
      // Seats are contained in the already-solid table rectangle.
      for (let dx = 15; dx < w - 15; dx += 41) {
        g.fillStyle(0x263344).fillRoundedRect(x + dx, y, 25, 13, 3);
        g.fillStyle(0x263344).fillRoundedRect(x + dx, y + h - 17, 25, 13, 3);
        g.lineStyle(1, 0x7a8797).lineBetween(x + dx + 3, y + 2, x + dx + 22, y + 2);
      }
      g.fillStyle(0xb18c68).fillRoundedRect(x + 6, y + 13, w - 12, h - 29, 4);
      g.lineStyle(1, 0xe7c9a2, 0.5).lineBetween(x + 10, y + 15, x + w - 10, y + 15);
      plant(g, x + w / 2, y + h / 2 - 1);
      if (w > 120) {
        g.fillStyle(0x203746).fillRect(x + 23, y + 19, 22, 16);
        g.fillStyle(0x6ab4ce).fillRect(x + 25, y + 21, 18, 10);
        g.fillStyle(0xe1dfd4).fillRect(x + w - 33, y + 21, 12, 14);
      }
      break;
    case 'monitors':
      frame(0x263241);
      for (let dx = 4; dx < w - 22; dx += 31) {
        g.fillStyle(0x111d29).fillRect(x + dx, y + 3, 28, h - 10);
        g.fillStyle(0x54778e).fillRect(x + dx + 2, y + 5, 24, h - 14);
        g.lineStyle(1, 0xb5d1df, 0.3).lineBetween(x + dx + 3, y + 6, x + dx + 20, y + 16);
        g.fillStyle(0x79cfb0).fillRect(x + dx + 22, y + 6, 2, 2);
      }
      break;
    case 'printer':
      frame(0xa2adb5);
      g.fillStyle(0xced5d4).fillRect(x + 7, y + 2, w - 14, 11);
      g.fillStyle(0x253543).fillRect(x + 10, y + 15, w - 20, 5);
      g.fillStyle(0xe7e8df).fillRect(x + 16, y + 13, w - 32, 7);
      g.fillStyle(0x69c8b7).fillRect(x + w - 10, y + 14, 4, 3);
      break;
    case 'sink':
      frame(0xc1cbc9);
      for (let dx = 5; dx < w - 18; dx += 28) {
        g.fillStyle(0x738f9a).fillRoundedRect(x + dx, y + 7, 21, 15, 5);
        g.fillStyle(0xe4ebdf).fillRoundedRect(x + dx + 3, y + 8, 15, 10, 4);
        g.fillStyle(0x687a87).fillRect(x + dx + 9, y + 3, 3, 7);
      }
      break;
    case 'stall':
      frame(0x576d7a);
      for (let dx = 4; dx < w - 25; dx += 32) {
        g.fillStyle(0x344958).fillRect(x + dx, y + 3, 28, h - 9);
        g.fillStyle(0xc5d3d2).fillRect(x + dx + 22, y + 12, 3, 3);
      }
      break;
    default: frame(0x647180);
  }
}

export function drawOffice(scene: Phaser.Scene, map: OfficeMap, colors: Map<number, number>): void {
  const g = scene.add.graphics();
  const t = map.tile;
  for (let row = 0; row < map.rows; row++) for (let col = 0; col < map.cols; col++) {
    const x = col * t, y = row * t, floor = map.floor[row][col];
    if (floor) {
      g.fillStyle(colors.get(floor) ?? 0x465467).fillRect(x, y, t, t);
      g.fillStyle(0xffffff, (row + col) % 2 ? 0.018 : 0.04).fillRect(x + 1, y + 1, t - 2, t - 2);
      g.lineStyle(1, 0x102331, 0.11).strokeRect(x, y, t, t);
      // Subtle carpet weave; timber grain in warm departments.
      if ([3, 9, 11].includes(floor)) {
        g.lineStyle(1, 0x211d22, 0.13).lineBetween(x, y + 11, x + t, y + 11).lineBetween(x, y + 23, x + t, y + 23);
      } else if (floor !== 6) {
        g.lineStyle(1, 0xffffff, 0.025).lineBetween(x + 3, y + 8, x + t - 3, y + 8).lineBetween(x + 3, y + 20, x + t - 3, y + 20);
      }
    }
    if (!map.walls[row][col]) continue;
    const horizontal = !!map.walls[row]?.[col - 1] || !!map.walls[row]?.[col + 1];
    g.fillStyle(0x192334).fillRect(x, y, t, t);
    if (horizontal) {
      g.fillStyle(0x3b475a).fillRect(x, y + 5, t, t - 12);
      g.fillStyle(0x738195).fillRect(x, y + 5, t, 2);
      g.fillStyle(0x283244).fillRect(x, y + 18, t, 5);
      if (col % 4 === 0) g.fillStyle(0x101b2a).fillRect(x, y + 4, 3, t - 8);
    } else {
      g.fillStyle(0x3b475a).fillRect(x + 5, y, t - 12, t);
      g.fillStyle(0x738195).fillRect(x + 5, y, 2, t);
      g.fillStyle(0x283244).fillRect(x + 18, y, 5, t);
      if (row % 4 === 0) g.fillStyle(0x101b2a).fillRect(x + 4, y, t - 8, 3);
    }
    const below = map.walls[row + 1]?.[col] === 0;
    const right = map.walls[row]?.[col + 1] === 0;
    if (below) {
      g.fillStyle(0x0a1523, 0.25).fillRect(x, y + t, t, 7);
      g.fillStyle(0x7f8d9d).fillRect(x + 2, y + t - 5, t - 4, 2);
      if (col % 4 === 2) {
        g.fillStyle(0x79b4c4, 0.1).fillRect(x + 3, y + t, t - 6, 12);
        g.fillStyle(0xb1d9e3).fillRect(x + 5, y + t - 5, t - 10, 2);
      }
    }
    if (right) g.fillStyle(0x788798).fillRect(x + t - 5, y + 2, 2, t - 4);
    // Exterior glazing lives inside the wall, never inside a walkable tile.
    if ((row === 0 || row === 31) && col % 5 !== 0 && horizontal) {
      g.fillStyle(0x142c3f).fillRect(x + 1, y + 8, t - 2, 13);
      g.fillStyle(0x6896ac).fillRect(x + 2, y + 10, t - 4, 8);
      g.fillStyle(0xb2d5df, 0.7).fillRect(x + 2, y + 10, t - 4, 2);
      g.lineStyle(1, 0xd6edf1, 0.3).lineBetween(x + 6, y + 18, x + 15, y + 10);
    }
  }
  // Floor inlays do not imply obstacles or change navigability.
  const named = new Set<string>();
  for (const room of map.rooms) {
    if (named.has(room.name) || room.name === 'Outside') continue;
    named.add(room.name);
    if (room.name === 'Corridor') {
      scene.add.text(room.x + room.width / 2, room.y + room.height / 2, 'THE INSIDER   /   NEXORA HQ', { ...textStyle, fontSize: '21px', fontStyle: 'bold', color: '#a9b8c9' }).setOrigin(0.5).setAlpha(0.3);
      continue;
    }
    const accent = hex(departmentColor(room.name));
    const width = Math.min(room.width - 24, 250);
    const cx = room.x + room.width / 2;
    let y = room.y + room.height - 23;
    // Keep floor signs clear of existing furniture (notably the security monitor bank).
    for (const f of map.furniture) {
      if (f.x < cx + width / 2 && f.x + f.width > cx - width / 2 && f.y < y + 14 && f.y + f.height > y - 10) y = f.y - 20;
    }
    // Woven inset carpet; purely a floor treatment under the original walkways.
    if (room.width >= 250 && room.height >= 200 && room.name !== 'Bathrooms') {
      const rx = room.x + 36, ry = room.y + 150, rw = room.width - 72, rh = room.height - 215;
      if (rh > 35) {
        g.fillStyle(0x152d40, 0.13).fillRoundedRect(rx, ry, rw, rh, 16);
        g.lineStyle(2, accent, 0.16).strokeRoundedRect(rx + 4, ry + 4, rw - 8, rh - 8, 13);
        for (let yy = ry + 10; yy < ry + rh - 8; yy += 4) g.lineStyle(1, 0xe4e8df, 0.025).lineBetween(rx + 10, yy, rx + rw - 10, yy);
      }
    }
    g.fillStyle(0x101c2b, 0.72).fillRoundedRect(cx - width / 2, y - 10, width, 24, 3);
    g.fillStyle(accent, 0.85).fillRect(cx - width / 2, y - 10, 3, 24);
    scene.add.text(cx + 2, y + 2, room.name.toUpperCase(), { ...textStyle, fontSize: room.width < 220 ? '10px' : '11px', color: '#e0e8ed' }).setOrigin(0.5).setDepth(2);
    // A quiet border defines the carpet without adding furniture or collision.
    g.lineStyle(1, accent, 0.15).strokeRect(room.x + 9, room.y + 9, room.width - 18, room.height - 18);
  }
  const props = scene.add.graphics().setDepth(2);
  for (const f of map.furniture) furniture(props, f);
  // Wall-mounted department signage and framed charts, inside solid wall tiles.
  for (const room of map.rooms) {
    if (room.name === 'Corridor' || room.name === 'Outside') continue;
    const col = Math.floor((room.x - t / 2) / t), startRow = Math.floor((room.y + 180) / t);
    if (room.height < 250 || !map.walls[startRow]?.[col] || !map.walls[startRow + 1]?.[col]) continue;
    const x = col * t + 7, y = startRow * t + 3;
    props.fillStyle(0x0d1828).fillRect(x, y, 19, 52);
    props.fillStyle(0xaebcc2).fillRect(x + 2, y + 2, 15, 48);
    props.fillStyle(0xd7ded8).fillRect(x + 4, y + 4, 11, 44);
    const accent = hex(departmentColor(room.name));
    for (let n = 0; n < 3; n++) props.fillStyle(accent).fillRect(x + 5 + n * 3, y + 25 - n * 5, 2, 13 + n * 5);
    props.fillStyle(0x778d9a).fillRect(x + 5, y + 9, 9, 2).fillRect(x + 5, y + 42, 9, 1);
  }
  for (const cam of map.cameras) {
    props.fillStyle(0x152332).fillCircle(cam.x, cam.y + 4, 5);
    props.lineStyle(3, 0x8295a4).lineBetween(cam.x, cam.y + 3, cam.x + 3, cam.y - 3);
    props.fillStyle(0xb96572).fillRoundedRect(cam.x - 8, cam.y - 9, 17, 9, 2);
    props.fillStyle(0xe5a1a1).fillRect(cam.x - 6, cam.y - 8, 12, 2);
    props.fillStyle(0x182332).fillRect(cam.x + 7, cam.y - 7, 4, 6);
    props.fillStyle(0xefb1a3).fillCircle(cam.x + 2, cam.y - 3, 1);
    const rightEdge = cam.x > map.width - 100;
    scene.add.text(cam.x + (rightEdge ? -15 : 15), cam.y - 5, cam.name.split(' ')[0], { ...textStyle, fontSize: '9px', color: '#efb8bf', backgroundColor: '#352936', padding: { x: 4, y: 2 } }).setOrigin(rightEdge ? 1 : 0, 0.5).setDepth(3);
  }
  // Bake static strokes once through Phaser's existing texture pipeline. This
  // avoids replaying thousands of floor/material commands on every animation frame.
  g.generateTexture('office-materials', map.width, map.height);
  scene.add.image(0, 0, 'office-materials').setOrigin(0).setDepth(-1);
  g.destroy();
  props.generateTexture('office-furnishings', map.width, map.height);
  scene.add.image(0, 0, 'office-furnishings').setOrigin(0).setDepth(2);
  props.destroy();
}
