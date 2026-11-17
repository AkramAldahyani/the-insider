/**
 * Security monitoring: a few simple rules that watch the master event log
 * and raise ALERTS, like the monitoring software a real company runs.
 *
 * DESIGN.md section 6: "Alerts become more frequent as the hacker
 * progresses, without revealing exact progress." The rules below fire on the
 * things an attack produces (a strange USB keyboard, repeated failed logins,
 * reading the password file, a new program listening on a port...), so the
 * further the hacker gets, the more alerts appear.
 *
 * Every alert becomes a line in /var/log/security/alerts.log on the security
 * server (root and group adm: the guard and the sysadmin can read it), with
 * the details an analyst needs. Separately, the game server shows EVERY
 * player a short, vague banner ("unusual activity detected") without any of
 * those details.
 *
 * Ordinary office life must not set them off: one mistyped password, normal
 * sudo by the sysadmin, or reading your own files raises nothing. A test runs
 * a full office of bots and checks exactly that.
 */
import { emit } from '../events/log';
import { isoSecond } from '../core/time';
import type { GameEvent, World } from '../types';

export type Severity = 'low' | 'medium' | 'high';

/** Files whose reading is recorded by the audit log and watched by the rules. */
export function watchedFile(world: World, host: string, path: string): 'shadow-read' | 'flag-read' | null {
  if (path === '/etc/shadow') return 'shadow-read';
  if (world.mission.flag && host === world.mission.flag.host && path === world.mission.flag.path) return 'flag-read';
  return null;
}

const AUTH_FAILURES = new Set(['ssh.fail', 'login.fail', 'unlock.fail', 'sudo.fail', 'su.fail']);
const MINUTE = 60_000;
/** The same rule for the same machine and account raises at most one alert in this time. */
const QUIET_MS = 5 * MINUTE;

/** Where alerts are written: the security server (or, without one, the flag's host). */
function alertHost(world: World): string {
  return world.badges.serverHost || world.mission.flag?.host || '';
}

function raise(world: World, rule: string, severity: Severity, about: GameEvent, summary: string): void {
  const host = alertHost(world);
  if (!host) return;
  // Not the same alert again and again while somebody keeps at it.
  const recent = [...world.events].reverse();
  for (const e of recent) {
    if (about.time - e.time > QUIET_MS) break;
    if (e.type === 'security.alert' && e.details.rule === rule && e.details.target === about.host && e.details.account === about.user && severity !== 'high') return;
  }
  emit(world, {
    host, user: '', sourceIp: about.sourceIp, type: 'security.alert',
    details: { rule, severity, target: about.host, account: about.user, summary },
  });
}

/**
 * The hacker's actions that the anti-stall rule may pick: each left a line in
 * some log, so an analyst can find it in the SIEM once pointed at it. Ordinary
 * things everybody does (logging in at the own desk, typing commands) are not
 * on the list; reading a file counts only for the watched files.
 */
const ESCALATION_TYPES = new Set([
  'ssh.accept', 'ssh.fail', 'su.success', 'su.fail', 'sudo.exec', 'sudo.fail', 'sudo.denied', 'unlock.fail', 'login.fail',
  'usb.insert', 'backdoor.install', 'implant.connect', 'keylogger.install', 'network.scan', 'scp.transfer', 'log.clear',
  'mail.send', 'tool.run', 'file.read',
]);

/**
 * ANTI-STALL (DESIGN.md section 1, "Match length"): called every few game
 * minutes by the game server. It takes the OLDEST real action of the hacker
 * that was not re-scored yet and raises it again as a HIGH alert, with the
 * facts its log line has (machine, account, source address, time). So a
 * long match slowly hands the defenders a trail to follow, from its start.
 * The alert never names a player: WHO was at the keyboard is still for the
 * investigators to work out. Returns the event it flagged, or null when the
 * hacker has done nothing new worth flagging (or there is no hacker).
 */
export function escalate(world: World): GameEvent | null {
  const hacker = world.mission.hacker;
  if (!hacker || world.noise.from === null) return null;
  const done = new Set(world.mission.escalated);
  const e = world.events.find((x) => x.actor === hacker && x.time >= world.noise.from! && !done.has(x.id) && ESCALATION_TYPES.has(x.type)
    && (x.type !== 'file.read' || (!x.details.denied && watchedFile(world, x.host, String(x.details.path)) !== null)));
  if (!e) return null;
  world.mission.escalated.push(e.id);
  const from = e.sourceIp ? ` from ${e.sourceIp}` : '';
  raise(world, 'threat-escalation', 'high', e, `earlier activity re-scored HIGH: ${e.type} on ${e.host} (account ${e.user || '-'}${from}) at ${isoSecond(e.time)}`);
  return e;
}

/** Called for every new master event (see events/log.ts). */
export function checkAlerts(world: World, e: GameEvent): void {
  if (e.type === 'security.alert' || world.noise.from === null) return; // nothing before the match starts
  const from = e.sourceIp ? ` from ${e.sourceIp}` : '';
  switch (e.type) {
    case 'network.scan':
      return raise(world, 'network-scan', 'medium', e, `network service scan from ${e.sourceIp} (${e.host}) towards ${String(e.details.target)}`);
    case 'usb.insert':
      return raise(world, 'usb-keyboard', 'low', e, `a new USB keyboard was plugged into ${e.host}`);
    case 'backdoor.install':
      return raise(world, 'new-listener', 'medium', e, `a new program started listening on port ${String(e.details.port)} on ${e.host} (as ${e.user})`);
    case 'sudo.denied':
      return raise(world, 'sudo-denied', 'low', e, `${e.user} tried to use sudo on ${e.host} without permission${from}`);
    case 'file.read': {
      const watched = watchedFile(world, e.host, String(e.details.path ?? ''));
      if (!watched) return;
      if (e.details.denied) return raise(world, `${watched}-denied`, 'low', e, `${e.user} tried to read ${String(e.details.path)} on ${e.host} and was refused${from}`);
      return raise(world, watched, watched === 'flag-read' ? 'high' : 'medium', e, `${String(e.details.path)} on ${e.host} was read as ${e.user} (login ${String(e.details.loginUser)})${from}`);
    }
    default:
      if (!AUTH_FAILURES.has(e.type)) return;
      // Three failures for the same account on the same machine within two minutes.
      let count = 0;
      for (let i = world.events.length - 1; i >= 0; i--) {
        const x = world.events[i];
        if (e.time - x.time > 2 * MINUTE) break;
        if (AUTH_FAILURES.has(x.type) && x.host === e.host && x.user === e.user) count++;
      }
      if (count >= 3) raise(world, 'auth-failures', 'medium', e, `${count} failed logins for ${e.user} on ${e.host} within 2 minutes${from}`);
  }
}
