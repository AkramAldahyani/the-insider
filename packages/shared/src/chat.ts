/**
 * Chat (Phase 6, part D): who hears what, and what a line may contain.
 *
 *   room      open chat: heard by everybody in the same room
 *   meeting   during a meeting: heard by everybody at the company
 *   hackers   private: only the hackers of this match (if there are several)
 *   fired     people who are out talk among themselves
 *
 * People who are out also listen to every room and to meetings. Nobody alive hears them.
 */
export const CHAT_CHANNELS = ['room', 'meeting', 'hackers', 'fired'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/** The longest line. */
export const CHAT_LENGTH = 300;
/** So many lines may follow each other at once... */
export const CHAT_BURST = 5;
/** ...and then one more every so many real milliseconds. */
export const CHAT_REFILL_MS = 1500;
/** Outside all rooms (in a doorway) people hear each other up to this many pixels away. */
export const CHAT_EARSHOT = 128;

/**
 * A line as others will see it: one line, not too long, without invisible
 * control characters (some turn the writing direction of the text after them
 * around). Letters of every language and emoji are fine.
 */
export function cleanChat(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.slice(0, 4 * CHAT_LENGTH)
    .replace(/[\p{Cc}\u{2028}\u{2029}]+/gu, ' ')
    .replace(/[\u{200B}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}\u{061C}]/gu, '')
    .replace(/(\p{M}{3})\p{M}+/gu, '$1') // a pile of accents on one letter
    .replace(/ +/g, ' ').trim();
  return [...text].slice(0, CHAT_LENGTH).join('').trim();
}
