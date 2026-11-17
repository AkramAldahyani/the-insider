/**
 * The security-office monitors: the camera recordings, the badge log and the
 * camera motion log, for whoever stands at the CCTV monitors (DESIGN.md
 * sections 2 and 7). The guard works here, but anyone who gets into the
 * security office can look.
 *
 * A recording is a list of pictures ("snapshots"); each one says who stood
 * where at that moment. This panel draws the chosen picture like a camera
 * would show it: the room seen from above, desks and furniture, and a
 * labelled figure for every person, in a green night-vision look.
 *
 * Everything shown comes from the server, and only while the player stands
 * at the monitors.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MonitorPerson, OfficeMap } from '@insider/shared';
import { store, type UiState } from '../game/store';

type Tab = 'cameras' | 'badges' | 'motion';

const clock = (t: number) => new Date(t).toISOString().slice(11, 19);

/** The part of the map a camera watches: the bounding box of its room, clipped to its range. */
function cameraView(map: OfficeMap, cameraId: string) {
  const cam = map.cameras.find((c) => c.name.split(' ')[0] === cameraId);
  if (!cam) return null;
  const covers = String(cam.props.covers ?? '');
  const range = (Number(cam.props.range) || 14) * map.tile;
  const rects = map.rooms.filter((r) => r.name === covers);
  if (rects.length === 0) return null;
  let x0 = Math.max(Math.min(...rects.map((r) => r.x)), cam.x - range);
  let y0 = Math.max(Math.min(...rects.map((r) => r.y)), cam.y - range);
  let x1 = Math.min(Math.max(...rects.map((r) => r.x + r.width)), cam.x + range);
  let y1 = Math.min(Math.max(...rects.map((r) => r.y + r.height)), cam.y + range);
  // One tile of margin so the walls show.
  x0 -= map.tile; y0 -= map.tile; x1 += map.tile; y1 += map.tile;
  return { cam, covers, range, x0, y0, x1, y1, name: cam.name };
}

export function drawFrame(canvas: HTMLCanvasElement, map: OfficeMap, cameraId: string, people: MonitorPerson[], time: number, live: boolean): void {
  const view = cameraView(map, cameraId);
  const ctx = canvas.getContext('2d');
  if (!view || !ctx) return;
  const w = view.x1 - view.x0;
  const h = view.y1 - view.y0;
  const scale = Math.min(canvas.width / w, canvas.height / h);
  const ox = (canvas.width - w * scale) / 2;
  const oy = (canvas.height - h * scale) / 2;
  const X = (x: number) => ox + (x - view.x0) * scale;
  const Y = (y: number) => oy + (y - view.y0) * scale;

  ctx.fillStyle = '#04100a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Floor and walls, tile by tile.
  const t = map.tile;
  for (let row = Math.floor(view.y0 / t); row < Math.ceil(view.y1 / t); row++) {
    for (let col = Math.floor(view.x0 / t); col < Math.ceil(view.x1 / t); col++) {
      if (row < 0 || col < 0 || row >= map.rows || col >= map.cols) continue;
      const wall = map.walls[row][col] !== 0;
      if (!wall && !map.floor[row][col]) continue;
      ctx.fillStyle = wall ? '#0f2a1b' : '#173d28';
      ctx.fillRect(X(col * t), Y(row * t), t * scale + 0.5, t * scale + 0.5);
    }
  }
  // Furniture and desks.
  ctx.fillStyle = '#2a5a3e';
  for (const f of map.furniture) ctx.fillRect(X(f.x + 2), Y(f.y + 2), (f.width - 4) * scale, (f.height - 4) * scale);
  ctx.fillStyle = '#3c7a54';
  for (const d of map.desks) ctx.fillRect(X(d.x + 1), Y(d.y + 3), (d.width - 2) * scale, (d.height - 5) * scale);
  // The edge of what the camera sees.
  ctx.strokeStyle = 'rgba(140, 255, 180, 0.18)';
  ctx.beginPath();
  ctx.arc(X(view.cam.x), Y(view.cam.y), view.range * scale, 0, Math.PI * 2);
  ctx.stroke();
  // People.
  ctx.font = `${Math.max(10, Math.round(11 * Math.min(1.4, scale)))}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  for (const p of people) {
    const r = Math.max(5, 9 * scale);
    ctx.fillStyle = p.activity === 'at-pc' ? '#ffd27a' : '#b6ffcf';
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), p.seatedAt ? r * 0.8 : r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9ffe6';
    ctx.fillText(p.name + (p.activity === 'at-pc' ? ' (at a PC)' : ''), X(p.x), Y(p.y) - r - 4);
  }
  // Scan lines and the caption a camera burns into its picture.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let y = 0; y < canvas.height; y += 3) ctx.fillRect(0, y, canvas.width, 1);
  ctx.textAlign = 'left';
  ctx.font = '12px ui-monospace, Consolas, monospace';
  ctx.fillStyle = '#b6ffcf';
  ctx.fillText(`${view.name.toUpperCase()}   ${new Date(time).toISOString().slice(0, 19).replace('T', ' ')}${live ? '   LIVE' : ''}`, 10, 18);
}

export function MonitorsPanel({ ui }: { ui: UiState }) {
  const [tab, setTab] = useState<Tab>('cameras');
  const [camera, setCamera] = useState('');
  /** Index into the chosen camera's list of pictures; -1 = the newest ("live"). */
  const [pick, setPick] = useState(-1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const index = ui.monitors;
  const map = store.map;
  const shots = useMemo(() => index?.cameras.find((c) => c.id === camera)?.shots ?? [], [index, camera]);

  useEffect(() => {
    if (!camera && index?.cameras[0]) setCamera(index.cameras[0].id);
  }, [index, camera]);

  // Ask the server for the picture whenever the camera or the time changes; "live" refreshes every 2 s.
  useEffect(() => {
    if (!camera) return;
    const ask = () => store.send('monitors.frame', pick < 0 || !shots[pick] ? { camera } : { camera, time: shots[pick].time });
    ask();
    if (pick >= 0) return;
    const timer = window.setInterval(() => {
      ask();
      store.send('monitors.open', {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [camera, pick, shots]);

  useEffect(() => {
    const frame = ui.monitorFrame;
    if (tab === 'cameras' && canvas.current && map && frame && frame.camera === camera) drawFrame(canvas.current, map, camera, frame.people, frame.time, pick < 0);
  }, [ui.monitorFrame, tab, camera, pick, map]);

  if (!index) return null;
  const step = (d: number) => setPick((p) => Math.max(0, Math.min(shots.length - 1, (p < 0 ? shots.length - 1 : p) + d)));
  return (
    <div className="monitors" data-testid="monitors">
      <div className="monitors-head">
        <span>SECURITY OFFICE · MONITORS</span>
        <button type="button" onClick={() => store.set({ monitors: null, monitorFrame: null })} aria-label="Close monitors">×</button>
      </div>
      <div className="monitors-tabs">
        {(['cameras', 'badges', 'motion'] as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={`monitors-tab-${t}`}>
            {t === 'cameras' ? 'Cameras' : t === 'badges' ? 'Badge log' : 'Motion log'}
          </button>
        ))}
      </div>
      {tab === 'cameras' && (
        <>
          <div className="monitors-cams">
            {index.cameras.map((c) => (
              <button key={c.id} type="button" className={camera === c.id ? 'on' : ''} onClick={() => { setCamera(c.id); setPick(-1); }} data-testid={`camera-${c.id}`}>
                {c.id}
              </button>
            ))}
          </div>
          <canvas ref={canvas} width={560} height={300} className="monitors-screen" data-testid="monitors-screen" />
          <div className="monitors-time">
            <button type="button" onClick={() => step(-1)} disabled={shots.length === 0} aria-label="Earlier picture">◀</button>
            <input
              type="range" min={0} max={Math.max(0, shots.length - 1)} value={pick < 0 ? shots.length - 1 : pick}
              onChange={(e) => setPick(Number(e.target.value))} aria-label="Recording time" data-testid="monitors-scrub"
            />
            <button type="button" onClick={() => step(1)} disabled={shots.length === 0} aria-label="Later picture">▶</button>
            <button type="button" className={pick < 0 ? 'on' : ''} onClick={() => setPick(-1)}>Live</button>
          </div>
          <div className="monitors-pin">
            <button
              type="button" data-testid="pin-picture" disabled={!ui.monitorFrame?.id || ui.monitorFrame.camera !== camera}
              onClick={() => ui.monitorFrame && store.send('evidence.pin', { kind: 'snapshot', camera, snapshot: ui.monitorFrame.id })}
            >Pin this picture</button>
          </div>
          <div className="monitors-who" data-testid="monitors-who">
            {ui.monitorFrame?.camera === camera
              ? `${clock(ui.monitorFrame.time)} · ${ui.monitorFrame.people.length === 0 ? 'nobody in view' : ui.monitorFrame.people.map((p) => p.name + (p.seatedAt ? ` at ${p.seatedAt}` : '')).join(', ')}`
              : '…'}
          </div>
        </>
      )}
      {tab !== 'cameras' && (
        <div className="monitors-log" data-testid={tab === 'badges' ? 'monitors-badges' : 'monitors-motion'}>
          {(tab === 'badges' ? index.badges : index.motion).slice().reverse().map((line) => (
            <div key={line} className="monitors-line">
              <button type="button" onClick={() => store.send('evidence.pin', { kind: 'log', source: tab === 'badges' ? 'badges' : 'motion', text: line })} aria-label="Pin this line">Pin</button>
              <span>{line}</span>
            </div>
          ))}
          {(tab === 'badges' ? index.badges : index.motion).length === 0 && (tab === 'badges' ? 'No badge taps yet.' : 'No motion yet.')}
        </div>
      )}
      <p className="monitors-note">Newest lines first. Walking away switches the monitors off.</p>
    </div>
  );
}
