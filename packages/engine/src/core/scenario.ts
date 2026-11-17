/**
 * The shape of a scenario file (scenarios/*.json) and a validator for it.
 *
 * A scenario is pure content: which machines exist, who works there, their
 * passwords, their files, and some past activity so logs are not empty.
 * New offices can be added without touching engine code.
 */
import { ROLE_IDS } from './roles';

export interface ScenarioAccount {
  username: string;
  fullName: string;
  title?: string;
  department?: string;
  password: string;
  /** 0 (trivial) to 100 (very strong). Used by the password cracker in a later phase. */
  strength: number;
  /** Numeric user id; the same on every host. Defaults to 1001, 1002, ... */
  uid?: number;
  /**
   * The plastic badge this employee carries. `id` is the number printed in the
   * badge log. `access` lists the RESTRICTED zones the badge opens (for example
   * "server-room"). Doors that are not restricted open for every badge.
   */
  badge?: { id: string; access?: string[] };
}

export interface ScenarioFile {
  path: string;
  /** Text, or a list of lines (easier to write in JSON). */
  content: string | string[];
  /** Defaults: files under /home/<user>/ belong to that user, everything else to root. */
  owner?: string;
  group?: string;
  /** Octal permissions as text, e.g. "600". Default "644". */
  mode?: string;
  /** How long before the scenario start the file was last modified. */
  ageMinutes?: number;
}

export interface ScenarioHost {
  hostname: string;
  kind: 'workstation' | 'server';
  department: string;
  location: string;
  mac: string;
  /**
   * True for a machine with no screen and keyboard in the office (a box in a
   * rack). Nobody can sit at it; it is reached over ssh only, and it needs no
   * desk on the map.
   */
  headless?: boolean;
  /** Fixed IP (servers). Hosts without one get an address from DHCP. */
  staticIp?: string;
  /** The employee whose desk this is. */
  owner?: string;
  /** Accounts that exist on this host: a list of usernames, or "*" for everyone. */
  users: string[] | '*';
  /** Accounts in group "sudo" here (may run any command as root). */
  sudoers?: string[];
  /** Accounts in group "adm" here (may read /var/log). Default: owner + sudoers. */
  logReaders?: string[];
  /** If set, root has a password here (otherwise the root account is locked). */
  rootPassword?: { password: string; strength: number };
  /** How long the machine has been running at scenario start. Default 3 days. */
  uptimeMinutes?: number;
  /** Who is logged in at the physical screen when the game starts. Omit for "nobody". */
  console?: { user: string; state: 'locked' | 'unlocked'; loginMinutesAgo: number };
  files?: ScenarioFile[];
  /** username -> crontab text (or lines). */
  crontabs?: Record<string, string | string[]>;
  /** username -> commands already present in ~/.bash_history. */
  bashHistory?: Record<string, string[]>;
}

/** Something that happened before the game started (creates realistic old log lines). */
export interface ScenarioHistoryItem {
  type: 'console-session' | 'ssh-session' | 'ssh-fail' | 'sudo';
  /** When it started, counted back from the scenario start. */
  minutesAgo: number;
  /** For sessions: how long they lasted. */
  durationMinutes?: number;
  host: string;
  user: string;
  /** ssh only: the hostname the connection came from. */
  from?: string;
  /** ssh-session: commands typed (end up in ~/.bash_history). sudo: the command run. */
  commands?: string[];
  command?: string;
  /** ssh-fail: number of wrong passwords (1-3). */
  attempts?: number;
}

/**
 * One step of a job task. Either a shell command (`run` + `match`) or a room
 * to visit (`visit`). In `text`, `run` and `match` these placeholders are
 * filled in when the task is handed out: {date} (2026-03-02), {n} (a random
 * three-digit number), {user} (the employee's username), {colleague} (the
 * username of some other employee).
 */
export interface ScenarioTaskStep {
  /** What the player reads: "Create the reports folder". */
  text: string;
  /** A command that does the step. Shown to humans as a hint; typed by bots. */
  run?: string;
  /** Regular expression a typed command must match to count. Required with `run`. */
  match?: string;
  /** The command must be typed in a shell ON this machine (e.g. after ssh). Default: anywhere. */
  host?: string;
  /** Name of a room on the map to go to. */
  visit?: string;
  /** How long to stay in that room. Default 5. */
  staySeconds?: number;
}

/** A small piece of ordinary work (DESIGN.md section 8). */
export interface ScenarioTask {
  id: string;
  title: string;
  /** Only players with one of these roles get it. Default: everyone. */
  roles?: string[];
  /** Only employees of one of these departments get it. Default: everyone. */
  departments?: string[];
  steps: ScenarioTaskStep[];
}

export interface ScenarioPlayer {
  id: string;
  name: string;
  account: string;
  desk: string;
  role?: string;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  domain: string;
  /** ISO time, e.g. "2026-03-02T09:00:00Z". */
  startTime: string;
  dhcp: {
    /** Hostname of the DHCP server (must have a staticIp). */
    server: string;
    /** First three numbers of the workstation network, e.g. "10.0.2". */
    subnet: string;
    rangeStart: number;
    rangeEnd: number;
    leaseHours: number;
    /** Old leases, to practise "who had this IP last week?". */
    history?: { hostname: string; ip: string; fromMinutesAgo: number; toMinutesAgo: number }[];
  };
  /** Hostname of the DNS server. Defaults to the DHCP server. */
  dnsServer?: string;
  /**
   * The door-badge system. `server` is the host that stores its logs
   * (/var/log/badge/). Without this block, doors still work but write no log files.
   */
  badgeSystem?: {
    server: string;
    /** Log name of the building's entrance door (as on the map), used for the previous day's arrivals. */
    entranceDoor?: string;
  };
  accounts: ScenarioAccount[];
  hosts: ScenarioHost[];
  /**
   * Internal email. `server` defaults to the DHCP server. `history` is old
   * mail already in people's inboxes when the game starts.
   */
  mail?: {
    server?: string;
    history?: { from: string; to: string[]; subject: string; body: string; minutesAgo: number }[];
  };
  /**
   * The simulated web. Every request goes through `proxy` (default: the DHCP
   * server) and is logged there. `sites` is the whole "internet": a name
   * that is not listed does not resolve. Use made-up names (".example").
   */
  web?: {
    proxy?: string;
    sites: { host: string; ip: string; title: string; category: string }[];
    /** The site workstations fetch updates from in the background (must be in `sites`). */
    updateSite?: string;
  };
  /**
   * The hacker's mission: where the flag is, and the weaknesses a match may
   * have. Each match switches on 2-4 of those described here (see
   * mission/mission.ts). Leave one out and it can never be chosen.
   */
  mission?: {
    flagHost: string;
    flagPath: string;
    /** The sysadmin uses this easy password instead of their normal one. */
    weakAdminPassword?: { account: string; password: string; strength: number };
    /** One of `candidates` is in group sudo on `hosts` (and on their own PC) by mistake. */
    extraSudo?: { candidates: string[]; hosts: string[] };
    /** A world-readable file on `host`; "{password}" in `content` becomes that host's root password. */
    plaintextPassword?: { host: string; path: string; content: string | string[]; ageMinutes?: number };
    /** The bot of this player (the sysadmin) forgets to lock its screen with probability `forgetLock`. */
    carelessAdmin?: { player: string; forgetLock: number };
    /** Code of the door that can be tailgated when this weakness is on, and is one-person otherwise. */
    tailgateDoor?: string;
  };
  players: ScenarioPlayer[];
  history?: ScenarioHistoryItem[];
  /** Job tasks handed to players and bots. */
  tasks?: ScenarioTask[];
}

/** Throws a readable error if the scenario is inconsistent. */
export function validateScenario(s: Scenario): void {
  const problems: string[] = [];
  const need = (ok: unknown, message: string) => {
    if (!ok) problems.push(message);
  };
  need(s.id && s.name && s.domain, 'id, name and domain are required');
  need(!Number.isNaN(Date.parse(s.startTime)), `startTime is not a valid date: ${s.startTime}`);
  need(Array.isArray(s.accounts) && s.accounts.length > 0, 'at least one account is required');
  need(Array.isArray(s.hosts) && s.hosts.length > 0, 'at least one host is required');

  const accounts = new Set((s.accounts ?? []).map((a) => a.username));
  const hosts = new Map((s.hosts ?? []).map((h) => [h.hostname, h]));
  need(accounts.size === (s.accounts ?? []).length, 'duplicate account usernames');
  need(hosts.size === (s.hosts ?? []).length, 'duplicate hostnames');
  for (const a of s.accounts ?? []) {
    need(/^[a-z_][a-z0-9_.-]*$/.test(a.username), `account "${a.username}": invalid username`);
    need(a.username !== 'root', 'do not list root as an account; use rootPassword on a host');
    need(typeof a.password === 'string' && a.password.length > 0, `account "${a.username}": password is required`);
  }

  const knowsUser = (h: ScenarioHost, u: string) => h.users === '*' || h.users.includes(u);
  for (const h of s.hosts ?? []) {
    const where = `host "${h.hostname}"`;
    need(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(h.mac ?? ''), `${where}: invalid MAC address`);
    if (h.users !== '*') for (const u of h.users) need(accounts.has(u), `${where}: unknown user "${u}"`);
    for (const u of [...(h.sudoers ?? []), ...(h.logReaders ?? []), ...(h.owner ? [h.owner] : [])]) {
      need(accounts.has(u) && knowsUser(h, u), `${where}: "${u}" must be an account that exists on this host`);
    }
    if (h.console) need(knowsUser(h, h.console.user) && accounts.has(h.console.user), `${where}: console user "${h.console.user}" does not exist here`);
    for (const f of h.files ?? []) need(f.path?.startsWith('/'), `${where}: file path must be absolute: ${f.path}`);
  }

  need(hosts.get(s.dhcp?.server)?.staticIp, 'dhcp.server must be a host with a staticIp');
  if (s.dnsServer) need(hosts.has(s.dnsServer), `dnsServer "${s.dnsServer}" is not a host`);
  if (s.badgeSystem) need(hosts.has(s.badgeSystem.server), `badgeSystem.server "${s.badgeSystem.server}" is not a host`);
  const badgeIds = (s.accounts ?? []).filter((a) => a.badge).map((a) => a.badge!.id);
  need(new Set(badgeIds).size === badgeIds.length, 'two accounts have the same badge id');
  for (const h of s.hosts ?? []) {
    if (h.headless) need(!h.console && !h.owner, `host "${h.hostname}": a headless host cannot have a console session or an owner`);
  }
  for (const p of s.players ?? []) {
    need(accounts.has(p.account), `player "${p.id}": unknown account "${p.account}"`);
    need(hosts.has(p.desk), `player "${p.id}": unknown desk "${p.desk}"`);
    need(!p.role || (ROLE_IDS as string[]).includes(p.role), `player "${p.id}": unknown role "${p.role}" (known: ${ROLE_IDS.join(', ')})`);
    need(!hosts.get(p.desk)?.headless, `player "${p.id}": desk "${p.desk}" is a headless host`);
  }
  for (const item of s.history ?? []) {
    const h = hosts.get(item.host);
    need(h, `history: unknown host "${item.host}"`);
    if (h) need(knowsUser(h, item.user) || item.type === 'ssh-fail', `history: user "${item.user}" does not exist on ${item.host}`);
    if (item.type.startsWith('ssh')) need(item.from && hosts.has(item.from), `history: ssh item needs a valid "from" host`);
  }

  if (s.mail?.server) need(hosts.has(s.mail.server), `mail.server "${s.mail.server}" is not a host`);
  for (const m of s.mail?.history ?? []) {
    for (const u of [m.from, ...m.to]) need(accounts.has(u), `mail history: unknown account "${u}"`);
  }
  if (s.web?.proxy) need(hosts.has(s.web.proxy), `web.proxy "${s.web.proxy}" is not a host`);
  if (s.web?.updateSite) need(s.web.sites.some((site) => site.host === s.web!.updateSite), `web.updateSite "${s.web.updateSite}" is not in web.sites`);

  if (s.mission) {
    const m = s.mission;
    need(hosts.has(m.flagHost) && m.flagPath?.startsWith('/'), 'mission: flagHost must be a host and flagPath an absolute path');
    if (m.weakAdminPassword) need(accounts.has(m.weakAdminPassword.account) && m.weakAdminPassword.password, 'mission.weakAdminPassword: unknown account or empty password');
    for (const u of m.extraSudo?.candidates ?? []) need(accounts.has(u), `mission.extraSudo: unknown account "${u}"`);
    for (const h of m.extraSudo?.hosts ?? []) need(hosts.has(h), `mission.extraSudo: unknown host "${h}"`);
    if (m.extraSudo) need(m.extraSudo.candidates.length > 0, 'mission.extraSudo needs at least one candidate');
    if (m.plaintextPassword) need(hosts.get(m.plaintextPassword.host)?.rootPassword && m.plaintextPassword.path?.startsWith('/'), 'mission.plaintextPassword: host must have a rootPassword and path must be absolute');
    if (m.carelessAdmin) need((s.players ?? []).some((p) => p.id === m.carelessAdmin!.player), `mission.carelessAdmin: unknown player "${m.carelessAdmin.player}"`);
  }

  const taskIds = new Set<string>();
  for (const t of s.tasks ?? []) {
    const where = `task "${t.id}"`;
    need(t.id && t.title, 'every task needs an id and a title');
    need(!taskIds.has(t.id), `${where}: duplicate id`);
    taskIds.add(t.id);
    need(Array.isArray(t.steps) && t.steps.length > 0, `${where}: needs at least one step`);
    for (const [i, step] of (t.steps ?? []).entries()) {
      const at = `${where}, step ${i + 1}`;
      need(step.text, `${at}: needs a text`);
      need((step.run !== undefined) !== (step.visit !== undefined), `${at}: needs either "run" or "visit"`);
      if (step.host) need(hosts.has(step.host), `${at}: unknown host "${step.host}"`);
      if (step.run !== undefined) {
        // The example command must satisfy the step's own pattern, or a bot would type it forever.
        const sample = (text: string) => text.replace(/\{date\}/g, '2026-01-01').replace(/\{n\}/g, '123').replace(/\{(user|colleague)\}/g, 'someone');
        let ok = false;
        try {
          ok = new RegExp(sample(step.match ?? '')).test(sample(step.run));
        } catch {
          ok = false;
        }
        need(step.match && ok, `${at}: "match" must be a regular expression that matches "run"`);
      }
    }
  }

  if (problems.length > 0) throw new Error(`Invalid scenario "${s.id ?? '?'}":\n- ${problems.join('\n- ')}`);
}
