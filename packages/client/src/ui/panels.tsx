/** The small React pieces around the map: start screen, HUD and onboarding card. */
import type { EmployeeChoice, OnboardingCard as Card } from '@insider/shared';
import { store, type UiState } from '../game/store';

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
        <h1>THE INSIDER</h1>
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
                  disabled={e.taken}
                  data-testid={`employee-${e.id}`}
                  onClick={() => store.send('choose', { playerId: e.id })}
                >
                  <span className="employee-name">{e.name}</span>
                  <span className="employee-title">{e.title}</span>
                  <span className="employee-desk">{e.taken ? 'already playing' : `desk ${e.desk}`}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
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
        <span className="hud-clock" data-testid="clock">{clockText(ui.clock)}</span>
        {ui.speed !== 1 && <span className="hud-speed">×{ui.speed}</span>}
        <span className="hud-room" data-testid="room">{ui.roomName || '—'}</span>
        <span className="hud-spacer" />
        <span className="hud-keys">
          WASD / arrows: walk · E: use PC · C: card{ui.dev ? ' · `: dev panel' : ''}
        </span>
      </div>
      {ui.notice && <div className="hud-notice" data-testid="notice">{ui.notice}</div>}
      {ui.nearDesk && !ui.seatedAt && (
        <div className="hud-hint" data-testid="hint">
          Press <kbd>E</kbd> to use {ui.nearDesk}
        </div>
      )}
    </>
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
        Your IP comes from DHCP and can change. Lock your screen when you leave your desk:
        <code> loginctl lock-session</code>. Press <kbd>C</kbd> to show or hide this card.
      </p>
    </div>
  );
}
