/** Phase 4 D game items. Only the in-memory World is inspected or changed; no host I/O. */
import { findUser, shadowField } from '../auth/accounts';
import { openSession } from '../auth/sessions';
import { fail } from '../commands/types';
import { errText, readTracked } from '../commands/util';
import { emit } from '../events/log';
import { sysWrite } from '../fs/vfs';
import { resolveHost } from '../net/dns';
import { spawn } from '../proc/processes';
import { writeLoot, type ToolDefinition } from './toolkit';

const implant: ToolDefinition = {
  name: 'implant', summary: 'opens a shell through a live USB backdoor', usage: 'implant HOST [USER]',
  cooldownMs: 10_000, actionMs: () => 0, noise: 'low',
  traces: ['established connections on both hosts in ss -tnp', 'sysupd remote shell and implant client in ps aux', 'remote shell history on normal exit'],
  start(c, args) {
    if (args.length < 1 || args.length > 2) return fail('usage: implant HOST [USER]');
    if (c.piped) return fail('implant: an interactive shell needs the terminal');
    const target = resolveHost(c.world, args[0]);
    if (!target?.online) return fail('implant: host is not on the simulated network');
    const backdoors = c.world.toolkit.backdoors.filter((b) => b.host === target.hostname
      && (!args[1] || b.account === args[1])
      && target.processes.some((p) => p.pid === b.pid)
      && target.services.some((s) => s.pid === b.pid && s.port === b.port));
    if (backdoors.length === 0) return fail('implant: no live USB backdoor for that host/account');
    if (backdoors.length > 1) return fail('implant: more than one backdoor; specify USER');
    const b = backdoors[0];
    if (!findUser(target, b.account)) return fail('implant: the backdoor account no longer exists');
    const session = openSession(c.world, { host: target, user: b.account, kind: 'implant', from: c.host, parent: c.session, backdoor: b });
    c.terminal.stack.push(session.id);
    return { stdout: `Connected to ${target.hostname} as ${b.account} through port ${b.port}. Type exit to return.\n` };
  },
};

const keylogger: ToolDefinition = {
  name: 'keylogger', summary: 'records the next password typed at this PC by this account', usage: 'keylogger',
  cooldownMs: 60_000, actionMs: () => 0, noise: 'low',
  traces: ['a .input-helper process in ps aux', 'a private hidden capture file in /tmp'],
  start(c, args) {
    if (args.length) return fail('usage: keylogger (run on the PC to record)');
    if (c.host.headless) return fail('keylogger: this machine has no physical keyboard');
    const records = c.world.toolkit.keyloggers;
    if (records.some((k) => k.host === c.host.hostname && k.account === c.cred.user && !k.captured
      && c.host.processes.some((p) => p.pid === k.pid))) return fail('keylogger: a recorder is already waiting for this account');
    const proc = spawn(c.world, c.host, { user: c.cred.user, command: '/tmp/.input-helper', stat: 'Sl' });
    const path = `/tmp/.keys-${proc.pid}`;
    sysWrite(c.host, path, '', { owner: c.cred.user, group: c.cred.user, mode: 0o600, time: c.world.time });
    records.push({ host: c.host.hostname, account: c.cred.user, player: c.terminal.playerId, pid: proc.pid, path, captured: false });
    emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'keylogger.install', details: { pid: proc.pid, path } });
    return { stdout: `Recorder ${proc.pid} is waiting on ${c.host.hostname}. Read ${path} here after the next password entry.\n` };
  },
};

const crack: ToolDefinition = {
  name: 'crack', summary: 'decodes a stolen simulated shadow file in a background job', usage: 'crack FILE [USER]',
  cooldownMs: 30_000, actionMs: () => 0, noise: 'low',
  traces: ['a background process in ps aux', 'shadow file access in the audit log', 'a private result in ~/.tools/loot/'],
  start(c, args) {
    if (args.length < 1 || args.length > 2) return fail('usage: crack FILE [USER]');
    let content: string;
    try { content = readTracked(c, args[0]); } catch (e) { return fail(`crack: ${errText(e)}`); }
    const results: string[] = [];
    let durationMs = 0;
    for (const line of content.split('\n')) {
      const [user, field] = line.split(':');
      if (args[1] && args[1] !== user) continue;
      const m = /^\$6\$([^$]+)\$[./A-Za-z0-9]{86}$/.exec(field ?? '');
      if (!m) continue;
      // This is a game lookup, not a password attack: only exact fake hashes of scenario credentials qualify.
      const candidates = Object.entries(c.world.credentials).filter(([key]) => key === user || (user === 'root' && key.startsWith('root@')));
      const match = candidates.find(([, cred]) => shadowField(cred.password, m[1]) === field);
      if (!match) continue;
      results.push(`${user}:${match[1].password}`);
      durationMs = Math.max(durationMs, Math.max(30_000, match[1].strength * 6_000));
    }
    if (!results.length) return fail('crack: no matching simulated password hashes in the readable input');
    // Snapshot now: deleting/replacing the input or resetting a password cannot change an already running job.
    return {
      stdout: `Cracking in the background (about ${Math.ceil(durationMs / 1000)} game seconds). Results: ~/.tools/loot/crack-JOB.txt\n`,
      job: { durationMs, data: { result: results.join('\n') + '\n' } },
    };
  },
  finish(world, host, job) {
    return `wrote ${writeLoot(world, host, job, `crack-${job.id}.txt`, job.data?.result ?? '')}`;
  },
};

const scan: ToolDefinition = {
  name: 'scan', summary: 'lists online simulated hosts and listening services; raises an IDS alert', usage: 'scan [HOST]',
  cooldownMs: 60_000, actionMs: () => 0, noise: 'loud',
  traces: ['network-scan entry in /var/log/ids/alerts.log', 'security alert and a vague global banner', 'shell history'],
  start(c, args) {
    if (args.length > 1) return fail('usage: scan [HOST]');
    const target = args[0] ? resolveHost(c.world, args[0]) : undefined;
    if (args[0] && !target?.online) return fail('scan: host is not on the simulated network');
    const hosts = (target ? [target] : Object.values(c.world.hosts)).filter((h) => h.online && h.ip);
    const rows = hosts.sort((a, b) => a.hostname.localeCompare(b.hostname)).map((h) => {
      const services = h.services.filter((s) => h.processes.some((p) => p.pid === s.pid)).sort((a, b) => a.port - b.port);
      return `${h.hostname} ${h.ip} ${services.map((s) => `${s.port}/tcp ${s.program}`).join(', ') || '(no listening services)'}`;
    });
    emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.host.ip, type: 'network.scan', details: { target: target?.hostname ?? 'office', hosts: hosts.length } });
    return { stdout: 'HOST IP SERVICES\n' + rows.join('\n') + '\n' };
  },
};

export const remoteTools: ToolDefinition[] = [implant, keylogger, crack, scan];
