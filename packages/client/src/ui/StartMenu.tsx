/**
 * The home lobby: the first screen (DESIGN.md section 1a).
 *
 * On the left the player's own character stands in a room of the office and can
 * be dressed (look.ts). On the right are the ways to play, each with its own
 * options, and one button that starts the chosen one. This screen only collects
 * choices; the server checks them and decides the rest.
 */
import {
  DEFENDER_LADDER, LADDER, NAME_LENGTH, TRAINING_CHOICE, defenderChoice, CODE_LENGTH, SOLO_DIFFICULTIES, SOLO_ROLES, cleanName, parseCode,
  type Facing, type Look, type SoloChoice, type SoloDifficulty, type SoloMode, type SoloRole,
} from '@insider/shared';
import { useState, type CSSProperties } from 'react';
import { isOpen, type LadderProgress } from '../game/ladderProgress';
import { invitedTo, readName, saveName } from '../game/playerName';
import type { SavedPlace } from '../game/savedPlace';
import { store } from '../game/store';
import { Figure } from './Figure';
import { Wardrobe } from './Wardrobe';
import { rankOf, type Career } from '../game/career';

export const MODE_TEXT: Record<SoloMode, { name: string }> = { investigation: { name: 'Investigation' }, infiltration: { name: 'Infiltration' }, training: { name: 'Training day' } };

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
  if (solo.mode === 'training') return MODE_TEXT.training.name;
  if (solo.level) return solo.mode === 'investigation' ? `Defender ${solo.level} · ${DEFENDER_LADDER[solo.level - 1].name}` : `Level ${solo.level} · ${LADDER[solo.level - 1].name}`;
  return `${MODE_TEXT[solo.mode].name} · ${DIFFICULTY_TEXT[solo.difficulty].name}`;
}

/** The choice that starts a level. Its role and difficulty are not used: a level is fixed. */
export const levelChoice = (level: number): SoloChoice => ({ mode: 'infiltration', role: 'any', difficulty: 'normal', level });

// ───────────────────────────── The ways to play ─────────────────────────────

type Mode = 'friends' | 'training' | 'investigation' | 'infiltration' | 'ladder' | 'office';
/** The two ladders: fixed cases for defenders, fixed break-ins for hackers. */
type Track = 'defender' | 'hacker';
const TRACKS = ['defender', 'hacker'] as const;
const TRACK_TEXT: Record<Track, { name: string; about: string }> = {
  defender: { name: 'Defender ladder', about: 'Five cases, a different job and a different kind of evidence in each' },
  hacker: { name: 'Hacker ladder', about: 'Five break-ins, each teaching one trick and how it is found' },
};
/** Each way to play has the colour of a part of the office. */
const MODES: { id: Mode; name: string; about: string; color: string; people: string }[] = [
  { id: 'friends', name: 'Play with friends', about: 'A lobby with a code. Secret roles; the computer fills the empty desks.', color: '#8adbc1', people: '2–30 people' },
  { id: 'training', name: 'Training day', about: 'Your first day in the security team, with a colleague who shows you each step.', color: '#74cbbb', people: 'Alone · new here?' },
  { id: 'investigation', name: 'Investigation', about: 'Somebody is after the file on the admin server. Find out who.', color: '#78bdec', people: 'Alone' },
  { id: 'infiltration', name: 'Infiltration', about: 'You are the hacker. Get the file out without being caught.', color: '#e5484d', people: 'Alone' },
  { id: 'ladder', name: 'Ladders', about: 'Fixed cases that get harder: learn to defend, or learn how break-ins work.', color: '#f2b134', people: 'Alone' },
  { id: 'office', name: 'Shared office', about: 'One office for everybody who opens it. Pick any employee.', color: '#b6a2e4', people: 'Anybody' },
];

/** A row of choices that look like the office's badge readers: one is lit. */
function Pick<T extends string>({ name, legend, value, options, set, label, testid }: {
  name: string; legend: string; value: T; options: readonly T[]; set: (v: T) => void; label: (v: T) => { name: string; about?: string }; testid: (v: T) => string;
}) {
  return (
    <fieldset className="pick">
      <legend>{legend}</legend>
      <div className="pick-options">
        {options.map((o) => (
          <label key={o} className={o === value ? 'pick-on' : ''} title={label(o).about}>
            <input type="radio" name={name} data-testid={testid(o)} checked={o === value} onChange={() => set(o)} />
            <span>{label(o).name}</span>
          </label>
        ))}
      </div>
      {label(value).about && <p className="pick-about">{label(value).about}</p>}
    </fieldset>
  );
}

// ───────────────────────────── The character ─────────────────────────────

const TURN: Facing[] = ['down', 'left', 'up', 'right'];

function Stage({ look, name, setName }: { look: Look; name: string; setName: (name: string) => void }) {
  const [turn, setTurn] = useState(0);
  const [walking, setWalking] = useState(false);
  return (
    <section className="stage" aria-label="Your character">
      <div className="stage-room">
        <div className="stage-wall" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="stage-floor">
          <div className="stage-spot">
            <Figure look={look} scale={5} facing={TURN[turn]} walking={walking} />
            <span className="stage-shadow" aria-hidden="true" />
          </div>
          <label className="stage-plate">
            <span className="visually-hidden">Your name</span>
            <input data-testid="friends-name" value={name} maxLength={NAME_LENGTH} placeholder="Your name" autoComplete="off" spellCheck={false} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="stage-turn">
            <button type="button" aria-label="Turn left" onClick={() => setTurn((t) => (t + 3) % 4)}>↺</button>
            <button type="button" aria-pressed={walking} onClick={() => setWalking(!walking)}>{walking ? 'Stand' : 'Walk'}</button>
            <button type="button" aria-label="Turn right" onClick={() => setTurn((t) => (t + 1) % 4)}>↻</button>
          </div>
        </div>
      </div>
      <Wardrobe look={look} />
    </section>
  );
}

// ───────────────────────────── The ladders ─────────────────────────────

/** The highest level of a ladder that is open (where a player most likely wants to go on). */
const highestOpen = (count: number, progress: LadderProgress) => Math.max(1, ...Array.from({ length: count }, (_, i) => i + 1).filter((n) => isOpen(n, progress)));

/** The levels of one ladder: the chosen one is played by the big button, or directly with its own. */
function LadderList({ levels, progress, at, setAt, testid, play }: {
  levels: { name: string; briefing: string; job?: string }[]; progress: LadderProgress; at: number; setAt: (n: number) => void; testid: string; play: (n: number) => void;
}) {
  return (
    <ol className="ladder">
      {levels.map((l, i) => {
        const n = i + 1;
        const open = isOpen(n, progress);
        const won = progress[n];
        return (
          <li key={l.name} className={`${open ? '' : 'ladder-closed'} ${n === at ? 'ladder-on' : ''}`} data-testid={`${testid}-${n}`}>
            <button type="button" disabled={!open} onClick={() => setAt(n)} aria-pressed={n === at}>
              <strong>{n}. {l.name}</strong>
              {l.job && <span className="ladder-job"> · {l.job}</span>}
              {won !== undefined && <span className="ladder-won"> won{won ? `: ${won}` : ''}</span>}
              <small>{open ? l.briefing : 'Win the level before it first.'}</small>
            </button>
            <button type="button" className="menu-go ladder-play" data-testid={`${testid}-play-${n}`} disabled={!open} onClick={() => play(n)}>{won !== undefined ? 'Again' : 'Play'}</button>
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────────── The screen ─────────────────────────────

/** The player's rank in the top bar, with how far it is to the next one. */
function RankChip({ career }: { career: Career }) {
  const rank = rankOf(career.points);
  const share = rank.next ? (career.points - rank.from) / (rank.next.points - rank.from) : 1;
  return (
    <span className="rank-chip" data-testid="rank" title={`${career.matches} matches, ${career.wins} won, ${career.found} pieces of evidence pinned${rank.next ? `. ${rank.next.points - career.points} points to ${rank.next.name}` : ''}`}>
      <span className="rank-name">{rank.name}</span>
      <span className="rank-bar" aria-hidden="true"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
      <span className="rank-points">{career.points} pts</span>
    </span>
  );
}

export function StartMenu({ progress, defenders, place, look, career }: { progress: LadderProgress; defenders: LadderProgress; place: SavedPlace | null; look: Look; career: Career }) {
  const invited = invitedTo();
  const [mode, setMode] = useState<Mode>('friends');
  const [name, setName] = useState(readName);
  const [code, setCode] = useState(invited);
  const [role, setRole] = useState<SoloRole>('soc');
  const [difficulty, setDifficulty] = useState<SoloDifficulty>('normal');
  const [risk, setRisk] = useState<SoloDifficulty>('normal');
  const [level, setLevel] = useState(() => highestOpen(LADDER.length, progress));
  const [defenderAt, setDefenderAt] = useState(() => highestOpen(DEFENDER_LADDER.length, defenders));
  const [track, setTrack] = useState<Track>('defender');
  const ready = cleanName(name) !== '';
  const valid = parseCode(code);
  const friends = (start: () => Promise<void>) => {
    saveName(cleanName(name));
    void start();
  };
  const current = MODES.find((m) => m.id === mode)!;

  /** What the big button does for the chosen way to play. */
  const play: { text: string; testid: string; disabled: boolean; go: () => void } = {
    friends: { text: 'Create a lobby', testid: 'friends-create', disabled: !ready, go: () => friends(() => store.createParty(cleanName(name))) },
    investigation: { text: 'Start the investigation', testid: 'menu-investigation', disabled: false, go: () => void store.startSolo({ mode: 'investigation', role, difficulty }) },
    infiltration: { text: 'Start the infiltration', testid: 'menu-infiltration', disabled: false, go: () => void store.startSolo({ mode: 'infiltration', role: 'any', difficulty: risk }) },
    training: { text: defenders[0] !== undefined ? 'Do the training again' : 'Start the training day', testid: 'menu-training', disabled: false, go: () => void store.startSolo(TRAINING_CHOICE) },
    ladder: track === 'hacker'
      ? { text: `Play level ${level}`, testid: 'menu-ladder', disabled: !isOpen(level, progress), go: () => void store.startSolo(levelChoice(level)) }
      : { text: `Play case ${defenderAt}`, testid: 'menu-ladder', disabled: !isOpen(defenderAt, defenders), go: () => void store.startSolo(defenderChoice(defenderAt)) },
    office: { text: 'Enter the office', testid: 'menu-office', disabled: false, go: () => void store.enterOffice() },
  }[mode];

  return (
    <div className="home" data-testid="menu">
      <header className="home-bar">
        <span className="hud-brand"><span className="brand-mark" />THE INSIDER</span>
        <span className="home-tagline">An ordinary office. An extraordinary amount of evidence.</span>
        <span className="hud-spacer" />
        <RankChip career={career} />
        <span className="hud-location">NEXORA HQ <span className="signal-dot" /></span>
      </header>
      {place && (
        <div className="menu-place" role="status" data-testid="menu-place">
          <span>You were in {place.code ? <>the lobby <strong>{place.code}</strong></> : place.solo ? <>a solo match (<strong>{matchName(place.solo)}</strong>)</> : 'a match'}. Your place may still be kept.</span>
          <button type="button" className="menu-go" data-testid="menu-go-back" onClick={() => store.goBack()}>Go back to it</button>
          <button type="button" data-testid="menu-forget" onClick={() => store.forgetPlace()}>No</button>
        </div>
      )}
      <main className="home-main">
        <Stage look={look} name={name} setName={setName} />
        <section className="modes" aria-label="How to play">
          <div className="mode-list" role="tablist" aria-label="Ways to play">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={m.id === mode} data-testid={`mode-${m.id}`}
                className={m.id === mode ? 'mode mode-on' : 'mode'} style={{ '--mode': m.color } as CSSProperties} onClick={() => setMode(m.id)}>
                <span className="mode-name">{m.name}{m.id === 'training' && defenders[0] !== undefined && <span className="mode-done"> done</span>}</span>
                <span className="mode-people">{m.people}</span>
                <span className="mode-about">{m.about}</span>
              </button>
            ))}
          </div>

          <div className="mode-options" role="tabpanel" style={{ '--mode': current.color } as CSSProperties}>
            {mode === 'friends' && (
              <>
                <p className="mode-lead">Create a lobby and send its link to your friends, or join theirs with the five letters of its code.</p>
                <form className="join" onSubmit={(e) => { e.preventDefault(); if (valid && ready) friends(() => store.joinParty(valid, cleanName(name))); }}>
                  <label>
                    <span>Code from a friend</span>
                    <input className="friends-code" data-testid="friends-code" value={code} maxLength={CODE_LENGTH + 3} autoComplete="off" spellCheck={false} placeholder="BCDFG" onChange={(e) => setCode(e.target.value)} />
                  </label>
                  <button type="submit" className="menu-go" data-testid="friends-join" disabled={!ready || !valid}>Join the lobby</button>
                </form>
                {!ready && <p className="friends-hint">Type your name under your character first.</p>}
              </>
            )}
            {mode === 'investigation' && (
              <>
                <Pick name="role" legend="Your job" value={role} options={SOLO_ROLES} set={setRole} label={(r) => ROLE_TEXT[r]} testid={(r) => `role-${r}`} />
                <Pick name="difficulty" legend="Difficulty" value={difficulty} options={SOLO_DIFFICULTIES} set={setDifficulty} label={(d) => DIFFICULTY_TEXT[d]} testid={(d) => `difficulty-${d}`} />
              </>
            )}
            {mode === 'infiltration' && (
              <>
                <p className="mode-lead">The computer plays your colleagues: they check their PCs, follow your traces, call meetings and vote.</p>
                <Pick name="risk" legend="Difficulty" value={risk} options={SOLO_DIFFICULTIES} set={setRisk} label={(d) => ({ name: DIFFICULTY_TEXT[d].name, about: INFILTRATION_TEXT[d] })} testid={(d) => `risk-${d}`} />
              </>
            )}
            {mode === 'training' && (
              <>
                <p className="mode-lead">You are the new SOC analyst. A colleague tells you what to do, one step at a time: sit down, log in, wait for the alert, follow it to a person, and make your case at a meeting.</p>
                <ul className="training-list">
                  <li>About twenty minutes. The intruder is slow today, and the guide waits for you.</li>
                  <li>You learn the commands a real analyst uses, and where the evidence is.</li>
                  {defenders[0] !== undefined && <li data-testid="training-done">Done: {defenders[0] || 'won'}. The defender ladder is next.</li>}
                </ul>
              </>
            )}
            {mode === 'ladder' && (
              <>
                <Pick name="track" legend="Which ladder" value={track} options={TRACKS} set={setTrack} label={(t) => TRACK_TEXT[t]} testid={(t) => `track-${t}`} />
                {track === 'defender'
                  ? <LadderList levels={DEFENDER_LADDER.map((l) => ({ name: l.name, briefing: l.briefing, job: ROLE_TEXT[l.role].name }))} progress={defenders} at={defenderAt} setAt={setDefenderAt} testid="defender" play={(n) => void store.startSolo(defenderChoice(n))} />
                  : <LadderList levels={LADDER} progress={progress} at={level} setAt={setLevel} testid="ladder" play={(n) => void store.startSolo(levelChoice(n))} />}
              </>
            )}
            {mode === 'office' && <p className="mode-lead">Walk in, choose who you are today, and work beside whoever else is there. Empty desks are filled by the computer.</p>}
          </div>

          <button type="button" className="play" data-testid={play.testid} disabled={play.disabled} onClick={play.go}>
            {play.text}
          </button>
          <p className="home-note">Everything is simulated: no real commands run and no real network is touched.</p>
        </section>
      </main>
    </div>
  );
}
