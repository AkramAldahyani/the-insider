/**
 * Who plays whom in a lobby's match, and who the hackers are (Phase 6, parts B and C).
 * Drawn once, when the host starts, on the server only. Each browser is told
 * its own part (its card, and the briefing if it is the hacker) and nothing
 * about the others until the match is over.
 */
import { PARTY_HUMAN_HACKER, hackerCount, type PartySettings } from '@insider/shared';
import type { Random } from './bots/random';

/** The hacker poses as an ordinary employee, in every kind of match. */
interface Employee {
  id: string;
  role?: string;
}

export interface Deal {
  /** Network id -> the employee this person plays. */
  seats: Map<string, string>;
  /** The employees who are hackers. */
  hackers: string[];
  /** Is at least one of them a person (and not the computer)? */
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

  const count = Math.min(hackerCount(settings, clients.length, all.length), possible.length);

  if (who === 'any') {
    // Drawn again if (with several hackers) too few people would be left who are not one.
    for (;;) {
      const order = shuffled(all, random);
      const hackers = shuffled(possible, random).slice(0, count);
      const seats = new Map(clients.map((c, i) => [c, order[i]]));
      const people = [...seats.values()].filter((id) => hackers.includes(id)).length;
      if (people <= Math.max(1, clients.length - 2)) return { seats, hackers, human: people > 0 };
    }
  }
  // First the hackers' desks, then everybody else gets one of the others.
  const hackers = shuffled(possible, random).slice(0, count);
  const order = shuffled(all.filter((id) => !hackers.includes(id)), random);
  // Two people at least are not hackers, so that nobody knows everything; and whoever fits at no other desk has to be one.
  const people = Math.max(who === 'human' ? Math.max(1, Math.min(count, clients.length - 2)) : 0, clients.length - order.length);
  const chosen = shuffled(clients, random).slice(0, people);
  const seats = new Map<string, string>();
  for (const c of clients) seats.set(c, chosen.includes(c) ? hackers[chosen.indexOf(c)] : order.pop()!);
  return { seats, hackers, human: people > 0 };
}
