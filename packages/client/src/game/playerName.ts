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

/** Does this page run on the computer that also runs the game, under a name only that computer understands? */
export const onHostComputer = (): boolean => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

/** The address friends can open: this page, with the code already filled in. `home`: the host's address in the home network. */
export function inviteLink(code: string, home = ''): string {
  const { protocol, port, origin, pathname } = window.location;
  return `${home ? `${protocol}//${home}${port ? `:${port}` : ''}` : origin}${pathname}?lobby=${code}`;
}

/** Asks the game which address this computer has at home ("" if that cannot be known). Only the host's own page is told. */
export async function homeAddress(): Promise<string> {
  if (!onHostComputer() || import.meta.env.DEV) return '';
  try {
    const { addresses } = (await (await fetch('/address')).json()) as { addresses: string[] };
    return /^[\d.]+$/.test(addresses[0] ?? '') ? addresses[0] : '';
  } catch {
    return '';
  }
}

/** The code in the address this page was opened with, or "". */
export function invitedTo(): string {
  return parseCode(new URLSearchParams(window.location.search).get('lobby')) ?? '';
}
