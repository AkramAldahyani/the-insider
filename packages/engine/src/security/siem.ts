/**
 * The SIEM: one place to search the logs of every machine.
 *
 * A real SIEM collects log lines from all machines, splits each line into
 * named fields (who, from which address, what happened...) and lets an analyst
 * search them all at once. DESIGN.md section 7 gives the SOC analyst one, with
 * a small query language such as  `src_ip=10.0.2.37 | where bytes > 1MB`.
 *
 * This version reads the log FILES on the simulated machines when a query
 * runs, so it contains exactly what the logs contain: no ground truth, no
 * player names, nothing the master event list knows that the logs do not.
 * (A later log-cleaning tool would therefore also hide lines from it.)
 *
 * QUERY LANGUAGE
 *   field=value      exact match, * as a wildcard:   user=k.nasser   src_ip=10.0.2.*
 *   field!=value     everything else
 *   word             the raw line contains this word (any case)
 *   since=09:10 until=09:30   time range (today), or full "2026-03-02 09:10"
 * then any number of steps after a "|":
 *   | where FIELD OP VALUE    OP is = != > < >= <= or ~ (contains); sizes like 1MB / 300KB work
 *   | count by FIELD          how many records per value
 *   | fields a,b,c            show only these fields
 *   | sort FIELD / sort -FIELD
 *   | head N / tail N         first / last N records (default: last 30)
 */
import { getNode } from '../fs/vfs';
import type { World } from '../types';

export interface SiemRecord {
  /** Game time (ms). */
  time: number;
  host: string;
  /** Which log it came from: auth, proxy, dns, mail, dhcp, firewall, usb, audit, badge, door, alert, cctv. */
  source: string;
  /** The line as written in the log file. */
  raw: string;
  /** Named fields found in the line (src_ip, user, action, ...). Numbers are kept as text. */
  fields: Record<string, string>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IP = String.raw`\d+\.\d+\.\d+\.\d+`;

/** "Mar  2 09:12:01" has no year: take the current one, or the year before if that would be in the future. */
function syslogTime(world: World, text: string): number | null {
  const m = /^(\w{3}) +(\d+) (\d\d):(\d\d):(\d\d)/.exec(text);
  if (!m) return null;
  const year = new Date(world.time).getUTCFullYear();
  let t = Date.UTC(year, MONTHS.indexOf(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  if (t > world.time + 60_000) t = Date.UTC(year - 1, MONTHS.indexOf(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  return t;
}
/** "2026-03-02 09:12:01" */
const isoTime = (text: string) => {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(text);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
};

/** Pulls key=value pairs (KEY=VALUE as in badge and firewall lines) into fields, lower-cased keys. */
function keyValues(text: string, into: Record<string, string>): void {
  for (const m of text.matchAll(/\b([A-Z_]+)=(\S*)/g)) into[m[1].toLowerCase()] = m[2];
}

type Parser = (world: World, host: string, line: string) => SiemRecord | null;

/** A classic syslog line: "Mar  2 09:12:01 HOST program[pid]: message". */
function syslogParts(world: World, line: string): { time: number; program: string; message: string } | null {
  const time = syslogTime(world, line);
  const m = /^\w{3} +\d+ [\d:]+ \S+ ([^:\[]+)(?:\[\d+\])?\]?: (.*)$/.exec(line);
  return time === null || !m ? null : { time, program: m[1], message: m[2] };
}

const auth: Parser = (world, host, line) => {
  const p = syslogParts(world, line);
  if (!p || p.program === 'CRON') return null; // hourly cron sessions are noise, not security events
  const f: Record<string, string> = { program: p.program };
  const msg = p.message;
  const ip = new RegExp(`from (${IP})`).exec(msg) ?? new RegExp(`(${IP}) port`).exec(msg);
  if (ip) f.src_ip = ip[1];
  let m: RegExpExecArray | null;
  if ((m = /^Accepted password for (\S+)/.exec(msg))) Object.assign(f, { action: 'login', result: 'success', user: m[1] });
  else if ((m = /^Failed password for (invalid user )?(\S+)/.exec(msg))) Object.assign(f, { action: 'login', result: 'failure', user: m[2] }, m[1] ? { invalid: 'yes' } : {});
  else if ((m = /^Invalid user (\S+)/.exec(msg))) Object.assign(f, { action: 'login', result: 'invalid-user', user: m[1] });
  else if ((m = /^(\S+) : user NOT in sudoers/.exec(msg))) Object.assign(f, { action: 'sudo', result: 'denied', user: m[1] });
  else if ((m = /^(\S+) : (?:\d+ incorrect password attempts ; )?TTY=\S+ ; PWD=\S+ ; USER=(\S+) ; COMMAND=(.*)$/.exec(msg))) {
    Object.assign(f, { action: 'sudo', result: msg.includes('incorrect password') ? 'failure' : 'success', user: m[1], target_user: m[2], command: m[3] });
  } else if ((m = /^\(to (\S+)\) (\S+) on/.exec(msg))) Object.assign(f, { action: 'su', result: 'success', user: m[2], target_user: m[1] });
  else if ((m = /FAILED SU \(to (\S+)\) (\S+) on/.exec(msg))) Object.assign(f, { action: 'su', result: 'failure', user: m[2], target_user: m[1] });
  else if ((m = /session opened for user ([^\s(]+)/.exec(msg))) Object.assign(f, { action: 'session-open', user: m[1] });
  else if ((m = /session closed for user ([^\s(]+)/.exec(msg))) Object.assign(f, { action: 'session-close', user: m[1] });
  else if ((m = /Session \d+ of user (\S+?)\.? ?(locked|unlocked)/.exec(msg))) Object.assign(f, { action: m[2] === 'locked' ? 'lock' : 'unlock', user: m[1] });
  else if ((m = /^REMOTE (lock|unlock)-session: session \d+ of user (\S+) \w+ by (\S+) from/.exec(msg))) Object.assign(f, { action: `remote-${m[1]}`, user: m[3], target_user: m[2] });
  else if ((m = /authentication failure;.*?(?:user=(\S+))?$/.exec(msg))) Object.assign(f, { action: 'auth-failure' }, m[1] ? { user: m[1] } : {});
  else if ((m = /of user (\S+?)\.$/.exec(msg))) Object.assign(f, { action: 'session', user: m[1] });
  else return null; // other lines (keyring, logind housekeeping) are not indexed
  return { time: p.time, host, source: 'auth', raw: line, fields: f };
};

const kernel: Parser = (world, host, line) => {
  const p = syslogParts(world, line);
  if (!p) return null;
  if (p.message.includes('[UFW ')) {
    const f: Record<string, string> = { action: /\[UFW (\w+)\]/.exec(p.message)?.[1].toLowerCase() ?? 'allow' };
    keyValues(p.message, f);
    if (f.src) f.src_ip = f.src;
    if (f.dst) f.dst_ip = f.dst;
    if (f.dpt) f.dst_port = f.dpt;
    return { time: p.time, host, source: 'firewall', raw: line, fields: f };
  }
  const usb = /New USB device found, idVendor=(\w+), idProduct=(\w+)/.exec(p.message);
  if (usb && p.time > world.time - 80 * 24 * 3600_000 && !/usb usb\d/.test(p.message)) {
    return { time: p.time, host, source: 'usb', raw: line, fields: { action: 'usb-insert', vendor: usb[1], product: usb[2] } };
  }
  return null;
};

const syslogDhcp: Parser = (world, host, line) => {
  const p = syslogParts(world, line);
  const m = p && p.program === 'dhcpd' ? new RegExp(`^DHCPACK on (${IP}) to (\\S+) \\((\\S+)\\)`).exec(p.message) : null;
  return p && m ? { time: p.time, host, source: 'dhcp', raw: line, fields: { action: 'lease', ip: m[1], mac: m[2], client: m[3] } } : null;
};

const mail: Parser = (world, host, line) => {
  const p = syslogParts(world, line);
  if (!p) return null;
  const f: Record<string, string> = { program: p.program };
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`client=(\\S+?)\\.\\S*\\[(${IP})\\], sasl_username=(\\S+)`).exec(p.message))) Object.assign(f, { action: 'submit', client: m[1], src_ip: m[2], user: m[3] });
  else if ((m = /from=<([^@>]+)@[^>]*>, size=(\d+), nrcpt=(\d+)/.exec(p.message))) Object.assign(f, { action: 'queued', from: m[1], bytes: m[2], rcpt: m[3] });
  else if ((m = /to=<([^@>]+)@[^>]*>.*status=(\w+)/.exec(p.message))) Object.assign(f, { action: 'deliver', to: m[1], status: m[2] });
  else return null;
  const queue = /^([0-9A-F]{6,}):/.exec(p.message);
  if (queue) f.queue_id = queue[1];
  return { time: p.time, host, source: 'mail', raw: line, fields: f };
};

const proxy: Parser = (_world, host, line) => {
  // 2026-03-02 09:00:12 10.0.2.58 s.alharbi GET https://news.example/x 200 48418 120ms TCP_MISS DIRECT/203.0.113.31
  const m = new RegExp(`^(\\S+ \\S+) (${IP}) (\\S+) (\\S+) (\\S+) (\\d+) (\\d+) (\\d+)ms (\\S+) DIRECT/(${IP})$`).exec(line);
  const time = m && isoTime(m[1]);
  if (!m || time === null) return null;
  const domain = /^\w+:\/\/([^/:]+)/.exec(m[5])?.[1] ?? '';
  return { time, host, source: 'proxy', raw: line, fields: { src_ip: m[2], user: m[3], method: m[4], url: m[5], domain, status: m[6], bytes: m[7], ms: m[8], dst_ip: m[10] } };
};

const dns: Parser = (_world, host, line) => {
  // 02-Mar-2026 09:00:01.123 client 10.0.2.58#41234 (name): query: name IN A +E(0)K (10.0.1.10)
  const m = new RegExp(`^(\\d\\d)-(\\w{3})-(\\d{4}) (\\d\\d):(\\d\\d):(\\d\\d)\\.\\d+ client (${IP})#\\d+ \\(([^)]*)\\): query: \\S+ IN (\\w+)`).exec(line);
  if (!m) return null;
  const time = Date.UTC(+m[3], MONTHS.indexOf(m[2]), +m[1], +m[4], +m[5], +m[6]);
  return { time, host, source: 'dns', raw: line, fields: { src_ip: m[7], query: m[8], type: m[9] } };
};

/** "2026-03-02 09:00:01 KEY=value ..." lines (badge access, doors, camera motion, alerts). */
function isoLine(source: string, extra: (rest: string, f: Record<string, string>) => void): Parser {
  return (_world, host, line) => {
    const time = isoTime(line);
    if (time === null) return null;
    const rest = line.slice(20);
    const f: Record<string, string> = {};
    keyValues(rest, f);
    extra(rest, f);
    return { time, host, source, raw: line, fields: f };
  };
}
const badge = isoLine('badge', (_r, f) => {
  if (f.result) f.result = f.result.toLowerCase();
});
const door = isoLine('door', (_r, f) => {
  if (f.event) f.action = f.event.toLowerCase();
});
const cctv = isoLine('cctv', (rest, f) => {
  const m = /^(\S+) MOTION persons=(\d+) snapshot=(\S+)/.exec(rest);
  if (m) Object.assign(f, { camera: m[1], persons: m[2], snapshot: m[3] });
});
const alert = isoLine('alert', (rest, f) => {
  const m = /^\[(\w+)\] (\S+) (.*)$/.exec(rest);
  if (m) Object.assign(f, { severity: m[1].toLowerCase(), rule: m[2], message: m[3] });
  const ip = new RegExp(`from (${IP})`).exec(rest);
  if (ip) f.src_ip = ip[1];
});

const audit: Parser = (_world, host, line) => {
  const m = /^type=SYSCALL msg=audit\((\d+)\.(\d+):\d+\): .*success=(\w+).* auid=(\d+) uid=(\d+).* comm="([^"]*)".* key="([^"]*)"/.exec(line);
  if (!m) return null;
  return { time: Number(m[1]) * 1000 + Number(m[2]), host, source: 'audit', raw: line, fields: { result: m[3] === 'yes' ? 'success' : 'failure', auid: m[4], uid: m[5], command: m[6], key: m[7] } };
};

/** Which files are collected, and how each is read. */
const FILES: [string, Parser][] = [
  ['/var/log/auth.log', auth],
  ['/var/log/kern.log', kernel],
  ['/var/log/syslog', syslogDhcp],
  ['/var/log/mail.log', mail],
  ['/var/log/squid/access.log', proxy],
  ['/var/log/named/queries.log', dns],
  ['/var/log/badge/access.log', badge],
  ['/var/log/badge/doors.log', door],
  ['/var/log/cctv/motion.log', cctv],
  ['/var/log/security/alerts.log', alert],
  ['/var/log/audit/audit.log', audit],
];

/** Every record the SIEM knows, oldest first. Reads the files now (the SIEM has its own collector: no user permissions apply). */
export function collect(world: World): SiemRecord[] {
  const out: SiemRecord[] = [];
  for (const host of Object.values(world.hosts)) {
    for (const [path, parse] of FILES) {
      const content = getNode(host, path)?.content;
      if (!content) continue;
      for (const line of content.split('\n')) {
        if (!line) continue;
        const record = parse(world, host.hostname, line);
        if (record) out.push(record);
      }
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

// ───────────────────────────── The query language ─────────────────────────────

/** "1MB" -> 1048576; plain numbers stay numbers; anything else -> NaN. */
export function sizeValue(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?$/i.exec(text.trim());
  if (!m) return NaN;
  const unit = (m[2] ?? '').toLowerCase()[0];
  return Number(m[1]) * (unit === 'k' ? 1024 : unit === 'm' ? 1024 ** 2 : unit === 'g' ? 1024 ** 3 : 1);
}

/** The value of a field of a record ("time", "host", "source" and "raw" are fields too). */
function field(r: SiemRecord, name: string): string {
  if (name === 'time') return new Date(r.time).toISOString().slice(0, 19).replace('T', ' ');
  if (name === 'host' || name === 'source' || name === 'raw') return r[name];
  return r.fields[name] ?? '';
}

function wildcard(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
}

function compare(value: string, op: string, wanted: string): boolean {
  if (op === '~') return value.toLowerCase().includes(wanted.toLowerCase());
  if (op === '=') return wildcard(wanted).test(value);
  if (op === '!=') return !wildcard(wanted).test(value);
  const a = sizeValue(value);
  const b = sizeValue(wanted);
  const [x, y] = Number.isNaN(a) || Number.isNaN(b) ? [value, wanted] : [a, b];
  return op === '>' ? x > y : op === '<' ? x < y : op === '>=' ? x >= y : op === '<=' ? x <= y : false;
}

/** "09:10" (today, game time) or "2026-03-02 09:10". */
function parseWhen(world: World, text: string): number | null {
  const day = new Date(world.time).toISOString().slice(0, 10);
  const full = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/.test(text) ? text : /^\d\d?:\d\d(:\d\d)?$/.test(text) ? `${day} ${text.padStart(5, '0')}` : null;
  if (!full) return null;
  const t = Date.parse(`${full.replace(' ', 'T')}${full.length <= 16 ? ':00' : ''}Z`);
  return Number.isNaN(t) ? null : t;
}

export interface SiemResult {
  /** Text to print. */
  text: string;
  /** Number of records that matched the filters. */
  matched: number;
  error?: string;
}

/** Runs a query and returns what to print. */
export function siemQuery(world: World, query: string): SiemResult {
  const [head, ...steps] = query.split('|').map((s) => s.trim());
  let records = collect(world);

  // 1. Filters before the first "|".
  for (const token of head.match(/"[^"]*"|\S+/g) ?? []) {
    const m = /^([a-z_]+)(!=|=|>=|<=|>|<|~)(.+)$/i.exec(token);
    if (m && (m[1] === 'since' || m[1] === 'until')) {
      const t = parseWhen(world, m[3].replace(/"/g, ''));
      if (t === null) return { text: '', matched: 0, error: `siem: cannot read the time "${m[3]}" (use 09:10 or "2026-03-02 09:10")` };
      records = records.filter((r) => (m[1] === 'since' ? r.time >= t : r.time <= t));
    } else if (m) {
      const [, name, op, value] = m;
      records = records.filter((r) => compare(field(r, name.toLowerCase()), op, value.replace(/"/g, '')));
    } else {
      const word = token.replace(/"/g, '').toLowerCase();
      records = records.filter((r) => r.raw.toLowerCase().includes(word));
    }
  }
  const matched = records.length;

  // 2. Pipeline steps.
  let shown: string[] | null = null; // chosen fields
  let limit: { from: 'head' | 'tail'; n: number } = { from: 'tail', n: 30 };
  for (const step of steps) {
    const [verb, ...rest] = step.split(/\s+/);
    const args = rest.join(' ');
    if (verb === 'where') {
      const m = /^([a-z_]+)\s*(!=|=|>=|<=|>|<|~)\s*(.+)$/i.exec(args);
      if (!m) return { text: '', matched, error: `siem: "where" needs FIELD OP VALUE, e.g. | where bytes > 1MB` };
      records = records.filter((r) => compare(field(r, m[1].toLowerCase()), m[2], m[3].replace(/"/g, '')));
    } else if (verb === 'count') {
      const by = /^by\s+([a-z_]+)$/i.exec(args)?.[1]?.toLowerCase();
      if (!by) return { text: `${records.length}\n`, matched };
      const counts = new Map<string, number>();
      for (const r of records) counts.set(field(r, by) || '-', (counts.get(field(r, by) || '-') ?? 0) + 1);
      const rows = [...counts].sort((a, b) => b[1] - a[1]);
      return { text: `${'COUNT'.padStart(6)}  ${by.toUpperCase()}\n${rows.map(([v, n]) => `${String(n).padStart(6)}  ${v}`).join('\n')}\n`, matched };
    } else if (verb === 'fields') {
      shown = args.split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase());
    } else if (verb === 'sort') {
      const desc = args.startsWith('-');
      const name = args.replace(/^-/, '').toLowerCase();
      const num = (r: SiemRecord) => sizeValue(field(r, name));
      records = [...records].sort((a, b) => {
        const [x, y] = [num(a), num(b)];
        const c = !Number.isNaN(x) && !Number.isNaN(y) ? x - y : field(a, name).localeCompare(field(b, name));
        return desc ? -c : c;
      });
    } else if (verb === 'head' || verb === 'tail') {
      limit = { from: verb, n: Math.max(1, Math.min(500, Number(args) || 10)) };
    } else {
      return { text: '', matched, error: `siem: unknown step "${verb}" (try: where, count by, fields, sort, head, tail)` };
    }
  }
  const total = records.length;
  records = limit.from === 'head' ? records.slice(0, limit.n) : records.slice(-limit.n);
  if (records.length === 0) return { text: 'No matching records.\n', matched };

  const lines = records.map((r) => {
    if (shown) return shown.map((name) => field(r, name) || '-').join('  ');
    const time = field(r, 'time').slice(11);
    const summary = Object.entries(r.fields).filter(([k]) => k !== 'program' && k !== 'message').map(([k, v]) => `${k}=${v}`).join(' ');
    return `${time} ${r.host.padEnd(13)} ${r.source.padEnd(8)} ${summary || r.raw}`;
  });
  const header = shown ? `${shown.map((s) => s.toUpperCase()).join('  ')}\n` : `TIME     HOST          SOURCE   FIELDS\n`;
  const footer = total > records.length ? `(${records.length} of ${total} shown; add | head N or | tail N for more)\n` : '';
  return { text: header + lines.join('\n') + '\n' + footer, matched };
}

export const SIEM_HELP = `siem - search the logs of every machine at once

  siem QUERY

Filters (all must match):
  field=value      exact, * is a wildcard     user=k.nasser   src_ip=10.0.2.*
  field!=value     not equal                  result!=success
  word             the raw line contains it   Failed
  since=09:10 until=09:40                     time range (today)
Then steps, each after a "|":
  | where FIELD OP VALUE    OP: = != > < >= <= ~(contains); sizes: 300KB, 1MB
  | count by FIELD          | fields a,b,c   | sort -FIELD   | head N   | tail N

Sources and their fields (every record also has time, host, source, raw):
  auth      action(login, sudo, su, lock, unlock, ...) result user target_user src_ip command
  proxy     src_ip user method url domain status bytes ms dst_ip
  dns       src_ip query type
  mail      action user from to src_ip client bytes queue_id
  dhcp      ip mac client          (which machine had which address)
  firewall  src_ip dst_ip dst_port
  usb       vendor product
  audit     key(shadow-read, flag-read) result auid uid command
  badge     door badge user result dir
  door      door action passages
  cctv      camera persons snapshot
  alert     severity rule message src_ip

Examples:
  siem source=auth result=failure | count by user
  siem source=proxy | where bytes > 1MB
  siem src_ip=10.0.2.71 since=09:00
  siem source=badge door=SRV-ROOM | fields time,user,result,dir
`;
