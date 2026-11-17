/**
 * The match's secrets: who the hacker is, and which WEAKNESSES this office
 * has today.
 *
 * Every match switches on a few weaknesses at random (DESIGN.md section 6),
 * so the way to the flag is different each time and cannot be memorised.
 * A weakness is ordinary scenario content: a different password, one more
 * name in a group, one extra file. This module only chooses which ones apply
 * and rewrites a COPY of the scenario before the world is built; nothing in
 * the simulation knows or cares that something is "a weakness".
 *
 * `world.mission` is ground truth for the server and the debrief. It must
 * never be sent to a browser, except the hacker's own briefing (and even that
 * does not say which weaknesses are on: finding them is the game).
 *
 * Everything here is game data about simulated machines. No real system is
 * involved anywhere.
 */
import { hashString } from '../core/rng';
import type { Scenario } from '../core/scenario';
import type { Mission, WeaknessId, World } from '../types';
import { installTools } from '../tools/toolkit';
import { emit, withActor } from '../events/log';
import { getNode } from '../fs/vfs';

export const ALL_WEAKNESSES: WeaknessId[] = ['weak-admin-password', 'extra-sudo', 'plaintext-password', 'careless-admin', 'tailgate'];

/** Shared hints, not match secrets: human briefings and bot hypotheses use the same definitions. */
export const HACKER_RUMOURS: Readonly<Record<WeaknessId, string>> = {
  'weak-admin-password': 'Some offices have a system administrator with an easy password.',
  'extra-sudo': 'Sometimes a regular employee was given sudo by mistake.',
  'plaintext-password': 'Old scripts and backups may contain a password in plain text.',
  'careless-admin': 'An administrator who forgets to lock his screen is a gift.',
  'tailgate': 'Some server room doors let a second person slip in behind the first.',
};

/** What createWorld is told about weaknesses: none, a fixed list, or "random" (2-4 picked from the seed). */
export type WeaknessChoice = 'random' | WeaknessId[];

/** A tiny random sequence of its own, so choosing weaknesses never disturbs the world's random numbers. */
function sequence(seed: number): () => number {
  let state = hashString(`mission/${seed}`);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which weaknesses this match has. Only those the scenario describes can be chosen. */
export function chooseWeaknesses(scenario: Scenario, seed: number, choice: WeaknessChoice): WeaknessId[] {
  const m = scenario.mission;
  if (!m) return [];
  const available = ALL_WEAKNESSES.filter((id) =>
    (id === 'weak-admin-password' && m.weakAdminPassword) || (id === 'extra-sudo' && m.extraSudo) ||
    (id === 'plaintext-password' && m.plaintextPassword) || (id === 'careless-admin' && m.carelessAdmin) || (id === 'tailgate' && m.tailgateDoor));
  if (choice !== 'random') return available.filter((id) => choice.includes(id));
  const next = sequence(seed);
  const count = Math.min(available.length, 2 + Math.floor(next() * 3)); // 2, 3 or 4
  const pool = [...available];
  const picked: WeaknessId[] = [];
  while (picked.length < count) picked.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return ALL_WEAKNESSES.filter((id) => picked.includes(id)); // a stable order
}

/**
 * Returns a copy of the scenario with the chosen weaknesses written into it,
 * and the mission record that says what was done.
 */
export function applyWeaknesses(scenario: Scenario, seed: number, choice: WeaknessChoice): { scenario: Scenario; mission: Mission } {
  const s = JSON.parse(JSON.stringify(scenario)) as Scenario;
  const m = s.mission;
  const weaknesses = chooseWeaknesses(s, seed, choice);
  const next = sequence(seed + 1);
  const mission: Mission = {
    hacker: null,
    flag: m ? { host: m.flagHost, path: m.flagPath } : null,
    weaknesses,
    extraSudoAccount: '',
    carelessPlayer: '',
    onePersonDoors: [],
    won: null,
    escalated: [],
  };
  if (!m) return { scenario: s, mission };

  if (weaknesses.includes('weak-admin-password') && m.weakAdminPassword) {
    // The sysadmin picked a password that is easy to guess.
    const account = s.accounts.find((a) => a.username === m.weakAdminPassword!.account);
    if (account) Object.assign(account, { password: m.weakAdminPassword.password, strength: m.weakAdminPassword.strength });
  }
  if (weaknesses.includes('extra-sudo') && m.extraSudo) {
    // A regular employee was put in group "sudo" by mistake: on the listed machines and on their own PC.
    const account = m.extraSudo.candidates[Math.floor(next() * m.extraSudo.candidates.length)];
    mission.extraSudoAccount = account;
    for (const host of s.hosts) {
      const applies = m.extraSudo.hosts.includes(host.hostname) || host.owner === account;
      const exists = host.users === '*' || host.users.includes(account);
      if (applies && exists) host.sudoers = [...new Set([...(host.sudoers ?? []), account])];
    }
  }
  if (weaknesses.includes('plaintext-password') && m.plaintextPassword) {
    // Somebody left a password in a script that everyone can read.
    const p = m.plaintextPassword;
    const host = s.hosts.find((h) => h.hostname === p.host);
    const secret = host?.rootPassword?.password ?? '';
    if (host) {
      host.files = [...(host.files ?? []), {
        path: p.path, mode: '644', ageMinutes: p.ageMinutes ?? 200_000,
        content: (Array.isArray(p.content) ? p.content.join('\n') : p.content).replace(/\{password\}/g, secret),
      }];
    }
  }
  if (weaknesses.includes('careless-admin') && m.carelessAdmin) mission.carelessPlayer = m.carelessAdmin.player;
  // Without the tailgating weakness, that door lets exactly one person through per badge.
  if (m.tailgateDoor && !weaknesses.includes('tailgate')) mission.onePersonDoors = [m.tailgateDoor];
  return { scenario: s, mission };
}

/**
 * Makes a player the hacker of this match (the server calls this when someone
 * joins in that role). Creates the hidden tools folder in their home on their
 * own PC, with every tool of tools/toolkit.ts in it.
 * Returns false if the match already has another hacker.
 */
export function setHacker(world: World, playerId: string): boolean {
  if (world.mission.hacker && world.mission.hacker !== playerId) return false;
  const player = world.players.find((p) => p.id === playerId);
  const host = player && world.hosts[player.desk];
  if (!player || !host) return false;
  world.mission.hacker = playerId;
  installTools(world, host, player.account);
  return true;
}

/**
 * The hacker hands in the flag. It counts only if the text is exactly what is
 * in the flag file AND this player really read that file during this match
 * (the master log says so): knowing the text from elsewhere is not enough.
 * Winning is recorded; the server then ends the match for everybody.
 */
export function submitFlag(world: World, playerId: string, text: string): { won: boolean; text: string } {
  const m = world.mission;
  if (!m.flag || m.hacker !== playerId) return { won: false, text: 'Only the hacker can hand in the flag.' };
  if (m.won !== null) return { won: false, text: 'The match is already over.' };
  const flag = (getNode(world.hosts[m.flag.host], m.flag.path)?.content ?? '').trim();
  if (!flag || text.trim() !== flag) return { won: false, text: 'That is not the flag.' };
  const readIt = world.events.some((e) => e.type === 'file.read' && e.actor === playerId && !e.details.denied && e.host === m.flag!.host && e.details.path === m.flag!.path);
  if (!readIt) return { won: false, text: 'You have to get the flag yourself in this match: read it on the server first.' };
  m.won = world.time;
  withActor(playerId, () => emit(world, { host: m.flag!.host, user: '', type: 'mission.won', details: { hacker: playerId } }));
  return { won: true, text: 'The flag is out. You win.' };
}

/** The hacker's private briefing. It hints at what MIGHT be wrong with this office, never at what is. */
export function briefing(world: World): { goal: string; toolsPath: string; rumours: string[] } {
  const player = world.players.find((p) => p.id === world.mission.hacker);
  return {
    goal: `Read the file ${world.mission.flag?.path ?? '?'} on ${world.mission.flag?.host ?? '?'} and hand in what it says, without being identified.`,
    toolsPath: `/home/${player?.account ?? '?'}/.tools`,
    rumours: [
      ...ALL_WEAKNESSES.map((id) => HACKER_RUMOURS[id]),
      'Not all of these are true today. Look before you leap: every attempt leaves traces.',
    ],
  };
}
