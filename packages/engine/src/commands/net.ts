/** Network commands: ip, ss, netstat, ping, nslookup. */
import { hashString, randInt } from '../core/rng';
import { emit } from '../events/log';
import { activeLease } from '../net/dhcp';
import { broadcastOf, fqdn, gatewayOf, networkOf, resolveHost } from '../net/dns';
import type { Host } from '../types';
import type { CmdCtx, Handler } from './types';
import { fail } from './types';
import { parseArgs } from './util';
import { phishingSite, visitPhishing } from '../tools/phishing';

const ip: Handler = (c, args) => {
  const what = args.find((a) => !a.startsWith('-')) ?? '';
  const h = c.host;
  if ('address'.startsWith(what) && what !== '') {
    const lease = activeLease(c.world, h.mac);
    const left = lease ? Math.max(0, Math.floor((lease.expires - c.world.time) / 1000)) : 0;
    const life = h.staticIp ? 'forever preferred_lft forever' : `${left}sec preferred_lft ${left}sec`;
    return {
      stdout:
        '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n' +
        '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n' +
        '    inet 127.0.0.1/8 scope host lo\n' +
        '       valid_lft forever preferred_lft forever\n' +
        '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n' +
        `    link/ether ${h.mac} brd ff:ff:ff:ff:ff:ff\n` +
        `    inet ${h.ip}/24 brd ${broadcastOf(h.ip)} scope global ${h.staticIp ? '' : 'dynamic '}eth0\n` +
        `       valid_lft ${life}\n`,
    };
  }
  if ('route'.startsWith(what) && what !== '') {
    return {
      stdout:
        `default via ${gatewayOf(h.ip)} dev eth0 proto ${h.staticIp ? 'static' : 'dhcp metric 100'}\n` +
        `${networkOf(h.ip)} dev eth0 proto kernel scope link src ${h.ip}\n`,
    };
  }
  if ('link'.startsWith(what) && what !== '') {
    return {
      stdout:
        '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\n' +
        '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n' +
        '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\n' +
        `    link/ether ${h.mac} brd ff:ff:ff:ff:ff:ff\n`,
    };
  }
  return fail('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | route }', 255);
};

/** Rows for ss/netstat: listening services first, then established connections. */
function sockets(c: CmdCtx, opts: string) {
  const listening = opts.includes('l') || opts.includes('a');
  const established = !opts.includes('l') || opts.includes('a');
  // Like the real tools, you only see process names for your own sockets unless you are root.
  const visible = (pid: number) => c.cred.user === 'root' || c.host.processes.find((p) => p.pid === pid)?.user === c.cred.user;
  const rows: { state: string; local: string; peer: string; pid: number; program: string; show: boolean }[] = [];
  if (listening) {
    for (const s of c.host.services) rows.push({ state: 'LISTEN', local: `0.0.0.0:${s.port}`, peer: '0.0.0.0:*', pid: s.pid, program: s.program, show: visible(s.pid) });
  }
  if (established) {
    for (const k of c.host.connections) rows.push({ state: 'ESTAB', local: `${k.localIp}:${k.localPort}`, peer: `${k.peerIp}:${k.peerPort}`, pid: k.pid, program: k.program, show: visible(k.pid) });
  }
  return rows;
}

const ss: Handler = (c, args) => {
  const opts = args.join('').replace(/-/g, '');
  const withProc = opts.includes('p');
  let out = `State    Recv-Q   Send-Q     Local Address:Port      Peer Address:Port  ${withProc ? 'Process' : ''}\n`;
  for (const r of sockets(c, opts)) {
    const proc = withProc && r.show ? ` users:(("${r.program}",pid=${r.pid},fd=${r.state === 'LISTEN' ? 3 : 4}))` : '';
    out += `${r.state.padEnd(8)} 0        ${r.state === 'LISTEN' ? '128' : '0  '}    ${r.local.padStart(18)} ${r.peer.padStart(22)} ${proc}`.trimEnd() + '\n';
  }
  return { stdout: out };
};

const netstat: Handler = (c, args) => {
  const opts = args.join('').replace(/-/g, '');
  const withProc = opts.includes('p');
  const servers = opts.includes('l') ? '(only servers)' : opts.includes('a') ? '(servers and established)' : '(w/o servers)';
  let out = '';
  if (withProc && c.cred.user !== 'root') {
    out += '(Not all processes could be identified, non-owned process info\n will not be shown, you would have to be root to see it all.)\n';
  }
  out += `Active Internet connections ${servers}\n`;
  out += `Proto Recv-Q Send-Q Local Address           Foreign Address         State      ${withProc ? ' PID/Program name' : ''}\n`;
  for (const r of sockets(c, opts)) {
    const state = r.state === 'ESTAB' ? 'ESTABLISHED' : 'LISTEN';
    const proc = withProc ? (r.show ? `${r.pid}/${r.program}` : '-') : '';
    out += `tcp        0      0 ${r.local.padEnd(23)} ${r.peer.padEnd(23)} ${state.padEnd(11)} ${proc}`.trimEnd() + '\n';
  }
  return { stdout: out };
};

/** Finds the machine a name or IP refers to ("localhost" is always this machine). */
export function lookup(c: CmdCtx, name: string): Host | undefined {
  if (name === 'localhost' || name === '127.0.0.1') return c.host;
  return resolveHost(c.world, name);
}

const ping: Handler = (c, args) => {
  const { values, rest } = parseArgs(args, 'ciWw');
  const name = rest[0];
  if (!name) return fail('ping: usage error: Destination address required', 2);
  const count = Math.min(Math.max(parseInt(values.c ?? '4', 10) || 4, 1), 20);
  const target = lookup(c, name);
  if (!target) return fail(`ping: ${name}: Name or service not known`, 2);
  emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'net.ping', details: { target: target.hostname, targetIp: target.ip } });

  const addr = name === 'localhost' ? '127.0.0.1' : target.ip;
  const label = /^\d+\.\d+\.\d+\.\d+$/.test(name) ? addr : `${name === 'localhost' ? 'localhost' : fqdn(c.world, target)} (${addr})`;
  let out = `PING ${name} (${addr}) 56(84) bytes of data.\n`;
  const times: number[] = [];
  if (target.online) {
    for (let seq = 1; seq <= count; seq++) {
      const ms = randInt(c.world, 180, 950) / 1000;
      times.push(ms);
      out += `64 bytes from ${label}: icmp_seq=${seq} ttl=64 time=${ms.toFixed(3)} ms\n`;
    }
  } else {
    for (let seq = 1; seq <= count; seq++) out += `From ${c.host.ip} icmp_seq=${seq} Destination Host Unreachable\n`;
  }
  out += `\n--- ${name} ping statistics ---\n`;
  const total = (count - 1) * 1001 + randInt(c.world, 1, 9);
  if (times.length === 0) {
    out += `${count} packets transmitted, 0 received, +${count} errors, 100% packet loss, time ${total}ms\n`;
    return { stdout: out, exit: 1 };
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const mdev = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / times.length);
  out += `${count} packets transmitted, ${count} received, 0% packet loss, time ${total}ms\n`;
  out += `rtt min/avg/max/mdev = ${Math.min(...times).toFixed(3)}/${avg.toFixed(3)}/${Math.max(...times).toFixed(3)}/${mdev.toFixed(3)} ms\n`;
  return { stdout: out };
};

const nslookup: Handler = (c, args) => {
  const name = args.find((a) => !a.startsWith('-'));
  if (!name) return fail('Usage: nslookup name');
  const dns = c.world.hosts[c.world.dnsServer];
  const header = `Server:\t\t${dns?.ip ?? '127.0.0.53'}\nAddress:\t${dns?.ip ?? '127.0.0.53'}#53\n\n`;
  const target = lookup(c, name);
  emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'dns.query', details: { name, found: !!target } });
  if (!target) return { stdout: `${header}** server can't find ${name}: NXDOMAIN\n\n`, exit: 1 };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
    // reverse lookup: IP -> name
    const arpa = name.split('.').reverse().join('.') + '.in-addr.arpa';
    return { stdout: `${header.trimEnd()}\n\n${arpa}\tname = ${fqdn(c.world, target)}.\n\n` };
  }
  return { stdout: `${header}Name:\t${fqdn(c.world, target)}\nAddress: ${target.ip}\n\n` };
};

/**
 * curl - fetch a page from the simulated web.
 *
 * There is no real network here: the "internet" is the list of sites in the
 * scenario. What matters is the evidence a request leaves behind: a line in
 * the DNS server's query log (who asked for which name) and a line in the
 * web proxy's access log (which PC and account fetched which URL, how big
 * the answer was).
 */
const curl: Handler = (c, args) => {
  const { flags, rest } = parseArgs(args, 'oAHdX');
  const raw = rest[0];
  if (!raw) return fail("curl: try 'curl URL'", 2);
  const url = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const match = /^(https?):\/\/([^/:]+)(?::\d+)?(\/.*)?$/i.exec(url);
  if (!match) return fail(`curl: (3) URL using bad/illegal format or missing URL`, 3);
  const [, scheme, name, path = '/'] = match;
  const base = { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp };

  const site = phishingSite(c.world, name) ?? c.world.web.sites.find((s) => s.host.toLowerCase() === name.toLowerCase());
  const internal = site ? undefined : lookup(c, name);
  emit(c.world, { ...base, type: 'dns.query', details: { name, found: !!(site ?? internal), ip: site?.ip ?? internal?.ip ?? '' } });
  if (!site && !internal) return fail(`curl: (6) Could not resolve host: ${name}`, 6);
  // A machine of the office that is not a web server.
  if (!site) return fail(`curl: (7) Failed to connect to ${name} port ${scheme === 'https' ? 443 : 80} after 2 ms: Connection refused`, 7);
  if (!c.world.web.proxyHost) return fail(`curl: (5) Could not resolve proxy`, 5);

  // Size and duration look random but depend only on the URL, so the same page is always the same size.
  const bytes = 2048 + (hashString(url) % 60000);
  const ms = 30 + (hashString(url, c.world.time & 0xffff) % 400);
  emit(c.world, { ...base, type: 'web.request', details: { method: flags.has('I') ? 'HEAD' : 'GET', url: `${scheme.toLowerCase()}://${site.host}${path}`, site: site.host, ip: site.ip, status: 200, bytes: flags.has('I') ? 0 : bytes, ms, category: site.category, agent: 'curl' } });

  if (flags.has('I')) return { stdout: `HTTP/1.1 200 OK\nServer: nginx\nContent-Type: text/html; charset=utf-8\nContent-Length: ${bytes}\nVia: 1.1 ${c.world.web.proxyHost} (squid)\n\n` };
  const reset = visitPhishing(c, url);
  if (reset !== null) return { stdout: reset };
  return { stdout: `<!doctype html>\n<html>\n<head><title>${site.title}</title></head>\n<body>\n<h1>${site.title}</h1>\n<p>${site.category} page ${path} (${bytes} bytes, simulated).</p>\n</body>\n</html>\n` };
};

export const netCommands: Record<string, Handler> = { ip, ss, netstat, ping, nslookup, curl };
