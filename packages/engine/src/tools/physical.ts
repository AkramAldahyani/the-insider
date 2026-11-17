/**
 * The hacker's PHYSICAL tools (DESIGN.md section 5): things done with hands
 * and eyes in the office rather than typed into a shell.
 *
 *  - The USB stick ("BadUSB"): plugged into an UNLOCKED PC, it pretends to be
 *    a keyboard and quickly sets up a small backdoor program for the logged-in
 *    user. Part D's remote tool connects to it. On a LOCKED PC it achieves
 *    nothing, but the machine still notices a device being plugged in.
 *  - Shoulder surfing: standing right behind someone while they type a
 *    password shows a few of its characters.
 *
 * The game server decides WHEN these happen (holding a key for 5 seconds,
 * standing in the right spot). This file decides WHAT they change in the
 * simulated world and WHICH EVIDENCE they leave. Everything is simulated:
 * the "backdoor" is a record, a process entry, a file and a listening port in
 * the game's own model of a Linux machine.
 *
 * Evidence left by the USB stick:
 *  - kernel lines in dmesg / journalctl -k / kern.log of that PC: a new USB
 *    keyboard, then its disconnection (also on a locked PC);
 *  - an odd process in `ps aux`, running as the logged-in user;
 *  - a port listening in `ss -tlnp`;
 *  - a hidden file in the user's home, and an @reboot line in their crontab;
 *  - (server side) the hacker is seen kneeling at the desk, by people and cameras.
 * Evidence left by shoulder surfing: being seen standing behind someone
 * (cameras, and bots remember it).
 */
import { emit, withActor } from '../events/log';
import { getNode, sysMkdir, sysWrite } from '../fs/vfs';
import { spawn } from '../proc/processes';
import { isoSecond } from '../core/time';
import type { World } from '../types';

const SECOND = 1000;
/** After using the stick, the hacker has to wait this long before the next try. */
export const USB_COOLDOWN_MS = 60 * SECOND;
/** The port the backdoor listens on is BASE + a small number, different per PC. */
const BACKDOOR_PORT_BASE = 4440;

/** Can this player use the USB stick now? Returns the seconds left, or 0 when ready. */
export function usbCooldown(world: World, playerId: string): number {
  const readyAt = world.toolkit.cooldowns[`${playerId}/usb`] ?? 0;
  return Math.max(0, Math.ceil((readyAt - world.time) / SECOND));
}

/** The session open on a PC's screen, if it is unlocked. */
function openSession(world: World, hostname: string) {
  const host = world.hosts[hostname];
  const id = host?.consoleSessionId;
  const session = id ? world.sessions[id] : undefined;
  return session && !session.locked && session.logoutTime === null ? session : undefined;
}

/**
 * The USB stick was plugged into a PC (after the 5 seconds of holding still).
 * Returns what the hacker sees as a result.
 */
export function plugUsb(world: World, hostname: string, playerId: string): { installed: boolean; text: string } {
  const host = world.hosts[hostname];
  if (!host) return { installed: false, text: 'There is no such PC.' };
  world.toolkit.cooldowns[`${playerId}/usb`] = world.time + USB_COOLDOWN_MS;
  const device = 2 + (world.toolkit.usbCount++ % 7);
  const session = openSession(world, hostname);

  return withActor(playerId, () => {
    // The kernel sees a new keyboard whether or not the screen is locked.
    emit(world, { host: hostname, user: session?.user ?? '', type: 'usb.insert', details: { device, vendor: '1b4f', product: '9208', name: 'USB Keyboard' } });
    if (!session) {
      emit(world, { host: hostname, user: '', type: 'usb.remove', details: { device } });
      return { installed: false, text: `${hostname} is locked: the stick typed into the lock screen and achieved nothing. (The PC still logged a USB device.)` };
    }
    const user = session.user;
    const already = world.toolkit.backdoors.find((b) => b.host === hostname && b.account === user && host.processes.some((p) => p.pid === b.pid));
    if (already) {
      emit(world, { host: hostname, user: '', type: 'usb.remove', details: { device } });
      return { installed: false, text: `${hostname} already has your backdoor for ${user} (port ${already.port}).` };
    }

    // What the stick "types": a small program saved in a hidden folder, started at once, and again at every boot.
    const home = `/home/${user}`;
    const dir = `${home}/.cache/.sysupd`;
    const program = `${dir}/sysupd`;
    const port = BACKDOOR_PORT_BASE + (world.toolkit.backdoors.length % 50);
    const opts = { owner: user, group: user, time: world.time };
    sysMkdir(host, dir, { ...opts, mode: 0o700 });
    sysWrite(host, program, '#!/bin/sh\n# sysupd - "system update helper" (a game item: simulated)\n', { ...opts, mode: 0o700 });
    const crontab = `/var/spool/cron/crontabs/${user}`;
    const cronOld = getNode(host, crontab)?.content ?? '';
    sysWrite(host, crontab, `${cronOld}${cronOld && !cronOld.endsWith('\n') ? '\n' : ''}@reboot ${program} -d\n`, { owner: user, group: 'crontab', mode: 0o600, time: world.time });
    const proc = spawn(world, host, { user, command: `${program} -d`, tty: '?', stat: 'Sl' });
    host.services.push({ port, program: 'sysupd', pid: proc.pid });
    const backdoor = { host: hostname, account: user, pid: proc.pid, port, installedAt: world.time, player: playerId };
    world.toolkit.backdoors.push(backdoor);
    emit(world, { host: hostname, user, type: 'backdoor.install', details: { pid: proc.pid, port, program, via: 'usb' } });
    emit(world, { host: hostname, user: '', type: 'usb.remove', details: { device } });
    return { installed: true, text: `Backdoor installed on ${hostname} for ${user} (listening on port ${port}). You can pull the stick out.` };
  }, hostname);
}

/**
 * The hacker watched someone type a password. `pattern` is what could be
 * seen ("R?y??h2??4!"); it is added to the hacker's loot, on their own PC.
 */
export function shoulderSurf(world: World, input: { hacker: string; victim: string; host: string; prompt: string; pattern: string }): void {
  const player = world.players.find((p) => p.id === input.hacker);
  const victim = world.players.find((p) => p.id === input.victim);
  const own = player && world.hosts[player.desk];
  if (!player || !own) return;
  const dir = `/home/${player.account}/.tools/loot`;
  const opts = { owner: player.account, group: player.account, time: world.time };
  sysMkdir(own, dir, { ...opts, mode: 0o700 });
  sysWrite(own, `${dir}/shoulder.txt`, `${isoSecond(world.time)} ${input.host} ${victim?.name ?? input.victim} at "${input.prompt.trim()}": ${input.pattern}\n`, { ...opts, mode: 0o600, append: true });
  // Master log only: nothing on any machine records where people stand. Cameras and witnesses might.
  withActor(input.hacker, () => emit(world, {
    host: input.host, user: '', type: 'shoulder.surf',
    details: { victim: input.victim, prompt: input.prompt.trim(), revealed: [...input.pattern].filter((ch) => ch !== '?').length, length: input.pattern.length },
  }), input.host);
}

/**
 * Which characters of a typed password a watcher catches: roughly 40 % of
 * them, at least one, chosen by `next` (a random number from 0 to 1).
 */
export function glimpse(text: string, next: () => number): string {
  if (text.length === 0) return '';
  const seen = [...text].map(() => next() < 0.4);
  if (!seen.includes(true)) seen[Math.floor(next() * text.length)] = true;
  return [...text].map((ch, i) => (seen[i] ? ch : '?')).join('');
}
