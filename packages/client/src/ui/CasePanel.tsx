/**
 * Investigation and lobbies: a defender's case, shown after the onboarding card (M hides
 * and shows it). It explains the goal, what convinces the colleagues, and where
 * this job finds things out. It knows nothing about the hacker.
 */
import { PARTY_VOTES_NEEDED } from '@insider/shared';
import type { ReactNode } from 'react';
import { store, type UiState } from '../game/store';

/** Where each job looks. The key is the role written on the card. */
const JOB: Record<string, ReactNode> = {
  'Employee': <>On the admin server (<code>ssh ADMIN-SRV-01</code>) you may run <code>last</code> (who logged in, from which address) and read <code>/var/lib/dhcp/dhcpd.leases</code> (which PC has an address). You cannot see security alerts, but the SOC analyst tells meetings about them.</>,
  'SOC analyst': <>Your PC searches every log: <code>siem source=alert</code> shows alerts, <code>siem source=dhcp ip=ADDRESS | tail 1</code> whose PC an address is. <code>siem help</code> explains the rest.</>,
  'Security guard': <>The monitors in the security office show the cameras and the badge log. On <code>SEC-SRV-01</code> you may read <code>/var/log/security/alerts.log</code>. Standing next to somebody, <kbd>X</kbd> detains them: one mistake and you lose that power.</>,
  'System administrator': <>You have sudo everywhere: <code>/var/log/auth.log</code> and <code>/var/log/audit/audit.log</code> on ADMIN-SRV-01, the alerts on SEC-SRV-01. Lock your screen when you leave.</>,
  'IT helpdesk': <><code>helpdesk status</code> shows every screen, <code>helpdesk lock HOST</code> locks one. On ADMIN-SRV-01 <code>last</code> shows who logged in from where, and <code>/var/lib/dhcp/dhcpd.leases</code> which PC has an address.</>,
};

export function CasePanel({ ui }: { ui: UiState }) {
  if ((!ui.solo && !ui.party) || ui.briefing || !ui.briefingOpen || ui.meeting?.active) return null;
  return (
    <div className="mission case" data-testid="case">
      <div className="mission-head">
        <span>YOUR CASE</span>
        <button type="button" onClick={() => store.set({ briefingOpen: false })} aria-label="Close case">×</button>
      </div>
      <p className="mission-goal">Find out which colleague is after the file on the admin server, before they hand it over.</p>
      <p>{JOB[ui.card?.role ?? ''] ?? JOB['Employee']}</p>
      <p>
        Pin what you find (<kbd>B</kbd> shows the board), press the red button in the meeting room, and accuse with three pieces{ui.solo ? ': ' : '. '}
        {ui.solo
          ? <>two about the person, one of them out of the ordinary. Your colleagues vote on what you show them.</>
          : <>Convince the others: everybody votes, and it takes at least {PARTY_VOTES_NEEDED} votes. Colleagues played by the computer vote on what they saw themselves; while you are few (less than half of those at the meeting) they also judge the evidence: two pieces about the person, one of them out of the ordinary.</>}
      </p>
      {ui.talk && <p data-testid="case-talks">In this large office each department has a small button: <kbd>E</kbd> there starts a department meeting with everybody near, for a minute, without a vote. The whole company meets at most three times.</p>}
      <p className="mission-sub">Meetings left: {ui.meeting?.usesLeft ?? 0}. Press <kbd>M</kbd> to show or hide this.</p>
    </div>
  );
}
