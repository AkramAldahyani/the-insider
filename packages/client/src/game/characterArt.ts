/** Original TEMPORARY pixel art, not crops of the concept sheet.
 * Four directions × four dedicated frames (idle, left step, passing, right step).
 * Only public employee id/department select cosmetics. No roles or private data.
 * This canvas source is shared by Phaser sprites and React portraits.
 */
import { LOOK_HAIR, LOOK_OUTFITS, LOOK_SKINS, type Facing, type Look } from '@insider/shared';

export const FRAME_W = 32;
export const FRAME_H = 40;
export const DIRECTIONS: Facing[] = ['down', 'left', 'right', 'up'];
export const departmentColor = (department: string): string => {
  const d = department.toLowerCase();
  if (d.includes('finance')) return '#78bdec';
  if (d === 'hr' || d.includes('human')) return '#d99bc5';
  if (d.includes('marketing')) return '#e4bc70';
  if (d.includes('sales')) return '#f09a6b';
  if (d.includes('legal')) return '#9fb4e8';
  if (d.includes('security')) return '#dd8993';
  if (d.includes('admin')) return '#b6a2e4';
  if (d.includes('it')) return '#74cbbb';
  return '#a6b99a';
};

function variant(id: string): number {
  return [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % 8;
}

/**
 * The four-by-four sheet of a character: an employee (from its id and department), or, with `look`,
 * a player's own character from the lobby.
 */
export function characterSheet(id: string, department: string, look?: Look): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W * 4;
  canvas.height = FRAME_H * 4;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const v = look ? look.style : variant(id);
  const skin = look ? LOOK_SKINS[look.skin] : ['#e5ae83', '#ba805c', '#efc6a0', '#cc956f'][v % 4];
  const hair = look ? LOOK_HAIR[look.hair] : ['#242937', '#47352f', '#302a38', '#805537'][v % 4];
  const accent = look ? LOOK_OUTFITS[look.outfit] : departmentColor(department);
  // A look chooses glasses itself; an employee has them by its variant.
  const glasses = look ? look.glasses : v === 0 || v === 5;
  for (let row = 0; row < 4; row++) for (let frame = 0; frame < 4; frame++) {
    ctx.save();
    ctx.translate(frame * FRAME_W, row * FRAME_H);
    ctx.beginPath(); ctx.rect(0, 0, FRAME_W, FRAME_H); ctx.clip();
    const back = row === 3;
    const side = row === 1 || row === 2;
    if (row === 1) { ctx.translate(FRAME_W, 0); ctx.scale(-1, 1); }
    const step = frame === 1 ? -2 : frame === 3 ? 2 : 0;
    const bob = step ? -1 : 0;
    const r = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
    };
    // Shoes and trousers retain the same ground contact across all directions.
    r(9, 29 + step, 6, 8, '#151d29'); r(17, 29 - step, 6, 8, '#151d29');
    r(10, 29 + step, 3, 6, '#445164'); r(18, 29 - step, 3, 6, '#344155');
    r(8, 35 + step, 7, 3, '#0c1420'); r(17, 35 - step, 7, 3, '#0c1420');
    r(9, 35 + step, 4, 1, '#718091'); r(18, 35 - step, 4, 1, '#718091');
    // Jacket / shirt and contrasting cuffs.
    r(side ? 10 : 6, 18 + bob, side ? 13 : 20, 13, '#131d2b');
    r(side ? 11 : 7, 19 + bob, side ? 11 : 18, 10, accent);
    r(9, 22 + bob, 3, 7, '#00000033'); r(21, 21 + bob, 3, 8, '#00000033');
    if (!back && !side) {
      r(13, 19 + bob, 6, 10, v % 2 ? '#e4e6de' : '#c8d9e5');
      r(15, 20 + bob, 2, 7, '#263d55');
      r(12, 19 + bob, 1, 6, '#29445a'); r(19, 19 + bob, 1, 6, '#29445a');
      r(17, 25 + bob, 4, 5, '#f0f5ea'); r(18, 26 + bob, 2, 2, '#4ba4ae');
    }
    r(side ? 16 : 5, 23 + bob - step, 4, 7, '#192331');
    r(side ? 17 : 6, 26 + bob - step, 3, 4, skin);
    if (!side) { r(24, 23 + bob + step, 3, 7, '#192331'); r(24, 26 + bob + step, 2, 4, skin); }
    // Head: silhouette, ears, hairline and face, with distinct hairstyles.
    r(8, 4 + bob, 16, 15, '#141c28'); r(6, 9 + bob, 20, 7, '#141c28');
    r(9, 6 + bob, 14, 12, skin); r(7, 11 + bob, 3, 4, skin); r(23, 11 + bob, 2, 4, skin);
    r(9, 3 + bob, 14, 6, hair); r(7, 6 + bob, 4, 6, hair);
    r(11, 2 + bob, 8, 2, hair); r(10, 4 + bob, 9, 2, '#ffffff18');
    if (back) { r(9, 7 + bob, 14, 10, hair); r(11, 17 + bob, 10, 2, hair); }
    else if (side) {
      r(9, 7 + bob, 9, 9, hair); r(23, 12 + bob, 3, 3, skin);
      r(21, 10 + bob, 2, 3, '#202431');
    } else {
      r(11, 11 + bob, 2, 2, '#202431'); r(19, 11 + bob, 2, 2, '#202431');
      r(15, 16 + bob, 3, 1, '#925c4d');
    }
    if (v === 1 || v === 4) { // bob / long hair
      r(7, 8 + bob, 3, 13, hair); if (!side) r(22, 8 + bob, 3, 13, hair);
    }
    if (v === 2) { // bun
      r(8, 0 + bob, 7, 5, hair); r(9, 1 + bob, 4, 2, '#ffffff18');
    }
    if (v === 3) { // headscarf
      r(7, 4 + bob, 3, 15, '#c5b5b3'); r(22, 4 + bob, 3, 16, '#c5b5b3');
      r(10, 2 + bob, 12, 4, '#ddd1c6'); r(10, 18 + bob, 14, 3, '#b39f9e');
      if (back) r(9, 6 + bob, 13, 13, '#c5b5b3');
    }
    if (glasses && !back) { // glasses
      r(side ? 19 : 10, 10 + bob, side ? 6 : 13, 1, '#182638');
      r(side ? 20 : 10, 11 + bob, 5, 3, '#182638');
      if (!side) r(18, 11 + bob, 5, 3, '#182638');
      r(side ? 21 : 11, 11 + bob, 3, 1, '#aacdd8');
    }
    if (v === 6 && !back && !side) { r(11, 16 + bob, 10, 3, hair); r(14, 16 + bob, 4, 1, skin); }
    if (v === 7) { r(8, 18 + bob, 3, 5, '#182638'); r(21, 18 + bob, 3, 5, '#182638'); r(9, 19 + bob, 1, 3, '#a9b6c3'); }
    ctx.restore();
  }
  return canvas;
}

const portraits = new Map<string, string>();
export function characterPortrait(id: string, department: string, look?: Look): string {
  const key = `${id}:${department}:${look ? JSON.stringify(look) : ''}`;
  if (!portraits.has(key)) {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    canvas.getContext('2d')!.drawImage(characterSheet(id, department, look), 0, 0, 32, 32, 0, 0, 32, 32);
    portraits.set(key, canvas.toDataURL());
  }
  return portraits.get(key)!;
}

const sheets = new Map<string, string>();
/** A look's whole sheet as a picture, for the lobby (React draws it with CSS, frame by frame). */
export function lookSheet(look: Look): string {
  const key = JSON.stringify(look);
  if (!sheets.has(key)) sheets.set(key, characterSheet('look', '', look).toDataURL());
  return sheets.get(key)!;
}
