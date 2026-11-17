import { describe, expect, it } from 'vitest';
import {
  advanceTime, changePassword, createWorld, deserializeWorld, plugUsb, queryEvents, sendInput,
  serializeWorld, setHacker, siemCollect, submitFlag, switchUser,
} from '../src/index';
import { getNode } from '../src/fs/vfs';
import { FLAG, PW, SERVER, Term, atDesk, fileOn, scenario, ssh } from './helpers';

const HOME = 'MKT-LT-11';
const VICTIM = 'HR-LT-03';
const ADMIN = 'IT-WS-02';
const SEC = 'SEC-SRV-01';
const START = Date.parse(scenario.startTime);

function setup(weak = false) {
  const world = createWorld(scenario, 1, { weaknesses: weak ? ['weak-admin-password'] : [] });
  setHacker(world, 'p4');
  return { world, hacker: atDesk(world, 'o.farouk') };
}

function connectVictim() {
  const { world, hacker } = setup();
  expect(plugUsb(world, VICTIM, 'p4').installed).toBe(true);
  expect(hacker.type(`~/.tools/implant ${VICTIM}`)).toContain('Connected');
  return { world, hacker };
}

describe('implant sessions', () => {
  it('requires a live backdoor, rejects unknown/offline hosts and preserves normal permissions', () => {
    const { world, hacker } = setup();
    expect(hacker.type(`~/.tools/implant ${SERVER}`)).toContain('no live USB backdoor');
    expect(hacker.type('~/.tools/implant example.com')).toContain('not on the simulated network');
    plugUsb(world, VICTIM, 'p4');
    world.hosts[VICTIM].online = false;
    expect(hacker.type(`~/.tools/implant ${VICTIM}`)).toContain('not on the simulated network');
    world.hosts[VICTIM].online = true;
    expect(hacker.type(`~/.tools/implant ${world.hosts[VICTIM].ip} l.haddad`)).toContain('as l.haddad');
    expect(hacker.type('whoami')).toBe('l.haddad\n');
    expect(hacker.type('cat /etc/shadow')).toContain('Permission denied');
    expect(queryEvents(world, { type: 'implant.connect' })[0]).toMatchObject({ actor: 'p4', origin: 'remote', sourceIp: world.hosts[HOME].ip });
  });

  it('leaves connections at both ends, saves remote history and cleans up on exit', () => {
    const { world, hacker } = connectVictim();
    expect(hacker.type('ss -tnp')).toContain(world.hosts[HOME].ip);
    expect(hacker.type('ps aux')).toContain('sysupd: remote shell');
    expect(world.hosts[HOME].connections.some((c) => c.program === 'implant')).toBe(true);
    expect(queryEvents(world, { type: 'ssh.accept', since: START })).toEqual([]);
    expect(hacker.type('exit')).toContain(`Connection to ${VICTIM} closed`);
    expect(hacker.type('hostname')).toBe(`${HOME}\n`);
    expect(world.hosts[HOME].connections).toEqual([]);
    expect(world.hosts[VICTIM].connections).toEqual([]);
    expect(fileOn(world, VICTIM, '/home/l.haddad/.bash_history')).toContain('ss -tnp');
    expect(world.hosts[VICTIM].services.some((s) => s.program === 'sysupd')).toBe(true);
  });

  it('pivots with the intermediate IP, and killing the listener closes its shells and downstream sessions', () => {
    const { world, hacker } = connectVictim();
    ssh(hacker, 'l.haddad', SERVER);
    expect(queryEvents(world, { type: 'ssh.accept', since: START }).at(-1)).toMatchObject({ actor: 'p4', sourceIp: world.hosts[VICTIM].ip });
    const victim = atDesk(world, 'l.haddad');
    victim.type(`kill ${world.toolkit.backdoors[0].pid}`);
    expect(hacker.type('whoami')).toContain('closed by remote host');
    expect(hacker.type('whoami')).toBe('o.farouk\n');
    for (const host of [HOME, VICTIM, SERVER]) expect(world.hosts[host].connections).toEqual([]);
    advanceTime(world, 10_000);
    expect(hacker.type(`~/.tools/implant ${VICTIM}`)).toContain('no live USB backdoor');
  });

  it('killing the client or remote shell cleans up both ends without killing the listener', () => {
    for (const end of ['client', 'remote']) {
      const { world, hacker } = connectVictim();
      const session = Object.values(world.sessions).find((s) => s.kind === 'implant')!;
      const defender = atDesk(world, end === 'client' ? 'o.farouk' : 'l.haddad');
      if (end === 'client') {
        // Use a separate SSH terminal to inspect/kill the client without reusing the hacked screen.
        const admin = atDesk(world, 'k.nasser');
        ssh(admin, 'k.nasser', HOME);
        admin.type(`sudo kill ${session.client!.pid}`);
        admin.type(PW['k.nasser']);
      } else defender.type(`kill ${session.authPid}`);
      expect(world.hosts[HOME].connections.filter((c) => c.program === 'implant')).toEqual([]);
      expect(world.hosts[VICTIM].connections).toEqual([]);
      expect(world.hosts[VICTIM].services.some((s) => s.program === 'sysupd')).toBe(true);
    }
  });

  it('rejects piping an interactive connection and survives saving an open session', () => {
    const { world, hacker } = setup();
    plugUsb(world, VICTIM, 'p4');
    expect(hacker.type(`~/.tools/implant ${VICTIM} | cat`)).toContain('needs the terminal');
    hacker.type(`~/.tools/implant ${VICTIM}`);
    const saved = deserializeWorld(serializeWorld(world));
    expect(sendInput(saved, hacker.id, 'whoami').output).toBe('l.haddad\n');
    sendInput(saved, hacker.id, 'exit');
    expect(saved.hosts[VICTIM].connections).toEqual([]);
  });
});

describe('one-shot keyboard recorder', () => {
  function recorder() {
    const state = setup();
    state.hacker.type(`scp ~/.tools/keylogger l.haddad@${VICTIM}:/tmp/recorder`);
    state.hacker.type(PW['l.haddad']);
    // Copying a game tool uses the same VFS permissions as any other file.
    plugUsb(state.world, VICTIM, 'p4');
    state.hacker.type(`~/.tools/implant ${VICTIM}`);
    state.hacker.type('chmod 700 /tmp/recorder');
    expect(state.hacker.type('/tmp/recorder')).toContain('Recorder');
    return { ...state, k: state.world.toolkit.keyloggers[0] };
  }

  it('records the next physical password, once, privately, and leaves a file and process trace', () => {
    const { world, hacker, k } = recorder();
    expect(hacker.type('ps aux')).toContain('/tmp/.input-helper');
    expect(hacker.type('ls -la /tmp')).toContain(k.path.split('/').pop());
    const victim = atDesk(world, 'l.haddad');
    victim.type('loginctl lock-session');
    victim.type(PW['l.haddad']);
    expect(hacker.type(`cat ${k.path}`)).toContain(PW['l.haddad']);
    expect(hacker.type('ps aux')).not.toContain('/tmp/.input-helper');
    const captured = fileOn(world, VICTIM, k.path);
    victim.type('loginctl lock-session');
    victim.type('a-second-password');
    expect(fileOn(world, VICTIM, k.path)).toBe(captured);
    expect(getNode(world.hosts[VICTIM], k.path)?.mode).toBe(0o600);
    expect(JSON.stringify(queryEvents(world, { type: 'keylogger.' }))).not.toContain(PW['l.haddad']);
    hacker.type('exit');
    ssh(hacker, 'k.nasser', VICTIM);
    expect(hacker.type(`cat ${k.path}`)).toContain('Permission denied');
  });

  it('cannot capture passwords entered on a different physical PC during a remote login', () => {
    const { world, hacker, k } = recorder();
    hacker.type('ssh k.nasser@ADMIN-SRV-01');
    hacker.type(PW['k.nasser']);
    expect(fileOn(world, VICTIM, k.path)).toBe('');
    expect(k.captured).toBe(false);
  });

  it('a user recorder cannot capture another account switching into the same PC', () => {
    const { world, k } = recorder();
    const victim = atDesk(world, 'l.haddad');
    victim.type('loginctl lock-session');
    switchUser(world, victim.id);
    victim.type('k.nasser');
    victim.type(PW['k.nasser']);
    expect(k.captured).toBe(false);
    expect(fileOn(world, VICTIM, k.path)).toBe('');
  });

  it.each(['kill', 'rm'])('a defender can disable it with %s', (method) => {
    const { world, k } = recorder();
    const victim = atDesk(world, 'l.haddad');
    victim.type(method === 'kill' ? `kill ${k.pid}` : `rm ${k.path}`);
    victim.type('loginctl lock-session');
    victim.type(PW['l.haddad']);
    expect(fileOn(world, VICTIM, k.path)).toBe('');
    expect(k.captured).toBe(false);
  });

  it('keeps waiting across save/reload and captures a mistyped password exactly as typed', () => {
    const { world, k } = recorder();
    const victim = atDesk(world, 'l.haddad');
    victim.type('loginctl lock-session');
    const saved = deserializeWorld(serializeWorld(world));
    sendInput(saved, victim.id, 'typo-password');
    expect(fileOn(saved, VICTIM, k.path)).toContain('typo-password');
    expect(fileOn(saved, VICTIM, k.path)).not.toContain(PW['l.haddad']);
  });
});

describe('simulated hash jobs', () => {
  function stolenShadow(weak = false) {
    const state = setup(weak);
    const admin = new Term(state.world, ADMIN, 'p5');
    if (!admin.masked) admin.type('k.nasser');
    admin.type(state.world.credentials['k.nasser'].password);
    admin.type('sudo cp /etc/shadow /tmp/stolen-shadow');
    admin.type(state.world.credentials['k.nasser'].password);
    admin.type('sudo chmod 644 /tmp/stolen-shadow');
    state.hacker.type(`scp k.nasser@${ADMIN}:/tmp/stolen-shadow /tmp/shadow-copy`);
    state.hacker.type(state.world.credentials['k.nasser'].password);
    return state;
  }

  it('needs readable matching hashes, audits direct shadow reads, and rejects invented input', () => {
    const { world, hacker } = setup();
    expect(hacker.type('~/.tools/crack /etc/shadow')).toContain('Permission denied');
    expect(fileOn(world, HOME, '/var/log/audit/audit.log')).toContain('success=no');
    expect(hacker.type('~/.tools/crack /missing')).toContain('No such file');
    hacker.type('echo "k.nasser:made-up" > /tmp/fake');
    expect(hacker.type('~/.tools/crack /tmp/fake')).toContain('no matching simulated');
    expect(world.toolkit.jobs).toEqual([]);
  });

  it('weak hashes finish sooner, with a visible cancellable process and private loot', () => {
    const durations: number[] = [];
    for (const weak of [true, false]) {
      const { world, hacker } = stolenShadow(weak);
      expect(fileOn(world, ADMIN, '/var/log/audit/audit.log')).toContain('key="shadow-read"');
      expect(hacker.type('~/.tools/crack /tmp/shadow-copy k.nasser')).toContain('background');
      const job = world.toolkit.jobs[0];
      durations.push(job.finishAt - job.startedAt);
      expect(hacker.type('ps aux')).toContain('crack /tmp/shadow-copy');
      expect(fileOn(world, HOME, `/home/o.farouk/.tools/loot/crack-${job.id}.txt`)).toBe('');
      advanceTime(world, job.finishAt - world.time);
      expect(hacker.type(`cat ~/.tools/loot/crack-${job.id}.txt`)).toBe(`k.nasser:${world.credentials['k.nasser'].password}\n`);
      expect(getNode(world.hosts[HOME], `/home/o.farouk/.tools/loot/crack-${job.id}.txt`)?.mode).toBe(0o600);
      expect(queryEvents(world, { type: 'tool.done' }).at(-1)).toMatchObject({ actor: 'p4', details: { tool: 'crack', result: 'done' } });
    }
    expect(durations[0]).toBeLessThan(durations[1]);
  });

  it('kill stops completion and cooldown prevents immediate duplicate jobs', () => {
    const { world, hacker } = stolenShadow(true);
    hacker.type('~/.tools/crack /tmp/shadow-copy k.nasser');
    const job = world.toolkit.jobs[0];
    expect(hacker.type('~/.tools/crack /tmp/shadow-copy k.nasser')).toContain('cooling down');
    hacker.type(`kill ${job.pid}`);
    advanceTime(world, 60_000);
    expect(fileOn(world, HOME, `/home/o.farouk/.tools/loot/crack-${job.id}.txt`)).toBe('');
    expect(queryEvents(world, { type: 'tool.done' }).at(-1)?.details.result).toBe('killed');
  });

  it('snapshots stolen hashes, survives logout/reload and completes independently of clock step size', () => {
    const { world, hacker } = stolenShadow(true);
    hacker.type('~/.tools/crack /tmp/shadow-copy k.nasser');
    const job = world.toolkit.jobs[0];
    hacker.type('rm /tmp/shadow-copy');
    changePassword(world, 'k.nasser', 'new-password', { by: 'd.aziz', sourceIp: '10.0.2.1', via: 'helpdesk' });
    hacker.type('exit');
    const a = deserializeWorld(serializeWorld(world));
    const b = deserializeWorld(serializeWorld(world));
    advanceTime(a, 60_000);
    for (let i = 0; i < 60; i++) advanceTime(b, 1000);
    const path = `/home/o.farouk/.tools/loot/crack-${job.id}.txt`;
    expect(fileOn(a, HOME, path)).toBe('k.nasser:nexora2026\n');
    expect(fileOn(b, HOME, path)).toBe(fileOn(a, HOME, path));
    expect(queryEvents(a, { type: 'tool.done' })).toEqual(queryEvents(b, { type: 'tool.done' }));
  });

  it('audits shadow copies obtained by scp and shell input redirection', () => {
    const { world, hacker } = setup();
    const admin = atDesk(world, 'k.nasser');
    admin.type('sudo chmod 644 /etc/shadow');
    admin.type(PW['k.nasser']);
    hacker.type(`scp k.nasser@${ADMIN}:/etc/shadow /tmp/shadow`);
    hacker.type(PW['k.nasser']);
    expect(fileOn(world, ADMIN, '/var/log/audit/audit.log')).toContain('key="shadow-read"');
    expect(hacker.type('cat < /etc/shadow')).toContain('Permission denied');
    expect(fileOn(world, HOME, '/var/log/audit/audit.log')).toContain('success=no');
  });
});

describe('network scanner', () => {
  it('lists live services, records source IP in IDS/SIEM, and raises a medium alert', () => {
    const { world, hacker } = setup();
    plugUsb(world, VICTIM, 'p4');
    const offline = world.hosts[ADMIN];
    offline.online = false;
    const out = hacker.type('~/.tools/scan');
    expect(out).toContain(`${VICTIM} ${world.hosts[VICTIM].ip}`);
    expect(out).toContain('4440/tcp sysupd');
    expect(out).not.toContain(ADMIN);
    expect(out).not.toContain(PW['k.nasser']);
    expect(fileOn(world, SEC, '/var/log/ids/alerts.log')).toContain(`SRC=${world.hosts[HOME].ip}`);
    expect(siemCollect(world).filter((r) => r.source === 'ids')).toMatchObject([{ fields: { src_ip: world.hosts[HOME].ip, rule: 'network-scan' } }]);
    expect(queryEvents(world, { type: 'security.alert' }).at(-1)).toMatchObject({ details: { rule: 'network-scan', severity: 'medium' } });
    expect(hacker.type('~/.tools/scan')).toContain('cooling down');
  });

  it('filters by an internal host and rejects outside addresses without making a network call', () => {
    const { world, hacker } = setup();
    expect(hacker.type('~/.tools/scan 8.8.8.8')).toContain('not on the simulated network');
    const out = hacker.type(`~/.tools/scan ${SERVER}`);
    expect(out).toContain(SERVER);
    expect(out).not.toContain(VICTIM);
    expect(queryEvents(world, { type: 'network.scan' })).toHaveLength(1);
  });
});

describe('complete Part D game route', () => {
  it('USB -> implant -> recorder -> observed sudo password -> server flag, with evidence at every step', () => {
    const { world, hacker } = setup();
    const admin = atDesk(world, 'k.nasser');
    // The hacker can carry a tool file to a machine they can already access.
    // Stage it in their own account on the server, then fetch it through the implant.
    hacker.type(`scp ~/.tools/keylogger o.farouk@${SERVER}:/home/o.farouk/recorder`);
    hacker.type(PW['o.farouk']);
    plugUsb(world, ADMIN, 'p4');
    hacker.type(`~/.tools/implant ${ADMIN}`);
    hacker.type(`scp o.farouk@${SERVER}:/home/o.farouk/recorder /tmp/recorder`);
    hacker.type(PW['o.farouk']);
    hacker.type('chmod 700 /tmp/recorder');
    hacker.type('/tmp/recorder');
    const k = world.toolkit.keyloggers[0];
    admin.type('sudo ls /root');
    admin.type(PW['k.nasser']);
    const captured = hacker.type(`cat ${k.path}`);
    expect(captured).toContain(PW['k.nasser']);
    ssh(hacker, 'k.nasser', SERVER);
    hacker.type('sudo cat /root/flag.txt');
    expect(hacker.type(PW['k.nasser'])).toContain(FLAG);
    expect(submitFlag(world, 'p4', FLAG).won).toBe(true);
    expect(fileOn(world, ADMIN, '/var/log/kern.log')).toContain('USB Keyboard');
    expect(world.hosts[ADMIN].connections.some((c) => c.program === 'sysupd')).toBe(true);
    expect(fileOn(world, ADMIN, k.path)).toContain(PW['k.nasser']);
    expect(fileOn(world, SERVER, '/var/log/auth.log')).toContain(`from ${world.hosts[ADMIN].ip}`);
    expect(fileOn(world, SERVER, '/var/log/audit/audit.log')).toContain('key="flag-read"');
  });

  it('loads an older save with no recorder state', () => {
    const { world } = setup();
    const old = JSON.parse(serializeWorld(world));
    delete old.toolkit.keyloggers;
    expect(deserializeWorld(JSON.stringify(old)).toolkit.keyloggers).toEqual([]);
  });
});
