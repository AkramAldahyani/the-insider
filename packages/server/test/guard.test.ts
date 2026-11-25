/**
 * Phase 5, part E: the guard's detain, and the helpdesk's new password
 * reaching (only) the employee it belongs to.
 */
import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '@insider/shared';
import { PW, Recorder } from './helpers';

const seconds = (s: number) => Math.round(s * TICK_RATE);

/** Walks the guard (Tariq, p10) up to someone. */
function nextTo(r: Recorder, guardClient: string, targetId: string): void {
  const t = r.position(targetId);
  expect(r.walkTo(guardClient, 'p10', t.x + 30, t.y) || r.walkTo(guardClient, 'p10', t.x - 30, t.y) || r.walkTo(guardClient, 'p10', t.x, t.y + 30)).toBe(true);
}

describe('the guard detains someone', () => {
  it('the hacker: the defenders win', () => {
    const r = new Recorder();
    r.connect('o', 'p4');
    r.connect('t', 'p10');
    r.connect('s', 'p1');
    r.game.world.mission.hackers = ['p4'];
    nextTo(r, 't', 'p4');
    r.send('t', 'detain', { target: 'p4' });
    for (const c of ['o', 't', 's']) {
      expect(r.last(c, 'match.over')!.payload, c).toMatchObject({ winner: 'defenders', hacker: 'Omar Farouk', reason: 'Tariq Omar caught Omar Farouk in the act.' });
    }
    expect(r.game.detentions).toEqual([expect.objectContaining({ guardId: 'p10', targetId: 'p4', wasHacker: true })]);
  });

  it('an innocent person: they are let go, everybody hears, and the guard loses the power', () => {
    const r = new Recorder();
    r.connect('o', 'p4');
    r.connect('t', 'p10');
    r.connect('s', 'p1');
    r.game.world.mission.hackers = ['p9'];
    nextTo(r, 't', 'p4');
    r.send('t', 'detain', { target: 'p4' });
    expect(r.last('s', 'match.over')).toBeUndefined();
    for (const c of ['o', 't', 's']) expect(r.notice(c)).toContain('Tariq Omar detained Omar Farouk, who was not the hacker');
    r.send('t', 'detain', { target: 'p4' });
    expect(r.notice('t')).toBe('You detained an innocent person: you cannot detain anyone any more.');
    expect(r.game.detentions).toHaveLength(1);
  });

  it('only the guard, only up close', () => {
    const r = new Recorder();
    r.connect('o', 'p4');
    r.connect('t', 'p10');
    r.connect('s', 'p1');
    r.game.world.mission.hackers = ['p4'];
    r.send('s', 'detain', { target: 'p4' });
    expect(r.notice('s')).toBe('Only the security guard can detain people.');
    expect(r.sitAt('o', 'p4', 'MKT-LT-11')).toBe(true); // Omar goes to his desk
    const g = r.position('p10');
    const o = r.position('p4');
    expect(Math.hypot(g.x - o.x, g.y - o.y)).toBeGreaterThan(64);
    r.send('t', 'detain', { target: 'p4' });
    expect(r.notice('t')).toBe('You must stand next to Omar Farouk to detain them.');
    r.send('t', 'detain', { target: 'p10' }); // yourself: nothing happens
    expect(r.game.detentions).toHaveLength(0);
    expect(r.last('t', 'match.over')).toBeUndefined();
  });
});

describe('the helpdesk resets a password', () => {
  function reset(r: Recorder, account: string): string {
    r.connect('d', 'p8');
    expect(r.sitAt('d', 'p8', 'IT-WS-01')).toBe(true);
    if (r.screen('d').prompt.endsWith('login: ')) r.type('d', 'd.aziz');
    r.type('d', PW['d.aziz']);
    const out = r.type('d', `helpdesk reset ${account}`);
    r.tick(1);
    return /New password: (\S+)/.exec(out)?.[1] ?? '';
  }

  it('the employee (and nobody else) gets the new password on their card', () => {
    const r = new Recorder();
    r.connect('r', 'p2');
    r.connect('s', 'p1');
    const password = reset(r, 'r.mansour');
    expect(password).not.toBe('');
    expect(r.last('r', 'card')!.payload).toMatchObject({ card: { password } });
    expect(r.notice('r')).toContain('The helpdesk reset your password');
    expect(r.last('s', 'card')).toBeUndefined();
    expect(JSON.stringify(r.messages('s'))).not.toContain(password);
  });

  it('a bot learns its new password and can still log in', () => {
    const r = new Recorder({ bots: true });
    r.tick(seconds(250)); // everybody has arrived
    const password = reset(r, 'y.khalil'); // Yousef, a bot
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- peeking at the bot's memory
    const bot = (r.game.bots as any).bots.get('p7');
    expect(password).not.toBe('');
    expect(bot.subject.persona.password).toBe(password);
  });
});
