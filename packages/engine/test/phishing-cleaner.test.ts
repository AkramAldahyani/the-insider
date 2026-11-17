import { describe, expect, it } from 'vitest';
import { advanceTime, changePassword, createWorld, deserializeWorld, queryEvents, sendInput, serializeWorld, setHacker, siemCollect } from '../src/index';
import { getNode, sysWrite } from '../src/fs/vfs';
import { PW, atDesk, fileOn, scenario, ssh } from './helpers';

const HOME = 'MKT-LT-11';
const VICTIM = 'HR-LT-03';
const USER = 'l.haddad';
const TOOL = '/home/o.farouk/.tools/clean';

function setup() {
  const world = createWorld(scenario, 1);
  setHacker(world, 'p4');
  return { world, hacker: atDesk(world, 'o.farouk'), victim: atDesk(world, USER) };
}

describe('simulated phishing mail', () => {
  it('delivers a spoofed message with real simulated origin and a private result, without capturing on read or HEAD', () => {
    const { world, hacker, victim } = setup();
    expect(hacker.type(`~/.tools/phish ${USER}`)).toContain('Reset message sent');
    const m = world.toolkit.phishing[0];
    const inbox = world.mail.messages.filter((mail) => mail.to.includes(USER));
    const text = victim.type(`mail ${inbox.length}`);
    expect(text).toContain('From: IT@');
    expect(text).toContain(`Received: from ${HOME}`);
    expect(text).toContain(world.hosts[HOME].ip);
    expect(text).toContain('spf=fail');
    expect(text).toContain(m.url);
    expect(fileOn(world, world.mail.serverHost, `/var/mail/${USER}`)).toContain('spf=fail');
    expect(fileOn(world, world.mail.serverHost, '/var/log/mail.log')).toContain(world.mail.messages.at(-1)!.queueId);
    expect(m.captured).toBe(false);
    expect(victim.type(`curl -I ${m.url}`)).toContain('200 OK');
    expect(m.captured).toBe(false);
    expect(getNode(world.hosts[HOME], m.path)).toMatchObject({ owner: 'o.farouk', mode: 0o600 });
    expect(fileOn(world, HOME, m.path)).not.toContain(PW[USER]);
  });

  it('captures only the intended account on the exact game link, once, and leaves DNS/proxy evidence without passwords', () => {
    const { world, hacker, victim } = setup();
    hacker.type(`~/.tools/phish ${USER}`);
    const m = world.toolkit.phishing[0];
    expect(hacker.type(`curl ${m.url}`)).toContain('different employee');
    victim.type(`curl ${m.url}/wrong`);
    expect(m.captured).toBe(false);
    const output = victim.type(`curl ${m.url}`);
    expect(output).toContain('request has been received');
    expect(output).not.toContain(PW[USER]);
    expect(hacker.type(`cat ${m.path}`)).toBe(`${USER}:${PW[USER]}\n`);
    expect(queryEvents(world, { type: 'phish.submit' })).toMatchObject([{ actor: 'p3', host: VICTIM, user: USER }]);
    victim.type(`curl ${m.url}`);
    expect(queryEvents(world, { type: 'phish.submit' })).toHaveLength(1);
    const proxy = fileOn(world, world.web.proxyHost, '/var/log/squid/access.log');
    expect(proxy).toContain(`${world.hosts[VICTIM].ip} ${USER} GET ${m.url}`);
    expect(fileOn(world, world.dnsServer, '/var/log/named/queries.log')).toContain('password-reset.example');
    expect(proxy).not.toContain(PW[USER]);
    expect(JSON.stringify(queryEvents(world, { type: 'phish.submit' }))).not.toContain(PW[USER]);
    expect(siemCollect(world).some((r) => r.source === 'proxy' && r.fields.url === m.url)).toBe(true);
  });

  it('uses a reset credential at visit time, keeps a captured value unchanged, and resumes from a save', () => {
    const { world, hacker, victim } = setup();
    hacker.type(`~/.tools/phish ${USER}`);
    const saved = deserializeWorld(serializeWorld(world));
    const m = saved.toolkit.phishing[0];
    changePassword(saved, USER, 'New-Game-Password', { by: 'd.aziz', via: 'IT-WS-01', sourceIp: saved.hosts['IT-WS-01'].ip });
    sendInput(saved, victim.id, `curl ${m.url}`);
    expect(fileOn(saved, HOME, m.path)).toBe(`${USER}:New-Game-Password\n`);
    changePassword(saved, USER, 'Another-Game-Password', { by: 'd.aziz', via: 'IT-WS-01', sourceIp: saved.hosts['IT-WS-01'].ip });
    sendInput(saved, victim.id, `curl ${m.url}`);
    expect(fileOn(saved, HOME, m.path)).toBe(`${USER}:New-Game-Password\n`);
  });

  it('cannot send to external addresses or root, enforces cooldowns, and does not share messages between worlds', () => {
    const { world, hacker } = setup();
    for (const user of ['root', 'person@outside.example', 'missing']) expect(hacker.type(`~/.tools/phish ${user}`)).toContain('employee account');
    expect(world.toolkit.phishing).toHaveLength(0);
    hacker.type(`~/.tools/phish ${USER}`);
    expect(hacker.type('~/.tools/phish s.alharbi')).toContain('cooling down');
    const other = setup();
    expect(other.victim.type(`curl ${world.toolkit.phishing[0].url}`)).toContain('Could not resolve');
    expect(other.world.toolkit.phishing).toHaveLength(0);
    advanceTime(world, 60_000);
    expect(hacker.type('~/.tools/phish s.alharbi')).toContain('Reset message sent');
    expect(world.toolkit.phishing[0].path).not.toBe(world.toolkit.phishing[1].path);
  });

  it('rejects missing services and refuses a deleted or public result destination', () => {
    const { world, hacker, victim } = setup();
    world.hosts[world.mail.serverHost].online = false;
    expect(hacker.type(`~/.tools/phish ${USER}`)).toContain('must be available');
    world.hosts[world.mail.serverHost].online = true;
    hacker.type(`~/.tools/phish ${USER}`);
    const m = world.toolkit.phishing[0];
    hacker.type(`chmod 644 ${m.path}`);
    expect(victim.type(`curl ${m.url}`)).toContain('unavailable');
    expect(fileOn(world, HOME, m.path)).not.toContain(PW[USER]);
    hacker.type(`rm ${m.path}`);
    expect(victim.type(`curl ${m.url}`)).toContain('unavailable');
    expect(getNode(world.hosts[HOME], m.path)).toBeUndefined();
  });

  it('attributes mail sent from an intermediate virtual host to that host, and keeps loot there', () => {
    const { world, hacker, victim } = setup();
    hacker.type('scp ~/.tools/phish o.farouk@ADMIN-SRV-01:/home/o.farouk/phish');
    hacker.type(PW['o.farouk']);
    ssh(hacker, 'o.farouk', 'ADMIN-SRV-01');
    hacker.type('chmod 700 phish');
    expect(hacker.type(`./phish ${USER}`)).toContain('Reset message sent');
    const m = world.toolkit.phishing[0];
    expect(world.mail.messages.at(-1)).toMatchObject({ sourceHost: 'ADMIN-SRV-01', sourceIp: world.hosts['ADMIN-SRV-01'].ip });
    victim.type(`curl ${m.url}`);
    expect(fileOn(world, 'ADMIN-SRV-01', m.path)).toContain(PW[USER]);
    expect(fileOn(world, HOME, m.path)).toBe('');
  });
});

describe('simulated log cleaner', () => {
  it('runs a tool path through authenticated sudo, while retaining sudo authorization and simulated-only execution', () => {
    const { world, hacker } = setup();
    const admin = atDesk(world, 'k.nasser');
    ssh(admin, 'k.nasser', HOME);
    admin.type(`sudo ${TOOL} /var/log/auth.log "session opened"`);
    expect(admin.masked).toBe(true);
    expect(queryEvents(world, { type: 'log.clear' })).toHaveLength(0);
    expect(admin.type(PW['k.nasser'])).toContain('removed');
    expect(queryEvents(world, { type: 'log.clear' }).at(-1)).toMatchObject({ user: 'root', actor: 'p5' });
    hacker.type('sudo ~/.tools/clean /var/log/auth.log session');
    expect(hacker.type(PW['o.farouk'])).toContain('not in the sudoers file');
    admin.type('echo "echo simulated" > /tmp/plain-script');
    admin.type('chmod 700 /tmp/plain-script');
    expect(admin.type('sudo /tmp/plain-script')).toContain('programs and scripts cannot be executed');
  });

  function rootCleaner() {
    const state = setup();
    const admin = atDesk(state.world, 'k.nasser');
    ssh(admin, 'k.nasser', HOME);
    admin.type('sudo -s');
    admin.type(PW['k.nasser']);
    return { ...state, root: admin };
  }

  it('enforces file permissions and confines paths to virtual logs, including normalized paths', () => {
    const { world, hacker } = setup();
    const before = fileOn(world, HOME, '/var/log/auth.log');
    expect(hacker.type('~/.tools/clean /var/log/auth.log session')).toContain('Permission denied');
    expect(fileOn(world, HOME, '/var/log/auth.log')).toBe(before);
    for (const path of ['/etc/shadow', '/var/log/../../etc/shadow', 'C:/Windows/system.ini']) expect(hacker.type(`~/.tools/clean ${path} x`)).toContain('under /var/log');
    expect(hacker.type('~/.tools/clean /var/log/auth.log ""')).toContain('non-empty');
    expect(queryEvents(world, { type: 'log.clear' })).toHaveLength(0);
  });

  it('removes literal matching rows, preserves timestamps, journal and master history, and surfaces tampering in SIEM', () => {
    const { world, root } = rootCleaner();
    const path = '/var/log/auth.log';
    const rows = [
      `Mar  2 09:00:00 ${HOME} sshd[1]: Accepted password for keep from 10.0.2.1 port 123 ssh2`,
      `Mar  2 09:01:00 ${HOME} sshd[1]: Accepted password for remove.* from 10.0.2.2 port 123 ssh2`,
      `Mar  2 09:02:00 ${HOME} sshd[1]: Accepted password for removeXYZ from 10.0.2.3 port 123 ssh2`,
    ];
    sysWrite(world.hosts[HOME], path, rows.join('\n') + '\n', { time: world.time });
    const oldEvents = world.events.slice();
    const oldJournal = world.hosts[HOME].journal.slice();
    expect(root.type(`${TOOL} ${path} "remove.*"`)).toContain('removed 1 line');
    const after = fileOn(world, HOME, path);
    expect(after).toContain(rows[0]);
    expect(after).not.toContain(rows[1]);
    expect(after).toContain(rows[2]);
    expect(after).toContain('EVENT=log-cleared');
    expect(world.events.slice(0, oldEvents.length)).toEqual(oldEvents);
    expect(world.hosts[HOME].journal.slice(0, oldJournal.length)).toEqual(oldJournal);
    expect(root.type('journalctl -n 5')).toContain('log cleared');
    expect(siemCollect(world).some((r) => r.fields.user === 'remove.*')).toBe(false);
    expect(siemCollect(world)).toContainEqual(expect.objectContaining({ host: HOME, source: 'tamper', fields: expect.objectContaining({ path, removed: '1' }) }));
    expect(queryEvents(world, { type: 'log.clear' }).at(-1)).toMatchObject({ user: 'root', actor: 'p5', origin: 'remote' });
  });

  it('leaves a new marker even when all old markers are removed; no-match does not rewrite the file', () => {
    const { world, root } = rootCleaner();
    const path = '/var/log/squid/access.log';
    sysWrite(world.hosts[HOME], path, 'one\ntwo\n', { time: world.time });
    root.type(`${TOOL} ${path} one`);
    advanceTime(world, 30_000);
    root.type(`${TOOL} ${path} log-cleared`);
    expect(fileOn(world, HOME, path)).toContain('EVENT=log-cleared');
    expect(siemCollect(world).some((r) => r.host === HOME && r.source === 'tamper')).toBe(true);
    advanceTime(world, 30_000);
    const before = fileOn(world, HOME, path);
    expect(root.type(`${TOOL} ${path} absent`)).toContain('unchanged');
    expect(fileOn(world, HOME, path)).toBe(before);
    expect(root.type(`${TOOL} ${path} two`)).toContain('cooling down');
  });

  it('loads saves made before Phase 4 E', () => {
    const { world } = setup();
    const old = JSON.parse(serializeWorld(world));
    delete old.toolkit.phishing;
    expect(deserializeWorld(JSON.stringify(old)).toolkit.phishing).toEqual([]);
  });
});
