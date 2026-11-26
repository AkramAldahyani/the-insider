/**
 * The debrief's replay: the match again on a plan of the office, fast. The
 * hacker's path is drawn as time goes on, and every step they took appears
 * where they were when they took it, coloured by what became of its evidence
 * (found, seen, missed). The slider moves through the match; a step in the list
 * below can jump there ("Show on the map").
 *
 * All of it comes from the debrief, which the server sends only after the match.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DebriefStepView, DebriefView } from '@insider/shared';
import { store } from '../game/store';
import { deskCentre, dot, drawPlan } from './officePlan';

const WIDTH = 720;
const SPEEDS = [30, 60, 120] as const;
const HACKER_COLORS = ['#ff6b70', '#f09a6b', '#d99bc5'];
export const STATUS_COLORS: Record<DebriefStepView['status'], string> = { pinned: '#8adbc1', seen: '#f2b134', missed: '#e5484d', none: '#7f8ea2' };
const clock = (t: number) => new Date(t).toISOString().slice(11, 19);

type Point = { time: number; x: number; y: number };

/** Where somebody on this path was at time t (between two points: on the line between them). */
function at(points: Point[], t: number): Point | undefined {
  if (points.length === 0 || t < points[0].time) return undefined;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].time > t) continue;
    const a = points[i];
    const b = points[i + 1];
    if (!b) return a;
    const k = (t - a.time) / Math.max(1, b.time - a.time);
    return { time: t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  return undefined;
}

export function ReplayMap({ d, time, setTime }: { d: DebriefView; time: number; setTime: (t: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const plan = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const map = store.map;
  const scale = map ? WIDTH / map.width : 1;
  const height = map ? Math.round(map.height * scale) : 0;
  const now = Math.min(d.at, Math.max(d.startedAt, time));

  // Playing: game time runs `speed` times faster than real time, up to the end of the match.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    let t = now;
    const step = (wall: number) => {
      t = Math.min(d.at, t + (wall - last) * speed);
      last = wall;
      setTime(t);
      if (t >= d.at) setPlaying(false);
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // (`now` only starts it: the loop keeps its own time, so it is not in the list below.)
  }, [playing, speed, d.at, setTime]);

  useEffect(() => {
    if (!map || !canvas.current) return;
    if (!plan.current) {
      plan.current = document.createElement('canvas');
      plan.current.width = WIDTH;
      plan.current.height = height;
      drawPlan(plan.current.getContext('2d')!, map, scale, true);
    }
    const ctx = canvas.current.getContext('2d')!;
    ctx.drawImage(plan.current, 0, 0);
    // The paths so far, each in its own colour.
    d.paths.forEach((path, i) => {
      const color = HACKER_COLORS[i % HACKER_COLORS.length];
      const done = path.points.filter((p) => p.time <= now);
      const here = at(path.points, now);
      if (done.length > 0) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        done.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x * scale, p.y * scale) : ctx.lineTo(p.x * scale, p.y * scale)));
        if (here) ctx.lineTo(here.x * scale, here.y * scale);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (here) {
        dot(ctx, here.x * scale, here.y * scale, 6, color);
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.fillText(path.name, here.x * scale + 9, here.y * scale - 7);
      }
    });
    // The steps so far, where the one who took them was standing (or at the PC they used).
    d.steps.forEach((s, i) => {
      if (s.time > now || !s.suspicious) return;
      const path = d.paths.find((p) => p.name === s.by) ?? d.paths[0];
      const where = (path && at(path.points, s.time)) ?? (map ? deskCentre(map, s.host) : undefined);
      if (!where) return;
      dot(ctx, where.x * scale, where.y * scale, 8, STATUS_COLORS[s.status]);
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0b1320';
      ctx.fillText(String(i + 1), where.x * scale, where.y * scale + 0.5);
      ctx.textBaseline = 'alphabetic';
    });
  }, [d, now, map, scale, height]);

  if (!map || (d.paths.length === 0 && d.steps.length === 0)) return null;
  const latest = [...d.steps.entries()].filter(([, s]) => s.time <= now && s.suspicious).pop();
  return (
    <section className="replay" data-testid="replay" aria-label="Replay on the map">
      <canvas ref={canvas} width={WIDTH} height={height} />
      <div className="replay-controls">
        <button type="button" data-testid="replay-play" onClick={() => { if (now >= d.at) setTime(d.startedAt); setPlaying(!playing); }}>{playing ? 'Pause' : now >= d.at ? 'Play again' : 'Play'}</button>
        <input type="range" aria-label="Time in the match" data-testid="replay-time" min={d.startedAt} max={d.at} step={1000} value={now} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} />
        <span className="replay-clock">{clock(now)}</span>
        <span className="replay-speed" role="group" aria-label="Speed">
          {SPEEDS.map((s) => <button key={s} type="button" aria-pressed={s === speed} onClick={() => setSpeed(s)}>×{s}</button>)}
        </span>
      </div>
      <p className="replay-caption" data-testid="replay-caption">
        {latest
          ? <><span className="replay-step" style={{ background: STATUS_COLORS[latest[1].status] }}>{latest[0] + 1}</span> {clock(latest[1].time)} · {latest[1].title}</>
          : 'Press Play: the match again, one game minute a second.'}
      </p>
      <div className="replay-key">
        <span style={{ '--c': STATUS_COLORS.pinned } as CSSProperties}>found</span>
        <span style={{ '--c': STATUS_COLORS.seen } as CSSProperties}>seen, not pinned</span>
        <span style={{ '--c': STATUS_COLORS.missed } as CSSProperties}>missed</span>
        <span style={{ '--c': STATUS_COLORS.none } as CSSProperties}>no trace</span>
      </div>
    </section>
  );
}
