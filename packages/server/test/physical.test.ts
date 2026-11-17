/**
 * Phase 4, part C (server side): using the USB stick by holding a key at a
 * PC, and shoulder surfing. The rules, the 5 seconds and the "standing right
 * behind" check are all decided on the server.
 */
import { describe, expect, it } from 'vitest';
import { queryEvents } from '@insider/engine';
import { TICK_RATE } from '@insider/shared';
import { PW, Recorder, scenario } from './helpers';

const START = Date.parse(scenario.startTime);
const seconds = (s: number) => Math.round(s * TICK_RATE);
const notice = (r: Recorder, client: string) => r.notice(client);
const kernToday = (r: Recorder, host: string) => r.file(host, '/var/log/kern.log').split('\n').filter((l) => l.startsWith('Mar  2 09:'));
const activity = (r: Recorder, id: string) => r.game.publicState().players[id].activity;

/** A match where `playerId` joined as the hacker on client "h". */
function withHacker(playerId: string, options: ConstructorParameters<typeof Recorder>[0] = {}): Recorder {
  const r = new Recorder(options);
  r.connect('h');
  r.send('h', 'choose', { playerId, hacker: true });
  return r;
}

/** Walks a player to a desk's chair without sitting down. */
function standAtChair(r: Recorder, client: string, playerId: string, hostname: string): void {
  const desk = r.map.desks.find((d) => d.hostname === hostname)!;
  expect(r.walkTo(client, playerId, desk.seatX, desk.seatY)).toBe(true);
}

describe('the USB stick', () => {
  it('holding U for 5 seconds at an unlocked PC sets up the backdoor; everyone sees the hacker busy there', () => {
    const r = withHacker('p4'); // Omar
    standAtChair(r, 'h', 'p4', 'HR-LT-03'); // Lina's PC is open and she is not there
    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-03' });
    expect(notice(r, 'h')).toContain('keep holding U');
    expect(activity(r, 'p4')).toBe('at-pc');

    r.tick(seconds(4));
    expect(r.game.world.toolkit.backdoors).toEqual([]); // not yet
    r.tick(seconds(1.2));
    expect(notice(r, 'h')).toContain('Backdoor installed on HR-LT-03 for l.haddad');
    expect(r.game.world.toolkit.backdoors).toMatchObject([{ host: 'HR-LT-03', player: 'p4' }]);
    expect(activity(r, 'p4')).toBe('');
    // Letting go afterwards changes nothing.
    r.send('h', 'item.stop');
    expect(notice(r, 'h')).toContain('Backdoor installed');
  });

  it('letting go early, or walking off, does nothing at all (not even a USB line)', () => {
    const r = withHacker('p4');
    standAtChair(r, 'h', 'p4', 'HR-LT-03');
    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-03' });
    r.tick(seconds(2));
    r.send('h', 'item.stop');
    expect(notice(r, 'h')).toContain('You let go before it was done');
    expect(activity(r, 'p4')).toBe('');

    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-03' });
    r.tick(seconds(1));
    r.send('h', 'move', { dx: 1, dy: 0 });
    r.tick(2);
    expect(notice(r, 'h')).toContain('You moved away');
    r.send('h', 'move', { dx: 0, dy: 0 });
    r.tick(seconds(6));
    expect(r.game.world.toolkit.backdoors).toEqual([]);
    expect(kernToday(r, 'HR-LT-03').some((l) => l.includes('USB'))).toBe(false);
    expect(queryEvents(r.game.world, { type: 'usb.insert' })).toEqual([]);
  });

  it('only the hacker has a stick; it needs the chair within reach and nobody sitting there', () => {
    const r = withHacker('p4');
    r.connect('e', 'p3'); // Lina, an ordinary employee
    standAtChair(r, 'e', 'p3', 'HR-LT-05');
    r.send('e', 'item.start', { item: 'usb', hostname: 'HR-LT-05' });
    expect(activity(r, 'p3')).toBe('');
    r.tick(seconds(6));
    expect(queryEvents(r.game.world, { type: 'usb.insert' })).toEqual([]);

    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-03' }); // from his own desk in Marketing
    expect(notice(r, 'h')).toContain('too far');
    r.sitAt('e', 'p3', 'HR-LT-03');
    standAtChair(r, 'h', 'p4', 'HR-LT-05');
    r.walkTo('h', 'p4', r.map.desks.find((d) => d.hostname === 'HR-LT-03')!.seatX, r.map.desks.find((d) => d.hostname === 'HR-LT-03')!.seatY + 32);
    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-03' });
    expect(notice(r, 'h')).toContain('Lina Haddad is sitting at HR-LT-03');
    // Nonsense is ignored.
    r.send('h', 'item.start', { item: 'laser', hostname: 'HR-LT-03' });
    r.send('h', 'item.start', { item: 'usb', hostname: 'NOWHERE' });
    expect(activity(r, 'p4')).toBe('');
  });

  it('after one use the stick needs a minute', () => {
    const r = withHacker('p4');
    standAtChair(r, 'h', 'p4', 'HR-LT-03');
    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-03' });
    r.tick(seconds(5.2));
    standAtChair(r, 'h', 'p4', 'HR-LT-05');
    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-05' });
    expect(notice(r, 'h')).toMatch(/You need \d+ s before you can use the USB stick again/);
    expect(activity(r, 'p4')).toBe('');
  });

  it('at a locked PC under a camera: no backdoor, but the PC logs the device and the camera saw who knelt there', () => {
    const r = withHacker('p9'); // Maha, at reception; her own PC is locked and CAM-01 watches the room
    standAtChair(r, 'h', 'p9', 'REC-PC-01');
    r.send('h', 'item.start', { item: 'usb', hostname: 'REC-PC-01' });
    r.tick(seconds(3));
    const picture = r.game.cctv.at('CAM-01', r.game.world.time)!;
    expect(picture.people).toMatchObject([{ playerId: 'p9', activity: 'at-pc' }]);
    r.tick(seconds(2.5));
    expect(notice(r, 'h')).toContain('REC-PC-01 is locked');
    expect(kernToday(r, 'REC-PC-01').some((l) => l.includes('New USB device found'))).toBe(true);
    expect(r.game.world.toolkit.backdoors).toEqual([]);
  });

  it('other players receive no word about it, only what they could see: someone busy at a desk', () => {
    const r = withHacker('p4');
    r.connect('e', 'p3');
    standAtChair(r, 'h', 'p4', 'HR-LT-03');
    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-03' });
    r.tick(seconds(5.5));
    const other = JSON.stringify(r.sent.get('e'));
    for (const word of ['USB', 'usb', 'backdoor', 'Backdoor', 'sysupd', '4440']) expect(other.includes(word), word).toBe(false);
    expect(r.states.some((s) => s.players.p4?.activity === 'at-pc')).toBe(true);
  });
});

describe('shoulder surfing', () => {
  /** Sara (a human, client "s") sits at her locked PC; the hacker Omar stands where the test puts him. */
  function saraAtHerPc(dx: number, dy: number): Recorder {
    const r = withHacker('p4');
    r.connect('s', 'p1');
    r.sitAt('s', 'p1', 'FIN-LT-07');
    const desk = r.map.desks.find((d) => d.hostname === 'FIN-LT-07')!;
    expect(r.walkTo('h', 'p4', desk.seatX + dx, desk.seatY + dy)).toBe(true);
    return r;
  }

  it('standing right behind someone typing a password shows some of its characters', () => {
    const r = saraAtHerPc(0, 32);
    r.type('s', PW['s.alharbi']);
    expect(r.screen('s').screen).toBe('shell'); // she unlocked as normal
    const text = notice(r, 'h');
    const pattern = /: (\S+)  \(saved in/.exec(text)![1];
    expect(text).toContain('You saw Sara Alharbi type a password at FIN-LT-07 ("Password:")');
    expect(pattern).toHaveLength(PW['s.alharbi'].length);
    expect(pattern).not.toBe(PW['s.alharbi']);
    [...pattern].forEach((ch, i) => ch !== '?' && expect(ch).toBe(PW['s.alharbi'][i]));
    expect(r.file('MKT-LT-11', '/home/o.farouk/.tools/loot/shoulder.txt')).toContain(`FIN-LT-07 Sara Alharbi at "Password:": ${pattern}`);
    // Sara receives nothing about it (she would have to turn around and look).
    expect(JSON.stringify(r.sent.get('s'))).not.toMatch(/You saw|shoulder/);
  });

  it('only passwords count, and only from right behind', () => {
    const near = saraAtHerPc(0, 32);
    near.type('s', PW['s.alharbi']);
    near.type('s', 'ls -la'); // not a password
    expect(queryEvents(near.game.world, { type: 'shoulder.surf' })).toHaveLength(1);

    for (const [dx, dy] of [[0, 96], [64, 32], [-64, 0]]) { // too far back, beside but off to the side, level with her
      const far = saraAtHerPc(dx, dy);
      far.type('s', PW['s.alharbi']);
      expect(queryEvents(far.game.world, { type: 'shoulder.surf' }), `${dx},${dy}`).toEqual([]);
    }
  });

  it('a sudo or ssh password counts too, and the prompt says whose it is', () => {
    const r = saraAtHerPc(0, 32);
    r.type('s', PW['s.alharbi']);
    r.type('s', 'ssh ADMIN-SRV-01');
    r.type('s', PW['s.alharbi']);
    expect(notice(r, 'h')).toContain(`("s.alharbi@ADMIN-SRV-01's password:")`);
  });

  it('a bot typing its password can be watched too, and the bot may remember who stood behind it', () => {
    const r = withHacker('p4', { bots: true });
    const desk = r.map.desks.find((d) => d.hostname === 'FIN-LT-04')!; // Rami's PC: he logs in when he arrives
    expect(r.walkTo('h', 'p4', desk.seatX, desk.seatY + 32)).toBe(true);
    for (let i = 0; i < seconds(400) && queryEvents(r.game.world, { type: 'shoulder.surf' }).length === 0; i++) r.game.tick(1000 / TICK_RATE);
    r.flush();
    const surf = queryEvents(r.game.world, { type: 'shoulder.surf', since: START });
    expect(surf.length).toBeGreaterThanOrEqual(1);
    expect(surf[0].details.victim).toBe('p2');
    expect(notice(r, 'h')).toContain('You saw Rami Mansour type a password at FIN-LT-04');

    // Whether this bot noticed is chance (7 in 10); over many watched passwords, most are noticed.
    for (let i = 0; i < 40; i++) r.game.bots!.watchedBy('p2', { playerId: 'p4', name: 'Omar Farouk' }, 'Finance', 'FIN-LT-04');
    const notes = r.game.bots!.observations('p2').filter((o) => o.note?.includes('stood right behind me'));
    expect(notes.length).toBeGreaterThanOrEqual(20);
    expect(notes.every((o) => o.who === 'p4')).toBe(true);
  });
});
