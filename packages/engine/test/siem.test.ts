/**
 * Phase 5, part B (engine side): the SIEM, a search over every machine's logs
 * with a small query language, installed on the SOC analyst's PC.
 */
import { describe, expect, it } from 'vitest';
import { advanceTime, createWorld, plugUsb, queryEvents, siemCollect, siemQuery } from '../src/index';
import { sizeValue } from '../src/security/siem';
import { PW, SERVER, atDesk, newWorld, scenario, ssh } from './helpers';

const START = Date.parse(scenario.startTime);

/** A world with some activity: Sara on the server, a few failed logins, some browsing, a USB stick. */
function busyWorld() {
  const world = newWorld();
  const sara = atDesk(world, 's.alharbi');
  ssh(sara, 's.alharbi', SERVER);
  sara.type('sudo cat /root/flag.txt');
  sara.type(PW['s.alharbi']);
  sara.type('curl https://news.example/today');
  sara.type('exit');
  sara.type(`ssh k.nasser@${SERVER}`);
  for (const guess of ['a', 'b', 'c']) sara.type(guess);
  plugUsb(world, 'HR-LT-03', 'p4');
  advanceTime(world, 10 * 60_000);
  return world;
}

describe('collecting the logs', () => {
  it('turns lines from every machine into records with named fields', () => {
    const world = busyWorld();
    const records = siemCollect(world);
    const sources = new Set(records.map((r) => r.source));
    for (const s of ['auth', 'proxy', 'dns', 'mail', 'dhcp', 'firewall', 'usb', 'badge', 'door', 'alert']) expect(sources, s).toContain(s);
    expect([...records].sort((a, b) => a.time - b.time)).toEqual(records); // oldest first
    const login = records.find((r) => r.source === 'auth' && r.fields.action === 'login' && r.fields.user === 's.alharbi' && r.time >= START)!;
    expect(login).toMatchObject({ host: SERVER, fields: { result: 'success', src_ip: world.hosts['FIN-LT-07'].ip } });
    expect(records.find((r) => r.source === 'proxy' && r.fields.user === 's.alharbi')!.fields).toMatchObject({ domain: 'news.example', method: 'GET', status: '200' });
    expect(records.find((r) => r.source === 'usb')!).toMatchObject({ host: 'HR-LT-03', fields: { vendor: '1b4f' } });
    expect(records.find((r) => r.source === 'dhcp' && r.fields.client === 'FIN-LT-07')!.fields.ip).toBe(world.hosts['FIN-LT-07'].ip);
  });

  it('contains only what the logs contain: no player ids, no master-log data', () => {
    const world = busyWorld();
    const text = JSON.stringify(siemCollect(world));
    for (const id of ['"p1"', '"p4"', 'actor', 'origin']) expect(text.includes(id), id).toBe(false);
  });
});

describe('the query language', () => {
  const lines = (text: string) => text.trim().split('\n');

  it('filters by field (with wildcards), by word, and by time', () => {
    const world = busyWorld();
    const ip = world.hosts['FIN-LT-07'].ip;
    const r = siemQuery(world, `src_ip=${ip} source=auth result=failure since=09:00`); // (before the match that address had other failed logins too)
    expect(r.matched).toBe(3);
    expect(lines(r.text).slice(1).every((l) => l.includes('result=failure') && l.includes('user=k.nasser'))).toBe(true);
    expect(siemQuery(world, 'src_ip=10.0.2.* source=auth result=failure since=09:00').matched).toBe(3);
    expect(siemQuery(world, 'source=auth Failed since=09:00').matched).toBe(3);
    expect(siemQuery(world, 'source=auth result=failure until=08:00').matched).toBeLessThan(siemQuery(world, 'source=auth result=failure').matched);
    expect(siemQuery(world, 'user!=k.nasser source=auth result=failure since=09:00').matched).toBe(0);
  });

  it('where, count by, fields, sort, head and tail', () => {
    const world = busyWorld();
    expect(siemQuery(world, 'source=auth result=failure since=09:00 | count by user').text).toBe(' COUNT  USER\n     3  k.nasser\n');
    expect(siemQuery(world, 'source=auth result=failure since=09:00 | count').text).toBe('3\n');
    const big = siemQuery(world, 'source=proxy | where bytes > 1KB | fields user,domain,bytes | sort -bytes | head 1');
    expect(lines(big.text)[0]).toBe('USER  DOMAIN  BYTES');
    expect(lines(big.text).filter((l) => !l.startsWith('('))).toHaveLength(2); // header + one record
    expect(lines(big.text).at(-1)).toMatch(/^\(1 of \d+ shown/);
    const bytes = siemQuery(world, 'source=proxy | fields bytes | sort bytes').text.trim().split('\n').slice(1).map(Number).filter((n) => !Number.isNaN(n));
    expect([...bytes].sort((a, b) => a - b)).toEqual(bytes);
    expect(lines(siemQuery(world, 'source=dhcp | tail 2').text).filter((l) => l.includes('dhcp'))).toHaveLength(2);
    expect(siemQuery(world, 'source=proxy | where url ~ news').matched).toBeGreaterThan(0);
  });

  it('explains mistakes and says when nothing matched', () => {
    const world = newWorld();
    expect(siemQuery(world, 'source=auth | frob').error).toContain('unknown step "frob"');
    expect(siemQuery(world, 'source=auth | where bytes').error).toContain('"where" needs FIELD OP VALUE');
    expect(siemQuery(world, 'since=tea-time').error).toContain('cannot read the time');
    expect(siemQuery(world, 'user=nobody-at-all').text).toBe('No matching records.\n');
  });

  it('reads sizes like 300KB and 1MB', () => {
    expect(sizeValue('1MB')).toBe(1048576);
    expect(sizeValue('300kb')).toBe(307200);
    expect(sizeValue('42')).toBe(42);
    expect(Number.isNaN(sizeValue('lots'))).toBe(true);
  });
});

describe('the siem command', () => {
  it('exists only on the SOC analyst\'s PC; there the whole line is one query', () => {
    const world = busyWorld();
    const huda = atDesk(world, 'h.rahman');
    const out = huda.type('siem source=auth result=failure since=09:00 | count by user');
    expect(out).toBe(' COUNT  USER\n     3  k.nasser\n');
    expect(huda.type('siem "source=auth result=failure since=09:00 | count"')).toBe('3\n'); // quoted works too
    expect(huda.type('siem')).toContain('siem - search the logs of every machine at once');
    expect(atDesk(world, 's.alharbi').type('siem source=auth')).toContain('bash: siem: command not found');
  });

  it('every search is in the master log (who looked for what, for the debrief)', () => {
    const world = createWorld(scenario, 1);
    const huda = atDesk(world, 'h.rahman');
    huda.type('siem source=badge door=SRV-ROOM');
    expect(queryEvents(world, { type: 'siem.query' })).toMatchObject([{ actor: 'p11', host: 'SOC-WS-01', details: { query: 'source=badge door=SRV-ROOM' } }]);
  });
});
