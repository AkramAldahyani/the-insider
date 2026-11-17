/** The small React pieces around the map: start screen, HUD and onboarding card. */
import type { EmployeeChoice, OnboardingCard as Card } from '@insider/shared';
import { useState, type CSSProperties } from 'react';
import { store, type UiState } from '../game/store';
import { characterPortrait, departmentColor } from '../game/characterArt';

function Portrait({ id, department }: { id: string; department: string }) {
  return <span className="portrait" style={{ '--department': departmentColor(department) } as CSSProperties}>
    <img src={characterPortrait(id, department)} alt="" width="40" height="40" />
  </span>;
}

/** "Mon 2 Mar 2026 09:04:31" in UTC, which is the time zone of the simulated office. */
function clockText(ms: number): string {
  if (!ms) return '--:--:--';
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${date.replace(',', '')}  ${d.toISOString().slice(11, 19)}`;
}

// ───────────────────────────── Start screen ─────────────────────────────

export function StartScreen({ ui }: { ui: UiState }) {
  const byDepartment = new Map<string, EmployeeChoice[]>();
  for (const e of ui.employees) byDepartment.set(e.department, [...(byDepartment.get(e.department) ?? []), e]);

  return (
    <div className="start">
      <div className="start-box">
        <div className="eyebrow"><span className="signal-dot" /> NEXORA CORPORATION / EMPLOYEE ACCESS</div>
        <h1>THE INSIDER</h1>
        <p className="start-intro">An ordinary office. An extraordinary amount of evidence.</p>
        <p className="start-sub">{ui.scenarioName} — choose who you are today</p>
        {[...byDepartment].map(([department, people]) => (
          <section key={department}>
            <h2>{department}</h2>
            <div className="start-grid">
              {people.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="employee"
                  style={{ '--department': departmentColor(e.department) } as CSSProperties}
                  disabled={e.taken}
                  data-testid={`employee-${e.id}`}
                  onClick={() => store.send('choose', { playerId: e.id, hacker: ui.asHacker })}
                >
                  <Portrait id={e.id} department={e.department} />
                  <span className="employee-copy">
                    <span className="employee-name">{e.name}</span>
                    <span className="employee-title">{e.title}</span>
                    <span className="employee-desk">{e.taken ? 'already playing' : `desk ${e.desk}`}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <label className={`start-hacker ${ui.hackerOpen ? '' : 'start-hacker-off'}`}>
          <input
            type="checkbox"
            data-testid="join-as-hacker"
            checked={ui.asHacker}
            disabled={!ui.hackerOpen}
            onChange={(e) => store.set({ asHacker: e.target.checked })}
          />
          <span>
            <strong>Join as the hacker</strong>
            {ui.hackerOpen
              ? ' — you look like the employee you pick, but your goal is to get the flag off the admin server. One per match.'
              : ' — this match already has its hacker.'}
          </span>
        </label>
        <p className="start-note">
          You start next to your desk with an onboarding card (username, password, PC). Everything is simulated: no real
          commands run and no real network is touched.
        </p>
      </div>
    </div>
  );
}

// ───────────────────────────── HUD ─────────────────────────────

export function Hud({ ui }: { ui: UiState }) {
  return (
    <>
      <div className="hud-top">
        <span className="hud-brand"><span className="brand-mark" />THE INSIDER</span>
        <span className="hud-clock" data-testid="clock">{clockText(ui.clock)}</span>
        {ui.speed !== 1 && <span className="hud-speed">×{ui.speed}</span>}
        <span className="hud-room" data-testid="room">{ui.roomName || '—'}</span>
        <span className="hud-spacer" />
        <span className="hud-location">NEXORA HQ <span className="signal-dot" /></span>
      </div>
      <div className="hud-bottom">
        <span><kbd>W A S D</kbd> / arrows <span className="key-caption">Move</span></span>
        <span><kbd>E</kbd> <span className="key-caption">PC / badge</span></span>
        <button type="button" onClick={() => store.set({ cardOpen: !ui.cardOpen })}><kbd>C</kbd> My card</button>
        <button type="button" onClick={() => store.set({ tasksOpen: !ui.tasksOpen })}><kbd>T</kbd> Tasks</button>
        {ui.dev && <span className="dev-shortcut"><kbd>`</kbd> Dev</span>}
      </div>
      <PlayerRoster ui={ui} />
      {ui.notice && <div className="hud-notice" role="status" data-testid="notice">{ui.notice}</div>}
      {ui.nearDesk && !ui.seatedAt && (
        <div className="hud-hint" data-testid="hint">
          Press <kbd>E</kbd> to use {ui.nearDesk}
          {ui.briefing && <> · hold <kbd>U</kbd> to plug in the USB stick</>}
        </div>
      )}
      {ui.nearDoor && !ui.nearDesk && !ui.seatedAt && (
        <div className="hud-hint" data-testid="hint">
          Press <kbd>E</kbd> to tap your badge at the {ui.nearDoorName.toLowerCase()}
        </div>
      )}
    </>
  );
}

/** Public identity/presence only. No role inference, private cards, bot labels or invented voice/life state. */
function PlayerRoster({ ui }: { ui: UiState }) {
  const [selected, setSelected] = useState('');
  const [open, setOpen] = useState(true);
  const people: { id: string; name: string; seatedAt: string }[] = [];
  store.room?.state.players?.forEach((p) => people.push({ id: p.id, name: p.name, seatedAt: p.seatedAt }));
  people.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (ui.seatedAt) return null;
  return <aside className={`roster ${open ? '' : 'roster-collapsed'}`} aria-label="Office roster" data-testid="roster">
    <button className="roster-heading" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span>IN THE OFFICE <b>{people.length}</b></span><span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <div className="roster-list">
      {people.map((p) => {
        const department = ui.employees.find((e) => e.id === p.id)?.department ?? 'Employee';
        const self = p.id === ui.playerId;
        return <button key={p.id} type="button" className={`roster-person ${self ? 'roster-self' : ''}`}
          aria-pressed={(selected || ui.playerId) === p.id} onClick={() => setSelected(p.id)}
          style={{ '--department': departmentColor(department) } as CSSProperties}>
          <Portrait id={p.id} department={department} />
          <span className="roster-copy"><span className="roster-name">{p.name}{self && <small> You</small>}</span>
            <span className="department-tag">{department}</span>
            <span className="roster-status"><span className="signal-dot" />{p.seatedAt ? 'At workstation' : 'In office'}</span>
          </span>
        </button>;
      })}
      {people.length === 0 && <p className="tasks-empty">Waiting for office state…</p>}
    </div>}
    {open && <div className="roster-foot">EMPLOYEE DIRECTORY</div>}
  </aside>;
}

// ───────────────────────────── Hacker briefing ─────────────────────────────

/** The hacker's private briefing. Only the hacker's browser ever receives the data for it. */
export function MissionPanel({ ui }: { ui: UiState }) {
  if (!ui.briefing || !ui.briefingOpen) return null;
  return (
    <div className="mission" data-testid="mission">
      <div className="mission-head">
        <span>YOUR MISSION · PRIVATE</span>
        <button type="button" onClick={() => store.set({ briefingOpen: false })} aria-label="Close briefing">×</button>
      </div>
      <p className="mission-goal" data-testid="mission-goal">{ui.briefing.goal}</p>
      <p>Your tools are in <code>{ui.briefing.toolsPath}</code> on your own PC (a hidden folder: <code>ls -a</code>).</p>
      <p className="mission-sub">Rumours about offices like this one:</p>
      <ul>
        {ui.briefing.rumours.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <FlagForm />
      <p className="mission-sub">Press <kbd>M</kbd> to show or hide this.</p>
    </div>
  );
}

/** Where the hacker hands in the flag. The server checks it (and that it was really read in this match). */
function FlagForm() {
  const [text, setText] = useState('');
  return (
    <form className="flag-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) store.send('flag.submit', { text }); }}>
      <input data-testid="flag-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the flag here" spellCheck={false} />
      <button type="submit" data-testid="flag-submit">Hand in</button>
    </form>
  );
}

/** The security-alert banner (everyone sees the same vague text). */
export function AlertBanner({ ui }: { ui: UiState }) {
  if (!ui.alert) return null;
  return <div className="alert-banner" role="alert" data-testid="alert">{ui.alert}</div>;
}

/** The end of the match. */
export function MatchOver({ ui }: { ui: UiState }) {
  if (!ui.matchOver) return null;
  const me = ui.card?.name === ui.matchOver.hacker && ui.briefing !== null;
  return (
    <div className="match-over" data-testid="match-over">
      <div className="match-over-box">
        <div className="eyebrow">MATCH OVER · {clockText(ui.matchOver.at)}</div>
        <h2>{me ? 'You got the flag out. You win.' : 'The hacker got the flag out.'}</h2>
        <p>The hacker was <strong data-testid="match-over-hacker">{ui.matchOver.hacker}</strong>.</p>
        <p className="start-note">Everything they did is still in the logs. The full debrief (timeline, evidence, what was missed) comes in a later version. Reload the page once everybody has left to start a new match.</p>
        <button type="button" onClick={() => store.set({ matchOver: null })}>Look around the office</button>
      </div>
    </div>
  );
}

// ───────────────────────────── Task list ─────────────────────────────

/**
 * The player's own job tasks. For each open task it shows the next step and a
 * command that does it; finished steps are crossed out. It stays visible
 * while the PC terminal is open, because that is where most steps are typed.
 */
export function TaskList({ ui }: { ui: UiState }) {
  if (!ui.tasksOpen) return null;
  return (
    <div className={`tasks ${ui.seatedAt ? 'tasks-seated' : ''}`} data-testid="tasks">
      <div className="tasks-head">
        <span>YOUR TASKS <kbd>T</kbd></span>
        <span data-testid="tasks-completed">{ui.tasksCompleted} done</span>
      </div>
      <div className="tasks-caption">Your workday</div>
      {ui.tasks.length === 0 && <p className="tasks-empty">Nothing to do right now.</p>}
      {ui.tasks.map((task) => {
        const next = task.steps.find((s) => !s.done);
        return (
          <div key={task.id} className={`task ${task.done ? 'task-done' : ''}`} data-testid={`task-${task.id.split('#')[0]}`}>
            <div className="task-title">{task.done ? '✓ ' : ''}{task.title}</div>
            {!task.done && (
              <ol>
                {task.steps.map((step, i) => (
                  <li key={i} className={step.done ? 'step-done' : step === next ? 'step-next' : ''}>
                    {step.text}
                    {step === next && step.hint && <code>{step.hint}</code>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Onboarding card ─────────────────────────────

export function OnboardingCard({ card }: { card: Card }) {
  const rows: [string, string][] = [
    ['Username', card.username],
    ['Password', card.password],
    ['Your PC', card.hostname],
    ['Location', card.location],
    ['IP address', card.ip],
    ['MAC address', card.mac],
    ['Badge', card.badgeId ? `#${card.badgeId}` : 'none'],
    ['Badge opens', ['all normal doors', ...card.badgeAccess.map((zone) => zone.replace(/-/g, ' '))].join(', ')],
  ];
  return (
    <div className="card" data-testid="card">
      <div className="card-head">
        <span>NEXORA CORP · IT ONBOARDING</span>
        <button type="button" onClick={() => store.set({ cardOpen: false })} aria-label="Close card">×</button>
      </div>
      <div className="card-name">{card.name}</div>
      <div className="card-title">{card.title} · {card.department}</div>
      <table>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td data-testid={`card-${label.toLowerCase().replace(/ /g, '-')}`}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card-note">
        Doors with a reader need your badge: stand at the door and press <kbd>E</kbd>. White means ready, green means accepted, and red means declined. Every tap is logged.
        Your IP comes from DHCP and can change. Lock your screen when you leave your desk:
        <code> loginctl lock-session</code>. Press <kbd>C</kbd> to show or hide this card.
      </p>
    </div>
  );
}
