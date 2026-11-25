/**
 * The debrief after a match (DESIGN.md section 11): everything the hacker did,
 * the evidence each step left, and whether anybody found it. The server sends
 * it only when the match is over; this file only draws it.
 */
import { useState } from 'react';
import type { DebriefEvidenceView, DebriefStepView, DebriefView } from '@insider/shared';
import { store, type UiState } from '../game/store';

const clock = (t: number) => new Date(t).toISOString().slice(11, 19);
const STATUS: Record<DebriefStepView['status'], string> = { pinned: 'FOUND', seen: 'SEEN, NOT PINNED', missed: 'MISSED', none: 'NO TRACE' };
const FOUND: Record<DebriefEvidenceView['found'], string> = { pinned: 'pinned by', seen: 'on the screen of', missed: 'nobody looked' };

/** "T1021.004" -> its page in the public ATT&CK catalogue. */
const attackUrl = (id: string) => `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`;

function Evidence({ item }: { item: DebriefEvidenceView }) {
  return (
    <li className={`debrief-evidence debrief-${item.found}`}>
      <div className="debrief-where">
        <strong>{item.host ? `${item.host}: ` : ''}{item.where}</strong>
        <span>{FOUND[item.found]}{item.found === 'missed' ? '' : ` ${item.foundBy.join(', ')}`}{item.gone ? ' · removed later by the hacker' : ''}</span>
      </div>
      <code>{item.text}</code>
    </li>
  );
}

function Step({ step, index, by }: { step: DebriefStepView; index: number; by: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`debrief-step debrief-${step.status} ${step.suspicious ? '' : 'debrief-ordinary'}`} data-testid={`debrief-step-${index}`}>
      <button type="button" className="debrief-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="debrief-time">{clock(step.time)}</span>
        <span className="debrief-title">{by && <strong>{step.by}: </strong>}{step.title}{step.count > 1 ? ` (${step.count} times)` : ''}</span>
        {step.technique && <span className="debrief-technique">{step.technique.id}</span>}
        <span className="debrief-status">{step.suspicious ? STATUS[step.status] : 'ORDINARY'}</span>
      </button>
      {open && (
        <div className="debrief-body">
          {step.technique && (
            <p>
              MITRE ATT&amp;CK <a href={attackUrl(step.technique.id)} target="_blank" rel="noreferrer">{step.technique.id}</a>: {step.technique.name}
            </p>
          )}
          <p>{step.lesson}</p>
          {step.typed && <p>Typed: <code>{step.typed}</code></p>}
          {step.alerts.length > 0 && <p>Raised the security alert: {step.alerts.join(', ')}.</p>}
          {step.flagged && <p>The SIEM flagged this again later (threat-escalation).</p>}
          {step.evidence.length > 0 ? <ul>{step.evidence.map((e, i) => <Evidence key={i} item={e} />)}</ul> : <p className="debrief-muted">It left nothing to find.</p>}
          {step.more > 0 && <p className="debrief-muted">…and {step.more} more lines.</p>}
        </div>
      )}
    </li>
  );
}

function Extras({ d }: { d: DebriefView }) {
  return (
    <>
      {d.weaknesses.length > 0 && (
        <section>
          <h3>Today&apos;s weaknesses</h3>
          <ul>{d.weaknesses.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}
      {d.witnesses.length > 0 && (
        <section data-testid="debrief-witnesses">
          <h3>What colleagues noticed</h3>
          <ul>{d.witnesses.map((w, i) => <li key={i}><strong>{w.name}:</strong> {w.text}</li>)}</ul>
        </section>
      )}
      {d.meetings.length > 0 && (
        <section data-testid="debrief-meetings">
          <h3>Meetings</h3>
          {d.meetings.map((m) => (
            <div key={m.number} className="debrief-meeting">
              <p>
                <strong>{clock(m.time)}</strong> called by {m.calledBy}.{' '}
                {m.fired ? `${m.fired} was voted out: ${m.wasHacker ? 'the hacker.' : 'innocent.'}` : 'Nobody was voted out.'}
              </p>
              <ul>
                {m.accusations.map((a, i) => <li key={i}>{a.accuser} accused {a.suspect} ({a.evidence.join(', ')}): {a.right ? 'right' : 'wrong'}</li>)}
                {m.votes.length > 0 && <li>Votes: {m.votes.map((v) => `${v.voter} → ${v.target}`).join(', ')}</li>}
              </ul>
            </div>
          ))}
        </section>
      )}
      {d.detentions.length > 0 && (
        <section>
          <h3>Detentions</h3>
          <ul>{d.detentions.map((x, i) => <li key={i}>{clock(x.time)} {x.guard} detained {x.target}: {x.right ? 'the hacker' : 'innocent'}</li>)}</ul>
        </section>
      )}
    </>
  );
}

export function DebriefPanel({ ui }: { ui: UiState }) {
  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const d = ui.debrief;
  if (!d || !ui.debriefOpen) return null;
  const t = d.totals;
  const steps = d.steps.map((step, index) => ({ step, index })).filter(({ step }) => filter === 'all' || (step.suspicious && step.status !== 'pinned' && step.status !== 'none'));
  return (
    <div className="debrief" data-testid="debrief" role="dialog" aria-label="Debrief">
      <div className="debrief-box">
        <div className="debrief-bar">
          <div>
            <div className="eyebrow">DEBRIEF · {clock(d.startedAt)} TO {clock(d.at)}</div>
            <h2>{d.hacker ? `What ${d.hacker} did` : 'What happened'}</h2>
          </div>
          <button type="button" onClick={() => store.set({ debriefOpen: false })} aria-label="Close debrief">×</button>
        </div>
        {d.rating && (
          <div className="debrief-rating" data-testid="debrief-rating">
            <strong>{d.rating.title}</strong>
            {d.rating.lines.map((l) => <p key={l}>{l}</p>)}
          </div>
        )}
        <p>{d.reason}</p>
        <p data-testid="debrief-totals">
          {t.steps === 0
            ? 'No suspicious action left any evidence.'
            : `${t.steps} suspicious ${t.steps === 1 ? 'action' : 'actions'} left evidence: ${t.pinned} pinned on the board, ${t.seen} seen on somebody's screen but not pinned, ${t.missed} missed.`}
        </p>
        <div className="debrief-filter">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Everything</button>
          <button type="button" aria-pressed={filter === 'missed'} data-testid="debrief-missed" onClick={() => setFilter('missed')}>Only what was not pinned</button>
        </div>
        {steps.length === 0 ? <p className="debrief-muted">Nothing to show here.</p> : <ol className="debrief-steps">{steps.map(({ step, index }) => <Step key={index} step={step} index={index} by={d.hackers.length > 1} />)}</ol>}
        <Extras d={d} />
      </div>
    </div>
  );
}
