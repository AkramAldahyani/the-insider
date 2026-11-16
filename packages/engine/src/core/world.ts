/**
 * createWorld: turns a scenario (data) + a seed (number) into a full World.
 *
 * It works in two stages:
 *  1. BUILD every host: filesystem, /etc account files, home directories.
 *  2. REPLAY the past: boot each machine, hand out DHCP leases, and re-enact
 *     the scenario's "history" (old logins, failed logins, sudo use) in time
 *     order using the very same code the live game uses. That is why the old
 *     log lines look exactly like new ones - they were produced the same way.
 */
import { shadowField } from '../auth/accounts';
import { closeSession, lockConsole, openSession } from '../auth/sessions';
import { commandNames } from '../commands/index';
import { emit } from '../events/log';
import { getNode, sysMkdir, sysWrite } from '../fs/vfs';
import { dhcpRequest } from '../net/dhcp';
import { allocPid, bootProcesses } from '../proc/processes';
import type { Host, Session, World } from '../types';
import { advanceTo } from './clock';
import { syncAllUnattended } from '../auth/unattended';
import { sendMail } from '../commands/mail';
import { doorClosed, doorOpened, tapBadge } from '../physical/badges';
import { randInt, randString } from './rng';
import { validateScenario, type Scenario, type ScenarioAccount, type ScenarioHost } from './scenario';
import { DAY, HOUR, MINUTE } from './time';

const SALT_CHARS = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** System accounts present on every machine: [name, uid, gid, description, home, shell]. */
const SYSTEM_USERS: [string, number, number, string, string, string][] = [
  ['root', 0, 0, 'root', '/root', '/bin/bash'],
  ['daemon', 1, 1, 'daemon', '/usr/sbin', '/usr/sbin/nologin'],
  ['bin', 2, 2, 'bin', '/bin', '/usr/sbin/nologin'],
  ['sys', 3, 3, 'sys', '/dev', '/usr/sbin/nologin'],
  ['mail', 8, 8, 'mail', '/var/mail', '/usr/sbin/nologin'],
  ['nobody', 65534, 65534, 'nobody', '/nonexistent', '/usr/sbin/nologin'],
  ['systemd-network', 100, 102, 'systemd Network Management,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['systemd-resolve', 101, 103, 'systemd Resolver,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['messagebus', 102, 105, '', '/nonexistent', '/usr/sbin/nologin'],
  ['systemd-timesync', 103, 106, 'systemd Time Synchronization,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['syslog', 104, 111, '', '/home/syslog', '/usr/sbin/nologin'],
  ['sshd', 105, 65534, '', '/run/sshd', '/usr/sbin/nologin'],
  ['dhcpd', 110, 115, '', '/var/run', '/usr/sbin/nologin'],
  ['bind', 111, 116, '', '/var/cache/bind', '/usr/sbin/nologin'],
];

/** System groups: [name, gid]. "adm" and "sudo" get members from the scenario. */
const SYSTEM_GROUPS: [string, number][] = [
  ['root', 0], ['daemon', 1], ['bin', 2], ['sys', 3], ['adm', 4], ['tty', 5], ['mail', 8], ['sudo', 27],
  ['shadow', 42], ['users', 100], ['systemd-journal', 101], ['systemd-network', 102], ['systemd-resolve', 103],
  ['crontab', 104], ['messagebus', 105], ['systemd-timesync', 106], ['syslog', 111], ['utmp', 43], ['dhcpd', 115], ['bind', 116],
  ['nogroup', 65534],
];

const SUDOERS = `#
# This file MUST be edited with the 'visudo' command as root.
#
Defaults\tenv_reset
Defaults\tmail_badpass
Defaults\tsecure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

# User privilege specification
root\tALL=(ALL:ALL) ALL

# Allow members of group sudo to execute any command
%sudo\tALL=(ALL:ALL) ALL
`;

const text = (content: string | string[]) => (Array.isArray(content) ? content.join('\n') + '\n' : content);

// ───────────────────────────── Stage 1: build a host ─────────────────────────────

function buildHost(world: World, scenario: Scenario, sh: ScenarioHost, uids: Map<string, number>, t0: number): Host {
  const host: Host = {
    hostname: sh.hostname,
    mac: sh.mac.toLowerCase(),
    ip: sh.staticIp ?? '',
    staticIp: !!sh.staticIp,
    kind: sh.kind,
    headless: sh.headless ?? false,
    department: sh.department,
    location: sh.location,
    owner: sh.owner ?? null,
    online: false,
    bootTime: t0,
    fs: { type: 'dir', ino: 2, owner: 'root', group: 'root', mode: 0o755, mtime: t0, atime: t0, ctime: t0, children: {} },
    nextIno: 3,
    nextPid: 1,
    nextLogindId: 1,
    processes: [],
    connections: [],
    services: [],
    wtmp: [],
    journal: [],
    consoleSessionId: null,
  };
  const dir = (path: string, mode = 0o755, owner = 'root', group = 'root') => sysMkdir(host, path, { owner, group, mode, time: t0 });
  const file = (path: string, content: string, mode = 0o644, owner = 'root', group = 'root', time = t0) =>
    sysWrite(host, path, content, { owner, group, mode, time });

  // Standard Linux directory layout.
  for (const d of ['/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/media', '/mnt', '/opt', '/proc', '/run', '/sbin', '/srv', '/sys', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/share', '/var/lib', '/var/mail', '/var/spool', '/var/backups']) dir(d);
  dir('/root', 0o700);
  dir('/tmp', 0o1777); // world-writable + sticky: anyone can create, only owners can delete
  dir('/var/tmp', 0o1777);
  dir('/var/log', 0o775, 'root', 'syslog');
  dir('/var/spool/cron/crontabs', 0o1730, 'root', 'crontab');
  file('/dev/null', '', 0o666);

  // Every command exists as a file so `ls /usr/bin` and `file /usr/bin/ls` look right.
  for (const name of commandNames()) file(`/usr/bin/${name}`, '\x7fELF\x02\x01\x01', 0o755);

  // ── accounts ──
  const users: ScenarioAccount[] = sh.users === '*' ? scenario.accounts : scenario.accounts.filter((a) => sh.users.includes(a.username));
  const sudoers = sh.sudoers ?? [];
  const logReaders = sh.logReaders ?? [...new Set([...(sh.owner ? [sh.owner] : []), ...sudoers])];
  const days = Math.floor(t0 / DAY); // /etc/shadow stores "days since 1970" of the last password change

  let passwd = SYSTEM_USERS.map((u) => `${u[0]}:x:${u[1]}:${u[2]}:${u[3]}:${u[4]}:${u[5]}\n`).join('');
  let shadow = SYSTEM_USERS.map((u) => {
    if (u[0] !== 'root') return `${u[0]}:*:${days}:0:99999:7:::\n`;
    // "!" means the account is locked: nobody can log in as root with a password.
    const hash = sh.rootPassword ? shadowField(sh.rootPassword.password, randString(world, 16, SALT_CHARS)) : '!';
    return `root:${hash}:${days}:0:99999:7:::\n`;
  }).join('');
  let group = SYSTEM_GROUPS.map(([name, gid]) => {
    const members = name === 'adm' ? ['syslog', ...logReaders] : name === 'sudo' ? sudoers : [];
    return `${name}:x:${gid}:${members.join(',')}\n`;
  }).join('');
  if (sh.rootPassword) world.credentials[`root@${sh.hostname}`] = { ...sh.rootPassword };

  for (const a of users) {
    const uid = uids.get(a.username)!;
    passwd += `${a.username}:x:${uid}:${uid}:${a.fullName},,,:/home/${a.username}:/bin/bash\n`;
    shadow += `${a.username}:${shadowField(a.password, randString(world, 16, SALT_CHARS))}:${days}:0:99999:7:::\n`;
    group += `${a.username}:x:${uid}:\n`;

    const home = `/home/${a.username}`;
    dir(home, 0o750, a.username, a.username); // 750: other employees cannot look inside
    file(`${home}/.bashrc`, '# ~/.bashrc: executed by bash(1) for non-login shells.\nHISTCONTROL=ignoreboth\nHISTSIZE=1000\nHISTFILESIZE=2000\nalias ll=\'ls -alF\'\n', 0o644, a.username, a.username);
    file(`${home}/.profile`, '# ~/.profile: executed by the command interpreter for login shells.\nif [ -f "$HOME/.bashrc" ]; then\n    . "$HOME/.bashrc"\nfi\n', 0o644, a.username, a.username);
    file(`${home}/.bash_logout`, '# ~/.bash_logout: executed by bash(1) when login shell exits.\n', 0o644, a.username, a.username);
    const old = sh.bashHistory?.[a.username];
    if (old?.length) file(`${home}/.bash_history`, old.join('\n') + '\n', 0o600, a.username, a.username, t0 + 60 * DAY);
  }

  file('/etc/passwd', passwd);
  file('/etc/shadow', shadow, 0o640, 'root', 'shadow');
  file('/etc/group', group);
  file('/etc/sudoers', SUDOERS, 0o440);
  file('/etc/hostname', `${sh.hostname}\n`);
  file('/etc/hosts', `127.0.0.1\tlocalhost\n127.0.1.1\t${sh.hostname}.${scenario.domain}\t${sh.hostname}\n`);
  file('/etc/resolv.conf', `nameserver ${scenario.hosts.find((h) => h.hostname === (scenario.dnsServer ?? scenario.dhcp.server))?.staticIp ?? '127.0.0.53'}\nsearch ${scenario.domain}\n`);
  file('/etc/os-release', 'PRETTY_NAME="Ubuntu 22.04.4 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\nVERSION="22.04.4 LTS (Jammy Jellyfish)"\nID=ubuntu\nID_LIKE=debian\n');
  file('/etc/issue', 'Ubuntu 22.04.4 LTS \\n \\l\n\n');
  file('/etc/crontab', 'SHELL=/bin/sh\n# m h dom mon dow user\tcommand\n17 *\t* * *\troot\tcd / && run-parts --report /etc/cron.hourly\n25 6\t* * *\troot\ttest -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.daily; }\n');
  file('/etc/ssh/sshd_config', 'Include /etc/ssh/sshd_config.d/*.conf\nPort 22\nPermitRootLogin prohibit-password\nPasswordAuthentication yes\nUsePAM yes\nX11Forwarding yes\nPrintMotd no\nSubsystem\tsftp\t/usr/lib/openssh/sftp-server\n');
  file('/root/.bashrc', '# ~/.bashrc: executed by bash(1) for non-login shells.\n');
  file('/root/.profile', '# ~/.profile: executed by Bourne-compatible login shells.\n');
  // `last`, `who` and `w` read their data from the engine; these binary files exist for realism.
  file('/var/log/wtmp', '\x00\x00binary login records - read them with the `last` command\n', 0o664, 'root', 'utmp');
  file('/var/log/btmp', '', 0o660, 'root', 'utmp');

  for (const [user, tab] of Object.entries(sh.crontabs ?? {})) {
    file(`/var/spool/cron/crontabs/${user}`, text(tab), 0o600, user, 'crontab');
  }

  // ── scenario files ──
  for (const f of sh.files ?? []) {
    const homeOwner = /^\/home\/([^/]+)\//.exec(f.path)?.[1];
    const owner = f.owner ?? homeOwner ?? 'root';
    const fileGroup = f.group ?? (f.owner ? f.owner : (homeOwner ?? 'root'));
    const age = f.ageMinutes ?? randInt(world, 1 * 24 * 60, 20 * 24 * 60);
    const when = Date.parse(scenario.startTime) - age * MINUTE;
    // Missing parent folders are created with the same owner.
    const parent = f.path.slice(0, f.path.lastIndexOf('/')) || '/';
    if (!getNode(host, parent)) {
      let path = '';
      for (const part of parent.split('/').filter(Boolean)) {
        path += `/${part}`;
        if (!getNode(host, path)) sysMkdir(host, path, { owner, group: fileGroup, mode: 0o755, time: when });
      }
    }
    file(f.path, text(f.content), parseInt(f.mode ?? '644', 8), owner, fileGroup, when);
  }
  return host;
}

// ───────────────────────────── Stage 2: replay the past ─────────────────────────────

interface TimedAction {
  time: number;
  run: () => void;
}

function bootHost(world: World, host: Host): void {
  host.online = true;
  host.bootTime = world.time;
  bootProcesses(world, host);
  host.wtmp.push({ user: 'reboot', tty: 'system boot', from: '5.15.0-105-gener', login: world.time, logout: null, sessionId: null });
  emit(world, { host: host.hostname, user: 'root', type: 'host.boot', details: {} });
  if (!host.staticIp) dhcpRequest(world, host);
}

export function createWorld(scenario: Scenario, seed = 1): World {
  validateScenario(scenario);
  const start = Date.parse(scenario.startTime);
  const t0 = start - 90 * DAY; // "installation day" of all machines

  const world: World = {
    version: 1,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    domain: scenario.domain,
    seed,
    time: t0,
    rngState: seed >>> 0,
    hosts: {},
    dhcp: {
      serverHost: scenario.dhcp.server,
      prefix: `${scenario.dhcp.subnet}.`,
      rangeStart: scenario.dhcp.rangeStart,
      rangeEnd: scenario.dhcp.rangeEnd,
      leaseMs: scenario.dhcp.leaseHours * HOUR,
      leases: [],
    },
    dnsServer: scenario.dnsServer ?? scenario.dhcp.server,
    badges: {
      serverHost: scenario.badgeSystem?.server ?? '',
      holders: Object.fromEntries(scenario.accounts.filter((a) => a.badge).map((a) => [a.username, { id: a.badge!.id, access: a.badge!.access ?? [] }])),
    },
    unattended: [],
    mail: { serverHost: scenario.mail?.server ?? scenario.dhcp.server, messages: [] },
    web: {
      proxyHost: scenario.web ? (scenario.web.proxy ?? scenario.dhcp.server) : '',
      sites: (scenario.web?.sites ?? []).map((site) => ({ ...site })),
      updateSite: scenario.web?.updateSite ?? '',
    },
    noise: { from: null, done: start }, // switched on at the end of this function
    players: scenario.players.map((p) => ({ id: p.id, name: p.name, account: p.account, desk: p.desk, role: p.role ?? 'employee' })),
    credentials: {},
    events: [],
    sessions: {},
    terminals: {},
    counters: { event: 0, session: 0 },
  };

  const uids = new Map(scenario.accounts.map((a, i) => [a.username, a.uid ?? 1001 + i]));
  for (const a of scenario.accounts) world.credentials[a.username] = { password: a.password, strength: a.strength };
  for (const sh of scenario.hosts) world.hosts[sh.hostname] = buildHost(world, scenario, sh, uids, t0);

  // Old DHCP leases from the scenario (already ended).
  for (const h of [...(scenario.dhcp.history ?? [])].sort((a, b) => b.fromMinutesAgo - a.fromMinutesAgo)) {
    const host = world.hosts[h.hostname];
    if (!host) continue;
    const from = start - h.fromMinutesAgo * MINUTE;
    const to = start - h.toMinutesAgo * MINUTE;
    world.dhcp.leases.push({ ip: h.ip, mac: host.mac, hostname: host.hostname, start: from, end: to, lastRenew: from, expires: to });
  }

  // Collect everything that happened before the start, then run it in time order.
  const actions: TimedAction[] = [];
  const at = (minutesAgo: number, run: () => void) => actions.push({ time: start - minutesAgo * MINUTE, run });

  for (const sh of scenario.hosts) {
    const host = world.hosts[sh.hostname];
    at(sh.uptimeMinutes ?? 3 * 24 * 60, () => bootHost(world, host));
    if (sh.console) {
      const c = sh.console;
      at(c.loginMinutesAgo, () => {
        const session = openSession(world, { host, user: c.user, kind: 'console' });
        const id = `term-${host.hostname}`;
        world.terminals[id] = { id, host: host.hostname, playerId: null, stack: [session.id], parked: [], pending: null, notice: '' };
      });
      if (c.state === 'locked') at(Math.max(0, c.loginMinutesAgo - 3), () => lockConsole(world, host, { by: c.user, via: 'scenario' }));
    }
  }

  for (const item of scenario.history ?? []) {
    const host = world.hosts[item.host];
    const from = item.from ? world.hosts[item.from] : undefined;
    const endsAt = Math.max(0, item.minutesAgo - (item.durationMinutes ?? 30));
    if (item.type === 'ssh-session' || item.type === 'console-session') {
      let session: Session | undefined;
      at(item.minutesAgo, () => {
        session = openSession(world, { host, user: item.user, kind: item.type === 'ssh-session' ? 'ssh' : 'console', from });
        session.history.push(...(item.commands ?? []));
      });
      at(endsAt, () => session && closeSession(world, session));
    } else if (item.type === 'ssh-fail') {
      at(item.minutesAgo, () => {
        const conn = { port: randInt(world, 32768, 60999), pid: allocPid(world, host), fromHost: from!.hostname };
        const base = { host: host.hostname, user: item.user, sourceIp: from!.ip };
        const invalidUser = !getNode(host, `/home/${item.user}`);
        for (let n = 1; n <= (item.attempts ?? 1); n++) emit(world, { ...base, type: 'ssh.fail', details: { ...conn, invalidUser, attempt: n } });
        emit(world, { ...base, type: 'ssh.giveup', details: conn });
      });
    } else if (item.type === 'sudo') {
      at(item.minutesAgo, () => {
        const [name = 'true', ...rest] = (item.command ?? '').split(' ');
        emit(world, {
          host: host.hostname, user: item.user, type: 'sudo.exec',
          details: { tty: 'pts/0', cwd: `/home/${item.user}`, runAs: 'root', runAsUid: 0, uid: uids.get(item.user), command: [`/usr/bin/${name}`, ...rest].join(' ') },
        });
      });
    }
  }

  // Old mail, sent from each sender's own PC.
  for (const m of scenario.mail?.history ?? []) {
    at(m.minutesAgo, () => {
      const desk = scenario.hosts.find((h) => h.owner === m.from);
      const from = world.hosts[desk?.hostname ?? world.mail.serverHost];
      sendMail(world, { from: m.from, to: m.to, subject: m.subject, body: m.body, sourceHost: from.hostname, sourceIp: from.ip || '10.0.2.1' });
    });
  }

  // The last working day's arrivals and departures, so the badge log is not empty.
  const entrance = scenario.badgeSystem?.entranceDoor;
  if (entrance) {
    // Go back one day, and further over a weekend (0 = Sunday, 6 = Saturday).
    let day = start - (start % DAY) - DAY;
    while ([0, 6].includes(new Date(day).getUTCDay())) day -= DAY;
    for (const a of scenario.accounts) {
      if (!a.badge) continue;
      // Each employee gets their own habits, derived from the badge number
      // (not from the random generator, so adding a badge changes nothing else).
      const n = [...a.badge.id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 100003, 7);
      const through = (time: number, direction: 'IN' | 'OUT') => actions.push({
        time,
        run: () => {
          tapBadge(world, { door: entrance, zone: 'building', restricted: false, account: a.username, direction, actor: null });
          doorOpened(world, entrance);
          const openedAt = world.time;
          world.time += 3000; // the door closes 3 s later; write that line now and step back
          doorClosed(world, entrance, openedAt, 1);
          world.time = openedAt;
        },
      });
      through(day + 8 * HOUR + (5 + (n % 50)) * MINUTE + (n % 53) * 1000, 'IN');
      through(day + 17 * HOUR + ((n >> 3) % 45) * MINUTE + (n % 47) * 1000, 'OUT');
    }
  }

  // Stable sort: actions at the same minute keep the order they were listed in.
  actions.sort((a, b) => a.time - b.time);
  world.time = actions[0]?.time ?? start;
  for (const action of actions) {
    advanceTo(world, action.time);
    action.run();
  }
  advanceTo(world, start);

  // There is no auto-lock: a PC the scenario starts UNLOCKED stays open until
  // somebody locks it. Its owner "just walked away", which the record of
  // unattended PCs notes from the first second of play.
  syncAllUnattended(world);
  // Background noise starts with the match (see core/noise.ts for why not earlier).
  world.noise = { from: start, done: start };
  return world;
}
