import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './game/store';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

/**
 * A small window for automated browser tests (and for curious people in the
 * browser console): where am I, and what does the map look like?
 * It only exposes PUBLIC things the page already shows - never the onboarding
 * card or anything else private.
 */
declare global {
  interface Window {
    __insider?: {
      me(): { x: number; y: number; stopped: boolean; seatedAt: string; room: string; nearDesk: string; nearDoor: string } | null;
      doors(): { id: string; look: string; reader: boolean }[];
      /** Where to stand to use the security monitors (a point just in front of them). */
      monitors(): { x: number; y: number };
      /** The middle of the map view, and whom a watcher follows. */
      view(): { x: number; y: number; zoom: number; follows: string };
      /** Where to stand to press the emergency button. */
      button(): { x: number; y: number };
      desks(): { hostname: string; seatX: number; seatY: number; screen: string }[];
      map(): {
        tile: number; cols: number; rows: number; solid: boolean[][];
        doors: { code: string; x: number; y: number; width: number; height: number; reader: boolean }[];
      } | null;
    };
  }
}
window.__insider = {
  me() {
    const ui = store.getUi();
    const p = store.room?.state.players?.get(ui.playerId);
    return p ? { x: p.x, y: p.y, stopped: store.movement.isStopped(p), seatedAt: p.seatedAt, room: ui.roomName, nearDesk: ui.nearDesk, nearDoor: ui.nearDoor } : null;
  },
  view() {
    return { ...store.view, follows: store.getUi().watch };
  },
  desks() {
    return (store.map?.desks ?? []).map((d) => ({
      hostname: d.hostname, seatX: d.seatX, seatY: d.seatY, screen: store.room?.state.desks?.get(d.hostname)?.screen ?? '',
    }));
  },
  button() {
    const f = store.map?.furniture.find((x) => x.kind === 'button');
    return f ? { x: f.x + f.width / 2, y: f.y + f.height + 14 } : { x: 0, y: 0 };
  },
  monitors() {
    const f = store.map?.furniture.find((x) => x.kind === 'monitors');
    return f ? { x: f.x + f.width / 2, y: f.y - 20 } : { x: 0, y: 0 };
  },
  doors() {
    return (store.map?.doors ?? []).map((d) => ({ id: d.code, look: store.room?.state.doors?.get(d.code)?.look ?? '', reader: d.reader }));
  },
  map() {
    const m = store.map;
    return m ? {
      tile: m.tile, cols: m.cols, rows: m.rows, solid: m.solid,
      doors: m.doors.map((d) => ({ code: d.code, x: d.x, y: d.y, width: d.width, height: d.height, reader: d.reader })),
    } : null;
  },
};
