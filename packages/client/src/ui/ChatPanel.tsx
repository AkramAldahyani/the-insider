/**
 * Chat (Phase 6, part D). One component shows the lines of a channel and a box
 * to write in; the office panel, the meeting and the panel of people who are
 * out all use it. The server decides who hears what; this only shows it.
 *
 * Clicking a name mutes that person for this match, in this browser only.
 */
import { useEffect, useRef, useState } from 'react';
import { CHAT_LENGTH, type ChatChannel } from '@insider/shared';
import { store, type UiState } from '../game/store';

const EMPTY: Record<ChatChannel, string> = {
  room: 'Nobody here has said anything.',
  meeting: 'Nobody has said anything yet.',
  hackers: 'Only you and your partners read this.',
  fired: 'Nobody else who is out has said anything yet.',
};
const PLACEHOLDER: Record<ChatChannel, string> = {
  room: 'Say something to this room',
  meeting: 'Say something to everybody',
  hackers: 'Only your partners read this',
  fired: 'Talk to the others who are out',
};

/** A hacker with partners has the private channel. */
export const hasPartners = (ui: UiState): boolean => (ui.briefing?.partners.length ?? 0) > 0;

/** Lines of one channel, without the people this player has muted. */
export function Lines({ ui, channel }: { ui: UiState; channel: ChatChannel }) {
  const box = useRef<HTMLDivElement>(null);
  const lines = ui.chat.filter((l) => l.channel === channel && !ui.muted.includes(l.fromId));
  const muted = [...new Map(ui.chat.filter((l) => ui.muted.includes(l.fromId)).map((l) => [l.fromId, l.from]))];
  // The newest line is always in view.
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length]);
  return (
    <div className="meeting-chat-lines" data-testid={`chat-${channel}`} ref={box}>
      {lines.length === 0 && <div className="meeting-muted">{EMPTY[channel]}</div>}
      {lines.map((l, i) => (
        <div key={i} dir="auto">
          {l.fromId === ui.playerId
            ? <strong>{l.from}:</strong>
            : <button type="button" className="chat-name" title={`Mute ${l.from}`} onClick={() => store.set({ muted: [...ui.muted, l.fromId] })}>{l.from}:</button>} {l.text}
        </div>
      ))}
      {muted.length > 0 && (
        <div className="meeting-muted" data-testid="chat-muted">
          Muted: {muted.map(([id, name]) => <button key={id} type="button" className="chat-name" title={`Hear ${name} again`} onClick={() => store.set({ muted: ui.muted.filter((m) => m !== id) })}>{name}</button>)}
        </div>
      )}
    </div>
  );
}

/** The box to write in. `onEscape`: what Esc does (close the panel). */
export function ChatInput({ channel, focus = false, onEscape }: { channel: ChatChannel; focus?: boolean; onEscape?: () => void }) {
  const [text, setText] = useState('');
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!text.trim()) return;
      store.send('chat.send', { text, channel: channel === 'hackers' ? 'hackers' : 'room' });
      setText('');
    }}>
      <input
        data-testid={`chat-input-${channel}`} value={text} maxLength={CHAT_LENGTH} placeholder={PLACEHOLDER[channel]} dir="auto" autoComplete="off" autoFocus={focus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Keys typed here belong to the chat, not to the office or the terminal behind it.
          e.stopPropagation();
          if (e.key === 'Escape') onEscape?.();
        }}
      />
      <button type="submit">Send</button>
    </form>
  );
}

/** Tabs (only for a hacker with partners), lines and box. */
export function Chat({ ui, channel }: { ui: UiState; channel: ChatChannel }) {
  const [secret, setSecret] = useState(false);
  const tabs = hasPartners(ui) && ui.fired === '';
  const shown: ChatChannel = tabs && secret ? 'hackers' : channel;
  const canTalk = channel === 'fired' || ui.fired === '';
  return (
    <div className="meeting-chat">
      {tabs && <Tabs open={channel} secret={secret} choose={setSecret} />}
      <Lines ui={ui} channel={shown} />
      {canTalk && <ChatInput key={shown} channel={shown} />}
    </div>
  );
}

function Tabs({ open, secret, choose }: { open: ChatChannel; secret: boolean; choose: (secret: boolean) => void }) {
  return (
    <div className="chat-tabs">
      <button type="button" aria-pressed={!secret} data-testid="chat-tab-open" onClick={() => choose(false)}>{open === 'meeting' ? 'Everybody' : 'This room'}</button>
      <button type="button" aria-pressed={secret} data-testid="chat-tab-hackers" onClick={() => choose(true)}>Partners (private)</button>
    </div>
  );
}

/** Puts the cursor back into the PC, if the player sits at one. */
const toTerminal = () => document.querySelector<HTMLTextAreaElement>('.term-body textarea')?.focus();

/** In the office: the panel (Enter or the button opens it), or the last lines for a few seconds when it is closed. */
export function ChatPanel({ ui }: { ui: UiState }) {
  const [, setNow] = useState(0);
  const recent = ui.chat.filter((l) => (l.channel === 'room' || l.channel === 'hackers') && !ui.muted.includes(l.fromId) && Date.now() - l.heardAt < 12_000).slice(-4);
  // Old lines go away by themselves.
  useEffect(() => {
    if (recent.length === 0) return;
    const timer = window.setTimeout(() => setNow((n) => n + 1), 1000);
    return () => window.clearTimeout(timer);
  });
  if (ui.solo || ui.fired || ui.meeting?.active || ui.matchOver || ui.debrief) return null;
  if (!ui.chatOpen) {
    if (recent.length === 0) return null;
    return (
      <div className={`chat-recent ${ui.seatedAt ? 'chat-seated' : ''}`} data-testid="chat-recent" aria-live="polite">
        {recent.map((l, i) => <div key={i} dir="auto" className={l.channel === 'hackers' ? 'chat-secret' : ''}><strong>{l.from}{l.channel === 'hackers' ? ' (private)' : ''}:</strong> {l.text}</div>)}
      </div>
    );
  }
  const close = () => {
    store.set({ chatOpen: false });
    toTerminal();
  };
  const channel: ChatChannel = ui.chatSecret && hasPartners(ui) ? 'hackers' : 'room';
  return (
    <div className={`chat-panel meeting-chat ${ui.seatedAt ? 'chat-seated' : ''}`} data-testid="chat-panel">
      <div className="meeting-head">
        <span>{channel === 'hackers' ? 'PARTNERS · PRIVATE' : `CHAT · ${ui.roomName || 'here'}`}</span>
        <button type="button" onClick={close} aria-label="Close chat">×</button>
      </div>
      {hasPartners(ui) && <Tabs open="room" secret={ui.chatSecret} choose={(secret) => store.set({ chatSecret: secret })} />}
      <Lines ui={ui} channel={channel} />
      <ChatInput key={channel} channel={channel} focus onEscape={close} />
    </div>
  );
}
