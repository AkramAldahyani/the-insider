/**
 * The minimap in the corner: the plan of the office, where the player is, their
 * own desk and the emergency button.
 *
 * It never shows other people. Where everybody is, is what the cameras, the
 * badge log and one's own eyes are for; a map with everybody on it would make
 * them worthless (and tell the hacker where nobody is looking).
 */
import { useEffect, useRef, useState } from 'react';
import { store, type UiState } from '../game/store';
import { deskCentre, dot, drawPlan } from './officePlan';

const WIDTH = 210;

export function Minimap({ ui }: { ui: UiState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(true);
  const map = store.map;
  const scale = map ? WIDTH / map.width : 1;
  const height = map ? Math.round(map.height * scale) : 0;
  const desk = ui.card?.hostname ?? '';
  const fired = ui.fired !== '';
  const self = ui.playerId;
  // At a PC the map is not shown. Standing up brings a NEW, empty canvas, so
  // `seated` is in the list below: drawing starts again on the new one.
  const seated = !!ui.seatedAt;

  useEffect(() => {
    if (!open || seated || !map || !canvas.current) return;
    // The plan is drawn once; only the marks move.
    const plan = document.createElement('canvas');
    plan.width = WIDTH;
    plan.height = height;
    const p = plan.getContext('2d');
    if (!p) return;
    drawPlan(p, map, scale);
    const ctx = canvas.current.getContext('2d')!;
    const draw = () => {
      ctx.drawImage(plan, 0, 0);
      const mine = desk ? deskCentre(map, desk) : undefined;
      if (mine && !fired) {
        ctx.strokeStyle = '#f2b134';
        ctx.lineWidth = 2;
        ctx.strokeRect(mine.x * scale - 5, mine.y * scale - 5, 10, 10);
      }
      // Somebody who is out has no body: the mark is where they are looking.
      const me = fired ? store.view : store.room?.state.players?.get(self);
      if (me) dot(ctx, me.x * scale, me.y * scale, 4, fired ? '#9aafbf' : '#8adbc1');
    };
    draw();
    const timer = window.setInterval(draw, 150);
    return () => window.clearInterval(timer);
  }, [open, seated, map, scale, height, desk, fired, self]);

  if (!map || seated) return null;
  return (
    <aside className={`minimap ${open ? '' : 'minimap-closed'}`} data-testid="minimap" aria-label="Map of the office">
      <button type="button" className="minimap-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>MAP · {ui.roomName || '—'}</span><span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <>
          <canvas ref={canvas} width={WIDTH} height={height} />
          <div className="minimap-key"><span className="key-me">you</span>{!fired && <span className="key-desk">your desk</span>}<span className="key-button">meeting button</span></div>
        </>
      )}
    </aside>
  );
}
