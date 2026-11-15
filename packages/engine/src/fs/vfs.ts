/**
 * The virtual filesystem: one tree of FsNode per host.
 *
 * Two families of functions live here:
 *  - "user" operations (readFile, writeFile, remove, ...) take a `Cred` and
 *    enforce Unix permissions exactly like a real kernel would. Shell commands
 *    use these. They throw `FsError` with a Linux-style error code.
 *  - "sys" operations (sysWrite, sysMkdir, getNode) skip permission checks.
 *    Only the engine itself uses them (building the world, writing logs).
 */
import type { FsNode, Host } from '../types';

export type FsErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'ENOTEMPTY'
  | 'EEXIST'
  | 'EPERM';

/** The exact texts Linux prints for each error. */
export const FS_MESSAGES: Record<FsErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EACCES: 'Permission denied',
  EISDIR: 'Is a directory',
  ENOTDIR: 'Not a directory',
  ENOTEMPTY: 'Directory not empty',
  EEXIST: 'File exists',
  EPERM: 'Operation not permitted',
};

export class FsError extends Error {
  code: FsErrorCode;
  constructor(code: FsErrorCode) {
    super(FS_MESSAGES[code]);
    this.code = code;
  }
}

/** Who is asking. `groups[0]` is the primary group. */
export interface Cred {
  user: string;
  groups: string[];
}

export const ROOT_CRED: Cred = { user: 'root', groups: ['root'] };

const R = 4;
const W = 2;
const X = 1;
const STICKY = 0o1000;

// ───────────────────────────── Paths ─────────────────────────────

/** Turns any path into a clean absolute one ("/a/./b/../c" -> "/a/c"). */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function resolvePath(cwd: string, path: string): string {
  return normalize(path.startsWith('/') ? path : `${cwd}/${path}`);
}

export function dirname(path: string): string {
  const n = normalize(path);
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

export function basename(path: string): string {
  const n = normalize(path);
  return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1);
}

// ───────────────────────────── Nodes ─────────────────────────────

export function newNode(
  host: Host,
  type: 'file' | 'dir',
  owner: string,
  group: string,
  mode: number,
  time: number,
  content = '',
): FsNode {
  const node: FsNode = { type, ino: host.nextIno++, owner, group, mode, mtime: time, atime: time, ctime: time };
  if (type === 'file') node.content = content;
  else node.children = {};
  return node;
}

/** Looks a node up WITHOUT permission checks (engine-internal). */
export function getNode(host: Host, path: string): FsNode | undefined {
  let node: FsNode | undefined = host.fs;
  for (const part of normalize(path).split('/')) {
    if (!part) continue;
    node = node?.children?.[part];
    if (!node) return undefined;
  }
  return node;
}

/** Size in bytes as shown by ls/stat. Directories are always 4096, like ext4. */
export function sizeOf(node: FsNode): number {
  return node.type === 'dir' ? 4096 : (node.content ?? '').length;
}

// ───────────────────────────── Permissions ─────────────────────────────

/**
 * The classic Unix check: pick ONE permission triplet (owner, group or other)
 * and test the requested bit in it. root is always allowed.
 */
export function can(node: FsNode, cred: Cred, bit: number): boolean {
  if (cred.user === 'root') return true;
  const shift = node.owner === cred.user ? 6 : cred.groups.includes(node.group) ? 3 : 0;
  return ((node.mode >> shift) & bit) !== 0;
}

export const canRead = (n: FsNode, c: Cred) => can(n, c, R);
export const canWrite = (n: FsNode, c: Cred) => can(n, c, W);
export const canExec = (n: FsNode, c: Cred) => can(n, c, X);

/**
 * Walks to a path the way the kernel does: you need "x" (search) permission on
 * every directory you pass THROUGH. This is why `cat /root/flag.txt` fails for
 * normal users even before the file's own permissions are looked at.
 */
export function walk(host: Host, path: string, cred: Cred): FsNode {
  let node = host.fs;
  for (const part of normalize(path).split('/')) {
    if (!part) continue;
    if (node.type !== 'dir') throw new FsError('ENOTDIR');
    if (!canExec(node, cred)) throw new FsError('EACCES');
    const child: FsNode | undefined = node.children![part];
    if (!child) throw new FsError('ENOENT');
    node = child;
  }
  return node;
}

/** Finds the directory that contains `path` and checks we may look inside it. */
function parentOf(host: Host, path: string, cred: Cred): { dir: FsNode; name: string } {
  const abs = normalize(path);
  if (abs === '/') throw new FsError('EPERM');
  const dir = walk(host, dirname(abs), cred);
  if (dir.type !== 'dir') throw new FsError('ENOTDIR');
  if (!canExec(dir, cred)) throw new FsError('EACCES');
  return { dir, name: basename(abs) };
}

/** In a sticky directory (/tmp) you may only delete/rename your own files. */
function stickyBlocks(dir: FsNode, node: FsNode, cred: Cred): boolean {
  if (!(dir.mode & STICKY) || cred.user === 'root') return false;
  return node.owner !== cred.user && dir.owner !== cred.user;
}

// ───────────────────────────── User operations ─────────────────────────────

export function readFile(host: Host, path: string, cred: Cred, now: number): string {
  const node = walk(host, path, cred);
  if (node.type === 'dir') throw new FsError('EISDIR');
  if (!canRead(node, cred)) throw new FsError('EACCES');
  node.atime = now;
  return node.content ?? '';
}

export function writeFile(
  host: Host,
  path: string,
  content: string,
  cred: Cred,
  now: number,
  append = false,
): void {
  if (normalize(path) === '/dev/null') return; // the classic bit bucket
  const { dir, name } = parentOf(host, path, cred);
  const existing = dir.children![name];
  if (existing) {
    if (existing.type === 'dir') throw new FsError('EISDIR');
    if (!canWrite(existing, cred)) throw new FsError('EACCES');
    existing.content = append ? (existing.content ?? '') + content : content;
    existing.mtime = existing.ctime = now;
    return;
  }
  if (!canWrite(dir, cred)) throw new FsError('EACCES');
  dir.children![name] = newNode(host, 'file', cred.user, cred.groups[0] ?? cred.user, 0o644, now, content);
  dir.mtime = dir.ctime = now;
}

/** Returns the names inside a directory (unsorted). */
export function listDir(host: Host, path: string, cred: Cred, now: number): string[] {
  const node = walk(host, path, cred);
  if (node.type !== 'dir') throw new FsError('ENOTDIR');
  if (!canRead(node, cred)) throw new FsError('EACCES');
  node.atime = now;
  return Object.keys(node.children!);
}

export function makeDir(host: Host, path: string, cred: Cred, now: number): void {
  const { dir, name } = parentOf(host, path, cred);
  if (dir.children![name]) throw new FsError('EEXIST');
  if (!canWrite(dir, cred)) throw new FsError('EACCES');
  dir.children![name] = newNode(host, 'dir', cred.user, cred.groups[0] ?? cred.user, 0o755, now);
  dir.mtime = dir.ctime = now;
}

/** Can `cred` delete everything inside this directory tree? */
function canEmpty(node: FsNode, cred: Cred): boolean {
  if (node.type !== 'dir') return true;
  const kids = Object.values(node.children!);
  if (kids.length === 0) return true;
  if (!canWrite(node, cred) || !canExec(node, cred)) return false;
  return kids.every((k) => canEmpty(k, cred));
}

export function remove(host: Host, path: string, cred: Cred, now: number, recursive = false): void {
  const { dir, name } = parentOf(host, path, cred);
  const node = dir.children![name];
  if (!node) throw new FsError('ENOENT');
  if (node.type === 'dir' && !recursive) throw new FsError('EISDIR');
  if (!canWrite(dir, cred) || stickyBlocks(dir, node, cred)) throw new FsError('EACCES');
  if (!canEmpty(node, cred)) throw new FsError('EACCES');
  delete dir.children![name];
  dir.mtime = dir.ctime = now;
}

/** Moves/renames. `dst` must be the full destination path (not a directory to move into). */
export function rename(host: Host, src: string, dst: string, cred: Cred, now: number): void {
  const from = parentOf(host, src, cred);
  const node = from.dir.children![from.name];
  if (!node) throw new FsError('ENOENT');
  const to = parentOf(host, dst, cred);
  if (!canWrite(from.dir, cred) || !canWrite(to.dir, cred)) throw new FsError('EACCES');
  if (stickyBlocks(from.dir, node, cred)) throw new FsError('EPERM');
  const target = to.dir.children![to.name];
  if (target === node) return;
  if (target?.type === 'dir') throw new FsError(node.type === 'dir' ? 'ENOTEMPTY' : 'EISDIR');
  delete from.dir.children![from.name];
  to.dir.children![to.name] = node;
  node.ctime = now;
  from.dir.mtime = from.dir.ctime = to.dir.mtime = to.dir.ctime = now;
}

export function chmod(host: Host, path: string, mode: number, cred: Cred, now: number): void {
  const node = walk(host, path, cred);
  if (cred.user !== 'root' && node.owner !== cred.user) throw new FsError('EPERM');
  node.mode = mode & 0o7777;
  node.ctime = now;
}

export function chown(
  host: Host,
  path: string,
  owner: string | null,
  group: string | null,
  cred: Cred,
  now: number,
): void {
  const node = walk(host, path, cred);
  if (cred.user !== 'root') throw new FsError('EPERM');
  if (owner) node.owner = owner;
  if (group) node.group = group;
  node.ctime = now;
}

/** Deep copy of a node with fresh inode numbers, owned by `cred` (used by `cp`). */
export function cloneNode(host: Host, node: FsNode, cred: Cred, now: number): FsNode {
  const copy = newNode(host, node.type, cred.user, cred.groups[0] ?? cred.user, node.mode & 0o777, now, node.content);
  if (node.type === 'dir') {
    for (const [name, child] of Object.entries(node.children!)) {
      copy.children![name] = cloneNode(host, child, cred, now);
    }
  }
  return copy;
}

// ───────────────────────────── Engine-internal operations ─────────────────────────────

export interface SysOpts {
  owner?: string;
  group?: string;
  mode?: number;
  time: number;
  append?: boolean;
}

/** Creates a directory and any missing parents, without permission checks. */
export function sysMkdir(host: Host, path: string, opts: SysOpts): FsNode {
  let node = host.fs;
  const parts = normalize(path).split('/').filter(Boolean);
  parts.forEach((part, i) => {
    let child = node.children![part];
    if (!child) {
      const last = i === parts.length - 1;
      child = newNode(
        host,
        'dir',
        opts.owner ?? 'root',
        opts.group ?? 'root',
        last ? (opts.mode ?? 0o755) : 0o755,
        opts.time,
      );
      node.children![part] = child;
    }
    node = child;
  });
  return node;
}

/**
 * Writes a file without permission checks, creating parent directories.
 * When the file already exists only its content/mtime change (owner and mode
 * are kept), which is what we want when appending to log files.
 */
export function sysWrite(host: Host, path: string, content: string, opts: SysOpts): FsNode {
  const abs = normalize(path);
  const dir = sysMkdir(host, dirname(abs), { owner: opts.owner, group: opts.group, time: opts.time });
  const name = basename(abs);
  let node = dir.children![name];
  if (!node) {
    node = newNode(host, 'file', opts.owner ?? 'root', opts.group ?? 'root', opts.mode ?? 0o644, opts.time, '');
    dir.children![name] = node;
  }
  node.content = opts.append ? (node.content ?? '') + content : content;
  node.mtime = node.ctime = opts.time;
  return node;
}
