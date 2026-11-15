/**
 * The shape of a scenario file (scenarios/*.json) and a validator for it.
 *
 * A scenario is pure content: which machines exist, who works there, their
 * passwords, their files, and some past activity so logs are not empty.
 * New offices can be added without touching engine code.
 */

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
  /** Auto-lock time for this machine only (overrides the scenario's). 0 = this screen never locks itself. */
  autoLockSeconds?: number;
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
  /**
   * A screen locks itself after this many seconds without input at its own
   * keyboard. Default 60. 0 = never. A host can override it.
   */
  autoLockSeconds?: number;
  /** Hostname of the DNS server. Defaults to the DHCP server. */
  dnsServer?: string;
  accounts: ScenarioAccount[];
  hosts: ScenarioHost[];
  players: ScenarioPlayer[];
  history?: ScenarioHistoryItem[];
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
  for (const p of s.players ?? []) {
    need(accounts.has(p.account), `player "${p.id}": unknown account "${p.account}"`);
    need(hosts.has(p.desk), `player "${p.id}": unknown desk "${p.desk}"`);
  }
  for (const item of s.history ?? []) {
    const h = hosts.get(item.host);
    need(h, `history: unknown host "${item.host}"`);
    if (h) need(knowsUser(h, item.user) || item.type === 'ssh-fail', `history: user "${item.user}" does not exist on ${item.host}`);
    if (item.type.startsWith('ssh')) need(item.from && hosts.has(item.from), `history: ssh item needs a valid "from" host`);
  }

  if (problems.length > 0) throw new Error(`Invalid scenario "${s.id ?? '?'}":\n- ${problems.join('\n- ')}`);
}
