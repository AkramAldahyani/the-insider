/**
 * The post-match debrief (DESIGN.md section 11): what the hacker did, in
 * order, which evidence each step left, and which real-world technique it
 * imitates (MITRE ATT&CK, the public catalogue of attacker behaviour that
 * security teams use: https://attack.mitre.org).
 *
 * This file knows the simulated world only. The game server adds what people
 * did with the evidence: what was pinned, what was seen, what the cameras and
 * the bots saw (server/src/debrief.ts).
 *
 * Only call it when the match is over: it reads the ground truth.
 */
import { watchedFile } from '../security/alerts';
import { getNode } from '../fs/vfs';
import { isoSecond } from '../core/time';
import type { GameEvent, TraceLine, WeaknessId, World } from '../types';

export interface Technique {
  /** "T1021.004" */
  id: string;
  name: string;
}

/** One piece of evidence a step left. */
export interface DebriefEvidence {
  host: string;
  /** The file it is in, or the command that shows it ("last", "ps aux"). */
  where: string;
  text: string;
  /** It was written, but is no longer there (the log cleaner). */
  gone: boolean;
  /** How to recognise it in what somebody's screen showed (see `shows`). Never sent to a browser. */
  match: { time: string; needle: string; unique: string; tokens: string[] };
}

export interface DebriefStep {
  /** Master event ids (several when the same thing happened again right away). */
  events: number[];
  type: string;
  time: number;
  until: number;
  count: number;
  by: string;
  host: string;
  account: string;
  title: string;
  technique: Technique | null;
  /** One or two sentences: the real-world technique and how to spot it. */
  lesson: string;
  /** The command line that started it ("" when nothing was typed). */
  typed: string;
  /** False for things an honest employee also does (logging in to the server as oneself). */
  suspicious: boolean;
  /** Names of the security alerts it raised. */
  alerts: string[];
  /** The anti-stall rule pointed at it. */
  flagged: boolean;
  evidence: DebriefEvidence[];
}

// ───────────────────────────── The techniques ─────────────────────────────

const T = {
  guess: { id: 'T1110.001', name: 'Brute Force: Password Guessing' },
  crack: { id: 'T1110.002', name: 'Brute Force: Password Cracking' },
  account: { id: 'T1078.003', name: 'Valid Accounts: Local Accounts' },
  ssh: { id: 'T1021.004', name: 'Remote Services: SSH' },
  sudo: { id: 'T1548.003', name: 'Abuse Elevation Control Mechanism: Sudo and Sudo Caching' },
  shadow: { id: 'T1003.008', name: 'OS Credential Dumping: /etc/passwd and /etc/shadow' },
  local: { id: 'T1005', name: 'Data from Local System' },
  files: { id: 'T1552.001', name: 'Unsecured Credentials: Credentials In Files' },
  hardware: { id: 'T1200', name: 'Hardware Additions' },
  cron: { id: 'T1053.003', name: 'Scheduled Task/Job: Cron' },
  port: { id: 'T1571', name: 'Non-Standard Port' },
  keys: { id: 'T1056.001', name: 'Input Capture: Keylogging' },
  scan: { id: 'T1046', name: 'Network Service Discovery' },
  phish: { id: 'T1566.002', name: 'Phishing: Spearphishing Link' },
  click: { id: 'T1204.001', name: 'User Execution: Malicious Link' },
  clear: { id: 'T1070.002', name: 'Indicator Removal: Clear Linux or Mac System Logs' },
  copy: { id: 'T1570', name: 'Lateral Tool Transfer' },
  reset: { id: 'T1098', name: 'Account Manipulation' },
} satisfies Record<string, Technique>;

interface Described {
  title: string;
  technique: Technique | null;
  lesson: string;
  suspicious: boolean;
  /** Evidence outside the log files: what a command shows, with the words that must appear on one line. */
  extra?: { where: string; text: string; tokens: string[] }[];
}

const s = (v: unknown) => String(v ?? '');

/** What one event was, in words. Null = not worth a step. */
function describe(world: World, e: GameEvent, by: string, previous: GameEvent[]): Described | null {
  const player = world.players.find((p) => p.id === by);
  const own = player?.account ?? '';
  const d = e.details;
  const foreign = e.user !== own;
  const itRole = player?.role === 'sysadmin' || player?.role === 'helpdesk';
  const who = `account ${e.user}`;
  const login = { where: 'last (login history)', text: `${e.user} from ${s(e.sourceIp)}`, tokens: [e.user, 'pts/', s(e.sourceIp), isoSecond(e.time).slice(11, 16)] };

  switch (e.type) {
    case 'ssh.accept':
      return foreign
        ? { title: `Logged in to ${e.host} over ssh as ${e.user}`, technique: T.account, suspicious: true, extra: [login],
            lesson: 'A stolen password makes the attacker look like its owner. The account name lies; the SOURCE ADDRESS does not. Ask: does this person normally log in from that PC?' }
        : { title: `Logged in to ${e.host} over ssh with their own account`, technique: T.ssh, suspicious: false, extra: [login],
            lesson: 'Everybody is allowed to do this, so on its own it proves nothing. It becomes interesting together with what happened next in the same session.' };
    case 'ssh.fail':
      return { title: `Wrong password over ssh for ${e.user} on ${e.host}`, technique: T.guess, suspicious: foreign,
        lesson: 'Each wrong password is a line on the target machine, with the address it came from. Several in a row, for an account that is not the owner of that address, is guessing.' };
    case 'login.fail':
    case 'unlock.fail':
      return foreign
        ? { title: `Tried to get past the screen of ${e.host} as ${e.user}`, technique: T.guess, suspicious: true,
            lesson: 'A failed unlock is logged on that PC, but not who sat there. Compare it with the cameras, the badge log and what colleagues saw.' }
        : null;
    case 'login.success':
    case 'session.unlock':
      return foreign && d.via !== 'loginctl'
        ? { title: `Opened ${e.host} with the password of ${e.user}`, technique: T.account, suspicious: true,
            lesson: 'The log says the owner logged in. If the owner was seen somewhere else at that minute, somebody else knew the password.' }
        : null;
    case 'su.success':
      return { title: `Became ${s(d.to)} on ${e.host} with su`, technique: T.account, suspicious: true,
        lesson: 'su writes down who changed into whom. A regular employee becoming root is one of the strongest signs there is.' };
    case 'su.fail':
      return { title: `Failed to become ${s(d.to)} on ${e.host} with su`, technique: T.guess, suspicious: true,
        lesson: 'A failed su names the account that tried. Ordinary employees have no reason to try.' };
    case 'sudo.exec':
      return { title: `Ran a command as ${s(d.runAs)} on ${e.host} with sudo (${who})`, technique: T.sudo, suspicious: foreign || !itRole,
        lesson: 'sudo records the account and the full command line. Look for accounts that should not have sudo at all, and for IT accounts used from the wrong PC.' };
    case 'sudo.denied':
      return { title: `Tried sudo on ${e.host} without permission (${who})`, technique: T.sudo, suspicious: true,
        lesson: '"user NOT in sudoers" is logged for every attempt. Trying is already evidence.' };
    case 'sudo.fail':
      return foreign ? { title: `Wrong sudo password for ${e.user} on ${e.host}`, technique: T.guess, suspicious: true,
        lesson: 'Somebody was using this account without knowing its password.' } : null;
    case 'file.read': {
      const path = s(d.path);
      const watched = watchedFile(world, e.host, path);
      if (watched === 'shadow-read') return { title: `${d.denied ? 'Was refused' : 'Read'} the password file on ${e.host}`, technique: T.shadow, suspicious: true,
        lesson: '/etc/shadow holds the password hashes. The audit log records every read, with the login account (auid) even after su.' };
      if (watched === 'flag-read') return { title: `${d.denied ? 'Was refused' : 'Read'} the flag ${path} on ${e.host}`, technique: T.local, suspicious: true,
        lesson: 'The goal. The audit log keeps the ORIGINAL login account (auid), so becoming root does not hide who it was.' };
      if (d.denied || path.includes('/.tools/')) return null;
      const content = getNode(world.hosts[e.host], path)?.content ?? '';
      const secret = Object.entries(world.credentials).some(([account, c]) => account !== own && c.password.length >= 6 && content.includes(c.password));
      return secret ? { title: `Read a password out of ${path} on ${e.host}`, technique: T.files, suspicious: true,
        lesson: 'Passwords left in scripts and notes are found by anyone who looks. Reading a file leaves no log line here; the command is only in the shell history, which is written at logout.',
        extra: [{ where: '~/.bash_history (after logout)', text: path, tokens: [path] }] } : null;
    }
    case 'usb.insert':
      return { title: `Plugged a USB stick into ${e.host}`, technique: T.hardware, suspicious: true,
        lesson: 'A stick that pretends to be a keyboard types faster than any person. The kernel log shows a new keyboard appearing; no office PC should get one in the middle of the day.' };
    case 'backdoor.install':
      return { title: `Installed a backdoor on ${e.host} as ${e.user}`, technique: T.cron, suspicious: true,
        lesson: 'A hidden program, started again at every boot by a crontab line, listening on a port. Look for processes you do not know, @reboot lines and listening ports.',
        extra: [
          { where: 'ps aux', text: s(d.program), tokens: [s(d.program), e.user] },
          { where: 'crontab -l', text: `@reboot ${s(d.program)}`, tokens: ['@reboot', s(d.program)] },
          { where: 'ss -tlnp', text: `port ${s(d.port)} (sysupd)`, tokens: [`:${s(d.port)}`, 'sysupd'] },
        ] };
    case 'implant.connect':
      return { title: `Connected to the backdoor on ${e.host}`, technique: T.port, suspicious: true,
        lesson: 'No password was used, so no login is logged. The connection itself is visible on both PCs while it lasts.',
        extra: [{ where: 'ss -tnp', text: `connection to port ${s(d.port)}`, tokens: [`:${s(d.port)}`, 'sysupd'] }] };
    case 'keylogger.install':
      return { title: `Started a keyboard recorder on ${e.host} (${who})`, technique: T.keys, suspicious: true,
        lesson: 'It waits for the next password typed there. It needs a process and a file to write to, and both can be found.',
        extra: [
          { where: 'ps aux', text: '.input-helper', tokens: ['.input-helper'] },
          { where: 'ls -la /tmp', text: s(d.path), tokens: [s(d.path).split('/').pop() ?? ''] },
        ] };
    case 'keylogger.capture':
      return { title: `The recorder on ${e.host} caught a password of ${e.user}`, technique: T.keys, suspicious: true,
        lesson: 'From here on the attacker can be this person. Changing the password (helpdesk) would have taken it away again.' };
    case 'shoulder.surf': {
      const victim = world.players.find((p) => p.id === d.victim)?.name ?? s(d.victim);
      return { title: `Watched ${victim} type a password at ${e.host}`, technique: null, suspicious: true,
        lesson: 'No computer records who stands behind you (and ATT&CK has no entry for it). Cameras and the victim do: look around before you type.' };
    }
    case 'network.scan':
      return { title: `Scanned the network from ${e.host}`, technique: T.scan, suspicious: true,
        lesson: 'Asking every machine which services it offers is fast and loud. The intrusion detection log names the address and account that asked.' };
    case 'tool.run':
      return s(d.tool) === 'crack' ? { title: `Started cracking a copied password file on ${e.host}`, technique: T.crack, suspicious: true,
        lesson: 'Cracking happens on the attacker\'s own PC, so the target sees nothing. The evidence is the copy of the password file, and a busy process.',
        extra: [{ where: 'ps aux', text: 'crack', tokens: ['.tools/crack'] }] } : null;
    case 'scp.transfer':
      return { title: `Copied a file ${d.direction === 'upload' ? 'to' : 'from'} ${e.host} with scp (${who})`, technique: T.copy, suspicious: foreign || /shadow|keylogger|recorder|\.tools/.test(s(d.remotePath) + s(d.localPath)),
        lesson: 'scp logs in like ssh, so the target records the account and the address. The file name is only in the sender\'s shell history.' };
    case 'mail.send': {
      const mail = world.mail.messages.find((m) => m.id === d.id);
      return mail && mail.headerFrom !== mail.from ? { title: `Sent a fake "${mail.subject}" mail to ${mail.to.join(', ')}`, technique: T.phish, suspicious: true,
        lesson: 'The From line can say anything. The Received line and the SPF result are added by the mail server and tell where it really came from.' } : null;
    }
    case 'web.request':
      return { title: `${e.user} opened the fake reset page`, technique: T.click, suspicious: true,
        lesson: 'The victim did this, so it is logged under the victim\'s PC and account. The unknown web address is what to look for in the proxy and DNS logs.' };
    case 'phish.submit':
      return { title: `${e.user} gave their password to the fake reset page`, technique: T.click, suspicious: true,
        lesson: 'Never reset a password from a link in a mail. The real IT helpdesk does it in person.' };
    case 'log.clear':
      return { title: `Removed ${s(d.removed)} line(s) from ${s(d.path)} on ${e.host}`, technique: T.clear, suspicious: true,
        lesson: 'Cleaning a log leaves a hole and a "log cleared" marker. Missing evidence is evidence: compare with the logs of the OTHER machines, which still have their half of the story.' };
    case 'password.change':
      return { title: `Reset the password of ${e.user} from the helpdesk console`, technique: T.reset, suspicious: s(d.by) !== own,
        lesson: 'Both the helpdesk account and the address of its PC are logged. A reset nobody asked for means the helpdesk PC was open.' };
    case 'badge.tap':
      return d.granted ? null : { title: `Was refused at door ${s(d.door)}`, technique: null, suspicious: true,
        lesson: 'A refused badge names its owner. One is a mistake; several at the server room are not.' };
    case 'door.pass': {
      // Into a room the own badge does not open, right after somebody else's badge opened the door.
      if (d.direction !== 'IN') return null;
      const opened = previous.filter((p) => p.type === 'badge.tap' && p.details.door === d.door && p.details.granted && p.actor !== by).at(-1);
      const zone = s(opened?.details.zone);
      const { holders } = world.badges;
      const restricted = zone !== '' && Object.values(holders).some((h) => h.access.includes(zone));
      return opened && restricted && !(holders[own]?.access.includes(zone) ?? false)
        ? { title: `Slipped through door ${s(d.door)} behind someone else`, technique: null, suspicious: true,
          lesson: 'One granted badge but PASSAGES=2 in the door log: two people went in on one badge. The log cannot say who the second one was; the camera can.' } : null;
    }
    case 'mission.won':
      return { title: 'Handed in the flag', technique: null, suspicious: true, lesson: 'The match was won here. Everything above was the chance to stop it.' };
    default:
      return null;
  }
}

// ───────────────────────────── Recognising evidence on a screen ─────────────────────────────

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The SOURCE column of the SIEM for a log line, and the word its row must also contain ("" = the SIEM does not show this line). */
function siemRow(t: TraceLine, e: GameEvent): { source: string; subject: string } {
  const subject = e.user || e.sourceIp || '';
  switch (t.path) {
    case '/var/log/auth.log': return { source: 'auth', subject };
    case '/var/log/squid/access.log': return { source: 'proxy', subject };
    case '/var/log/mail.log': return { source: 'mail', subject };
    case '/var/log/badge/access.log': return { source: 'badge', subject };
    case '/var/log/ids/alerts.log': return { source: 'ids', subject: e.sourceIp ?? '' };
    case '/var/log/audit/audit.log': return { source: 'audit', subject: /key="([^"]+)"/.exec(t.line)?.[1] ?? '' };
    case '/var/log/security/alerts.log': return { source: 'alert', subject: s(e.details.rule) };
    case '/var/log/syslog':
    case '/var/log/kern.log':
      if (t.line.includes('[UFW ')) return { source: 'firewall', subject: e.sourceIp ?? '' };
      if (t.line.includes('New USB device found')) return { source: 'usb', subject: 'usb-insert' };
  }
  return { source: '', subject: '' };
}

/**
 * What identifies one log line when somebody looks at it. Different viewers
 * print the same line differently (cat, journalctl, dmesg, siem), so it is
 * recognised by its time of day plus its message, or, in a SIEM row, by time,
 * machine, source, and account, address or rule.
 */
function matcher(world: World, e: GameEvent, t: TraceLine): DebriefEvidence['match'] {
  const none = { time: '', needle: squeeze(t.line), unique: '', tokens: [] as string[] };
  const row = siemRow(t, e);
  const tokens = row.source && row.subject ? [isoSecond(e.time).slice(11), t.host, ` ${row.source} `, row.subject] : [];
  const audit = /audit\([\d.]+:\d+\)/.exec(t.line);
  if (audit) return { ...none, needle: audit[0], tokens };
  const m = /^[A-Z][a-z]{2} [ \d]\d (\d\d:\d\d:\d\d) \S+ [^:]+: (.*)$/.exec(t.line) // syslog style
    ?? /^\d{4}-\d\d-\d\d (\d\d:\d\d:\d\d) (.*)$/.exec(t.line) // most other logs
    ?? /^\d\d-[A-Z][a-z]{2}-\d{4} (\d\d:\d\d:\d\d)\.\d+ (.*)$/.exec(t.line); // DNS queries
  if (!m) return none;
  const kernel = /^\[ *\d+\.\d+\] (.*)$/.exec(m[2]);
  return {
    time: m[1],
    needle: squeeze(kernel ? kernel[1] : m[2]),
    unique: kernel ? squeeze(m[2]) : '', // dmesg prints no clock, but the seconds since boot are unique
    tokens,
  };
}

/** Does this line of a screen show this piece of evidence? */
export function shows(evidence: DebriefEvidence, screenLine: string): boolean {
  const { time, needle, unique, tokens } = evidence.match;
  const line = squeeze(screenLine);
  if (!line) return false;
  if (unique && line.includes(unique)) return true;
  if (needle && line.includes(needle) && (!time || line.includes(time))) return true;
  return tokens.length > 0 && tokens.every((k) => line.includes(k));
}

/** Like `shows`, for a pinned text: it may be several lines, wrapped by the terminal, or only the telling part of a line. */
export function pinShows(evidence: DebriefEvidence, pinned: string): boolean {
  if (shows(evidence, pinned) && evidence.match.needle !== '' && squeeze(pinned).includes(evidence.match.needle)) return true;
  return pinned.split('\n').some((line) => {
    const part = squeeze(line);
    return shows(evidence, line) || (part.length >= 20 && evidence.match.needle.includes(part));
  });
}

// ───────────────────────────── Building the debrief ─────────────────────────────

/** The same thing again within this time is one step ("3 times"). */
const REPEAT_MS = 2 * 60_000;
/** A command line belongs to what happened at most this long after it (a password question may come in between). */
const TYPED_MS = 60_000;

function evidenceOf(world: World, e: GameEvent, lines: TraceLine[]): DebriefEvidence[] {
  const out: DebriefEvidence[] = [];
  for (const t of lines) {
    // A mailbox is private; only the lines the mail server added are evidence.
    if (t.path.startsWith('/var/mail/') && !/^(Received: from|Authentication-Results:)/.test(t.line)) continue;
    if (out.some((x) => x.host === t.host && x.text === t.line)) continue; // kernel lines go to two files
    out.push({
      host: t.host, where: t.path, text: t.line,
      gone: !(getNode(world.hosts[t.host], t.path)?.content ?? '').includes(t.line),
      match: matcher(world, e, t),
    });
  }
  return out;
}

/** Everything the hacker did, oldest first. */
export function debriefSteps(world: World): DebriefStep[] {
  const steps: DebriefStep[] = [];
  const trail = new Map(world.mission.trail.map((t) => [t.event, t]));
  const typed = new Map<string, GameEvent>(); // player id -> last command line
  const recent: GameEvent[] = []; // badge taps of the last minute, for tailgating
  let last: DebriefStep | null = null;

  for (const e of world.events) {
    if (e.type === 'command' && e.actor) typed.set(e.actor, e);
    const entry = trail.get(e.id);
    const about = entry ? describe(world, e, entry.by, recent) : null;
    if (e.type === 'badge.tap') recent.push(e);
    while (recent.length > 0 && e.time - recent[0].time > 60_000) recent.shift(); // only the last minute matters
    if (!entry) continue;
    if (e.type === 'security.alert') {
      // Raised by the step just before it.
      if (last) {
        last.alerts.push(s(e.details.rule));
        last.evidence.push(...evidenceOf(world, e, entry.lines));
      }
      continue;
    }
    if (!about) {
      if (e.type !== 'tool.run' && e.type !== 'tool.done') last = null; // an alert after something unlisted belongs to nothing
      continue;
    }
    const evidence = evidenceOf(world, e, entry.lines);
    for (const x of about.extra ?? []) evidence.push({ host: e.host, where: x.where, text: x.text, gone: false, match: { time: '', needle: '', unique: '', tokens: x.tokens.filter(Boolean) } });
    const command = typed.get(entry.by);
    const step: DebriefStep = {
      events: [e.id], type: e.type, time: e.time, until: e.time, count: 1, by: entry.by, host: e.host, account: e.user,
      title: about.title, technique: about.technique, lesson: about.lesson, suspicious: about.suspicious,
      typed: e.origin !== 'system' && e.actor === entry.by && command && e.time - command.time <= TYPED_MS && !['usb.insert', 'backdoor.install', 'shoulder.surf', 'badge.tap', 'door.pass', 'keylogger.capture', 'mission.won'].includes(e.type)
        ? s(command.details.command).slice(0, 200) : '',
      alerts: [], flagged: world.mission.escalated.includes(e.id), evidence,
    };
    const same = steps.at(-1);
    if (same && same.title === step.title && same.by === step.by && step.time - same.until <= REPEAT_MS) {
      same.events.push(e.id);
      same.count++;
      same.until = e.time;
      same.flagged ||= step.flagged;
      same.evidence.push(...evidence.filter((x) => !same.evidence.some((y) => y.where === x.where && y.text === x.text)));
      last = same;
    } else {
      steps.push(step);
      last = step;
    }
  }

  // Using a PC somebody left open writes no log line at all; the engine keeps its own record (auth/unattended.ts).
  const hackers = new Set([...world.mission.trail.map((t) => t.by), ...(world.mission.hacker ? [world.mission.hacker] : [])]);
  for (const w of world.unattended) {
    for (const v of w.visitors) {
      if (!hackers.has(v.playerId) || v.playerId === w.ownerPlayer || w.ownerPlayer === null) continue;
      const owner = world.players.find((p) => p.id === w.ownerPlayer)?.name ?? w.account;
      steps.push({
        events: [], type: 'unattended.use', time: v.firstAt, until: v.lastAt, count: 1, by: v.playerId, host: w.host, account: w.account,
        title: `Sat down at ${w.host}, which ${owner} had left unlocked${v.lines > 0 ? ` (typed ${v.lines} line${v.lines === 1 ? '' : 's'})` : ''}`,
        technique: T.account, suspicious: true, typed: '', alerts: [], flagged: false, evidence: [],
        lesson: 'No password needed and nothing logged: everything typed there looks like the owner. Lock your screen (loginctl lock-session). Only cameras and colleagues can tell who sat there.',
      });
    }
  }
  return steps.sort((a, b) => a.time - b.time);
}

/** Today's weaknesses, in words. */
export function weaknessNotes(world: World): { id: WeaknessId; text: string }[] {
  const name = (account: string) => world.players.find((p) => p.account === account)?.name ?? account;
  const text: Record<WeaknessId, string> = {
    'weak-admin-password': 'The system administrator used a password that is easy to guess.',
    'extra-sudo': `${name(world.mission.extraSudoAccount)} (an ordinary employee) had been given sudo by mistake.`,
    'plaintext-password': 'An old script on the shared folder still contained the root password.',
    'careless-admin': `${world.players.find((p) => p.id === world.mission.carelessPlayer)?.name ?? 'The administrator'} often left the screen unlocked.`,
    tailgate: 'The server room door let a second person slip in behind the first.',
  };
  return world.mission.weaknesses.map((id) => ({ id, text: text[id] }));
}
