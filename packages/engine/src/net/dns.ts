/**
 * Simple internal DNS: hosts can be reached by IP, by short hostname
 * ("FIN-LT-07") or by full name ("FIN-LT-07.nexora.local"). Names are not
 * case-sensitive, like real DNS.
 */
import type { Host, World } from '../types';

export function fqdn(world: World, host: Host): string {
  return `${host.hostname}.${world.domain}`;
}

export function resolveHost(world: World, name: string): Host | undefined {
  const wanted = name.toLowerCase().replace(/\.$/, '');
  const suffix = `.${world.domain.toLowerCase()}`;
  const short = wanted.endsWith(suffix) ? wanted.slice(0, -suffix.length) : wanted;
  for (const host of Object.values(world.hosts)) {
    if (!host.ip) continue; // not on the network yet
    if (host.ip === wanted || host.hostname.toLowerCase() === short) return host;
  }
  if (wanted === 'localhost' || wanted === '127.0.0.1') return undefined; // handled by callers
  return undefined;
}

/** Default gateway of the subnet an IP is in ("10.0.2.37" -> "10.0.2.1"). */
export function gatewayOf(ip: string): string {
  return ip.split('.').slice(0, 3).join('.') + '.1';
}

export function broadcastOf(ip: string): string {
  return ip.split('.').slice(0, 3).join('.') + '.255';
}

export function networkOf(ip: string): string {
  return ip.split('.').slice(0, 3).join('.') + '.0/24';
}
