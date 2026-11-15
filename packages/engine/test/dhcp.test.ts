import { describe, expect, it } from 'vitest';
import { activeLease, advanceTime, dhcpRelease, dhcpRequest, leaseHistory, leaseHolderAt, queryEvents } from '../src/index';
import { PW, SERVER, atDesk, fileOn, newWorld, ssh } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

describe('DHCP', () => {
  it('gives every workstation a unique address from the pool; the server keeps its static IP', () => {
    const world = newWorld();
    const ips = new Set<string>();
    for (const host of Object.values(world.hosts)) {
      if (host.staticIp) {
        expect(host.ip).toBe('10.0.1.10');
        expect(activeLease(world, host.mac)).toBeUndefined();
        continue;
      }
      expect(host.ip).toMatch(/^10\.0\.2\.\d+$/);
      const n = Number(host.ip.split('.')[3]);
      expect(n).toBeGreaterThanOrEqual(30);
      expect(n).toBeLessThanOrEqual(200);
      expect(activeLease(world, host.mac)?.ip).toBe(host.ip);
      ips.add(host.ip);
    }
    expect(ips.size).toBe(10);
  });

  it('keeps lease HISTORY: the same IP belonged to different machines at different times', () => {
    const world = newWorld();
    const history = leaseHistory(world, { ip: '10.0.2.58' });
    expect(history.map((l) => l.hostname)).toEqual(['MKT-LT-11', 'FIN-LT-07', 'FIN-LT-07']);
    expect(history.map((l) => l.end === null)).toEqual([false, false, true]);

    // "Who had 10.0.2.58 nine days ago?" - not the machine that has it today.
    expect(leaseHolderAt(world, '10.0.2.58', world.time - 9 * DAY)?.hostname).toBe('MKT-LT-11');
    expect(leaseHolderAt(world, '10.0.2.58', world.time - 5 * DAY)?.hostname).toBe('FIN-LT-07');
    expect(leaseHolderAt(world, '10.0.2.58', world.time)?.mac).toBe(world.hosts['FIN-LT-07'].mac);
    // nobody held it in the gap between two leases
    expect(leaseHolderAt(world, '10.0.2.58', world.time - 4450 * 60 * 1000)).toBeUndefined();
  });

  it('records release and re-request as separate leases', () => {
    const world = newWorld();
    const host = world.hosts['HR-LT-03'];
    const oldIp = host.ip;
    const count = leaseHistory(world, { mac: host.mac }).length;

    dhcpRelease(world, host);
    expect(host.ip).toBe('');
    expect(activeLease(world, host.mac)).toBeUndefined();
    expect(leaseHistory(world, { mac: host.mac }).slice(-1)[0].end).toBe(world.time);

    advanceTime(world, 10 * 60 * 1000);
    expect(dhcpRequest(world, host)).toBe(oldIp); // returning clients get their old address back
    const history = leaseHistory(world, { mac: host.mac });
    expect(history).toHaveLength(count + 1);
    expect(history.slice(-1)[0]).toMatchObject({ ip: oldIp, start: world.time, end: null });
    expect(queryEvents(world, { type: 'dhcp.release', host: 'HR-LT-03' })).toHaveLength(1);
  });

  it('renews leases as time passes without creating new ones', () => {
    const world = newWorld();
    const mac = world.hosts['FIN-LT-04'].mac;
    const before = { ...activeLease(world, mac)! };
    const total = world.dhcp.leases.length;
    advanceTime(world, 9 * 60 * 60 * 1000); // longer than the 8h lease
    const after = activeLease(world, mac)!;
    expect(after.ip).toBe(before.ip);
    expect(after.start).toBe(before.start);
    expect(after.lastRenew).toBeGreaterThan(before.lastRenew);
    expect(after.expires).toBeGreaterThan(world.time);
    expect(world.dhcp.leases).toHaveLength(total);
  });

  it('the lease history is readable on the DHCP server, like real dhcpd', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    ssh(t, 'k.nasser', SERVER);
    const leases = t.type('cat /var/lib/dhcp/dhcpd.leases');
    expect(leases).toContain(`hardware ethernet ${world.hosts['FIN-LT-07'].mac};`);
    expect(leases).toContain('client-hostname "MKT-LT-11";');
    expect(leases).toContain('binding state active;');
    expect(leases).toContain('binding state free;');

    t.type('sudo grep -c DHCPACK /var/log/syslog');
    expect(Number(t.type(PW['k.nasser']))).toBeGreaterThan(5);
    expect(fileOn(world, SERVER, '/var/log/syslog')).toContain(
      `DHCPACK on ${world.hosts['IT-WS-02'].ip} to ${world.hosts['IT-WS-02'].mac} (IT-WS-02) via eth0`,
    );
  });

  it('ip a shows the MAC and the leased address', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    const out = t.type('ip a');
    expect(out).toContain(`link/ether ${world.hosts['HR-LT-03'].mac} brd ff:ff:ff:ff:ff:ff`);
    expect(out).toContain(`inet ${world.hosts['HR-LT-03'].ip}/24 brd 10.0.2.255 scope global dynamic eth0`);
  });
});
