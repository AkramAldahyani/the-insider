/**
 * Bots that investigate (Phase 5a, part E): the SOC analyst and the security
 * guard of a match with `botOptions.investigate`. They do what a human in that
 * job would do, with what that job may see, and nothing else:
 *
 *  - the ANALYST types SIEM queries at its own PC and reads the answers off its
 *    own screen. An alert has an address; the address has a lease; the lease
 *    names a PC; the PC has an owner (the staff list). It also follows
 *    addresses in what colleagues pinned to the evidence board.
 *  - the GUARD stands at the monitors now and then and looks at the pictures
 *    and the badge log since the last time. When the evidence against somebody
 *    is strong it walks up to them and detains them.
 *
 * None of this knows who the hacker is, and both can be wrong: an address leads
 * to the owner of a PC, also when somebody else sat at it. A guard who detains
 * the wrong person loses the power to detain, like a human guard.
 */
import type { ClueReport } from './brain';

export interface StaffEntry {
  id: string;
  name: string;
  account: string;
  desk: string;
  /** Sysadmin or helpdesk. */
  it: boolean;
}

interface Lead {
  ip: string;
  /** Why this address is interesting, in the analyst's words. */
  why: string;
  weight: number;
}

const IP = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
/** Columns of a SIEM row: time, machine, source, then field=value pairs. */
const ROW = /^(\d\d:\d\d:\d\d) \S+ +\S+ +(.+)$/;
const field = (row: string, name: string) => new RegExp(`(?:^| )${name}=(\\S+)`).exec(row)?.[1] ?? '';

/**
 * The SOC analyst's desk work. The brain asks `next()` for a query to type,
 * types it, and gives the screen back to `read()`.
 */
export class Analyst {
  private readonly leads: Lead[] = [];
  /** Addresses followed already, with the owner of the PC (null = nobody's PC, e.g. a server). */
  private readonly traced = new Map<string, StaffEntry | null>();
  private readonly alerts = new Set<string>();
  private readonly seenItems = new Set<string>();
  private current: { lead: Lead; step: 'lease' | 'login' | 'root'; owner: StaffEntry | null; account: string } | null = null;

  constructor(private readonly me: string, private readonly staff: StaffEntry[], private readonly board: () => { id: string; text: string; pinnedById: string }[]) {}

  /** The analyst just looked at the newest alerts. */
  saw(output: string): ClueReport[] {
    const clues: ClueReport[] = [];
    for (const raw of output.split('\n')) {
      const m = ROW.exec(raw.trimEnd());
      if (!m || !/ alert /.test(raw) || this.alerts.has(raw)) continue;
      this.alerts.add(raw);
      const ip = field(m[2], 'src_ip');
      if (!ip) continue;
      // An old action that was flagged again is a lead, not proof: it may be an ordinary login.
      const weight = /threat-escalation/.test(raw) || field(m[2], 'severity') === 'low' ? 1 : 2;
      const why = `the security alert at ${m[1]} (${m[2]}) came from there`;
      const owner = this.traced.get(ip);
      if (owner) clues.push(this.clue(owner, ip, why, weight));
      else if (owner === undefined) this.lead({ ip, why, weight });
    }
    return clues;
  }

  private clue(owner: StaffEntry, ip: string, why: string, weight: number): ClueReport {
    return { text: `The address ${ip} is ${owner.desk}, the PC of ${owner.name}: ${why}.`, suspect: owner.id, weight };
  }

  private lead(lead: Lead): void {
    if (this.traced.has(lead.ip) || this.leads.some((l) => l.ip === lead.ip) || this.current?.lead.ip === lead.ip) return;
    this.leads.push(lead);
  }

  /** Addresses in what colleagues found on their PCs. */
  private readBoard(): void {
    for (const item of this.board()) {
      if (this.seenItems.has(item.id)) continue;
      this.seenItems.add(item.id);
      if (item.pinnedById === this.me) continue;
      // "ESTAB 0 0 10.0.2.74:4440 10.0.2.71:51525 ...": the other end; "o.farouk pts/0 10.0.2.71 ...": where a login came from.
      const peer = /^ESTAB\s+\d+\s+\d+\s+\S+\s+(\d+(?:\.\d+){3}):\d{4,5}\b/.exec(item.text)?.[1];
      const login = /^\S+\s+pts\/\d+\s+(\d+(?:\.\d+){3})\s/.exec(item.text)?.[1];
      if (peer) this.lead({ ip: peer, why: `it was connected to a PC through a program nobody started (${item.id})`, weight: 2 });
      else if (login) this.lead({ ip: login, why: `somebody logged in from there to a PC that is not theirs (${item.id})`, weight: 1 });
    }
  }

  /** The next query to type, or null when there is nothing to follow. */
  next(): string | null {
    if (!this.current) {
      this.readBoard();
      const lead = this.leads.sort((a, b) => b.weight - a.weight).shift();
      if (!lead) return null;
      this.current = { lead, step: 'lease', owner: null, account: '' };
    }
    const c = this.current;
    if (c.step === 'lease') return `siem source=dhcp ip=${c.lead.ip} | tail 1`;
    if (c.step === 'login') return `siem source=auth action=login result=success src_ip=${c.lead.ip} | tail 1`;
    return `siem source=auth user=${c.account} target_user=root | tail 1`;
  }

  /** The answer on the screen. Returns what the analyst concludes (with the row to pin). */
  read(output: string): ClueReport[] {
    const c = this.current;
    if (!c) return [];
    const row = output.split('\n').map((l) => l.trimEnd()).find((l) => ROW.test(l)) ?? '';
    const fields = ROW.exec(row)?.[2] ?? '';
    const done = () => { this.current = null; };
    if (c.step === 'lease') {
      c.owner = this.staff.find((p) => p.desk === field(fields, 'client') && p.id !== this.me) ?? null;
      this.traced.set(c.lead.ip, c.owner);
      if (!c.owner) { done(); return []; }
      c.step = 'login';
      return [{ ...this.clue(c.owner, c.lead.ip, c.lead.why, c.lead.weight), line: row.trim(), pin: true }];
    }
    const owner = c.owner!;
    if (c.step === 'login') {
      c.account = field(fields, 'user');
      if (!row || !IP.test(fields) || !c.account) { done(); return []; }
      const own = c.account === owner.account;
      // Their own account: was it used to become root? (For IT that is the job.) Somebody else's: that is already odd.
      if (own && !owner.it) c.step = 'root';
      else done();
      return [{
        text: own ? `${owner.name} logged in to a server from ${owner.desk}.` : `From ${owner.desk}, the PC of ${owner.name}, somebody logged in to a server as ${c.account}. That is another person's account.`,
        suspect: own ? '' : owner.id, weight: own ? 0 : 2, line: row.trim(), pin: true,
      }];
    }
    done();
    return row ? [{ text: `${owner.account} used root rights on a server. ${owner.name} does not work in IT.`, suspect: owner.id, weight: 2, line: row.trim(), pin: true }] : [];
  }
}

// ───────────────────────────── The guard ─────────────────────────────

/** A person in a camera picture. */
export interface PictureOf {
  name: string;
  playerId: string;
  seatedAt: string;
  activity: string;
  room: string;
}

/** What a guard makes of one person in one picture (null = nothing special: everybody is on camera all day). */
export function suspicious(p: PictureOf, camera: string, at: string, staff: StaffEntry[]): (ClueReport & { caught: boolean }) | null {
  const person = staff.find((s) => s.id === p.playerId);
  if (!person) return null;
  const clue = (what: string, weight: number, caught: boolean) => ({ text: `${camera} shows ${p.name} ${what} at ${at}.`, suspect: p.playerId, weight, caught });
  if (p.activity === 'at-pc') return clue('crouched at a PC, plugging something in', 3, true);
  const owner = staff.find((s) => s.desk === p.seatedAt && s.id !== p.playerId);
  if (owner && !person.it) return clue(`sitting at the PC of ${owner.name}`, 2, false);
  if (p.room === 'Server room' && !person.it) return clue('in the server room. They do not work in IT', 1, false);
  return null;
}

/** "2026-03-02 09:31:05 DOOR=SRV-ROOM BADGE=0417 USER=o.farouk RESULT=DENIED DIR=IN" */
export function refusedBadge(line: string, staff: StaffEntry[]): ClueReport | null {
  const m = /^\S+ (\d\d:\d\d):\d\d .*DOOR=(\S+) .*USER=(\S+) RESULT=DENIED/.exec(line);
  const person = m && staff.find((s) => s.account === m[3]);
  return m && person ? { text: `The badge log shows ${person.name} was refused at the door ${m[2]} at ${m[1]}.`, suspect: person.id, weight: 1, line } : null;
}
