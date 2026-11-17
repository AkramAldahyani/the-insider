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
  kind: 'console' | 'ssh' | 'su' | 'implant';
  /** Implant sessions depend on this simulated listener remaining alive. */
  backdoorPid?: number;
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
   *  - "system":   nobody typed anything (boot, DHCP, cron, old history).
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

// ───────────────────────────── Mission ─────────────────────────────

/** A weakness a match can have (DESIGN.md section 6). */
export type WeaknessId = 'weak-admin-password' | 'extra-sudo' | 'plaintext-password' | 'careless-admin' | 'tailgate';

/** The match's secrets (see mission/mission.ts). NEVER send this to a game client. */
export interface Mission {
  /** Player id of the hacker (null = this match has none yet). */
  hacker: string | null;
  /** Where the flag is. */
  flag: { host: string; path: string } | null;
  /** The weaknesses switched on for this match. */
  weaknesses: WeaknessId[];
  /** "extra-sudo": the account that got sudo by mistake ("" if that weakness is off). */
  extraSudoAccount: string;
  /** "careless-admin": the player whose bot rarely locks its screen ("" if off). */
  carelessPlayer: string;
  /** Door codes that let exactly one person through per badge tap (the server room, unless "tailgate" is on). */
  onePersonDoors: string[];
  /** Set when the hacker has won: the game time it happened. */
  won: number | null;
}

// ───────────────────────────── Toolkit ─────────────────────────────

/** A tool running in the background (see tools/toolkit.ts). Plain data, so a world can be saved mid-job. */
export interface ToolJob {
  id: number;
  tool: string;
  args: string[];
  host: string;
  /** Its process in `ps aux`. Killing that process stops the job. */
  pid: number;
  /** The account it runs as, and the player who started it. */
  account: string;
  player: string | null;
  startedAt: number;
  finishAt: number;
  /** Private input snapshot for deterministic jobs, never sent to browsers. */
  data?: Record<string, string>;
}

/** A one-shot simulated keyboard recorder on one PC, scoped to its installing account. */
export interface Keylogger {
  host: string;
  account: string;
  player: string | null;
  pid: number;
  path: string;
  captured: boolean;
}

/** A backdoor set up by the USB stick (see tools/physical.ts). It works while its process is alive. */
export interface Backdoor {
  host: string;
  /** The account it runs as: whoever was logged in at the PC. */
  account: string;
  pid: number;
  port: number;
  installedAt: number;
  /** The player who plugged the stick in. */
  player: string;
}

export interface ToolkitState {
  /** "playerId/tool" -> game time from which it may be used again. */
  cooldowns: Record<string, number>;
  jobs: ToolJob[];
  nextJob: number;
  backdoors: Backdoor[];
  keyloggers: Keylogger[];
  /** USB devices plugged in so far (numbers the kernel's "device N" lines). */
  usbCount: number;
}

// ───────────────────────────── Unattended PCs ─────────────────────────────

/**
 * A stretch of time during which a PC stood unlocked while the person logged
 * in was away from it (see auth/unattended.ts). Ground truth for the debrief.
 */
export interface UnattendedWindow {
  host: string;
  /** The account whose session was open. */
  account: string;
  /** The player who owns that account (null if no player does). */
  ownerPlayer: string | null;
  sessionId: string;
  from: number;
  /** null while it is still open. */
  to: number | null;
  /** How it ended: locked, logged out, or the owner sat down again. null while open. */
  endedBy: 'locked' | 'logged out' | 'owner returned' | null;
  /** Who locked it (account typed / player at the keyboard), when it ended by a lock. */
  lockedBy: { account: string; playerId: string | null } | null;
  /** Other players who sat at it while it was open, and how many lines each typed. */
  visitors: { playerId: string; firstAt: number; lastAt: number; lines: number }[];
}

// ───────────────────────────── Mail and web ─────────────────────────────

export interface MailMessage {
  /** 1, 2, 3... in the order the server accepted them. */
  id: number;
  /** The mail server's queue id, as it appears in mail.log and in the Received header. */
  queueId: string;
  time: number;
  /** The account that really sent it (the "envelope sender"). */
  from: string;
  /** What the From: line claims. The same as `from` unless the message is spoofed (Phase 4). */
  headerFrom: string;
  to: string[];
  subject: string;
  body: string;
  /** The machine the message was sent from, and its IP at that moment. */
  sourceHost: string;
  sourceIp: string;
  /** Recipients who have opened it. */
  readBy: string[];
}

export interface MailSystem {
  /** Hostname of the mail server ("" = no mail). */
  serverHost: string;
  messages: MailMessage[];
}

/** A web site of the simulated internet / intranet. Nothing real is ever contacted. */
export interface WebSite {
  host: string;
  ip: string;
  title: string;
  category: string;
}

export interface WebSystem {
  /** Hostname of the web proxy all web requests pass through ("" = no web). */
  proxyHost: string;
  sites: WebSite[];
  /** The site workstations ask for software updates ("" = none). */
  updateSite: string;
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
  /** Internal email (see commands/mail.ts). */
  mail: MailSystem;
  /** The match's secrets: the hacker and today's weaknesses. Never sent to players. */
  mission: Mission;
  /** Tool cooldowns and background jobs (see tools/toolkit.ts). */
  toolkit: ToolkitState;
  /** Every time a PC stood unlocked with its user away (see auth/unattended.ts). Never sent to players. */
  unattended: UnattendedWindow[];
  /** The simulated web and its proxy (see `curl` in commands/net.ts). */
  web: WebSystem;
  /**
   * Background log noise (see core/noise.ts): `from` is the game time it
   * starts (null = off), `done` the time up to which it has been produced.
   */
  noise: { from: number | null; done: number };
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
