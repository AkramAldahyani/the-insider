/**
 * Phase 4, part C (engine side): what the USB stick changes on a PC and the
 * evidence it leaves; the shoulder-surfing record.
 */
import { describe, expect, it } from 'vitest';
import { USB_COOLDOWN_MS, advanceTime, glimpse, plugUsb, queryEvents, shoulderSurf, usbCooldown } from '../src/index';
import { PW, Term, atDesk, fileOn, newWorld, scenario, ssh } from './helpers';

const START = Date.parse(scenario.startTime);
const kern = (world: ReturnType<typeof newWorld>, host: string) => fileOn(world, host, '/var/log/kern.log').split('\n').filter((l) => l.startsWith('Mar  2 09:'));

describe('the USB stick on an unlocked PC', () => {
  // Lina's PC (HR-LT-03) starts unlocked with nobody at it.
  it('sets up a backdoor for the logged-in user and says so', () => {
    const world = newWorld();
    const result = plugUsb(world, 'HR-LT-03', 'p4');
    expect(result).toEqual({ installed: true, text: 'Backdoor installed on HR-LT-03 for l.haddad (listening on port 4440). You can pull the stick out.' });
    expect(world.toolkit.backdoors).toMatchObject([{ host: 'HR-LT-03', account: 'l.haddad', port: 4440, player: 'p4', installedAt: world.time }]);
  });

  it('leaves kernel lines: a new USB keyboard, then its disconnection', () => {
    const world = newWorld();
    plugUsb(world, 'HR-LT-03', 'p4');
    const lines = kern(world, 'HR-LT-03');
    expect(lines.some((l) => l.includes('usb 1-1: new full-speed USB device number 2 using xhci_hcd'))).toBe(true);
    expect(lines.some((l) => l.includes('New USB device found, idVendor=1b4f, idProduct=9208'))).toBe(true);
    expect(lines.some((l) => l.includes('USB HID v1.11 Keyboard [USB Keyboard]'))).toBe(true);
    expect(lines.at(-1)).toContain('usb 1-1: USB disconnect, device number 2');
    // Readable with dmesg by the PC's owner (and everyone else at that keyboard).
    expect(new Term(world, 'HR-LT-03', 'p3').type('dmesg | grep -i usb | tail -n 2')).toContain('USB disconnect');
  });

  it('leaves an odd process, a listening port, a hidden file and an @reboot crontab line', () => {
    const world = newWorld();
    plugUsb(world, 'HR-LT-03', 'p4');
    const lina = new Term(world, 'HR-LT-03', 'p3');
    expect(lina.type('ps aux | grep sysupd')).toMatch(/l\.haddad +\d+ .* \/home\/l\.haddad\/\.cache\/\.sysupd\/sysupd -d/);
    expect(lina.type('ss -tln')).toContain('0.0.0.0:4440');
    expect(lina.type('ls -a .cache')).toContain('.sysupd');
    expect(lina.type('crontab -l')).toContain('@reboot /home/l.haddad/.cache/.sysupd/sysupd -d');
  });

  it('is recorded in the master log as done in person by the hacker', () => {
    const world = newWorld();
    plugUsb(world, 'HR-LT-03', 'p4');
    const types = queryEvents(world, { host: 'HR-LT-03', since: START }).map((e) => e.type);
    expect(types).toEqual(['usb.insert', 'backdoor.install', 'usb.remove']);
    for (const e of queryEvents(world, { host: 'HR-LT-03', since: START })) expect(e).toMatchObject({ actor: 'p4', origin: 'physical' });
    expect(queryEvents(world, { type: 'backdoor.install' })[0]).toMatchObject({ user: 'l.haddad', details: { port: 4440, via: 'usb' } });
  });

  it('killing the process shuts the backdoor: the port stops listening', () => {
    const world = newWorld();
    plugUsb(world, 'HR-LT-03', 'p4');
    const lina = new Term(world, 'HR-LT-03', 'p3');
    const pid = /l\.haddad +(\d+) .*sysupd -d/.exec(lina.type('ps aux'))![1];
    lina.type(`kill ${pid}`);
    expect(lina.type('ss -tln')).not.toContain(':4440');
  });

  it('a second stick on the same PC and user adds nothing', () => {
    const world = newWorld();
    plugUsb(world, 'HR-LT-03', 'p4');
    advanceTime(world, USB_COOLDOWN_MS);
    expect(plugUsb(world, 'HR-LT-03', 'p4')).toMatchObject({ installed: false, text: expect.stringContaining('already has your backdoor') });
    expect(world.toolkit.backdoors).toHaveLength(1);
  });

  it('starts a cooldown of 60 s for that player', () => {
    const world = newWorld();
    expect(usbCooldown(world, 'p4')).toBe(0);
    plugUsb(world, 'HR-LT-03', 'p4');
    expect(usbCooldown(world, 'p4')).toBe(60);
    advanceTime(world, 30_000);
    expect(usbCooldown(world, 'p4')).toBe(30);
    expect(usbCooldown(world, 'p1')).toBe(0);
    advanceTime(world, 30_000);
    expect(usbCooldown(world, 'p4')).toBe(0);
  });
});

describe('the USB stick on a locked PC', () => {
  it('achieves nothing, but the PC still logs the device', () => {
    const world = newWorld();
    const result = plugUsb(world, 'FIN-LT-07', 'p4'); // Sara's PC starts locked
    expect(result.installed).toBe(false);
    expect(result.text).toContain('FIN-LT-07 is locked');
    expect(world.toolkit.backdoors).toEqual([]);
    const lines = kern(world, 'FIN-LT-07');
    expect(lines.some((l) => l.includes('New USB device found'))).toBe(true);
    expect(lines.at(-1)).toContain('USB disconnect');
    expect(queryEvents(world, { host: 'FIN-LT-07', since: START }).map((e) => e.type)).toEqual(['usb.insert', 'usb.remove']);
    const sara = atDesk(world, 's.alharbi');
    expect(sara.type('ps aux')).not.toContain('sysupd');
  });

  it('a PC with nobody logged in is the same', () => {
    const world = newWorld();
    expect(plugUsb(world, 'FIN-LT-04', 'p4').installed).toBe(false);
  });
});

describe('shoulder surfing', () => {
  it('what the hacker saw goes to their own loot, never the whole password', () => {
    const world = newWorld();
    shoulderSurf(world, { hacker: 'p4', victim: 'p5', host: 'IT-WS-02', prompt: 'Password: ', pattern: 'T?o?b?d?r???K?' });
    expect(fileOn(world, 'MKT-LT-11', '/home/o.farouk/.tools/loot/shoulder.txt')).toMatch(/^2026-03-02 09:00:00 IT-WS-02 Khalid Nasser at "Password:": T\?o\?b\?d\?r\?\?\?K\?\n$/);
    const event = queryEvents(world, { type: 'shoulder.surf' })[0];
    expect(event).toMatchObject({ actor: 'p4', origin: 'physical', details: { victim: 'p5', revealed: 6, length: 14 } });
    expect(JSON.stringify(event)).not.toContain(PW['k.nasser']);
  });

  it('a glimpse keeps the length, shows some characters in place and hides the rest', () => {
    let seed = 1;
    const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const password = 'Tr0ub4dor&3xK9';
    let shown = 0;
    for (let i = 0; i < 200; i++) {
      const g = glimpse(password, next);
      expect(g).toHaveLength(password.length);
      expect([...g].some((ch) => ch !== '?')).toBe(true); // always at least one
      [...g].forEach((ch, k) => ch !== '?' && expect(ch).toBe(password[k]));
      shown += [...g].filter((ch) => ch !== '?').length;
    }
    const share = shown / (200 * password.length);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.5);
    expect(glimpse('', next)).toBe('');
  });
});

describe('a backdoor seen by a defender', () => {
  it('the sysadmin finds every trace from his own PC', () => {
    const world = newWorld();
    plugUsb(world, 'HR-LT-03', 'p4');
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', 'HR-LT-03');
    khalid.type('sudo ss -tlnp');
    expect(khalid.type(PW['k.nasser'])).toMatch(/0\.0\.0\.0:4440 .*users:\(\("sysupd",pid=\d+/);
    expect(khalid.type('sudo crontab -l -u l.haddad')).toContain('@reboot');
    expect(khalid.type('dmesg | grep idVendor')).toContain('idVendor=1b4f');
  });
});
