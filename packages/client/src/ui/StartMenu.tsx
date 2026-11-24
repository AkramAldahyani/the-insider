/**
 * The start menu: which kind of match to play (DESIGN.md section 1a).
 * It only collects the choice. The server checks it and decides the rest.
 */
import { LADDER, SOLO_DIFFICULTIES, SOLO_ROLES, type SoloChoice, type SoloDifficulty, type SoloMode, type SoloRole } from '@insider/shared';
import { useState } from 'react';
import { isOpen, type LadderProgress } from '../game/ladderProgress';
import { store } from '../game/store';

export const MODE_TEXT: Record<SoloMode, { name: string }> = { investigation: { name: 'Investigation' }, infiltration: { name: 'Infiltration' } };

export const DIFFICULTY_TEXT: Record<SoloDifficulty, { name: string; about: string }> = {
  easy: { name: 'Easy', about: 'The hacker only knows rumours and takes its time. Colleagues pin some clues on the board.' },
  normal: { name: 'Normal', about: 'The hacker knows some of the weaknesses. Colleagues only speak in meetings.' },
  hard: { name: 'Hard', about: 'More weaknesses, and the hacker knows all of them. Many PCs are left open.' },
};

const INFILTRATION_TEXT: Record<SoloDifficulty, string> = {
  easy: 'Many weaknesses, forgetful colleagues, and slow investigators.',
  normal: 'Some weaknesses. Colleagues check their PCs, and the investigators take their time.',
  hard: 'Few weaknesses, locked screens, and investigators who come quickly.',
};

const ROLE_TEXT: Record<SoloRole, { name: string; about: string }> = {
  any: { name: 'Surprise me', about: 'Anybody at the company' },
  employee: { name: 'Employee', about: 'Your own PC, your eyes, and the meeting room. The hardest job' },
  soc: { name: 'SOC analyst', about: 'Search the logs of every machine' },
  guard: { name: 'Security guard', about: 'Cameras, badge logs, and you can detain someone' },
  sysadmin: { name: 'System administrator', about: 'Root everywhere, and the hacker’s favourite target' },
  helpdesk: { name: 'IT helpdesk', about: 'Lock any PC, reset passwords' },
};

/** What the top bar calls a solo match. */
export function matchName(solo: SoloChoice): string {
  return solo.level ? `Level ${solo.level} · ${LADDER[solo.level - 1].name}` : `${MODE_TEXT[solo.mode].name} · ${DIFFICULTY_TEXT[solo.difficulty].name}`;
}

/** The choice that starts a level. Its role and difficulty are not used: a level is fixed. */
export const levelChoice = (level: number): SoloChoice => ({ mode: 'infiltration', role: 'any', difficulty: 'normal', level });

function Ladder({ progress }: { progress: LadderProgress }) {
  return (
    <div className="menu-card">
      <h2>Scenario ladder</h2>
      <p>Five fixed infiltrations, each harder than the last and with something to learn. Winning one opens the next.</p>
      <ol className="ladder">
        {LADDER.map((l, i) => {
          const n = i + 1;
          const open = isOpen(n, progress);
          const won = progress[n];
          return (
            <li key={l.name} className={open ? '' : 'ladder-closed'} data-testid={`ladder-${n}`}>
              <div>
                <strong>{n}. {l.name}</strong>
                {won !== undefined && <span className="ladder-won"> won{won ? `: ${won}` : ''}</span>}
                <small>{open ? l.briefing : 'Win the level before it first.'}</small>
              </div>
              <button type="button" className="menu-go" data-testid={`ladder-play-${n}`} disabled={!open} onClick={() => void store.startSolo(levelChoice(n))}>{won !== undefined ? 'Again' : 'Play'}</button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function StartMenu({ progress }: { progress: LadderProgress }) {
  const [role, setRole] = useState<SoloRole>('soc');
  const [difficulty, setDifficulty] = useState<SoloDifficulty>('normal');
  const [risk, setRisk] = useState<SoloDifficulty>('normal');
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
          <form className="menu-card" onSubmit={(e) => { e.preventDefault(); void store.startSolo({ mode: 'infiltration', role: 'any', difficulty: risk }); }}>
            <h2>Infiltration</h2>
            <p>
              You are the hacker, posing as an ordinary employee. Get the secret file off the admin server and hand it in. The
              computer plays your colleagues: they check their PCs, follow your traces, call meetings and vote, and a guard walks around.
            </p>
            <div className="menu-options">
              <fieldset>
                <legend>Difficulty</legend>
                {SOLO_DIFFICULTIES.map((d) => (
                  <label key={d}>
                    <input type="radio" name="risk" data-testid={`risk-${d}`} checked={risk === d} onChange={() => setRisk(d)} />
                    <span>{DIFFICULTY_TEXT[d].name}<small>{INFILTRATION_TEXT[d]}</small></span>
                  </label>
                ))}
              </fieldset>
            </div>
            <button type="submit" className="menu-go" data-testid="menu-infiltration">Start the infiltration</button>
          </form>
          <Ladder progress={progress} />
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
