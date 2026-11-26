/**
 * Gentle hints for a defender who seems stuck (no new command, pin or step for
 * a while). The store asks `nextHint` now and then; how long "a while" is
 * depends on the difficulty (`HINT_AFTER_MS`), and on Hard there are none.
 *
 * Every hint is general advice about investigating, true in every match. None
 * of them knows anything about THIS match (who the hacker is, which weakness
 * they used): the browser does not know that, and must not.
 */
import type { SoloDifficulty } from '@insider/shared';

/** How long without progress before a hint, by difficulty (null = never). */
export const HINT_AFTER_MS: Record<SoloDifficulty, number | null> = { easy: 75_000, normal: 150_000, hard: null };

/** What the browser knows about what this player has done in this match. */
export interface HintFacts {
  /** Has sat at a PC. */
  sat: boolean;
  /** Command names used in this match. */
  used: ReadonlySet<string>;
  /** Clues on the evidence board. */
  pins: number;
  /** The title on their card ("SOC analyst"). */
  role: string;
  /** Has looked at the security monitors. */
  monitors: boolean;
}

interface Hint {
  id: string;
  text: string;
  /** True once the hint is no longer needed. */
  done(f: HintFacts): boolean;
  /** Only for this job (title on the card). */
  role?: string;
}

const HINTS: Hint[] = [
  { id: 'sit', text: 'Your PC is at your desk. Walk there, press E, and log in with the username and password on your card (C).', done: (f) => f.sat },
  { id: 'siem', role: 'SOC analyst', text: 'You can search the logs of every machine from your own desk: type `siem help`.', done: (f) => f.used.has('siem') },
  { id: 'monitors', role: 'Security guard', text: 'The monitors in the security office show the cameras and the badge log: who went where, and when.', done: (f) => f.monitors },
  { id: 'logs', text: 'Logs live in /var/log. `ls /var/log` shows which ones this machine keeps; `tail /var/log/auth.log` shows the newest logins.', done: (f) => f.used.has('tail') || f.used.has('cat') || f.used.has('less') },
  { id: 'last', text: '`last` lists who logged in to a machine and from which address. Servers tell the most.', done: (f) => f.used.has('last') },
  { id: 'grep', text: '`grep` finds the lines that matter: `grep "Failed password" /var/log/auth.log` shows guessed passwords.', done: (f) => f.used.has('grep') || f.used.has('siem') },
  { id: 'ip', text: 'An address like 10.0.2.15 leads to a PC: `nslookup 10.0.2.15` gives its name, and the name says whose desk it is.', done: (f) => f.used.has('nslookup') },
  { id: 'pin', text: 'Found a telling line? Select it in the terminal with the mouse and press Pin selection. The board (B) keeps it for the meeting.', done: (f) => f.pins > 0 },
  { id: 'mail', text: '`mail` shows your inbox. A strange message? `mail 2` shows its headers, which name the machine it really came from.', done: (f) => f.used.has('mail') },
  { id: 'meeting', text: 'Clues from different places that point at one person make a strong case. The emergency button in the meeting room calls a meeting.', done: (f) => f.pins >= 3 },
  { id: 'notebook', text: 'Press H for your notebook: every command you have used, with what it does. Tab completes commands and file names.', done: () => false },
];

/** The first hint this player still needs and has not been shown in this match (null = none left). */
export function nextHint(facts: HintFacts, shown: ReadonlySet<string>): { id: string; text: string } | null {
  const hint = HINTS.find((h) => !shown.has(h.id) && (!h.role || h.role === facts.role) && !h.done(facts));
  return hint ? { id: hint.id, text: hint.text } : null;
}
