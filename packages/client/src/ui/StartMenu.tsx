/**
 * The start menu: which kind of match to play (DESIGN.md section 1a).
 * It only collects the choice. The server checks it and decides the rest.
 */
import { SOLO_DIFFICULTIES, SOLO_ROLES, type SoloChoice, type SoloDifficulty, type SoloMode, type SoloRole } from '@insider/shared';
import { useState } from 'react';
import { store } from '../game/store';

export const MODE_TEXT: Record<SoloMode, { name: string }> = { investigation: { name: 'Investigation' } };

export const DIFFICULTY_TEXT: Record<SoloDifficulty, { name: string; about: string }> = {
  easy: { name: 'Easy', about: 'The hacker only knows rumours and takes its time. Colleagues pin some clues on the board.' },
  normal: { name: 'Normal', about: 'The hacker knows some of the weaknesses. Colleagues only speak in meetings.' },
  hard: { name: 'Hard', about: 'More weaknesses, and the hacker knows all of them. Many PCs are left open.' },
};

const ROLE_TEXT: Record<SoloRole, { name: string; about: string }> = {
  any: { name: 'Surprise me', about: 'Anybody at the company' },
  employee: { name: 'Employee', about: 'Your own PC, your eyes, and the meeting room. The hardest job' },
  soc: { name: 'SOC analyst', about: 'Search the logs of every machine' },
  guard: { name: 'Security guard', about: 'Cameras, badge logs, and you can detain someone' },
  sysadmin: { name: 'System administrator', about: 'Root everywhere, and the hacker’s favourite target' },
  helpdesk: { name: 'IT helpdesk', about: 'Lock any PC, reset passwords' },
};

export function StartMenu() {
  const [role, setRole] = useState<SoloRole>('soc');
  const [difficulty, setDifficulty] = useState<SoloDifficulty>('normal');
  const choice: SoloChoice = { mode: 'investigation', role, difficulty };
  return (
    <div className="start" data-testid="menu">
      <div className="start-box">
        <div className="eyebrow"><span className="signal-dot" /> NEXORA CORPORATION / EMPLOYEE ACCESS</div>
        <h1>THE INSIDER</h1>
        <p className="start-intro">An ordinary office. An extraordinary amount of evidence.</p>
        <div className="menu-cards">
          <form className="menu-card" onSubmit={(e) => { e.preventDefault(); void store.startSolo(choice); }}>
            <h2>Investigation</h2>
            <p>
              One of your colleagues is after a secret file on the admin server. Everybody except you is played by the
              computer. Find out who it is from the evidence, then have them voted out or detained before the file is gone.
            </p>
            <div className="menu-options">
              <fieldset>
                <legend>Your job</legend>
                {SOLO_ROLES.map((r) => (
                  <label key={r}>
                    <input type="radio" name="role" data-testid={`role-${r}`} checked={role === r} onChange={() => setRole(r)} />
                    <span>{ROLE_TEXT[r].name}<small>{ROLE_TEXT[r].about}</small></span>
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Difficulty</legend>
                {SOLO_DIFFICULTIES.map((d) => (
                  <label key={d}>
                    <input type="radio" name="difficulty" data-testid={`difficulty-${d}`} checked={difficulty === d} onChange={() => setDifficulty(d)} />
                    <span>{DIFFICULTY_TEXT[d].name}<small>{DIFFICULTY_TEXT[d].about}</small></span>
                  </label>
                ))}
              </fieldset>
            </div>
            <button type="submit" className="menu-go" data-testid="menu-investigation">Start the investigation</button>
          </form>
          <div className="menu-card menu-card-off">
            <h2>Infiltration</h2>
            <p>You are the hacker, and the computer plays everybody who could catch you. This mode is not ready yet.</p>
          </div>
          <div className="menu-card">
            <h2>Shared office</h2>
            <p>Everybody who opens it plays in the same office. Choose any employee; empty desks are filled by the computer.</p>
            <button type="button" className="menu-go" data-testid="menu-office" onClick={() => void store.enterOffice()}>Enter the office</button>
          </div>
        </div>
        <p className="start-note">
          Everything is simulated: no real commands run and no real network is touched.
        </p>
      </div>
    </div>
  );
}
