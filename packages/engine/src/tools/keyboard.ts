/** Captures one masked input from a simulated PC keyboard, never the user's real keyboard. */
import { isoSecond } from '../core/time';
import { emit, withActor } from '../events/log';
import { getNode, sysWrite } from '../fs/vfs';
import { removeProcess } from '../proc/processes';
import type { Pending, Terminal, World } from '../types';

export function recordPassword(world: World, terminal: Terminal, pending: Pending, text: string): void {
  if (!pending.masked) return;
  const host = world.hosts[terminal.host];
  const console = world.sessions[terminal.stack[0]];
  const account = pending.kind === 'login-pass' ? String(pending.data.user) : console?.user;
  for (const k of world.toolkit.keyloggers) {
    if (k.host !== host.hostname || k.captured || (k.account !== 'root' && k.account !== account)) continue;
    if (!host.processes.some((p) => p.pid === k.pid)) continue;
    // Removing the capture file disables this recorder too; do not recreate a defender's deleted evidence.
    const file = getNode(host, k.path);
    if (file?.type !== 'file' || file.owner !== k.account) continue;
    sysWrite(host, k.path, `${isoSecond(world.time)} ${pending.prompt.trim()} ${text}\n`, { owner: k.account, group: k.account, mode: 0o600, time: world.time });
    k.captured = true;
    removeProcess(host, k.pid);
    // Password text belongs only in the private capture file, never in events or global alerts.
    withActor(k.player, () => emit(world, { host: host.hostname, user: k.account, type: 'keylogger.capture', details: { pid: k.pid, path: k.path } }));
  }
}
