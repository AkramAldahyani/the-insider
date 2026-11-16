/**
 * All the data shapes of the simulated world.
 *
 * IMPORTANT DESIGN RULE: everything reachable from `World` is plain JSON
 * (objects, arrays, strings, numbers, booleans, null). No classes, no Map/Set,
 * no Date, no functions. That is what makes `JSON.stringify(world)` a complete
 * save file, and what makes replays and debugging simple.
 *
 * All times are "game time": milliseconds since the Unix epoch, in UTC.
 */

// ───────────────────────────── Filesystem ─────────────────────────────

export interface FsNode {
  type: 'file' | 'dir';
  /** Inode number, unique per host. Only used for realism (`stat`). */
  ino: number;
  /** Owner and group are stored as NAMES (not numeric ids) to keep things readable. */
  owner: string;
  group: string;
  /** Unix permission bits, e.g. 0o644. May include the sticky bit 0o1000 (used by /tmp). */
  mode: number;
  mtime: number;
  atime: number;
  ctime: number;
  /** Files only. */
  content?: string;
  /** Directories only: name -> node. */
  children?: Record<string, FsNode>;
}

// ───────────────────────────── Host pieces ─────────────────────────────

export interface Process {
  pid: number;
  user: string;
  /** "?" for daemons, otherwise "tty1", "pts/0", ... */
  tty: string;
  start: number;
  command: string;
  /** Process state column of `ps aux`, e.g. "Ss", "S", "R+". */
  stat: string;
  vsz: number;
  rss: number;
  /** Set when the process belongs to a login session (its shell, its sshd...). */
  sessionId?: string;
}

/** An established TCP connection, as seen from ONE host. Each end has its own record. */
export interface Connection {
  localIp: string;
  localPort: number;
  peerIp: string;
  peerPort: number;
  pid: number;
  program: string;
  sessionId: string;
}

/** A listening TCP service (shown by `ss -tlnp`). */
export interface Service {
  port: number;
  program: string;
  pid: number;
}

/** One line of `last`: who logged in where, from where, and when. */
export interface WtmpEntry {
  user: string;
  tty: string;
  /** Source IP for remote logins, "" for local console logins. */
  from: string;
  login: number;
  logout: number | null;
  sessionId: string | null;
}

/** One system journal record (shown by `journalctl` / `dmesg`). */
export interface JournalEntry {
  time: number;
  ident: string;
  pid: number | null;
  message: string;
  kernel: boolean;
}

export interface Host {
  hostname: string;
  mac: string;
  /** Current IP ("" until the host has booted and got an address). */
  ip: string;
  /** True when the IP is fixed (servers) rather than handed out by DHCP. */
  staticIp: boolean;
  kind: 'workstation' | 'server';
  /** No screen or keyboard in the office: reachable over ssh only. */
  headless: boolean;
  department: string;
  location: string;
  /** The employee whose desk this is (null for servers). */
  owner: string | null;
  online: boolean;
  bootTime: number;
  fs: FsNode;
  nextIno: number;
  nextPid: number;
  /** Counter for systemd-logind session numbers ("New session 12 of user ..."). */
  nextLogindId: number;
  processes: Process[];
  connections: Connection[];
  services: Service[];
  wtmp: WtmpEntry[];
  journal: JournalEntry[];
  /** The session currently shown on the physical screen/keyboard, if any. */
  consoleSessionId: string | null;
  /**
   * The screen locks itself after this much game time without PHYSICAL input
   * (someone typing at this machine's own keyboard). 0 = never.
   */
  autoLockMs: number;
}

// ───────────────────────────── Sessions & terminals ─────────────────────────────

/**
 * A login session = one running shell.
 *  - "console": someone logged in at the physical keyboard (tty1)
 *  - "ssh":     a remote login from another host (pts/N)
 *  - "su":      a shell started by `su` / `sudo -i` inside another session
 */
export interface Session {
  id: string;
  host: string;
  user: string;
  kind: 'console' | 'ssh' | 'su';
  /** Login shells print "logout" on exit and start in the home directory. */
  loginShell: boolean;
  tty: string;
  /** null = local. For ssh sessions: the IP the connection came from. */
  sourceIp: string | null;
  sourcePort: number | null;
  loginTime: number;
  logoutTime: number | null;
  /** Only meaningful for console sessions: is the screen locked? */
  locked: boolean;
  /** Game time of the last input into THIS shell (shown as idle time by `w`). */
  lastActivity: number;
  cwd: string;
  oldCwd: string;
  /** In-memory shell history (what the `history` command shows). */
  history: string[];
  /** history[0..historyBase) was loaded from ~/.bash_history; the rest is new. */
  historyBase: number;
  lastExit: number;
  /** sudo remembers a correct password until this game time. */
  sudoUntil: number;
  /** pids owned by this session on its host (removed when it ends). */
  pids: number[];
  /** pid used in auth.log lines ("sshd[1403]:" / "login[822]:" / "su[2210]:"). */
  authPid: number;
  logindId: number;
  parentId: string | null;
  /** For ssh sessions: where the `ssh` client process runs. */
  client: { host: string; pid: number } | null;
}

/**
 * A question the terminal is waiting on (login name, a password, ...).
 * It is plain data - not a callback - so a world can be saved in the middle of
 * a password prompt and continued later.
 */
export interface Pending {
  kind: string;
  prompt: string;
  masked: boolean;
  /** Whatever the handler for this `kind` needs to continue. */
  data: Record<string, unknown>;
  /** The rest of the command line to run once the question is answered. */
  resume?: unknown;
}

/**
 * A physical screen + keyboard. There is exactly one per host and it persists:
 * when a player walks away the sessions stay exactly as they were.
 */
export interface Terminal {
  id: string;
  host: string;
  /** Who is physically sitting here right now (null = nobody). */
  playerId: string | null;
  /** Session ids, bottom = console session, top = the shell receiving input. */
  stack: string[];
  /**
   * "Switch user": other people's console sessions that are still logged in
   * but hidden behind the one in `stack`. Each entry is a whole stack (its
   * bottom is a LOCKED console session). They are never lost: logging out or
   * logging in as that user again brings one back.
   */
  parked: string[][];
  /**
   * Game time of the last key pressed on THIS machine's own keyboard. The
   * auto-lock timer counts from here. Input that arrives over ssh is typed on
   * another machine's keyboard and does not move this.
   */
  lastPhysicalInput: number;
  pending: Pending | null;
  /** Text to show before the next prompt (e.g. "Connection closed by remote host"). */
  notice: string;
}

// ───────────────────────────── Events ─────────────────────────────

/**
 * One entry of the master event log. Players never see this list directly;
 * they see the log files / command outputs that were "materialized" from it.
 */
export interface GameEvent {
  id: number;
  time: number;
  host: string;
  /** The ACCOUNT the action ran as. */
  user: string;
  sourceIp: string | null;
  type: string;
  details: Record<string, unknown>;
  /** The PLAYER physically at the keyboard (ground truth, for the debrief). */
  actor: string | null;
  /**
   * Where the input that caused this came from:
   *  - "physical": typed at the keyboard of the machine the event happened on;
   *  - "remote":   typed at ANOTHER machine's keyboard (it arrived over ssh);
   *  - "system":   nobody typed anything (boot, DHCP, cron, auto-lock, old history).
   */
  origin: 'physical' | 'remote' | 'system';
}

// ───────────────────────────── Network ─────────────────────────────

export interface Lease {
  ip: string;
  mac: string;
  hostname: string;
  start: number;
  /** null while the lease is active. */
  end: number | null;
  lastRenew: number;
  expires: number;
}

export interface DhcpServer {
  /** Hostname of the machine running dhcpd (its logs get the DHCP lines). */
  serverHost: string;
  /** e.g. "10.0.2." - addresses are prefix + number. */
  prefix: string;
  rangeStart: number;
  rangeEnd: number;
  leaseMs: number;
  /** Full HISTORY of leases, oldest first. Never deleted: this is evidence. */
  leases: Lease[];
}

// ───────────────────────────── Physical security ─────────────────────────────

export interface Badge {
  /** The number printed in the badge log, e.g. "0417". */
  id: string;
  /** Restricted zones this badge opens, e.g. ["server-room"]. */
  access: string[];
}

export interface BadgeSystem {
  /** Hostname of the machine that stores the badge logs ("" = no log files). */
  serverHost: string;
  /** account username -> the badge that employee carries. */
  holders: Record<string, Badge>;
}

// ───────────────────────────── World ─────────────────────────────

export interface Player {
  id: string;
  name: string;
  account: string;
  desk: string;
  role: string;
}

export interface Credential {
  password: string;
  /** 0-100. Used by the hash cracker in a later phase. */
  strength: number;
}

export interface World {
  version: 1;
  scenarioId: string;
  scenarioName: string;
  domain: string;
  seed: number;
  /** Current game time (ms since epoch, UTC). */
  time: number;
  /** State of the seedable random generator. */
  rngState: number;
  hosts: Record<string, Host>;
  dhcp: DhcpServer;
  dnsServer: string;
  /** The door-badge system (see physical/badges.ts). */
  badges: BadgeSystem;
  players: Player[];
  /**
   * Engine-side secrets: plaintext passwords and strengths.
   * Keys: "username" for domain accounts, "root@HOSTNAME" for local root.
   * NEVER send this to a game client.
   */
  credentials: Record<string, Credential>;
  events: GameEvent[];
  sessions: Record<string, Session>;
  terminals: Record<string, Terminal>;
  counters: { event: number; session: number };
}
