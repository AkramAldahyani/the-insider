/**
 * Developer panel (the backtick key).
 *
 * It can speed up or jump the game clock, show the master event log, teleport
 * and save the world - things a real player must never be able to do. Two
 * separate locks keep it out of production:
 *  - this file is only loaded when the page runs in development mode (see
 *    App.tsx), so a production build does not even contain it;
 *  - the server ignores every dev.* message unless it was started in
 *    development mode. That is the lock that matters: a page can be modified
 *    by its user, the server cannot.
 */
import { useState } from 'react';
import { store, type UiState } from '../game/store';

export default function DevPanel({ ui }: { ui: UiState }) {
  const [duration, setDuration] = useState('+5m');
  const [count, setCount] = useState(15);
  const desks = store.map?.desks.map((d) => d.hostname) ?? [];
  const [desk, setDesk] = useState(desks[0] ?? '');

  return (
    <div className="dev" data-testid="dev-panel">
      <div className="dev-head">
        <span>DEVELOPER PANEL</span>
        <button type="button" onClick={() => store.set({ devOpen: false })}>×</button>
      </div>
      <div className="dev-row">
        <span>Speed</span>
        {[0, 1, 10, 60, 600].map((m) => (
          <button key={m} type="button" className={ui.speed === m ? 'on' : ''} onClick={() => store.send('dev.speed', { multiplier: m })}>
            {m === 0 ? 'pause' : `×${m}`}
          </button>
        ))}
      </div>
      <div className="dev-row">
        <span>Jump</span>
        <input value={duration} onChange={(e) => setDuration(e.target.value)} size={8} />
        <button type="button" onClick={() => store.send('dev.jump', { duration })}>go</button>
      </div>
      <div className="dev-row">
        <span>Events</span>
        <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        <button type="button" onClick={() => store.send('dev.events', { count })}>show last</button>
      </div>
      <div className="dev-row">
        <span>Teleport</span>
        <select value={desk} onChange={(e) => setDesk(e.target.value)}>
          {desks.map((d) => <option key={d}>{d}</option>)}
        </select>
        <button type="button" onClick={() => store.send('dev.teleport', { hostname: desk })}>go</button>
      </div>
      <div className="dev-row">
        <span>World</span>
        <button type="button" onClick={() => store.send('dev.dump', {})}>dump to dumps/</button>
        <button type="button" onClick={() => store.set({ devLog: [] })}>clear log</button>
      </div>
      <pre className="dev-log" data-testid="dev-log">{ui.devLog.join('\n\n') || 'Results appear here.'}</pre>
    </div>
  );
}
