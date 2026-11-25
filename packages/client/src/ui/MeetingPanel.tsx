/**
 * The emergency meeting (DESIGN.md section 9), and the chat of fired players.
 *
 * DISCUSSION: everybody talks in the meeting chat; anyone may accuse someone
 * by ticking 3 or more items of the evidence board. VOTING: one vote each,
 * for an accused person or "skip". RESULT: who was voted out, and whether
 * they were the hacker. The server decides everything; this only shows it.
 */
import { useEffect, useState } from 'react';
import { store, type UiState } from '../game/store';
import { Chat } from './ChatPanel';

/** Seconds left in the phase, counting down from what the server said. */
function useCountdown(endsIn: number, receivedAt: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((endsIn - (now - receivedAt)) / 1000));
}

function AccuseForm({ ui }: { ui: UiState }) {
  const [suspect, setSuspect] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const people: { id: string; name: string }[] = [];
  store.room?.state.players?.forEach((p) => { if (p.id !== ui.playerId) people.push({ id: p.id, name: p.name }); });
  people.sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  return (
    <form className="accuse" data-testid="accuse-form" onSubmit={(e) => { e.preventDefault(); store.send('meeting.accuse', { suspect, evidence: picked }); }}>
      <div className="meeting-label">Accuse someone (needs 3 or more pieces of evidence)</div>
      {ui.solo && (
        <div className="meeting-muted">
          Your colleagues vote too. At least two pieces must point at the person (account, name, PC, address, badge, or a picture of
          them in the act), and one of those must show something out of the ordinary.
        </div>
      )}
      <select value={suspect} onChange={(e) => setSuspect(e.target.value)} aria-label="Suspect" data-testid="accuse-suspect">
        <option value="">Who?</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="accuse-evidence">
        {ui.board.length === 0 && <div className="meeting-muted">The evidence board is empty.</div>}
        {ui.board.map((item) => (
          <label key={item.id}>
            <input type="checkbox" checked={picked.includes(item.id)} onChange={() => toggle(item.id)} data-testid={`accuse-evidence-${item.id}`} />
            <span><strong>{item.id}</strong> {item.title}: {item.text.split('\n')[0].slice(0, 90)}</span>
          </label>
        ))}
      </div>
      <button type="submit" disabled={!suspect || picked.length < 3} data-testid="accuse-submit">Accuse ({picked.length} evidence)</button>
    </form>
  );
}

export function MeetingPanel({ ui }: { ui: UiState }) {
  const m = ui.meeting;
  const left = useCountdown(m?.endsIn ?? 0, ui.meetingAt);
  if (!m?.active) return null;
  const accusedByMe = m.accusations.some((a) => a.accuser === ui.card?.name);
  return (
    <div className="meeting" data-testid="meeting">
      <div className="meeting-box">
        <div className="meeting-head">
          <span>EMERGENCY MEETING #{m.number} · called by {m.calledBy}</span>
          <span data-testid="meeting-phase">{m.phase === 'discussion' ? 'Discussion' : m.phase === 'voting' ? 'Voting' : 'Result'} · {left} s</span>
        </div>
        <div className="meeting-body">
          <Chat ui={ui} channel="meeting" />
          <div className="meeting-side">
            <div className="meeting-label">Accusations</div>
            {m.accusations.length === 0 && <div className="meeting-muted">None yet. Without an accusation there is no vote.</div>}
            {m.accusations.map((a) => (
              <div key={a.id} className="accusation" data-testid={`accusation-${a.id}`}>
                <strong>{a.accuser}</strong> accuses <strong>{a.suspect}</strong>: {a.evidence.join(', ')}
              </div>
            ))}
            {m.phase === 'discussion' && ui.fired === '' && !accusedByMe && <AccuseForm ui={ui} />}
            {m.phase === 'voting' && (
              <div className="votes" data-testid="vote-buttons">
                <div className="meeting-label">Vote {m.myVote ? '(done)' : ''} · voted so far: {m.voted.length}</div>
                {m.canVote && !m.myVote && [...new Map(m.accusations.map((a) => [a.suspectId, a.suspect]))].map(([id, name]) => (
                  <button key={id} type="button" onClick={() => store.send('meeting.vote', { target: id })} data-testid={`vote-${id}`}>Vote {name}</button>
                ))}
                {m.canVote && !m.myVote && <button type="button" onClick={() => store.send('meeting.vote', { target: 'skip' })} data-testid="vote-skip">Skip</button>}
                {m.myVote && <div className="meeting-muted">You voted {m.myVote === 'skip' ? 'to skip' : `for ${m.accusations.find((a) => a.suspectId === m.myVote)?.suspect ?? m.myVote}`}.</div>}
                {!m.canVote && <div className="meeting-muted">You cannot vote in this meeting.</div>}
              </div>
            )}
            {m.phase === 'result' && m.result && (
              <div className="meeting-result" data-testid="meeting-result">
                <div className="meeting-verdict">
                  {m.result.fired ? `${m.result.fired} was voted out. ${m.result.wasHacker ? `They were ${(ui.party?.hackers ?? 1) > 1 ? 'a' : 'the'} hacker!` : `They were not ${(ui.party?.hackers ?? 1) > 1 ? 'a' : 'the'} hacker.`}` : 'Nobody was voted out.'}
                </div>
                <div className="meeting-muted">
                  {m.result.tally.map((t) => `${t.name}: ${t.votes}`).join(' · ')}{m.result.tally.length ? ' · ' : ''}skip: {m.result.skips} · did not vote: {m.result.abstained}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shown to a fired player: they watch, and can talk only with the other fired players. */
export function FiredPanel({ ui }: { ui: UiState }) {
  if (!ui.fired || ui.meeting?.active) return null;
  return (
    <div className="fired" data-testid="fired">
      <div className="meeting-head"><span>YOU ARE OUT</span></div>
      <p>{ui.fired} Move the view with the arrow keys.</p>
      <Chat ui={ui} channel="fired" />
    </div>
  );
}
