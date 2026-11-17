import { describe, expect, it } from 'vitest';
import { advanceTime, queryEvents } from '@insider/engine';
import { resetLink } from '../src/bots/brain';
import { PW, Recorder } from './helpers';

function match(bots = false) {
  const r = new Recorder({ weaknesses: [], bots });
  r.connect('h');
  r.send('h', 'choose', { playerId: 'p4', hacker: true });
  r.sitAt('h', 'p4', 'MKT-LT-11');
  r.type('h', PW['o.farouk']);
  return r;
}

describe('Phase 4 E visibility', () => {
  it('mail and results stay private; a bystander and a lobby client receive neither', () => {
    const r = match();
    r.connect('v', 'p3');
    r.connect('e', 'p1');
    r.connect('lobby');
    expect(r.type('h', '~/.tools/phish l.haddad')).toContain('Reset message sent');
    const m = r.game.world.toolkit.phishing[0];
    r.sitAt('v', 'p3', 'HR-LT-03');
    const count = r.game.world.mail.messages.filter((x) => x.to.includes('l.haddad')).length;
    expect(r.type('v', `mail ${count}`)).toContain('spf=fail');
    expect(r.type('v', `curl ${m.url}`)).toContain('request has been received');
    expect(r.type('h', `cat ${m.path}`)).toContain(PW['l.haddad']);
    for (const client of ['e', 'lobby']) {
      const stream = JSON.stringify(r.sent.get(client));
      for (const secret of [PW['l.haddad'], m.url, m.path, 'spf=fail', 'phish.submit']) expect(stream).not.toContain(secret);
    }
    expect(JSON.stringify(r.states)).not.toMatch(/phishing|toolkit|password-reset|phish-/);
  });

  it('cleaning a log does not rewrite evidence already pinned by a player', () => {
    const r = match();
    r.connect('admin', 'p5');
    r.sitAt('admin', 'p5', 'IT-WS-02');
    r.type('admin', PW['k.nasser']);
    r.type('admin', 'ssh k.nasser@MKT-LT-11');
    r.type('admin', PW['k.nasser']);
    const text = r.type('admin', 'grep "session opened" /var/log/auth.log | tail -n 1').trim();
    expect(text).not.toBe('');
    r.send('admin', 'evidence.pin', { kind: 'screen', text });
    const before = r.last('h', 'board')!.payload;
    r.type('admin', 'sudo -s');
    r.type('admin', PW['k.nasser']);
    expect(r.type('admin', '/home/o.farouk/.tools/clean /var/log/auth.log "session opened"')).toContain('removed');
    expect(r.file('MKT-LT-11', '/var/log/auth.log')).not.toContain(text);
    expect(r.last('h', 'board')!.payload).toEqual(before);
    expect(JSON.stringify(before)).toContain(text);
  });
});

describe('bot inbox decisions', () => {
  it('follows a fixed game link for 30 percent of rolls, and never executes arbitrary mail text', () => {
    const message = 'From: IT\n\nPlease visit:\nhttps://password-reset.example/reset/12\n';
    expect(Array.from({ length: 100 }, (_, n) => resetLink(message, n / 100)).filter(Boolean)).toHaveLength(30);
    for (const body of ['https://outside.example/reset/12', 'https://password-reset.example/reset/12; whoami', '$(whoami)', 'https://password-reset.example/reset/12 && whoami']) {
      expect(resetLink(`From: IT\n\n${body}`, 0)).toBe('');
    }
    expect(resetLink('Subject: https://password-reset.example/reset/12\n\nNo link here.', 0)).toBe('');
  });

  it('bots read their own mail and some visit through their own terminals, leaving ordinary web evidence', () => {
    const r = match(true);
    const recipients = r.game.world.players.filter((p) => p.id !== 'p4');
    for (const p of recipients) {
      advanceTime(r.game.world, 60_000);
      expect(r.type('h', `~/.tools/phish ${p.account}`)).toContain('Reset message sent');
    }
    // Let the office run, retaining no thousands of identical physical snapshots.
    for (let tick = 0; tick < 20 * 60 * 20; tick++) {
      r.game.tick(50);
      r.game.drain();
    }
    const world = r.game.world;
    const campaigns = world.toolkit.phishing;
    expect(campaigns.filter((m) => m.captured).length).toBeGreaterThan(0);
    expect(campaigns.filter((m) => !m.captured).length).toBeGreaterThan(0);
    for (const campaign of campaigns) {
      const mail = world.mail.messages.find((m) => m.id === campaign.mailId)!;
      expect(mail.readBy).toContain(campaign.recipient);
      if (!campaign.captured) continue;
      const p = recipients.find((p) => p.account === campaign.recipient)!;
      expect(queryEvents(world, { type: 'phish.submit' })).toContainEqual(expect.objectContaining({ actor: p.id, host: p.desk, user: p.account }));
      expect(r.file(world.web.proxyHost, '/var/log/squid/access.log')).toContain(`${p.account} GET ${campaign.url}`);
      expect(r.file('MKT-LT-11', campaign.path)).toContain(PW[p.account]);
    }
  }, 60_000);
});
