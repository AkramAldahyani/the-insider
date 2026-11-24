/**
 * Playing with friends (Phase 6, part A): the card on the start menu where a
 * lobby is created or joined, and the lobby itself. The server keeps the lobby;
 * this file only shows it and sends what the player wants.
 */
import { CODE_LENGTH, NAME_LENGTH, PARTY_MEETINGS, SOLO_DIFFICULTIES, cleanName, parseCode, type PartyMeetings, type PartyView, type SoloDifficulty } from '@insider/shared';
import { useState } from 'react';
import { invitedTo, inviteLink, readName, saveName } from '../game/playerName';
import { store } from '../game/store';

const DIFFICULTY_TEXT: Record<SoloDifficulty, string> = {
  easy: 'Easy: a computer hacker knows only rumours and takes its time',
  normal: 'Normal: a computer hacker knows some of the weaknesses',
  hard: 'Hard: a computer hacker knows all the weaknesses and is fast',
};
const MEETING_TEXT: Record<PartyMeetings, string> = {
  short: 'Short: 45 seconds to talk, 30 to vote',
  normal: 'Normal',
  long: 'Long: 2½ minutes to talk, 1 to vote',
};

/** Start menu: your name, then a new lobby or a friend's code. */
export function FriendsCard() {
  const [name, setName] = useState(readName);
  const [code, setCode] = useState(invitedTo);
  const ready = cleanName(name) !== '';
  const valid = parseCode(code);
  const go = (start: () => Promise<void>) => {
    saveName(cleanName(name));
    void start();
  };
  return (
    <div className="menu-card">
      <h2>Play with friends</h2>
      <p>
        One of you creates a lobby and shares its code; the others join with the code, from their own computers. Desks
        nobody takes can be filled by the computer.
      </p>
      <div className="friends">
        <label>
          <span>Your name</span>
          <input data-testid="friends-name" value={name} maxLength={NAME_LENGTH} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="button" className="menu-go" data-testid="friends-create" disabled={!ready} onClick={() => go(() => store.createParty(cleanName(name)))}>Create a lobby</button>
      </div>
      <form className="friends" onSubmit={(e) => { e.preventDefault(); if (valid && ready) go(() => store.joinParty(valid, cleanName(name))); }}>
        <label>
          <span>Code from a friend</span>
          <input className="friends-code" data-testid="friends-code" value={code} maxLength={CODE_LENGTH + 3} autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button type="submit" className="menu-go" data-testid="friends-join" disabled={!ready || !valid}>Join the lobby</button>
      </form>
      {!ready && <p className="friends-hint">Type a name first.</p>}
    </div>
  );
}

/** The lobby: who is here, what the host chose, and the buttons to get ready or start. */
export function PartyScreen({ party }: { party: PartyView }) {
  const host = party.you === party.hostId;
  const me = party.members.find((m) => m.id === party.you);
  const s = party.settings;
  return (
    <div className="start" data-testid="party">
      <div className="start-box">
        <div className="eyebrow"><span className="signal-dot" /> NEXORA CORPORATION / LOBBY</div>
        <h1 className="party-code" data-testid="party-code">{party.code}</h1>
        <p className="start-intro">Friends join with this code, or with this link:</p>
        <input className="party-link" data-testid="party-link" readOnly aria-label="Link for friends" value={inviteLink(party.code)} onFocus={(e) => e.target.select()} />

        <h2>Players ({party.members.length} of {party.size})</h2>
        <ul className="party-list" data-testid="party-members">
          {party.members.map((m) => (
            <li key={m.id}>
              <span className="party-name">{m.name}{m.id === party.you && <small> you</small>}</span>
              <span className={m.ready || m.id === party.hostId ? 'party-ready' : 'party-waiting'}>{m.id === party.hostId ? 'host' : m.ready ? 'ready' : 'not ready'}</span>
              {host && m.id !== party.you && <button type="button" data-testid={`remove-${m.name}`} onClick={() => store.send('party.remove', { id: m.id })}>Remove</button>}
            </li>
          ))}
        </ul>

        <h2>Match {host ? '' : '(the host decides)'}</h2>
        <div className="party-settings">
          <label>
            <input type="checkbox" data-testid="party-bots" disabled={!host} checked={s.bots} onChange={(e) => store.send('party.settings', { bots: e.target.checked })} />
            <span>The computer plays every desk nobody takes</span>
          </label>
          <label>
            <span>Difficulty</span>
            <select data-testid="party-difficulty" disabled={!host || !s.bots} value={s.difficulty} onChange={(e) => store.send('party.settings', { difficulty: e.target.value as SoloDifficulty })}>
              {SOLO_DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_TEXT[d]}</option>)}
            </select>
          </label>
          <label>
            <span>Meetings</span>
            <select data-testid="party-meetings" disabled={!host} value={s.meetings} onChange={(e) => store.send('party.settings', { meetings: e.target.value as PartyMeetings })}>
              {PARTY_MEETINGS.map((m) => <option key={m} value={m}>{MEETING_TEXT[m]}</option>)}
            </select>
          </label>
          <label>
            <input type="checkbox" data-testid="party-open" disabled={!host} checked={party.open} onChange={(e) => store.send('party.open', { open: e.target.checked })} />
            <span>More people may join</span>
          </label>
        </div>

        <div className="party-buttons">
          {host
            ? <button type="button" className="menu-go" data-testid="party-start" disabled={party.notYet !== ''} onClick={() => store.send('party.start', {})}>Start the match</button>
            : <button type="button" className="menu-go" data-testid="party-ready" onClick={() => store.send('party.ready', { ready: !me?.ready })}>{me?.ready ? 'Not ready after all' : 'I am ready'}</button>}
          <button type="button" className="start-back" data-testid="party-leave" onClick={() => store.leave()}>Leave the lobby</button>
          <span className="party-note" role="status" data-testid="party-note">{party.notYet || (host ? 'Everybody is ready.' : 'Waiting for the host to start.')}</span>
        </div>
      </div>
    </div>
  );
}
