/**
 * Unattended PCs: how long a screen stayed UNLOCKED while the person logged
 * in was not sitting at it, and who used it in the meantime.
 *
 * There is no auto-lock in this game (DESIGN.md section 3): a PC stays open
 * until somebody locks it. Locking your own screen is one of the habits the
 * game teaches, and this record is how the Phase 5 debrief will show it:
 * "your PC was open for 7 minutes while you were at the printer, and Omar
 * typed 12 commands on it".
 *
 * A WINDOW opens when a console session is unlocked and its user's player is
 * not at the keyboard (they stood up without locking, or the match started
 * that way). It closes when the screen is locked, the session logs out, or
 * the user comes back and sits down. Every other player who sits at the PC
 * while it is open is a VISITOR, with the number of lines they typed.
 *
 * This is ground truth for the debrief. It is never shown to players and
 * writes no log line: what visitors did leaves its own traces (auth.log,
 * .bash_history, CCTV...), which is what players must find.
 */
import type { Terminal, UnattendedWindow, World } from '../types';

/** The player whose account a session belongs to (null if no player has that account). */
function playerOf(world: World, account: string): string | null {
  return world.players.find((p) => p.account === account)?.id ?? null;
}

function openWindow(world: World, terminal: Terminal): UnattendedWindow | undefined {
  return world.unattended.find((w) => w.host === terminal.host && w.to === null);
}

/**
 * Brings the record of one PC up to date with its current state. Called after
 * anything that can change it: input, sitting, standing, locking, logging out.
 */
export function syncUnattended(world: World, terminal: Terminal): void {
  const session = terminal.stack[0] ? world.sessions[terminal.stack[0]] : undefined;
  const owner = session ? playerOf(world, session.user) : null;
  const exposed = !!session && session.logoutTime === null && !session.locked && terminal.playerId !== owner;
  let window = openWindow(world, terminal);

  // Close a window that no longer applies (or that belongs to another session now).
  if (window && (!exposed || window.sessionId !== session!.id)) {
    window.to = world.time;
    if (!session || session.id !== window.sessionId || session.logoutTime !== null) window.endedBy = 'logged out';
    else if (session.locked) {
      window.endedBy = 'locked';
      const lock = [...world.events].reverse().find((e) => e.type === 'session.lock' && e.host === terminal.host);
      window.lockedBy = lock ? { account: String(lock.details.by ?? ''), playerId: lock.actor } : null;
    } else window.endedBy = 'owner returned';
    window = undefined;
  }
  if (exposed && !window) {
    window = {
      host: terminal.host, account: session!.user, ownerPlayer: owner, sessionId: session!.id,
      from: world.time, to: null, endedBy: null, lockedBy: null, visitors: [],
    };
    world.unattended.push(window);
  }
  // Somebody other than the owner is sitting here: note them.
  if (window && terminal.playerId && terminal.playerId !== owner) {
    let visitor = window.visitors.find((v) => v.playerId === terminal.playerId);
    if (!visitor) window.visitors.push((visitor = { playerId: terminal.playerId, firstAt: world.time, lastAt: world.time, lines: 0 }));
    visitor.lastAt = world.time;
  }
}

/** A visitor typed one line at an unattended PC. */
export function noteUnattendedInput(world: World, terminal: Terminal): void {
  const window = openWindow(world, terminal);
  const visitor = window?.visitors.find((v) => v.playerId === terminal.playerId);
  if (visitor) {
    visitor.lines++;
    visitor.lastAt = world.time;
  }
}

/** Every PC's terminal, brought up to date (used once the match starts). */
export function syncAllUnattended(world: World): void {
  for (const terminal of Object.values(world.terminals)) syncUnattended(world, terminal);
}

/** Total time (ms) a PC has stood open and unattended, counting a window that is still open up to now. */
export function unattendedMs(world: World, host: string): number {
  return world.unattended.filter((w) => w.host === host).reduce((sum, w) => sum + ((w.to ?? world.time) - w.from), 0);
}
