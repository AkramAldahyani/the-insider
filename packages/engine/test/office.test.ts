/**
 * Phase 3, part E: internal email, DNS / proxy / firewall logs, and
 * background noise. All of it is engine work, so it is tested here and is
 * available in the CLI as well as in the browser.
 */
import { describe, expect, it } from 'vitest';
import { advanceTime, createWorld, queryEvents } from '../src/index';
import { HOUR, MINUTE } from '../src/core/time';
import { PW, SERVER, Term, atDesk, fileOn, newWorld, scenario, ssh } from './helpers';

const START = Date.parse(scenario.startTime);
const lines = (text: string) => text.split('\n').filter(Boolean);
const today = (text: string, marker = 'Mar  2 09:') => lines(text).filter((l) => l.includes(marker));

describe('internal email', () => {
  it('lists the inbox, with old mail from the scenario', () => {
    const t = atDesk(newWorld(), 's.alharbi');
    const out = t.type('mail');
    expect(out).toContain('"/var/mail/s.alharbi": 2 messages 2 new');
    expect(out).toMatch(/N {2}1 n\.saleh .* "Reminder: lock your screen"/);
    expect(out).toMatch(/N {2}2 r\.mansour .* "February invoices"/);
    expect(atDesk(newWorld(), 'y.khalil').type('mail')).toContain('1 message 1 new');
  });

  it('reading a message shows headers that name the machine and IP it was sent from', () => {
    const world = newWorld();
    const out = atDesk(world, 's.alharbi').type('mail 2');
    const ramiPc = world.hosts['FIN-LT-04'];
    expect(out).toContain('Return-Path: <r.mansour@nexora.local>');
    expect(out).toContain(`Received: from FIN-LT-04.nexora.local (FIN-LT-04.nexora.local [${ramiPc.ip}])`);
    expect(out).toContain('by mail.nexora.local (Postfix) with ESMTP id ');
    expect(out).toContain('spf=pass');
    expect(out).toContain('From: Rami Mansour <r.mansour@nexora.local>');
    expect(out).toContain('To: s.alharbi@nexora.local');
    expect(out).toContain('Subject: February invoices');
    expect(out).toContain('can you send me the list of February invoices');
    // Read once: no longer "new".
    const world2 = newWorld();
    const t = atDesk(world2, 's.alharbi');
    t.type('mail 2');
    expect(t.type('mail')).toContain('2 messages 1 new');
    expect(t.type('mail 9')).toContain('no message 9');
  });

  it('sending delivers to the mailbox and is logged on the mail server with the sending PC', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    expect(sara.type('mail -s "Re: February invoices" r.mansour "Attached, 14 invoices."')).toMatch(/^Message [0-9A-F]{10} sent to r\.mansour@nexora\.local/);
    const rami = atDesk(world, 'r.mansour');
    const inbox = rami.type('mail');
    expect(inbox).toMatch(/s\.alharbi .* "Re: February invoices"/);
    const n = lines(inbox).length - 2; // header line + hint line
    const message = rami.type(`mail ${n}`);
    expect(message).toContain(`[${world.hosts['FIN-LT-07'].ip}]`);
    expect(message).toContain('Attached, 14 invoices.');

    const log = today(fileOn(world, SERVER, '/var/log/mail.log'));
    expect(log.some((l) => l.includes(`postfix/smtpd`) && l.includes(`connect from FIN-LT-07.nexora.local[${world.hosts['FIN-LT-07'].ip}]`))).toBe(true);
    expect(log.some((l) => l.includes('sasl_username=s.alharbi'))).toBe(true);
    expect(log.some((l) => l.includes('from=<s.alharbi@nexora.local>') && l.includes('nrcpt=1'))).toBe(true);
    expect(log.some((l) => l.includes('to=<r.mansour@nexora.local>') && l.includes('status=sent (delivered to mailbox)'))).toBe(true);
    expect(queryEvents(world, { type: 'mail.send', since: START })).toMatchObject([{ host: SERVER, user: 's.alharbi', actor: 'p1', sourceIp: world.hosts['FIN-LT-07'].ip }]);
  });

  it('the body can come from a pipe; bad recipients and empty messages are refused', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    expect(t.type('echo "See you at ten." | mail -s "Meeting" n.saleh')).toContain('sent to n.saleh@nexora.local');
    expect(atDesk(world, 'n.saleh').type('mail')).toContain('"Meeting"');
    expect(t.type('mail -s "Hi" nobody.here "text"')).toContain('no such user');
    expect(t.type('mail -s "Hi" n.saleh')).toContain('empty message');
    expect(t.type('mail -s')).toContain('Usage: mail');
  });

  it("a mailbox file is private: its owner and root can read it, a colleague cannot", () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    ssh(sara, 's.alharbi', SERVER);
    expect(sara.type('cat /var/mail/s.alharbi')).toContain('Subject: February invoices');
    expect(sara.type('cat /var/mail/t.omar')).toContain('Permission denied');
    expect(sara.type('tail -n 1 /var/log/mail.log')).toContain('Permission denied'); // not in group adm
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', SERVER);
    expect(khalid.type('grep -c "status=sent" /var/log/mail.log').trim()).toMatch(/^\d+$/);
  });

  it('mail sent from inside an ssh session comes from the server, not from the desk', () => {
    const world = newWorld();
    const omar = new Term(world, 'HR-LT-03', 'p4'); // Omar at Lina's unlocked PC, as l.haddad
    ssh(omar, 'l.haddad', SERVER);
    omar.type('mail -s "Day off" n.saleh "I will be away tomorrow."');
    const message = world.mail.messages.at(-1)!;
    expect(message).toMatchObject({ from: 'l.haddad', sourceHost: SERVER, sourceIp: '10.0.1.10' });
    // The master log still knows who was really typing.
    expect(queryEvents(world, { type: 'mail.send', since: START }).at(-1)).toMatchObject({ user: 'l.haddad', actor: 'p4' });
  });
});

describe('web, DNS and firewall logs', () => {
  it('curl fetches a simulated page and the proxy logs who asked for what', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    expect(t.type('curl https://news.example/world/today')).toContain('<title>World News Today</title>');
    expect(t.type('curl -I intranet.nexora.local')).toContain('HTTP/1.1 200 OK');
    const access = lines(fileOn(world, SERVER, '/var/log/squid/access.log'));
    const ip = world.hosts['FIN-LT-07'].ip;
    expect(access.at(-2)).toMatch(new RegExp(`^2026-03-02 09:00:\\d\\d ${ip} s\\.alharbi GET https://news\\.example/world/today 200 \\d+ \\d+ms TCP_MISS DIRECT/203\\.0\\.113\\.31$`));
    expect(access.at(-1)).toMatch(/s\.alharbi HEAD http:\/\/intranet\.nexora\.local\/ 200 0 /);
    expect(queryEvents(world, { type: 'web.request', actor: 'p1' })).toHaveLength(2);
  });

  it('unknown names do not resolve, and office PCs are not web servers', () => {
    const t = atDesk(newWorld(), 's.alharbi');
    expect(t.type('curl http://no-such-site.example/')).toContain('curl: (6) Could not resolve host: no-such-site.example');
    expect(t.type('curl http://HR-LT-03/')).toContain('curl: (7) Failed to connect to HR-LT-03 port 80');
    expect(t.type('curl')).toContain("try 'curl URL'");
  });

  it('every name lookup is in the DNS query log with the asking PC, even one that failed', () => {
    const world = newWorld();
    const t = atDesk(world, 'o.farouk');
    t.type('nslookup ADMIN-SRV-01');
    t.type('curl http://no-such-site.example/');
    t.type('curl https://weather.example/');
    const queries = lines(fileOn(world, SERVER, '/var/log/named/queries.log')).slice(-3);
    const ip = world.hosts['MKT-LT-11'].ip;
    expect(queries[0]).toMatch(new RegExp(`^02-Mar-2026 09:00:\\d\\d\\.\\d{3} client ${ip}#\\d+ \\(ADMIN-SRV-01\\): query: ADMIN-SRV-01 IN A \\+E\\(0\\)K \\(10\\.0\\.1\\.10\\)$`));
    expect(queries[1]).toContain('(no-such-site.example): query: no-such-site.example IN A');
    expect(queries[2]).toContain(`client ${ip}#`);
    expect(queries[2]).toContain('weather.example');
  });

  it('the firewall of a machine notes every connection to its ssh port, successful or not', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    t.type('exit');
    t.type('ssh k.nasser@ADMIN-SRV-01');
    t.type('wrong-password');
    const ip = world.hosts['FIN-LT-07'].ip;
    const kern = today(fileOn(world, SERVER, '/var/log/kern.log')).filter((l) => l.includes('[UFW ALLOW]'));
    expect(kern).toHaveLength(2);
    for (const line of kern) expect(line).toMatch(new RegExp(`SRC=${ip} DST=10\\.0\\.1\\.10 .* PROTO=TCP SPT=\\d+ DPT=22 `));
    // Old connections from the scenario's history have their firewall lines too.
    expect(lines(fileOn(world, SERVER, '/var/log/kern.log')).filter((l) => l.includes('[UFW ALLOW]')).length).toBeGreaterThan(2);
  });
});

describe('background noise', () => {
  it('logs keep growing while nobody does anything', () => {
    const world = newWorld();
    const before = { syslog: lines(fileOn(world, 'FIN-LT-07', '/var/log/syslog')).length, events: world.events.length };
    advanceTime(world, HOUR);
    const added = lines(fileOn(world, 'FIN-LT-07', '/var/log/syslog')).slice(before.syslog);
    expect(added.filter((l) => l.includes('systemd-timesyncd')).length).toBeGreaterThanOrEqual(3); // every 16 minutes
    expect(added.some((l) => l.includes('Contacted time server 10.0.1.10:123 (ADMIN-SRV-01).'))).toBe(true);
    expect(added.filter((l) => l.includes(' systemd[1]: ')).length).toBeGreaterThanOrEqual(5); // every 11 minutes
    // Lines are in time order.
    const stamps = added.map((l) => l.slice(0, 15));
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('workstations check for updates: DNS and proxy lines with no user behind them', () => {
    const world = newWorld();
    advanceTime(world, HOUR);
    const access = lines(fileOn(world, SERVER, '/var/log/squid/access.log'));
    const updates = access.filter((l) => l.includes('archive.ubuntu.example'));
    expect(updates.length).toBeGreaterThanOrEqual(20); // 10 workstations, every 23 minutes
    expect(updates.every((l) => / - GET http:\/\/archive\.ubuntu\.example\//.test(l))).toBe(true); // "-" = no account
    expect(new Set(updates.map((l) => l.split(' ')[2])).size).toBe(11); // every workstation's IP appears
    expect(lines(fileOn(world, SERVER, '/var/log/named/queries.log')).filter((l) => l.includes('archive.ubuntu.example')).length).toBe(updates.length);
    // In the master log these are marked as done by the system, not by a person.
    for (const e of queryEvents(world, { type: 'web.request', since: START })) expect(e).toMatchObject({ origin: 'system', actor: null, user: '' });
  });

  it('the machines do not all write at the same second', () => {
    const world = newWorld();
    advanceTime(world, 30 * MINUTE);
    const times = new Set(queryEvents(world, { type: 'web.request', since: START }).map((e) => e.time));
    expect(times.size).toBeGreaterThanOrEqual(8);
  });

  it('noise starts with the match: the history before it is unchanged, and so are the addresses', () => {
    const world = newWorld();
    expect(lines(fileOn(world, 'FIN-LT-07', '/var/log/syslog')).some((l) => l.includes('systemd-timesyncd'))).toBe(false);
    // Seed 1 still gives the addresses documented in TESTING.md.
    expect(world.hosts['FIN-LT-07'].ip).toBe('10.0.2.58');
    expect(world.hosts['IT-WS-02'].ip).toBe('10.0.2.119');
  });

  it('is deterministic, and does not depend on how time is sliced', () => {
    const run = (step: number) => {
      const world = createWorld(scenario, 1);
      for (let t = 0; t < HOUR; t += step) advanceTime(world, step);
      return fileOn(world, SERVER, '/var/log/squid/access.log') + fileOn(world, 'HR-LT-05', '/var/log/syslog');
    };
    expect(run(HOUR)).toBe(run(50)); // one big jump vs. the game server's 50 ms ticks...
    expect(run(6 * MINUTE)).toBe(run(HOUR));
  });

  it('a workstation that is switched off is silent', () => {
    const world = newWorld();
    world.hosts['MKT-LT-09'].online = false;
    const before = lines(fileOn(world, 'MKT-LT-09', '/var/log/syslog')).length;
    advanceTime(world, HOUR);
    expect(lines(fileOn(world, 'MKT-LT-09', '/var/log/syslog')).length).toBe(before);
  });
});

describe('scenario checks for mail and web', () => {
  it('unknown mail accounts and a missing update site are refused', () => {
    const a = JSON.parse(JSON.stringify(scenario));
    a.mail.history.push({ from: 'ghost', to: ['s.alharbi'], subject: 'x', body: 'y', minutesAgo: 5 });
    expect(() => createWorld(a, 1)).toThrow('mail history: unknown account "ghost"');
    const b = JSON.parse(JSON.stringify(scenario));
    b.web.updateSite = 'nowhere.example';
    expect(() => createWorld(b, 1)).toThrow('web.updateSite "nowhere.example" is not in web.sites');
  });

  it('a password typed by a bot or a person is never in mail, DNS or proxy logs', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    t.type('curl https://bank.example/login');
    t.type('mail -s "hello" r.mansour "just saying hi"');
    const text = fileOn(world, SERVER, '/var/log/squid/access.log') + fileOn(world, SERVER, '/var/log/mail.log') + fileOn(world, SERVER, '/var/log/named/queries.log');
    for (const pw of Object.values(PW)) expect(text.includes(pw)).toBe(false);
  });
});
