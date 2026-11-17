/**
 * Changing an employee's password on every machine at once (accounts are the
 * same everywhere in this office, as if a directory server held them).
 *
 * The new hash goes into /etc/shadow of every host that has the account, the
 * engine's secret list of passwords (`world.credentials`) is updated, and the
 * change is recorded:
 *  - a master event `password.change` (the server tells the employee their
 *    new password, and bots learn theirs);
 *  - an auth.log line on the directory host (the DHCP/admin server) naming
 *    the account that asked and the address it came from.
 * Sessions that are already open stay open, as on real Linux.
 */
import { DAY } from '../core/time';
import { hashString } from '../core/rng';
import { emit } from '../events/log';
import { getNode, sysWrite } from '../fs/vfs';
import type { World } from '../types';
import { shadowField } from './accounts';

const SALT_CHARS = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function changePassword(world: World, account: string, password: string, req: { by: string; sourceIp: string; via: string }): void {
  const day = Math.floor(world.time / DAY);
  for (const host of Object.values(world.hosts)) {
    const node = getNode(host, '/etc/shadow');
    if (!node?.content) continue;
    const lines = node.content.split('\n');
    const i = lines.findIndex((l) => l.split(':')[0] === account);
    if (i < 0) continue;
    // A fresh salt per host, made from the host and the time (no random numbers).
    let salt = '';
    let h = hashString(`${host.hostname}/${account}/${world.time}`);
    for (let k = 0; k < 16; k++) {
      salt += SALT_CHARS[h % 64];
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    }
    const fields = lines[i].split(':');
    fields[1] = shadowField(password, salt);
    fields[2] = String(day);
    lines[i] = fields.join(':');
    sysWrite(host, '/etc/shadow', lines.join('\n'), { owner: 'root', group: 'shadow', mode: 0o640, time: world.time });
  }
  const old = world.credentials[account];
  // A helpdesk password is a few words and a number: fairly strong (it matters for the hash cracker).
  world.credentials[account] = { password, strength: Math.max(60, old?.strength ?? 0) };
  emit(world, { host: world.dhcp.serverHost, user: account, sourceIp: req.sourceIp, type: 'password.change', details: { by: req.by, via: req.via } });
}
