/**
 * Puts the Phaser game (the office map) inside the React page, and reads the
 * keyboard for walking and for the shortcut keys.
 *
 * The keyboard is read here with normal browser events instead of Phaser's
 * keyboard system, for one reason: while the PC terminal is open, EVERY key
 * must go to the terminal. One place that checks "is the player seated?" is
 * easier to get right than two input systems fighting over the keys.
 */
import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { createOfficeScene } from './OfficeScene';
import { store } from './store';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function PhaserView() {
  const holder = useRef<HTMLDivElement>(null);

  // The map.
  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: holder.current!,
      backgroundColor: '#0d0f14',
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      input: { keyboard: false },
      scene: createOfficeScene(store),
      banner: false,
    });
    return () => game.destroy(true);
  }, []);

  // The keyboard.
  useEffect(() => {
    const held = new Set<string>();
    let sent = '0,0';

    /** Tells the server which way the player wants to walk, only when that changes. */
    const sendDirection = () => {
      let dx = 0;
      let dy = 0;
      for (const code of held) {
        dx += MOVE_KEYS[code][0];
        dy += MOVE_KEYS[code][1];
      }
      const key = `${Math.sign(dx)},${Math.sign(dy)}`;
      if (key === sent) return;
      sent = key;
      store.send('move', { dx: Math.sign(dx), dy: Math.sign(dy) });
    };
    const stop = () => {
      held.clear();
      sendDirection();
    };
    /** Keys belong to the terminal while seated, and to a text box while typing in one. */
    const busy = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      return store.getUi().seatedAt !== '' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    };

    const down = (event: KeyboardEvent) => {
      if (busy(event)) return stop();
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (MOVE_KEYS[event.code]) {
        held.add(event.code);
        sendDirection();
        event.preventDefault(); // arrow keys must not scroll the page
        return;
      }
      if (event.repeat) return;
      const ui = store.getUi();
      if (event.code === 'KeyE' && ui.nearDesk) {
        stop();
        store.send('sit', { hostname: ui.nearDesk });
        event.preventDefault(); // or the "e" would also be typed into the terminal that opens
      } else if (event.code === 'KeyC') store.set({ cardOpen: !ui.cardOpen });
      else if (event.code === 'Escape') store.set({ cardOpen: false });
      else if (event.code === 'Backquote' && ui.dev) store.set({ devOpen: !ui.devOpen });
    };
    const up = (event: KeyboardEvent) => {
      if (held.delete(event.code)) sendDirection();
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop); // switching windows must not leave the player walking
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
    };
  }, []);

  return <div className="map" ref={holder} />;
}
