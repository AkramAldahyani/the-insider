/**
 * The hacker's TRAIL: for every notable action of the hacker, the exact log
 * lines that action wrote. It is recorded while the match runs (see emit() in
 * log.ts) and read only after the match, by the debrief (debrief/debrief.ts).
 *
 * Why record it instead of working it out afterwards? Because the debrief must
 * show what was REALLY written, including lines the hacker removed later with
 * the log cleaner.
 *
 * Like `world.mission`, this is ground truth: it is never sent to a browser
 * while the match runs.
 */
import { watchAppends } from '../fs/vfs';
import type { GameEvent, TraceLine, World } from '../types';

/** Actions worth a line in the debrief. Ordinary office work (typing commands, browsing, mail) is not here. */
const NOTABLE = new Set([
  'ssh.accept', 'ssh.fail', 'su.success', 'su.fail', 'sudo.exec', 'sudo.denied', 'sudo.fail', 'login.success', 'login.fail',
  'session.unlock', 'unlock.fail', 'file.read', 'usb.insert', 'backdoor.install', 'implant.connect', 'keylogger.install',
  'keylogger.capture', 'shoulder.surf', 'network.scan', 'tool.run', 'tool.done', 'scp.transfer', 'mail.send', 'log.clear',
  'password.change', 'badge.tap', 'door.pass', 'security.alert', 'mission.won',
]);

/** Whose trail this event belongs on (a player id), or null. */
function trailOwner(world: World, e: GameEvent): string | null {
  const hacker = world.mission.hacker;
  if (!hacker || world.noise.from === null) return null;
  if (e.actor === hacker && NOTABLE.has(e.type)) return hacker;
  // The victim of a reset mail does these, but they are the hacker's work (and the evidence of it).
  if (e.type === 'phish.submit') return hacker;
  if (e.type === 'web.request' && world.toolkit.phishing.some((m) => m.url === e.details.url)) return hacker;
  return null;
}

/** Runs the step that writes an event's log lines and, if the event belongs on the trail, remembers those lines. */
export function recordTrail(world: World, e: GameEvent, writeLines: () => void): void {
  const by = trailOwner(world, e);
  if (by === null) return writeLines();
  const lines: TraceLine[] = [];
  watchAppends((host, path, text) => {
    if (!path.startsWith('/var/log/') && !path.startsWith('/var/mail/')) return;
    for (const line of text.split('\n')) if (line.trim()) lines.push({ host: host.hostname, path, line });
  }, writeLines);
  world.mission.trail.push({ event: e.id, by, lines });
}
