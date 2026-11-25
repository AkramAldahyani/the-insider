/**
 * Who plays whom in a lobby's match, and who is the hacker (Phase 6, part B).
 * Drawn once, when the host starts, on the server only. Each browser is told
 * its own part (its card, and the briefing if it is the hacker) and nothing
 * about the others until the match is over.
 */
import { PARTY_HUMAN_HACKER, type PartySettings } from '@insider/shared';
import type { Random } from './bots/random';

/** The hacker poses as an ordinary employee, in every kind of match. */
interface Employee {
  id: string;
  role?: string;
}

export interface Deal {
  /** Network id -> the employee this person plays. */
  seats: Map<string, string>;
  /** The employee who is the hacker. */
  hacker: string;
  /** Is the hacker one of the people (and not the computer)? */
  human: boolean;
}

/**
 * Who can be the hacker: a person, the computer, or "any" (every ordinary
 * employee is equally likely, whoever plays them). Without bots, and when
 * people play every desk, only a person can.
 */
export function whoMayHack(settings: PartySettings, people: number, desks: number): 'human' | 'bot' | 'any' {
  if (!settings.bots || people >= desks || settings.hacker === 'human') return 'human';
  if (settings.hacker === 'bot') return 'bot';
  return people >= PARTY_HUMAN_HACKER ? 'human' : 'any';
}

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = random.int(0, i);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function deal(employees: readonly Employee[], clients: readonly string[], settings: PartySettings, random: Random): Deal {
  const ordinary = employees.filter((e) => (e.role ?? 'employee') === 'employee');
  const possible = (ordinary.length > 0 ? ordinary : employees).map((e) => e.id);
  const all = employees.map((e) => e.id);
  const who = whoMayHack(settings, clients.length, all.length);

  if (who === 'any') {
    const order = shuffled(all, random);
    const hacker = random.pick(possible);
    const seats = new Map(clients.map((c, i) => [c, order[i]]));
    return { seats, hacker, human: [...seats.values()].includes(hacker) };
  }
  // First the hacker's desk, then everybody else gets one of the others.
  const hacker = random.pick(possible);
  const order = shuffled(all.filter((id) => id !== hacker), random);
  const chosen = who === 'human' ? random.pick(clients) : null;
  const seats = new Map<string, string>();
  for (const c of clients) seats.set(c, c === chosen ? hacker : order.pop()!);
  return { seats, hacker, human: chosen !== null };
}
