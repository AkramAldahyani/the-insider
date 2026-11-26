/**
 * The emergency meeting (DESIGN.md section 9), and the panel of people who are out.
 *
 * DISCUSSION: everybody talks in the meeting chat; anyone may accuse someone
 * by ticking 3 or more items of the evidence board, and the accusation's
 * evidence goes up on the screen for everybody. DEFENCE: each accused has the
 * floor for a few seconds to answer. VOTING: one vote each, for an accused
 * person or "skip". RESULT: the ballots are turned over one by one, then who
 * was voted out, and whether they were the hacker. The server decides
 * everything; this only shows it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MeetingView } from '@insider/shared';
import { playSound } from '../game/sound';
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
      {ui.meeting?.judged && (
        <div className="meeting-muted" data-testid="accuse-judged">
          {ui.solo ? 'Your colleagues vote too.' : 'You are few, so the colleagues played by the computer look at the evidence and vote too.'} At least two pieces must point at the person (account, name, PC, address, badge, or a picture of
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

const PHASE_NAME: Record<MeetingView['phase'], string> = { discussion: 'Discussion', defence: 'Defence', voting: 'Voting', result: 'Result', '': '' };

/** The screen at the head of the meeting table: one accusation and its evidence, for everybody to read. */
function Projector({ ui }: { ui: UiState }) {
  const m = ui.meeting!;
  const [chosen, setChosen] = useState('');
  if (m.accusations.length === 0) return null;
  // During the defence: the case against whoever has the floor. Otherwise the one chosen, or the newest.
  const shown = (m.floor && m.accusations.find((a) => a.suspectId === m.floor!.id)) || m.accusations.find((a) => a.id === chosen) || m.accusations[m.accusations.length - 1];
  const items = shown.evidence.map((id) => ui.board.find((b) => b.id === id)).filter((b) => b !== undefined);
  return (
    <section className="projector" data-testid="projector" aria-label="The evidence on the screen">
      <div className="projector-head">
        <span>ON THE SCREEN</span>
        {m.accusations.length > 1 && !m.floor && (
          <span className="projector-tabs">
            {m.accusations.map((a) => <button key={a.id} type="button" aria-pressed={a.id === shown.id} onClick={() => setChosen(a.id)}>{a.suspect}</button>)}
          </span>
        )}
      </div>
      <div className="projector-title" key={shown.id}><strong>{shown.accuser}</strong> accuses <strong>{shown.suspect}</strong></div>
      <ol className="projector-items">
        {items.map((item, i) => (
          <li key={item.id} style={{ animationDelay: `${i * 0.12}s` }}>
            <span className="board-id">{item.id}</span> <b>{item.title}</b>
            <pre>{item.text.split('\n').slice(0, 3).join('\n')}</pre>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The result: the ballots are turned over one by one (they are secret: only
 * whose name is on each), then the verdict. It always finishes within the first
 * half of the result's time, whatever the number of ballots.
 */
function BallotReveal({ m, hackers }: { m: MeetingView; hackers: number }) {
  const r = m.result!;
  const ballots = useMemo(() => {
    const list = [...r.tally.flatMap((t) => Array<string>(t.votes).fill(t.name)), ...Array<string>(r.skips).fill('Skip')];
    // Mixed in the same way on every screen, so that nobody learns anything from the order.
    let seed = m.number * 7919;
    for (let i = list.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const j = seed % (i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }, [m.number, r]);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const pace = Math.max(110, Math.min(420, (m.endsIn * 0.45) / Math.max(1, ballots.length)));
  const [shown, setShown] = useState(reduced ? ballots.length : 0);
  const done = shown >= ballots.length;
  const announced = useRef(false);
  useEffect(() => {
    if (done) {
      if (!announced.current) playSound(r.fired ? (r.wasHacker ? 'verdict-caught' : 'verdict-wrong') : 'verdict-none');
      announced.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      playSound('ballot');
      setShown((n) => n + 1);
    }, pace);
    return () => window.clearTimeout(timer);
  }, [done, shown, pace, r]);
  const columns = [...r.tally.map((t) => t.name), ...(r.skips > 0 ? ['Skip'] : [])];
  const counted = ballots.slice(0, shown);
  const a = hackers > 1 ? 'a' : 'the';
  return (
    <div className="meeting-result" data-testid="meeting-result">
      <div className="ballots" aria-hidden={!done}>
        {columns.map((name) => (
          <div key={name} className={`ballot-column ${done && r.fired === name ? 'ballot-out' : ''}`}>
            <span className="ballot-name">{name}</span>
            <span className="ballot-cards">{counted.filter((b) => b === name).map((_, i) => <span key={i} className="ballot-card" />)}</span>
          </div>
        ))}
        {ballots.length === 0 && <div className="meeting-muted">Nobody voted.</div>}
      </div>
      {done && (
        <>
          <div className="meeting-verdict" data-testid="meeting-verdict">
            {r.fired ? `${r.fired} was voted out. ${r.wasHacker ? `They were ${a} hacker!` : `They were not ${a} hacker.`}` : 'Nobody was voted out.'}
          </div>
          {r.fired && <div className={`stamp ${r.wasHacker ? 'stamp-caught' : 'stamp-wrong'}`} aria-hidden="true">{r.wasHacker ? 'Hacker caught' : 'Wrong person'}</div>}
          <div className="meeting-muted">
            {r.tally.map((t) => `${t.name}: ${t.votes}`).join(' · ')}{r.tally.length ? ' · ' : ''}skip: {r.skips} · did not vote: {r.abstained}
          </div>
          {!r.fired && r.tally.some((t) => t.votes > r.skips) && r.tally.every((t) => t.votes < m.votesNeeded) && <div className="meeting-muted">At least {m.votesNeeded} votes are needed.</div>}
        </>
      )}
    </div>
  );
}

export function MeetingPanel({ ui }: { ui: UiState }) {
  const m = ui.meeting;
  const left = useCountdown(m?.endsIn ?? 0, ui.meetingAt);
  const floorLeft = useCountdown(m?.floor?.endsIn ?? 0, ui.meetingAt);
  // The first moment of a meeting: everybody is called to the table.
  const [splash, setSplash] = useState(0);
  const number = m?.active ? m.number : 0;
  useEffect(() => {
    if (!number) return;
    setSplash(number);
    const timer = window.setTimeout(() => setSplash(0), 1600);
    return () => window.clearTimeout(timer);
  }, [number]);
  if (!m?.active) return null;
  const accusedByMe = m.accusations.some((a) => a.accuser === ui.card?.name);
  return (
    <div className="meeting" data-testid="meeting">
      {splash === m.number && (
        <div className="meeting-splash" aria-hidden="true">
          <span className="meeting-splash-stripe" />
          <strong>Emergency meeting</strong>
          <span>called by {m.calledBy}</span>
        </div>
      )}
      <div className="meeting-box">
        <div className="meeting-head">
          <span>EMERGENCY MEETING #{m.number} · called by {m.calledBy}</span>
          <span data-testid="meeting-phase">{PHASE_NAME[m.phase]} · {left} s</span>
        </div>
        {m.phase === 'defence' && m.floor && (
          <div className="floor" data-testid="floor">
            <strong>{m.floor.name}</strong> has the floor{m.floor.of > 1 ? ` (${m.floor.turn} of ${m.floor.of})` : ''} · {floorLeft} s
            <span>{m.floor.id === ui.playerId ? 'You are accused. Answer in the chat now: where were you, what did you do?' : 'They may answer in the chat. The vote comes next.'}</span>
          </div>
        )}
        <Projector ui={ui} />
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
                {m.votesNeeded > 1 && <div className="meeting-muted votes-needed" data-testid="votes-needed">Somebody is voted out with at least {m.votesNeeded} votes, more than anybody else and more than “skip”.</div>}
                {m.canVote && !m.myVote && [...new Map(m.accusations.map((a) => [a.suspectId, a.suspect]))].map(([id, name]) => (
                  <button key={id} type="button" onClick={() => store.send('meeting.vote', { target: id })} data-testid={`vote-${id}`}>Vote {name}</button>
                ))}
                {m.canVote && !m.myVote && <button type="button" onClick={() => store.send('meeting.vote', { target: 'skip' })} data-testid="vote-skip">Skip</button>}
                {m.myVote && <div className="meeting-muted">You voted {m.myVote === 'skip' ? 'to skip' : `for ${m.accusations.find((a) => a.suspectId === m.myVote)?.suspect ?? m.myVote}`}.</div>}
                {!m.canVote && <div className="meeting-muted">{ui.fired ? 'You are out: you watch, and have no vote.' : 'You cannot vote in this meeting.'}</div>}
              </div>
            )}
            {m.phase === 'result' && m.result && <BallotReveal key={m.number} m={m} hackers={ui.party?.hackers ?? 1} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown to somebody who is out: they watch and talk only with the others who
 * are out. It stays there behind a meeting, so that the map keeps its size.
 */
export function FiredPanel({ ui }: { ui: UiState }) {
  if (!ui.fired) return null;
  const followed = store.room?.state.players?.get(ui.watch)?.name;
  return (
    <div className="fired" data-testid="fired">
      <div className="meeting-head"><span>YOU ARE OUT</span></div>
      <p>{ui.fired} You can watch everybody, but nothing you do reaches the match{ui.solo ? '.' : ', and only the others who are out can read what you write.'}</p>
      <div className="meeting-label">View</div>
      <div className="fired-follow" data-testid="watching">{followed ? <>Following <strong>{followed}</strong></> : 'Moving freely'}</div>
      <div className="fired-buttons">
        <button type="button" data-testid="watch-previous" onClick={() => store.followNext(-1)} aria-label="Follow the previous person">←</button>
        <button type="button" data-testid="watch-next" onClick={() => store.followNext(1)} aria-label="Follow the next person">→</button>
        <button type="button" data-testid="watch-free" disabled={!ui.watch} onClick={() => store.follow('')}>Let go</button>
        <button type="button" data-testid="watch-closer" onClick={() => store.zoomBy(1.25)} aria-label="Closer">+</button>
        <button type="button" data-testid="watch-further" onClick={() => store.zoomBy(0.8)} aria-label="Further away">−</button>
      </div>
      <p className="meeting-muted fired-help">Arrow keys or dragging move the view. <kbd>N</kbd> or a click on a person follows them. The wheel zooms. <kbd>B</kbd> is the evidence board.</p>
      {!ui.matchOver && !ui.debrief && !ui.solo && !ui.meeting?.active && <Chat ui={ui} channel="fired" />}
    </div>
  );
}
