/**
 * Users, groups, passwords and sudo rules.
 *
 * DESIGN CHOICE: the account database is the real text files inside each
 * host's virtual filesystem (/etc/passwd, /etc/shadow, /etc/group,
 * /etc/sudoers). The engine parses them every time it needs an answer.
 * That is slower than keeping objects in memory, but it means that whatever a
 * player sees with `cat /etc/passwd` is exactly what the engine uses - and a
 * later phase can let an attacker EDIT those files (add a user, grant sudo)
 * with no extra code.
 */
import { hashString } from '../core/rng';
import { getNode, type Cred } from '../fs/vfs';
import type { Host } from '../types';

export interface PasswdEntry {
  name: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
}

export interface GroupEntry {
  name: string;
  gid: number;
  members: string[];
}

function lines(host: Host, path: string): string[] {
  const node = getNode(host, path);
  if (!node || node.type !== 'file') return [];
  return (node.content ?? '').split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
}

export function readPasswd(host: Host): PasswdEntry[] {
  return lines(host, '/etc/passwd')
    .map((l) => l.split(':'))
    .filter((f) => f.length >= 7)
    .map((f) => ({ name: f[0], uid: Number(f[2]), gid: Number(f[3]), gecos: f[4], home: f[5], shell: f[6] }));
}

export function readGroups(host: Host): GroupEntry[] {
  return lines(host, '/etc/group')
    .map((l) => l.split(':'))
    .filter((f) => f.length >= 4)
    .map((f) => ({ name: f[0], gid: Number(f[2]), members: f[3] ? f[3].split(',') : [] }));
}

export function findUser(host: Host, name: string): PasswdEntry | undefined {
  return readPasswd(host).find((u) => u.name === name);
}

/** Builds the credentials (user + all group names) used for permission checks. */
export function getCred(host: Host, user: string): Cred {
  const entry = findUser(host, user);
  const groups = readGroups(host);
  const primary = entry ? groups.find((g) => g.gid === entry.gid)?.name : undefined;
  const extra = groups.filter((g) => g.members.includes(user)).map((g) => g.name);
  return { user, groups: [primary ?? user, ...extra.filter((g) => g !== primary)] };
}

export function uidOf(host: Host, name: string): number | null {
  return findUser(host, name)?.uid ?? null;
}

export function gidOf(host: Host, group: string): number | null {
  return readGroups(host).find((g) => g.name === group)?.gid ?? null;
}

// ───────────────────────────── Passwords ─────────────────────────────

const HASH_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A FAKE password hash. It only has to (a) look like a real SHA-512 crypt
 * string and (b) be the same every time for the same password + salt.
 * It is NOT secure and is not meant to be: nothing here is a real password.
 */
export function fakeHash(password: string, salt: string): string {
  let a = hashString(`${salt}$${password}`, 0x811c9dc5);
  let b = hashString(`${password}$${salt}`, 0x9747b28c);
  let out = '';
  for (let i = 0; i < 86; i++) {
    // xorshift-style mixing of the two 32-bit states
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    b = (Math.imul(b, 1664525) + 1013904223) >>> 0;
    out += HASH_ALPHABET[((a ^ b) >>> 0) % 64];
  }
  return out;
}

/** The second field of an /etc/shadow line, e.g. "$6$salt$hash". */
export function shadowField(password: string, salt: string): string {
  return `$6$${salt}$${fakeHash(password, salt)}`;
}

/**
 * Checks a typed password against the host's /etc/shadow.
 * Accounts whose hash field is "*" or "!" (locked / no password) never match.
 */
export function verifyPassword(host: Host, user: string, password: string): boolean {
  const line = lines(host, '/etc/shadow').find((l) => l.split(':')[0] === user);
  if (!line) return false;
  const field = line.split(':')[1] ?? '';
  const m = /^\$6\$([^$]+)\$(.+)$/.exec(field);
  if (!m) return false;
  return fakeHash(password, m[1]) === m[2];
}

// ───────────────────────────── sudo ─────────────────────────────

export interface SudoRule {
  allowed: boolean;
  nopasswd: boolean;
  /** "ALL" or a list of command names the user may run. */
  commands: 'ALL' | string[];
}

/**
 * Reads /etc/sudoers and answers "may this user use sudo?".
 * Supported line shapes (the common ones):
 *   root    ALL=(ALL:ALL) ALL
 *   %sudo   ALL=(ALL:ALL) ALL
 *   bob     ALL=(ALL) NOPASSWD: ALL
 *   alice   ALL=(root) /usr/bin/systemctl, /usr/bin/journalctl
 */
export function sudoRule(host: Host, user: string): SudoRule {
  const cred = getCred(host, user);
  const result: SudoRule = { allowed: false, nopasswd: false, commands: [] };
  for (const line of lines(host, '/etc/sudoers')) {
    const m = /^(%?[\w.-]+)\s+\S+\s*=\s*(\([^)]*\))?\s*(NOPASSWD:\s*)?(.+)$/.exec(line.trim());
    if (!m || m[1] === 'Defaults') continue;
    const who = m[1];
    const matches = who.startsWith('%') ? cred.groups.includes(who.slice(1)) : who === user;
    if (!matches) continue;
    result.allowed = true;
    if (m[3]) result.nopasswd = true;
    const cmds = m[4].trim();
    if (cmds === 'ALL') result.commands = 'ALL';
    else if (result.commands !== 'ALL') {
      result.commands.push(...cmds.split(',').map((c) => c.trim().split(/\s+/)[0].split('/').pop()!));
    }
  }
  return result;
}
