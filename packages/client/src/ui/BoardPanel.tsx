/**
 * The shared evidence board (`B`). Everybody playing sees the same items;
 * each player can take down only their own pins. Items come from the server,
 * which accepted them only because they really appeared on that player's
 * screen (see server/src/evidence.ts).
 */
import { useEffect, useRef } from 'react';
import type { EvidenceView } from '@insider/shared';
import { store, type UiState } from '../game/store';
import { drawFrame } from './MonitorsPanel';

const clock = (t: number) => new Date(t).toISOString().slice(11, 19);
const KIND: Record<EvidenceView['kind'], string> = { screen: 'SCREEN', snapshot: 'CAMERA', log: 'LOG' };

function Picture({ item }: { item: EvidenceView }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current && store.map && item.frame) drawFrame(canvas.current, store.map, item.frame.camera, item.frame.people, item.frame.time, false);
  }, [item]);
  return <canvas ref={canvas} width={360} height={190} className="board-picture" />;
}

export function BoardPanel({ ui }: { ui: UiState }) {
  if (!ui.boardOpen) return null;
  return (
    <div className="board" data-testid="board">
      <div className="board-head">
        <span>EVIDENCE BOARD · {ui.board.length} item{ui.board.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={() => store.set({ boardOpen: false })} aria-label="Close board">×</button>
      </div>
      {ui.board.length === 0 && (
        <p className="board-empty">
          Nothing pinned yet. At a PC, select text in the terminal and press <strong>Pin selection</strong>.
          At the security monitors, pin a camera picture or a log line.
        </p>
      )}
      <ol className="board-items">
        {ui.board.map((item) => (
          <li key={item.id} className={`board-item board-${item.kind}`} data-testid={`evidence-${item.id}`}>
            <div className="board-meta">
              <span className="board-id">{item.id}</span>
              <span className="board-kind">{KIND[item.kind]}</span>
              <span>{item.title}</span>
              <span className="board-spacer" />
              <span>pinned by {item.pinnedBy} at {clock(item.time)}</span>
              {item.mine && <button type="button" onClick={() => store.send('evidence.unpin', { id: item.id })} aria-label={`Take down ${item.id}`}>Take down</button>}
            </div>
            {item.frame && <Picture item={item} />}
            <pre>{item.text}</pre>
          </li>
        ))}
      </ol>
    </div>
  );
}
