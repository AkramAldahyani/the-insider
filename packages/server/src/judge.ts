/**
 * How colleagues judge an accusation (Phase 5a, part B).
 *
 * In a solo match the bots vote, so a lone human needs to convince them. They
 * look at the pinned pieces of evidence the accusation names, and at nothing
 * else: this file knows the staff list (names, accounts, PCs, badges) and which
 * address each PC has now, like everybody at the company could. It never asks
 * who the hacker is, so it can be fooled - by a guess with good-looking
 * evidence, and by a hacker who worked under somebody else's account.
 *
 * Two questions are asked about every piece:
 *
 *   POINTS   does it say something about the accused? Their account, name, PC,
 *            the address of their PC, their badge or user number, or a camera
 *            picture of them doing something.
 *   UNUSUAL  does it show something other than ordinary office work? An alert,
 *            a refusal, root rights for somebody outside IT, another person's
 *            account used from their address...
 *
 * Colleagues also remember what OTHER colleagues told a meeting about what
 * they saw themselves (TESTIMONY). It can stand in for the unusual piece - an
 * employee cannot read the security alerts, but the SOC analyst can tell - and
 * never for the two pieces that point at the accused.
 *
 * An accusation CONVINCES when at least two of its pieces point at the accused
 * (the owner's rule) and at least one of those is unusual (or testimony is). Without the second
 * half, two ordinary "logged in" lines would be enough to fire anybody.
 */
import type { EvidenceItem } from './evidence';

/** At least this many pieces must point at the accused. */
export const POINTING_PIECES = 2;
/** A piece that names more people than this is a list: it says nothing about one of them. */
const MAX_NAMED = 3;

export interface StaffMember {
  id: string;
  name: string;
  account: string;
  /** Hostname of their own PC, and the address it has now. */
  desk: string;
  ip: string;
  /** Number of their account (`id`), as audit lines write it, and of their badge. */
  uid: number;
  badge: string;
  /** Sysadmin or helpdesk: root rights and other people's PCs are their job. */
  it: boolean;
}

export interface Judge {
  staff: StaffMember[];
  /** "2026-03-02": lines from other days are old news. */
  today: string;
  /** Room at a point of the map (for camera pictures). */
  roomAt(x: number, y: number): string;
}

export interface Verdict {
  convincing: boolean;
  /** Ids of the pieces that point at the accused, and of those that are also unusual. */
  pointing: string[];
  unusual: string[];
  /** Who told the meeting something unusual about the accused ("" = nobody). */
  testimony: string;
}

/** Something a colleague said in a meeting about what they saw themselves. */
export interface Testimony {
  from: string;
  text: string;
  /** Player id of the person it is about ("" = it names nobody; then an address in it may still point at somebody). */
  suspect?: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The word itself: not a part of a longer word, account, address or host name. */
const word = (s: string) => `(?<![\\w.-])${escape(s)}(?![\\w-]|\\.\\w)`;

/** Does a line of text mention this person in any of the ways above? */
function mentions(line: string, p: StaffMember): boolean {
  const ways = [word(p.account), word(p.name), word(p.desk), `\\ba?uid=${p.uid}\\b`];
  if (p.ip) ways.push(word(p.ip));
  if (p.badge) ways.push(`\\bBADGE=${escape(p.badge)}\\b`);
  return new RegExp(ways.join('|'), 'i').test(line);
}

const ODD = /severity=|\[(low|medium|high)\]|\brule=|denied|refused|not in (the )?sudoers|not allowed|invalid user|flag-read|flag\.txt|log-cleared|network-scan|@reboot|backdoor|implant|keylog|\.tools\/|usb.*(keyboard|hid)|remote shell|\/\.[\w-]+\/|ESTAB.*:\d{4,5}\s+\S+:\d{4,5}\b|password-reset\.example|spf=fail/i;
/** What witnesses say (the sentences of bots/manager.ts). */
const WITNESS = /sitting at (my PC|the PC of)|doing something to (my PC|the PC of)|stood right behind me|They do not work in IT|Someone logged in to my PC|a line I never added|that I did not make/i;
const ROOT = /\(to root\)|user=root|session opened for user root|\buid=0\b/i;

/** Lines like "Feb 27 15:10:00 ..." or "2026-02-27 ..." that are not from today. Without a date (SIEM rows) it is today. */
function oldNews(line: string, today: string): boolean {
  const iso = /^\s*(\d{4}-\d\d-\d\d)[ T]/.exec(line);
  if (iso) return iso[1] !== today;
  // Syslog lines begin with "Mar  2 09:03:12"; `last` has "Mon Mar  2 09:03" in the middle.
  const syslog = /^\s*([A-Z][a-z]{2}) +(\d{1,2}) \d\d:\d\d:\d\d /.exec(line) ?? /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) +(\d{1,2}) \d\d:\d\d\b/.exec(line);
  if (!syslog) return false;
  const d = new Date(`${today}T00:00:00Z`);
  return syslog[1] !== d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) || Number(syslog[2]) !== d.getUTCDate();
}

function unusualLine(line: string, suspect: StaffMember, staff: StaffMember[]): boolean {
  if (ODD.test(line)) return true;
  if (!suspect.it && ROOT.test(line)) return true;
  // Somebody else's account, used from the accused's address.
  return suspect.ip !== '' && new RegExp(word(suspect.ip)).test(line)
    && staff.some((p) => p.id !== suspect.id && new RegExp(word(p.account), 'i').test(line));
}

/** One piece of evidence against one person. */
export function judgePiece(item: EvidenceItem, suspect: StaffMember, judge: Judge): { points: boolean; unusual: boolean } {
  const no = { points: false, unusual: false };
  if (item.frame) {
    // A camera picture says something only if it shows them doing what they should not: everybody is on camera all day.
    const p = item.frame.people.find((x) => x.name === suspect.name);
    if (!p) return no;
    const caught = p.activity === 'at-pc' || (p.seatedAt !== '' && p.seatedAt !== suspect.desk) || (judge.roomAt(p.x, p.y) === 'Server room' && !suspect.it);
    return { points: caught, unusual: caught };
  }
  // What the pinning player typed is their own word, not evidence (`echo "it was Sara"`).
  const lines = (item.shown ?? item.text).split('\n').filter((l) => !oldNews(l, judge.today));
  if (judge.staff.filter((p) => lines.some((l) => mentions(l, p))).length > MAX_NAMED) return no;
  const about = lines.filter((l) => mentions(l, suspect));
  return { points: about.length > 0, unusual: about.some((l) => unusualLine(l, suspect, judge.staff)) };
}

/** A whole accusation. The same text pinned twice counts once. */
export function judgeAccusation(items: EvidenceItem[], suspectId: string, judge: Judge, said: Testimony[] = []): Verdict {
  const suspect = judge.staff.find((p) => p.id === suspectId);
  const verdict: Verdict = { convincing: false, pointing: [], unusual: [], testimony: '' };
  if (!suspect) return verdict;
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.kind}|${item.text.replace(/\s+/g, ' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { points, unusual } = judgePiece(item, suspect, judge);
    if (points) verdict.pointing.push(item.id);
    if (unusual) verdict.unusual.push(item.id);
  }
  verdict.testimony = said.find((t) => t.from !== suspect.name && (t.suspect ? t.suspect === suspect.id : mentions(t.text, suspect)) && (unusualLine(t.text, suspect, judge.staff) || WITNESS.test(t.text)))?.from ?? '';
  verdict.convincing = verdict.pointing.length >= POINTING_PIECES && (verdict.unusual.length > 0 || verdict.testimony !== '');
  return verdict;
}

const list = (ids: string[]) => (ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)!}`);

/** What a colleague says about an accusation in the meeting chat. */
export function comment(verdict: Verdict, name: string): string {
  const { pointing, unusual } = verdict;
  if (verdict.convincing && unusual.length === 0) return `${list(pointing)} point at ${name}, and ${verdict.testimony} told us something odd about them. That convinces me.`;
  if (verdict.convincing) return `${list(pointing)} point at ${name}, and ${list(unusual)} ${unusual.length === 1 ? 'is' : 'are'} not ordinary work. That convinces me.`;
  if (pointing.length === 0) return `None of that evidence says anything about ${name}. I will not fire somebody for that.`;
  if (pointing.length < POINTING_PIECES) return `Only ${list(pointing)} says anything about ${name}. That is not enough for me.`;
  return `${list(pointing)} are about ${name}, but they only show ordinary work.`;
}
