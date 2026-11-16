/**
 * THE VISIBILITY FILTER - the only place that builds data for a browser.
 *
 * The server knows everything: every password (`world.credentials`), the
 * master event log (`world.events`), every file on every machine. A player
 * must receive only what they could see by standing in the office.
 *
 * The rule is enforced by construction, not by removing things: every
 * function here creates a NEW object and copies named fields into it one by
 * one. Nothing from the engine is ever passed through whole, so a field added
 * to the engine later cannot leak by accident. Rooms and handlers never call
 * `client.send` with engine data directly; they go through these functions.
 *
 * test/visibility.test.ts plays a match and checks every byte sent.
 */
import { screenState, type Scenario, type TerminalResult, type World } from '@insider/engine';
import type { DoorLook, EmployeeChoice, OnboardingCard, PublicDesk, PublicDoor, PublicPlayer, TermScreen, Facing } from '@insider/shared';

/** A player's body in the office (server-side record). */
export interface Avatar {
  clientId: string;
  playerId: string;
  /** The employee's account: whose badge this body carries. Never sent to browsers. */
  account: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  /** Hostname of the desk the player sits at, "" when walking. */
  seatedAt: string;
  /** Engine terminal id while seated. */
  terminalId: string;
  /** Wanted walking direction, each -1, 0 or 1. */
  dx: number;
  dy: number;
}

/** Start screen: who can be played. Names and desks are public; passwords are not included. */
export function employeeChoices(world: World, scenario: Scenario, takenPlayerIds: Set<string>): EmployeeChoice[] {
  return world.players.map((p) => {
    const account = scenario.accounts.find((a) => a.username === p.account);
    return {
      id: p.id,
      name: p.name,
      title: account?.title ?? '',
      department: account?.department ?? '',
      desk: p.desk,
      taken: takenPlayerIds.has(p.id),
    };
  });
}

/**
 * The onboarding card of ONE player: their own username, password and
 * machine. This is the only function that reads a password, and it reads
 * exactly one: the caller's own.
 */
export function onboardingCard(world: World, scenario: Scenario, playerId: string): OnboardingCard {
  const player = world.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  const account = scenario.accounts.find((a) => a.username === player.account);
  const host = world.hosts[player.desk];
  const badge = world.badges.holders[player.account];
  return {
    name: player.name,
    title: account?.title ?? '',
    department: account?.department ?? '',
    username: player.account,
    password: world.credentials[player.account]?.password ?? '',
    hostname: player.desk,
    ip: host?.ip ?? '',
    mac: host?.mac ?? '',
    location: host?.location ?? '',
    badgeId: badge?.id ?? '',
    badgeAccess: [...(badge?.access ?? [])],
  };
}

/**
 * What the PC's screen shows. `result.events` (master-log entries, with the
 * true identity of whoever typed) is deliberately NOT copied.
 */
export function termScreen(result: TerminalResult): TermScreen {
  return {
    output: result.output,
    prompt: result.prompt,
    masked: result.awaitingInput?.masked ?? false,
    screen: result.screen,
    canSwitchUser: result.canSwitchUser,
  };
}

/** A player as seen by everyone in the office. */
export function publicPlayer(a: Avatar): PublicPlayer {
  return { id: a.playerId, name: a.name, x: Math.round(a.x * 10) / 10, y: Math.round(a.y * 10) / 10, facing: a.facing, seatedAt: a.seatedAt };
}

/**
 * A door as seen from across the room: open, closed, or closed with a red
 * light. WHO tapped, and whether anyone was refused before, is not sent: that
 * is in the badge log, which has to be read on the badge server.
 */
export function publicDoor(id: string, look: DoorLook): PublicDoor {
  return { id, look };
}

/**
 * A monitor as seen by someone walking past: is it at the login prompt,
 * locked, or open? A lock screen prints its user's name, so that is public.
 * An OPEN screen's user is not sent: you would have to sit down and look.
 */
export function publicDesk(world: World, hostname: string, occupantId: string): PublicDesk {
  const screen = screenState(world, hostname);
  return {
    hostname,
    screen: screen.state,
    lockUser: screen.state === 'locked' ? (screen.user ?? '') : '',
    occupantId,
  };
}
