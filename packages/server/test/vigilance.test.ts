/**
 * Phase 5a, part D: bots notice more. Traces on their own PC (processes,
 * connections, USB devices, logins), people at somebody else's desk, and
 * putting what they found on the evidence board.
 */
import { describe, expect, it } from 'vitest';
import { lastStamp, plugUsb, queryEvents, setHacker } from '@insider/engine';
import { TICK_RATE } from '@insider/shared';
import { SELF_CHECKS, inspect, today } from '../src/bots/brain';
import { judgeAccusation, judgePiece, type Judge } from '../src/judge';
import { PW, Recorder, scenario } from './helpers';

const START = Date.parse(scenario.startTime);
const me = { account: 'r.mansour', desk: 'FIN-LT-04', ip: '10.0.2.74', today: today(START) };
const texts = (command: string, output: string) => inspect(command, output, me).map((f) => f.text);
const seconds = (s: number) => Math.round(s * TICK_RATE);

describe('what an employee finds odd on their own PC', () => {
  it('a program from a hidden folder, or a remote shell; not the ordinary ones', () => {
    const ps = [
      'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
      'root           1  0.0  0.1 167744 11532 ?        Ss   Feb27   0:00 /sbin/init splash',
      'root         563  0.0  0.1  15436  9100 ?        Ss   Feb27   0:00 sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups',
      'message+     550  0.0  0.1   8756  4800 ?        Ss   Feb27   0:00 @dbus-daemon --system --address=systemd: --nofork',
      'r.manso+     763  0.0  0.1  12414  6362 tty1     Ss   09:00   0:00 -bash',
      'r.manso+     764  0.0  0.1  12414  6362 tty1     S+   09:00   0:00 cat /home/r.mansour/.bash_history',
      'r.manso+     765  0.0  0.1  18809  6597 ?        Sl   09:00   0:00 /home/r.mansour/.cache/.sysupd/sysupd -d',
      'r.manso+     768  0.0  0.1   8929  7231 pts/0    Ss   09:00   0:00 sysupd: remote shell',
    ].join('\n');
    expect(inspect('ps aux', ps, me)).toEqual([
      { text: 'A program I never started runs on my PC FIN-LT-04: /home/r.mansour/.cache/.sysupd/sysupd -d', weight: 0, line: ps.split('\n')[6].trim() },
      { text: 'A program I never started runs on my PC FIN-LT-04: sysupd: remote shell', weight: 0, line: ps.split('\n')[7].trim() },
    ]);
  });

  it('a connection that is not ssh, with the address at its other end', () => {
    const ss = [
      'State    Recv-Q   Send-Q     Local Address:Port      Peer Address:Port  Process',
      'ESTAB    0        0          10.0.2.74:4440        10.0.2.71:51525  users:(("sysupd",pid=768,fd=4))',
      'ESTAB    0        0          10.0.2.74:41000       10.0.1.10:22     users:(("ssh",pid=800,fd=3))', // logging in to the server
      'ESTAB    0        0          10.0.2.74:22          10.0.2.119:50100', // the administrator logging in here
    ].join('\n');
    expect(texts('ss -tnp', ss)).toEqual(['My PC FIN-LT-04 has a connection with 10.0.2.71 on port 4440 that I did not make (sysupd).']);
  });

  it('something waiting for connections, other than ssh', () => {
    const ss = 'State    Recv-Q   Send-Q     Local Address:Port      Peer Address:Port  Process\nLISTEN   0        128            0.0.0.0:22              0.0.0.0:*\nLISTEN   0        128          0.0.0.0:4440              0.0.0.0:*  users:(("sysupd",pid=765,fd=3))';
    expect(texts('ss -tlnp', ss)).toEqual(['Something waits for connections on port 4440 of my PC FIN-LT-04 (sysupd).']);
  });

  it('a USB keyboard plugged in after the PC started; not the devices it started with', () => {
    expect(texts('dmesg | tail -8', '[    1.722000] usb usb1: Product: xHCI Host Controller\n[    1.800000] usb 1-2: Product: USB Keyboard\n[264002.616000] usb 1-1: Product: USB Keyboard\n[264002.616000] usb 1-1: USB disconnect, device number 2'))
      .toEqual(['A USB Keyboard was plugged into my PC FIN-LT-04. That was not me.']);
  });

  it('somebody else logging in at the keyboard today', () => {
    const last = [`o.farouk   tty1                          ${lastStamp(START + 600_000)}   still logged in`, `r.mansour  tty1                          ${lastStamp(START)}   still logged in`,
      `o.farouk   tty1                          ${lastStamp(START - 4 * 86_400_000)} - 10:00  (00:05)`, 'reboot     system boot  5.15.0-105-gener Fri Feb 27 07:40   still running'].join('\n');
    expect(texts('last -n 10', last)).toEqual(['o.farouk logged in at my PC FIN-LT-04, sitting in front of it, at 09:10.']);
  });
});

describe('in the office', () => {
  it('bots run every check in turn, and an ordinary day gives them nothing to report', () => {
    for (const seed of [1, 2]) {
      const r = new Recorder({ bots: true, seed });
      for (let i = 0; i < 2 * 36_000; i++) r.game.tick(100); // two hours
      const typed = queryEvents(r.game.world, { type: 'command', since: START }).map((e) => String(e.details.command));
      for (const check of SELF_CHECKS) expect(typed.filter((c) => c === check).length, check).toBeGreaterThan(10);
      const said = scenario.players.flatMap((p) => r.game.bots!.findings(p.id)).map((f) => f.text);
      expect(said.filter((t) => !t.includes('stood right behind me'))).toEqual([]); // colleagues do walk past
      expect(r.game.board.items).toEqual([]);
    }
  }, 60_000);

  /** Rami (a bot) has a backdoor on his PC and somebody uses it from Omar's PC. */
  function infected(pinClues: number): Recorder {
    const r = new Recorder({ bots: true, seed: 3, weaknesses: [], botOptions: { pinClues } });
    r.connect('h');
    r.send('h', 'choose', { playerId: 'p4', hacker: true });
    for (let i = 0; i < 6000 && r.game.publicState().desks['FIN-LT-04'].screen !== 'unlocked'; i++) r.game.tick(100);
    expect(plugUsb(r.game.world, 'FIN-LT-04', 'p4').text).toContain('Backdoor installed');
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    expect(r.type('h', '~/.tools/implant FIN-LT-04')).toContain('Connected');
    for (let i = 0; i < 25 * 600; i++) r.game.tick(100); // one round of checks, at the latest
    r.flush();
    return r;
  }

  it('the owner of a PC finds the backdoor, the connection and the USB keyboard, and tells the meeting', () => {
    const r = infected(0);
    const found = r.game.bots!.findings('p2').map((f) => f.text).join('\n');
    const omar = r.game.world.hosts['MKT-LT-11'].ip;
    expect(found).toContain('A USB Keyboard was plugged into my PC FIN-LT-04');
    expect(found).toContain('sysupd');
    expect(found).toMatch(/Something waits for connections on port \d+ of my PC FIN-LT-04 \(sysupd\)/);
    expect(found).toContain(`has a connection with ${omar} on port`);
    expect(found).toContain('a line I never added');
    expect(r.game.bots!.findings('p2').every((f) => f.suspect !== 'p4' || f.weight > 0)).toBe(true);
    expect(r.game.board.items).toEqual([]); // nobody pins anything unless the match says so
    expect(r.game.bots!.speech('p2', () => 1).length).toBeGreaterThan(0);
    // Nobody else found anything on THEIR PC.
    for (const p of scenario.players) if (!['p2', 'p4'].includes(p.id)) expect(r.game.bots!.findings(p.id).filter((f) => f.text.includes('my PC') && f.weight === 0), p.name).toEqual([]);
  }, 30_000);

  it('with pinning on they put the lines on the board, as they were on the screen, up to the limit', () => {
    const r = infected(4);
    const items = r.game.board.items;
    expect(items).toHaveLength(4);
    for (const i of items) {
      // Rami found things on his PC; the SOC analyst found the alert about the new listener.
      expect(['p2', 'p11']).toContain(i.pinnedById);
      expect(i.kind).toBe('screen');
      expect(i.title).toBe(i.pinnedById === 'p2' ? 'FIN-LT-04 screen' : 'SOC-WS-01 screen');
    }
    expect(new Set(items.map((i) => i.text)).size).toBe(4);
  }, 30_000);

  it('the connection they found points at the PC at its other end', () => {
    const r = infected(20);
    const line = r.game.board.items.find((i) => i.text.startsWith('ESTAB'))!;
    expect(line, r.game.board.items.map((i) => i.text).join('\n')).toBeDefined();
    const judge: Judge = {
      staff: scenario.players.map((p) => ({ id: p.id, name: p.name, account: p.account, desk: p.desk, ip: r.game.world.hosts[p.desk].ip, uid: 0, badge: '', it: p.role === 'sysadmin' || p.role === 'helpdesk' })),
      today: '2026-03-02', roomAt: () => '',
    };
    expect(judgePiece(line, judge.staff.find((p) => p.id === 'p4')!, judge)).toEqual({ points: true, unusual: true });
    expect(judgePiece(line, judge.staff.find((p) => p.id === 'p7')!, judge)).toEqual({ points: false, unusual: false });
  }, 30_000);

  it('the hacker never reports its own traces', () => {
    const r = new Recorder({ bots: true, seed: 3, weaknesses: [], botOptions: { pinClues: 20 } });
    for (let i = 0; i < 6000 && r.game.publicState().desks['FIN-LT-04'].screen !== 'unlocked'; i++) r.game.tick(100);
    setHacker(r.game.world, 'p2'); // a bot on an ordinary day, as far as its routine goes
    expect(plugUsb(r.game.world, 'FIN-LT-04', 'p2').text).toContain('Backdoor installed');
    for (let i = 0; i < 25 * 600; i++) r.game.tick(100);
    expect(queryEvents(r.game.world, { type: 'command', actor: 'p2' }).some((e) => e.details.command === 'ps aux')).toBe(true); // it does look
    expect(r.game.bots!.findings('p2').filter((f) => f.weight === 0)).toEqual([]);
    expect(r.game.board.items.filter((i) => i.pinnedById === 'p2')).toEqual([]);
  }, 30_000);

  it('how often they check can be set', () => {
    const rounds = (checkMinutes: [number, number]) => {
      const r = new Recorder({ bots: true, seed: 5, botOptions: { checkMinutes } });
      for (let i = 0; i < 18_000; i++) r.game.tick(100); // half an hour
      return queryEvents(r.game.world, { type: 'command', since: START }).filter((e) => e.details.command === 'crontab -l').length;
    };
    expect(rounds([3, 6])).toBeGreaterThan(2 * rounds([15, 25]));
  }, 30_000);
});

describe('somebody at another person\'s desk', () => {
  /** Waits until Rami (p2) has left his desk while Sara's bot (p1) is at hers, in the same room. */
  function absent(as: string): Recorder {
    const r = new Recorder({ bots: true, seed: 2 });
    r.tick(seconds(260));
    for (let i = 0; i < 600 && r.game.bots!.list().find((b) => b.playerId === 'p2')?.seatedAt !== 'FIN-LT-04'; i++) r.tick(seconds(1));
    r.game.bots!.mind('p2')!.nextBreakAt = 0;
    r.game.bots!.mind('p1')!.nextBreakAt = r.game.world.time + 3_600_000; // Sara stays
    for (let i = 0; i < 60 && r.game.bots!.list().find((b) => b.playerId === 'p2')?.seatedAt; i++) r.tick(seconds(1));
    r.connect('x', as);
    return r;
  }
  const seen = (r: Recorder) => r.game.bots!.findings('p1').map((f) => ({ suspect: f.suspect, weight: f.weight, text: f.text.replace(/\d\d:\d\d/, '..') }));

  it('a colleague in the room remembers who sat there', () => {
    const r = absent('p4');
    expect(r.sitAt('x', 'p4', 'FIN-LT-04')).toBe(true);
    for (let i = 0; i < 60 && seen(r).length === 0; i++) r.tick(seconds(1));
    expect(seen(r)).toContainEqual({ suspect: 'p4', weight: 1, text: 'I saw Omar Farouk sitting at the PC of Rami Mansour at ...' });
  });

  it('and who did something to it, standing', () => {
    const r = absent('p4');
    r.send('x', 'choose', { playerId: 'p4' });
    setHacker(r.game.world, 'p4');
    const desk = r.map.desks.find((d) => d.hostname === 'FIN-LT-04')!;
    expect(r.walkTo('x', 'p4', desk.seatX, desk.seatY + 4)).toBe(true);
    r.send('x', 'item.start', { item: 'usb', hostname: 'FIN-LT-04' });
    r.tick(seconds(4));
    expect(seen(r)).toContainEqual({ suspect: 'p4', weight: 2, text: 'I saw Omar Farouk doing something to the PC of Rami Mansour at .., standing at it, not sitting.' });
  });

  it('the helpdesk working at somebody\'s PC is nothing special', () => {
    const r = absent('p8');
    expect(r.sitAt('x', 'p8', 'FIN-LT-04')).toBe(true);
    r.tick(seconds(20));
    expect(seen(r).filter((f) => f.suspect === 'p8')).toEqual([]);
  });

  it('what a witness says counts against that person, not against the owner of the PC they name', () => {
    const judge: Judge = {
      staff: scenario.players.map((p) => ({ id: p.id, name: p.name, account: p.account, desk: p.desk, ip: '', uid: 0, badge: '', it: false })),
      today: '2026-03-02', roomAt: () => '',
    };
    const said = [{ from: 'Sara Alharbi', text: 'I saw Omar Farouk sitting at the PC of Rami Mansour at 09:30.', suspect: 'p4' }];
    expect(judgeAccusation([], 'p4', judge, said).testimony).toBe('Sara Alharbi');
    expect(judgeAccusation([], 'p2', judge, said).testimony).toBe('');
  });
});
