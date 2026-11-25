/** The connection was lost (Phase 6, part F): this page tries to come back by itself (see store.ts). */
import { HOLD_MS } from '@insider/shared';
import { store } from '../game/store';

export function Reconnecting() {
  return (
    <div className="reconnecting" data-testid="reconnecting" role="alertdialog" aria-label="Connection lost">
      <div className="reconnecting-box">
        <h2>Connection lost</h2>
        <p>
          Trying to get you back. Your place is kept for {HOLD_MS / 1000} seconds. In a match with friends you can also come
          back later: until then the computer plays for you, if the match has computer colleagues.
        </p>
        <button type="button" data-testid="reconnecting-leave" onClick={() => store.leave()}>Back to the menu</button>
      </div>
    </div>
  );
}
