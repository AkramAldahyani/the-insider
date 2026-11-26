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
    const parent = holder.current!;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#0d0f14',
      // ResizeObserver owns the canvas size. RESIZE mode would independently
      // measure the border box and overwrite our content size on its next poll.
      scale: { mode: Phaser.Scale.NONE, width: parent.clientWidth, height: parent.clientHeight },
      input: { keyboard: false },
      scene: createOfficeScene(store),
      banner: false,
    });
    let resizeFrame = 0;
    const fitCanvas = () => {
      resizeFrame = 0;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (width > 0 && height > 0 && (game.scale.width !== width || game.scale.height !== height)) {
        // NONE + resize updates the renderer and camera together, at 1:1 scale.
        game.scale.resize(width, height);
      }
    };
    const resize = new ResizeObserver(() => {
      if (!resizeFrame) resizeFrame = requestAnimationFrame(fitCanvas);
    });
    const startSizing = () => { fitCanvas(); resize.observe(parent); };
    game.events.once(Phaser.Core.Events.READY, startSizing);
    return () => {
      game.events.off(Phaser.Core.Events.READY, startSizing);
      resize.disconnect();
      cancelAnimationFrame(resizeFrame);
      game.destroy(true);
    };
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
      // Who is out has no body: the arrows move their view instead (and nothing is sent).
      if (store.getUi().fired) return store.set({ pan: { dx: Math.sign(dx), dy: Math.sign(dy) }, ...(dx || dy ? { watch: '' } : {}) });
      const key = `${Math.sign(dx)},${Math.sign(dy)}`;
      if (key === sent) return;
      sent = key;
      store.send('move', { dx: Math.sign(dx), dy: Math.sign(dy) });
    };
    /** True while U is held to use the USB stick (the server counts the seconds). */
    let usb = false;
    const stop = () => {
      held.clear();
      sendDirection();
      if (usb) {
        usb = false;
        store.send('item.stop', {});
      }
    };
    /** Keys belong to the terminal while seated, and to a text box while typing in one. */
    const busy = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      return store.getUi().seatedAt !== '' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    };

    /** The few keys of somebody who is out: looking around, the board, and talking to others who are out. */
    const watchKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyN') store.followNext(event.shiftKey ? -1 : 1);
      else if (event.key === '+' || event.key === '=') store.zoomBy(1.25);
      else if (event.key === '-') store.zoomBy(0.8);
      else if (event.code === 'KeyB') store.set({ boardOpen: !store.getUi().boardOpen });
      else if (event.code === 'Escape') store.set({ boardOpen: false, watch: '' });
      else if (event.code === 'Enter' && (event.target as HTMLElement | null)?.tagName !== 'BUTTON') {
        document.querySelector<HTMLInputElement>('[data-testid="chat-input-fired"]')?.focus();
        event.preventDefault();
      }
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
      if (ui.fired) return watchKey(event);
      // Enter starts a chat line (on a button it presses the button, as everywhere).
      if (event.code === 'Enter' && (event.target as HTMLElement | null)?.tagName !== 'BUTTON' && !ui.solo && !ui.reveal) {
        stop();
        store.set({ chatOpen: true });
        event.preventDefault();
        return;
      }
      if (event.code === 'KeyE' && ui.nearDesk) {
        stop();
        store.send('sit', { hostname: ui.nearDesk });
        event.preventDefault(); // or the "e" would also be typed into the terminal that opens
      } else if (event.code === 'KeyE' && ui.nearDoor) {
        // Hold the badge against the reader. The server decides; the answer comes back as a notice.
        store.send('tap', { door: ui.nearDoor });
      } else if (event.code === 'KeyX' && ui.card?.role === 'Security guard' && ui.nearPerson) {
        // Detaining is final: the first press asks, the second (within 3 s) does it.
        const armed = ui.detainArmed;
        if (armed && armed.id === ui.nearPerson.id && Date.now() < armed.until) {
          store.send('detain', { target: ui.nearPerson.id });
          store.set({ detainArmed: null });
        } else store.set({ detainArmed: { id: ui.nearPerson.id, until: Date.now() + 3000 } });
      } else if (event.code === 'KeyE' && ui.nearButton) {
        store.send('meeting.call', {});
      } else if (event.code === 'KeyE' && ui.nearTalk) {
        store.send('talk.call', {});
      } else if (event.code === 'KeyE' && ui.nearMonitors) {
        if (ui.monitors) store.set({ monitors: null, monitorFrame: null });
        else store.send('monitors.open', {});
      } else if (event.code === 'KeyC') store.set({ cardOpen: !ui.cardOpen });
      else if (event.code === 'KeyT') store.set({ tasksOpen: !ui.tasksOpen });
      else if (event.code === 'KeyB') store.set({ boardOpen: !ui.boardOpen });
      else if (event.code === 'KeyM' && (ui.briefing || ui.solo || ui.party)) store.set({ briefingOpen: !ui.briefingOpen });
      else if (event.code === 'KeyU' && ui.briefing && ui.nearDesk) {
        // The hacker's USB stick: hold U at a PC. Letting go (or walking) before 5 s cancels it.
        usb = true;
        store.send('item.start', { item: 'usb', hostname: ui.nearDesk });
      }
      else if (event.code === 'Escape') store.set({ cardOpen: false, monitors: null, monitorFrame: null, boardOpen: false });
      else if (event.code === 'Backquote' && ui.dev) store.set({ devOpen: !ui.devOpen });
    };
    const up = (event: KeyboardEvent) => {
      if (held.delete(event.code)) sendDirection();
      if (event.code === 'KeyU' && usb) {
        usb = false;
        store.send('item.stop', {});
      }
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
