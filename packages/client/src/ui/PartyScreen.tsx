/**
 * Playing with friends (Phase 6, parts A and B): the lobby itself, with
 * everybody's character, and the screen that tells each player their part when
 * a match starts. (A lobby is created or joined on the home screen, StartMenu.tsx.) The server keeps the lobby;
 * this file only shows it and sends what the player wants.
 */
import { PARTY_HAND_IN_MINUTES, PARTY_HACKERS, PARTY_HUMAN_HACKER, PARTY_MEETINGS, PARTY_OFFICES, SOLO_DIFFICULTIES, type PartyHacker, type PartyMeetings, type PartyOffice, type PartyView, type SoloDifficulty } from '@insider/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { homeAddress, inviteLink, onHostComputer } from '../game/playerName';
import { Figure } from './Figure';
import { Wardrobe } from './Wardrobe';
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
  auto: 'Small while everybody fits, else large',
  small: 'Small: 11 desks',
  large: 'Large: 30 desks, two more departments; department meetings, and at most 3 all-hands meetings',
};
const MEETING_TEXT: Record<PartyMeetings, string> = {
  short: 'Short: 45 seconds to talk, 30 to vote',
  normal: 'Normal',
  long: 'Long: 2½ minutes to talk, 1 to vote',
};

/** The lobby: everybody standing together, what the host chose, and the buttons to get ready or start. */
export function PartyScreen({ party }: { party: PartyView }) {
  const host = party.you === party.hostId;
  const me = party.members.find((m) => m.id === party.you);
  const s = party.settings;
  // "localhost" means something else on every computer: friends need this one's address.
  const [home, setHome] = useState('');
  useEffect(() => void homeAddress().then(setHome), []);
  const [copied, setCopied] = useState(false);
  const link = inviteLink(party.code, home);
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => undefined);
    window.setTimeout(() => setCopied(false), 2000);
  };
  // The more people, the smaller they stand, so that up to thirty fit on the floor.
  const scale = party.members.length <= 4 ? 5 : party.members.length <= 8 ? 4 : party.members.length <= 16 ? 3 : 2;
  const look = useSyncExternalStore(store.subscribe, () => store.getUi().look);
  return (
    <div className="home lobby" data-testid="party">
      <header className="home-bar">
        <span className="hud-brand"><span className="brand-mark" />THE INSIDER</span>
        <span className="lobby-code-label">Lobby</span>
        <span className="lobby-code" data-testid="party-code">{party.code}</span>
        <span className="hud-spacer" />
        <span className="lobby-count" data-testid="party-count">{party.members.length} of {party.size} people</span>
      </header>
      <main className="home-main">
        <section className="stage lobby-stage" aria-label="Who is here">
          <div className="stage-room">
            <div className="stage-wall" aria-hidden="true"><span /><span /><span /><span /></div>
            <ul className="stage-floor lobby-floor" data-testid="party-members">
              {party.members.map((m) => {
                const status = m.lost ? 'connection lost' : m.away ? 'in the last match' : m.id === party.hostId ? 'host' : m.ready ? 'ready' : 'not ready';
                return (
                  <li key={m.id} className={`squad ${m.ready || m.id === party.hostId ? 'squad-ready' : ''} ${m.lost || m.away ? 'squad-away' : ''}`}>
                    <Figure look={m.id === party.you ? look : m.look} scale={scale} label={m.name} />
                    <span className="squad-plate">
                      <span className="party-name">{m.name}{m.id === party.you && <small> you</small>}</span>
                      <span className={`squad-status squad-${status.split(' ')[0]}`}>{status}</span>
                    </span>
                    {host && m.id !== party.you && <button type="button" className="squad-remove" data-testid={`remove-${m.name}`} onClick={() => store.send('party.remove', { id: m.id })}>Remove</button>}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="invite">
            <label>
              <span>Friends join with the code, or with this link</span>
              <input className="party-link" data-testid="party-link" readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
            <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
          <details className="lobby-wardrobe" data-testid="lobby-wardrobe">
            <summary>Change your look</summary>
            <Wardrobe look={look} />
          </details>
          {onHostComputer() && import.meta.env.DEV && <p className="home-note">This is the development server: only this computer can join. For friends on other computers start the game with <code>pnpm start</code>.</p>}
          {home && <p className="home-note">The link works for computers in the same home network. (If Windows asked whether Node.js may use the network, it must be allowed for private networks.)</p>}
        </section>

        <section className="modes lobby-settings" aria-label="The match">
          <h2 className="settings-title">The match{host ? '' : <small> · the host decides</small>}</h2>
          <div className="party-settings">
            <label className="setting-check">
              <input type="checkbox" data-testid="party-bots" disabled={!host} checked={s.bots} onChange={(e) => store.send('party.settings', { bots: e.target.checked })} />
              <span>The computer plays every desk nobody takes</span>
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
            <label>
              <span>Meetings</span>
              <select data-testid="party-meetings" disabled={!host} value={s.meetings} onChange={(e) => store.send('party.settings', { meetings: e.target.value as PartyMeetings })}>
                {PARTY_MEETINGS.map((m) => <option key={m} value={m}>{MEETING_TEXT[m]}</option>)}
              </select>
            </label>
            <label className="setting-check">
              <input type="checkbox" data-testid="party-open" disabled={!host} checked={party.open} onChange={(e) => store.send('party.open', { open: e.target.checked })} />
              <span>More people may join</span>
            </label>
          </div>
          <p className="party-note" role="status" data-testid="party-note">{party.notYet || (host ? 'Everybody is ready.' : 'Waiting for the host to start.')}</p>
          {host
            ? <button type="button" className="play" data-testid="party-start" disabled={party.notYet !== ''} onClick={() => store.send('party.start', {})}>Start the match</button>
            : <button type="button" className={`play ${me?.ready ? 'play-done' : ''}`} data-testid="party-ready" onClick={() => store.send('party.ready', { ready: !me?.ready })}>{me?.ready ? 'Not ready after all' : 'I am ready'}</button>}
          <button type="button" className="start-back lobby-leave" data-testid="party-leave" onClick={() => store.leave()}>Leave the lobby</button>
        </section>
      </main>
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
