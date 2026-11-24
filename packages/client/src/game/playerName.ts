/**
 * The name other people in a lobby see, remembered in this browser, and the
 * invite link of a lobby ("?lobby=CODE"). A browser may refuse to store or
 * give out anything (private windows); then the player simply types it again.
 */
import { cleanName, parseCode } from '@insider/shared';

const KEY = 'insider-name';

export function readName(): string {
  try {
    return cleanName(window.localStorage.getItem(KEY));
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    window.localStorage.setItem(KEY, name);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

/** The address friends can open: this page, with the code already filled in. */
export function inviteLink(code: string): string {
  return `${window.location.origin}${window.location.pathname}?lobby=${code}`;
}

/** The code in the address this page was opened with, or "". */
export function invitedTo(): string {
  return parseCode(new URLSearchParams(window.location.search).get('lobby')) ?? '';
}
