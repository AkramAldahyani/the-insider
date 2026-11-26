/**
 * Playing with friends (Phase 6, parts A and B): the card on the start menu
 * where a lobby is created or joined, the lobby itself, and the screen that
 * tells each player their part when a match starts. The server keeps the lobby;
 * this file only shows it and sends what the player wants.
 */
import { CODE_LENGTH, NAME_LENGTH, PARTY_HAND_IN_MINUTES, PARTY_HACKERS, PARTY_HUMAN_HACKER, PARTY_MEETINGS, PARTY_OFFICES, SOLO_DIFFICULTIES, cleanName, parseCode, type PartyHacker, type PartyMeetings, type PartyOffice, type PartyView, type SoloDifficulty } from '@insider/shared';
import { useEffect, useState } from 'react';
import { homeAddress, invitedTo, inviteLink, onHostComputer, readName, saveName } from '../game/playerName';
import { store, type UiState } from '../game/store';

const DIFFICULTY_TEXT: Record<SoloDifficulty, string> = {
  easy: `Easy to defend: few ways in; a computer hacker takes its time, a person as the hacker waits ${PARTY_HAND_IN_MINUTES.easy} minutes before handing in`,
  normal: `Normal: a person as the hacker waits ${PARTY_HAND_IN_MINUTES.normal} minutes before handing in`,
  hard: `Hard to defend: many ways in, screens left open; a computer hacker is fast, a person waits only ${PARTY_HAND_IN_MINUTES.hard} minutes`,
};
const HACKER_TEXT: Record<PartyHacker, string> = {
  auto: `Drawn: one of you with ${PARTY_HUMAN_HACKER} or more people, otherwise anybody`,
  human: 'Always one of you',
  bot: 'Always the computer',
};
const OFFICE_TEXT: Record<PartyOffice, string> = {
  auto: 'The small one while everybody fits (11 desks), otherwise the large one',
  small: 'Small: 11 desks',
  large: 'Large: 30 desks, two more departments; department meetings, and at most 3 all-hands meetings',
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
  // "localhost" means something else on every computer: friends need this one's address.
  const [home, setHome] = useState('');
  useEffect(() => void homeAddress().then(setHome), []);
  return (
    <div className="start" data-testid="party">
      <div className="start-box">
        <div className="eyebrow"><span className="signal-dot" /> NEXORA CORPORATION / LOBBY</div>
        <h1 className="party-code" data-testid="party-code">{party.code}</h1>
        <p className="start-intro">Friends join with this code, or with this link:</p>
        <input className="party-link" data-testid="party-link" readOnly aria-label="Link for friends" value={inviteLink(party.code, home)} onFocus={(e) => e.target.select()} />
        {onHostComputer() && import.meta.env.DEV && <p className="start-note">This is the development server: only this computer can join. For friends on other computers start the game with <code>pnpm start</code>.</p>}
        {home && <p className="start-note">The link works for computers in the same home network. (If Windows asked whether Node.js may use the network, it must be allowed for private networks.)</p>}

        <h2>Players ({party.members.length} of {party.size})</h2>
        <ul className="party-list" data-testid="party-members">
          {party.members.map((m) => (
            <li key={m.id}>
              <span className="party-name">{m.name}{m.id === party.you && <small> you</small>}</span>
              {m.lost && <span className="party-waiting">connection lost</span>}
              {!m.lost && m.away && <span className="party-waiting">in the last match</span>}
              {m.id === party.hostId
                ? <span className="party-ready">host</span>
                : !m.away && !m.lost && <span className={m.ready ? 'party-ready' : 'party-waiting'}>{m.ready ? 'ready' : 'not ready'}</span>}
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
            <span>Hacker</span>
            <select data-testid="party-hacker" disabled={!host || !s.bots} value={s.bots ? s.hacker : 'human'} onChange={(e) => store.send('party.settings', { hacker: e.target.value as PartyHacker })}>
              {PARTY_HACKERS.map((h) => <option key={h} value={h}>{HACKER_TEXT[h]}</option>)}
            </select>
          </label>
          <label>
            <span>How many</span>
            <select data-testid="party-hackers" disabled={!host} value={s.hackers} onChange={(e) => store.send('party.settings', { hackers: Number(e.target.value) })}>
              <option value={0}>As many as suit the match</option>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? 'One hacker' : `${n} hackers`}</option>)}
            </select>
            <small data-testid="party-hacker-count">{s.hackers > party.hackers ? `Only ${party.hackers}: the defenders must keep the majority.` : `This match: ${party.hackers === 1 ? 'one hacker' : `${party.hackers} hackers`}.`}</small>
          </label>
          <label>
            <span>Difficulty</span>
            <select data-testid="party-difficulty" disabled={!host} value={s.difficulty} onChange={(e) => store.send('party.settings', { difficulty: e.target.value as SoloDifficulty })}>
              {SOLO_DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_TEXT[d]}</option>)}
            </select>
          </label>
          {party.size > 11 && (
            <label>
              <span>Office</span>
              <select data-testid="party-office" disabled={!host} value={s.office} onChange={(e) => store.send('party.settings', { office: e.target.value as PartyOffice })}>
                {PARTY_OFFICES.map((o) => <option key={o} value={o}>{OFFICE_TEXT[o]}</option>)}
              </select>
              <small data-testid="party-office-now">This match: the {party.office} office ({party.desks} desks).</small>
            </label>
          )}
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

/** Right after the start: who this player is. Nobody else is told. */
export function RoleReveal({ ui }: { ui: UiState }) {
  if (!ui.reveal || !ui.card) return null;
  const hacker = ui.briefing !== null;
  const partners = ui.briefing?.partners ?? [];
  const count = ui.party?.hackers ?? 1;
  return (
    <div className="reveal" data-testid="reveal" role="dialog" aria-label="Your part">
      <div className={`reveal-box ${hacker ? 'reveal-hacker' : ''}`}>
        <div className="eyebrow">ONLY YOU SEE THIS</div>
        <h2 data-testid="reveal-role">{hacker ? (partners.length > 0 ? 'You are a hacker' : 'You are the hacker') : 'You are not a hacker'}</h2>
        <p>You are <strong>{ui.card.name}</strong>, {ui.card.title} ({ui.card.role.toLowerCase()}).</p>
        <p>
          {hacker
            ? 'Look like everybody else, get the flag off the admin server, and hand it in. Your private briefing is under M.'
            : `${count === 1 ? 'One of your colleagues is' : `${count} of your colleagues are`} after a file on the admin server. Find out who, with evidence, before they hand it over.`}
        </p>
        {partners.length > 0 && <p data-testid="reveal-partners">You are not alone: <strong>{partners.map((p) => p.name).join(' and ')}</strong>. Any of you can hand in the flag.</p>}
        <button type="button" className="menu-go" data-testid="reveal-close" autoFocus onClick={() => store.set({ reveal: false })}>Go to work</button>
      </div>
    </div>
  );
}
