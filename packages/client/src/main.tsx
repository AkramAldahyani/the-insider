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
      me(): { x: number; y: number; seatedAt: string; room: string; nearDesk: string; nearDoor: string } | null;
      doors(): { id: string; look: string; reader: boolean }[];
      desks(): { hostname: string; seatX: number; seatY: number; screen: string }[];
      map(): { tile: number; cols: number; rows: number; solid: boolean[][] } | null;
    };
  }
}
window.__insider = {
  me() {
    const ui = store.getUi();
    const p = store.room?.state.players?.get(ui.playerId);
    return p ? { x: p.x, y: p.y, seatedAt: p.seatedAt, room: ui.roomName, nearDesk: ui.nearDesk, nearDoor: ui.nearDoor } : null;
  },
  desks() {
    return (store.map?.desks ?? []).map((d) => ({
      hostname: d.hostname, seatX: d.seatX, seatY: d.seatY, screen: store.room?.state.desks?.get(d.hostname)?.screen ?? '',
    }));
  },
  doors() {
    return (store.map?.doors ?? []).map((d) => ({ id: d.code, look: store.room?.state.doors?.get(d.code)?.look ?? '', reader: d.reader }));
  },
  map() {
    const m = store.map;
    return m ? { tile: m.tile, cols: m.cols, rows: m.rows, solid: m.solid } : null;
  },
};
