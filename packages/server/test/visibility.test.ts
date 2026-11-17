/**
 * THE VISIBILITY RULE, proven two ways.
 *
 * 1. "what the game sends": a scripted match with two players is played
 *    against OfficeGame, recording every message and every public state.
 * 2. "what goes over the wire": the same kind of match is played against a
 *    real Colyseus server through real WebSockets, recording every BYTE each
 *    browser receives (messages and state patches alike).
 *
 * Both recordings are then searched for things a player must never get:
 * other people's passwords, the root password, master-log entries, and the
 * text on screens they are not sitting at.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOM_NAME, TAP_DISTANCE, nearestReaderDoor, type PublicState } from '@insider/shared';
import { createGameServer } from '../src/app';
import { PW, ROOT_PW, Recorder, corners, findRoute, scenario } from './helpers';

/** Every secret in the scenario: all account passwords and the root password. */
const ALL_SECRETS = [...Object.values(PW), ROOT_PW];
/** Text that exists only in the master event log, never in anything a player may see. */
const MASTER_LOG_MARKERS = ['terminal.sit', 'terminal.leave', '"actor"', '"origin"', '"events"', 'session.lock', 'login.success', 'credentials'];
/** A line of Sara's private file, which she prints on her own screen during the match. */
const SARA_FILE_LINE = 'INV-2043,Najd Catering';

/** The allowed fields of every message type. Anything else is a leak. */
const ALLOWED_FIELDS: Record<string, string[]> = {
  lobby: ['scenarioName', 'mapName', 'employees', 'dev', 'hackerOpen'],
  welcome: ['playerId', 'card', 'mission'],
  'term.open': ['hostname', 'output', 'prompt', 'masked', 'screen', 'canSwitchUser'],
  'term.output': ['output', 'prompt', 'masked', 'screen', 'canSwitchUser'],
  'term.close': ['reason'],
  notice: ['text'],
  tasks: ['tasks', 'completed'],
  alert: ['text'],
  'match.over': ['winner', 'hacker', 'at'],
  'monitors.index': ['cameras', 'badges', 'motion'],
  'monitors.frame': ['camera', 'id', 'time', 'people'],
  board: ['items'],
};

/** Plays the match: Sara (client "sara") at her own PC, Omar (client "omar") at Lina's unlocked one. */
function playMatch(): Recorder {
  const r = new Recorder(); // dev: false, like production
  r.connect('sara', 'p1');
  r.connect('omar', 'p4');

  r.sitAt('sara', 'p1', 'FIN-LT-07');
  r.type('sara', 'not-my-password');
  r.type('sara', PW['s.alharbi']);
  r.type('sara', 'cat Documents/invoices_feb.csv');
  r.type('sara', 'cat /etc/shadow');
  r.type('sara', 'cat /etc/passwd');
  r.type('sara', 'ssh s.alharbi@ADMIN-SRV-01');
  r.type('sara', PW['s.alharbi']);
  r.type('sara', 'sudo cat /root/flag.txt');
  r.type('sara', PW['s.alharbi']);
  r.type('sara', 'last');
  r.type('sara', 'exit');
  r.type('sara', 'loginctl lock-session'); // (there is no auto-lock)

  r.sitAt('omar', 'p4', 'HR-LT-03');
  r.type('omar', 'whoami');
  r.type('omar', 'ls -la');
  r.type('omar', 'tail -n 20 /var/log/auth.log');
  r.type('omar', 'ssh k.nasser@ADMIN-SRV-01');
  r.type('omar', 'guess1');
  r.send('omar', 'term.cancel');
  r.send('omar', 'stand');

  // Things a production server must ignore.
  for (const client of ['sara', 'omar']) {
    r.send(client, 'dev.events', { count: 50 });
    r.send(client, 'dev.dump');
    r.send(client, 'dev.speed', { multiplier: 100 });
    r.send(client, 'dev.jump', { duration: '+1h' });
    r.send(client, 'dev.teleport', { hostname: 'ADMIN-SRV-01' });
    for (const what of ['bots', 'doors', 'badges', 'tasks', 'cctv', 'saw', 'file']) r.send(client, 'dev.show', { what, arg: 'ADMIN-SRV-01:/etc/shadow' });
  }
  r.tick(20 * 70);
  return r;
}

describe('visibility: what the game sends', () => {
  const r = playMatch();
  const streamOf = (client: string) => JSON.stringify(r.sent.get(client));
  const states = JSON.stringify(r.states);

  it('the match really happened (so the checks below mean something)', () => {
    expect(r.screen('sara').screen).toBe('locked'); // she locked it before leaving
    expect(streamOf('sara')).toContain(SARA_FILE_LINE);
    expect(streamOf('sara')).toContain('s.alharbi is not in the sudoers file');
    expect(streamOf('omar')).toContain('l.haddad\\n');
    expect(r.game.world.events.length).toBeGreaterThan(50);
  });

  it('a player receives their own password exactly once: on their onboarding card', () => {
    const own = PW['s.alharbi'];
    const withPassword = r.messages('sara').filter((m) => JSON.stringify(m.payload).includes(own));
    expect(withPassword.map((m) => m.type)).toEqual(['welcome']);
    // Typed passwords are never echoed back by the server.
    expect(streamOf('sara')).not.toContain('not-my-password');
    expect(streamOf('omar')).not.toContain('guess1');
  });

  it("no player ever receives someone else's password or the root password", () => {
    for (const [client, account] of [['sara', 's.alharbi'], ['omar', 'o.farouk']]) {
      const stream = streamOf(client);
      for (const secret of ALL_SECRETS) {
        if (secret === PW[account]) continue;
        expect(stream.includes(secret), `${client} received the secret "${secret}"`).toBe(false);
      }
    }
  });

  it('the public state contains no password, no master-log data and no file contents', () => {
    for (const secret of ALL_SECRETS) expect(states.includes(secret), `public state contains "${secret}"`).toBe(false);
    for (const marker of MASTER_LOG_MARKERS) expect(states).not.toContain(marker);
    expect(states).not.toContain(SARA_FILE_LINE);
  });

  it('the public state has exactly the documented shape', () => {
    for (const state of r.states as PublicState[]) {
      expect(Object.keys(state).sort()).toEqual(['clock', 'desks', 'doors', 'players', 'speed']);
      for (const door of Object.values(state.doors)) expect(Object.keys(door).sort()).toEqual(['id', 'look']);
      for (const player of Object.values(state.players)) {
        expect(Object.keys(player).sort()).toEqual(['activity', 'facing', 'id', 'name', 'seatedAt', 'x', 'y']);
      }
      for (const desk of Object.values(state.desks)) {
        expect(Object.keys(desk).sort()).toEqual(['hostname', 'lockUser', 'occupantId', 'screen']);
        // A username is public only when it is printed on a lock screen.
        if (desk.screen !== 'locked') expect(desk.lockUser).toBe('');
      }
    }
    // Lina's PC was open the whole time: her name never appeared in the public state.
    expect(states).not.toContain('l.haddad');
    expect(states).toContain('"lockUser":"s.alharbi"');
  });

  it('messages carry only their documented fields, and nothing from the master event log', () => {
    for (const [client, messages] of r.sent) {
      for (const m of messages) {
        expect(ALLOWED_FIELDS[m.type], `unexpected message type ${m.type}`).toBeDefined();
        const extra = Object.keys(m.payload as object).filter((k) => !ALLOWED_FIELDS[m.type].includes(k));
        expect(extra, `${m.type} to ${client} has extra fields`).toEqual([]);
      }
      for (const marker of MASTER_LOG_MARKERS) expect(streamOf(client)).not.toContain(marker);
    }
  });

  it('the text on a screen goes only to the player sitting at it', () => {
    expect(streamOf('omar')).not.toContain(SARA_FILE_LINE);
    expect(streamOf('omar')).not.toContain('s.alharbi is not in the sudoers file');
    // Sara never sat at HR-LT-03: she gets none of the prompts Omar saw there.
    expect(streamOf('sara')).not.toContain('l.haddad@HR-LT-03');
  });

  it('developer messages do nothing on a production server', () => {
    expect(r.messages('sara', 'dev.result' as never)).toHaveLength(0);
    expect(r.messages('omar', 'dev.result' as never)).toHaveLength(0);
    expect(r.game.speed).toBe(1);
    expect(r.game.publicState().players.p4.seatedAt).toBe('');
    // Not teleported: Omar is still next to HR-LT-03.
    const desk = r.map.desks.find((d) => d.hostname === 'HR-LT-03')!;
    expect(Math.hypot(r.position('p4').x - desk.seatX, r.position('p4').y - desk.seatY)).toBeLessThan(4);
  });

  it('a developer server can show the master log - which is why dev must be off in production', () => {
    const dev = new Recorder({ dev: true });
    dev.connect('a', 'p1');
    dev.send('a', 'dev.events', { count: 5 });
    expect((dev.last('a', 'dev.result')!.payload as { text: string }).text).toContain('Master event log');
    dev.send('a', 'dev.speed', { multiplier: 30 });
    expect(dev.game.speed).toBe(30);
    dev.send('a', 'dev.teleport', { hostname: 'ADMIN-SRV-01' });
    expect(dev.position('p1').x).toBeGreaterThan(50 * 32);
  });
});

// ───────────────────────────── Over a real network connection ─────────────────────────────

const PORT = 2599;

describe('visibility: what goes over the wire', () => {
  /** Everything each WebSocket received, as raw text (bytes mapped 1:1 to characters). */
  const received: string[] = [];
  let server: ReturnType<typeof createGameServer>;

  beforeAll(async () => {
    // Wrap the WebSocket class BEFORE the client library loads, so every
    // connection it opens reports its raw incoming frames to us.
    const Original = globalThis.WebSocket;
    globalThis.WebSocket = class Recording extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const index = received.push('') - 1;
        this.addEventListener('message', (event: MessageEvent) => {
          const data: unknown = event.data;
          received[index] += typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('latin1');
        });
      }
    } as typeof WebSocket;
    server = createGameServer({ dev: false, bots: false }); // an empty office: this test is about what two humans receive
    await server.listen(PORT);
  });

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it('no secret reaches a browser, in messages or in state patches', async () => {
    const { Client } = await import('colyseus.js');
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /** Joins, picks an employee and returns helpers to play as them. */
    async function join(playerId: string) {
      const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, { dev: true }); // a browser asking for dev: must be ignored
      const screens: { output: string; prompt: string }[] = [];
      let devReplies = 0;
      room.onMessage('*', (type, payload) => {
        if (type === 'term.open' || type === 'term.output') screens.push(payload as { output: string; prompt: string });
        if (type === 'dev.result') devReplies++;
      });
      await wait(100);
      room.send('choose', { playerId });
      await wait(100);
      const me = () => (room.state as unknown as { players: Map<string, { x: number; y: number; seatedAt: string }> }).players.get(playerId)!;
      const doorLook = (code: string) => (room.state as unknown as { doors: Map<string, { look: string }> }).doors.get(code)?.look;
      const line = async (text: string) => {
        room.send('term.line', { text });
        await wait(80);
        return screens[screens.length - 1];
      };
      /** Walks with `move` messages, steering by the position the SERVER reports. */
      const sitAt = async (hostname: string, map: Recorder['map']) => {
        const desk = map.desks.find((d) => d.hostname === hostname)!;
        for (const point of [...corners(findRoute(map, me().x, me().y, desk.seatX, desk.seatY)), { x: desk.seatX, y: desk.seatY }]) {
          for (let guard = 0; guard < 400; guard++) {
            const far = (axis: 'x' | 'y') => point[axis] - me()[axis];
            // Arrive within 6 px: a tile is 32 px and a player 20 px wide, so being
            // further off-centre than that can snag on a door frame at the next turn.
            const dx = Math.abs(far('x')) > 6 ? Math.sign(far('x')) : 0;
            const dy = Math.abs(far('y')) > 6 ? Math.sign(far('y')) : 0;
            if (dx === 0 && dy === 0) break;
            // At a closed door with a badge reader: tap (what pressing E does in the browser).
            const near = nearestReaderDoor(map, me().x, me().y);
            if (near && near.distance <= TAP_DISTANCE && doorLook(near.door.code) === 'closed') {
              room.send('tap', { door: near.door.code });
              await wait(80);
            }
            room.send('move', { dx, dy });
            await wait(60); // at least one server tick (50 ms), or the step might not happen at all
            // Close to the target: take one short step, stop, and look again.
            // (Walking on while reading a slightly old position would overshoot,
            // turn back, and oscillate on a slow machine.)
            if (Math.max(dx ? Math.abs(far('x')) : 0, dy ? Math.abs(far('y')) : 0) < 40) {
              room.send('move', { dx: 0, dy: 0 });
              await wait(130);
            }
          }
        }
        room.send('move', { dx: 0, dy: 0 });
        await wait(80);
        room.send('sit', { hostname });
        await wait(150);
      };
      return { room, screens, line, sitAt, me, devReplies: () => devReplies };
    }

    const map = new Recorder().map;
    const sara = await join('p1');
    const omar = await join('p4');

    await sara.sitAt('FIN-LT-07', map);
    expect(sara.screens[0]?.output).toContain('screen locked by s.alharbi');
    await sara.line(PW['s.alharbi']);
    expect((await sara.line('cat Documents/invoices_feb.csv')).output).toContain(SARA_FILE_LINE);
    await sara.line('ssh k.nasser@ADMIN-SRV-01');
    await sara.line('wrong-guess');
    sara.room.send('term.cancel', {});
    sara.room.send('dev.events', { count: 100 });

    await omar.sitAt('HR-LT-03', map);
    expect((await omar.line('whoami')).output).toBe('l.haddad\n');
    omar.room.send('dev.events', { count: 100 });
    omar.room.send('dev.dump', {});
    await wait(300);

    // Each client opened one WebSocket: Sara's is the first, Omar's the second.
    expect(received).toHaveLength(2);
    const [saraBytes, omarBytes] = received;

    // The recording works: it contains what the players legitimately got.
    expect(saraBytes).toContain('FIN-LT-07');
    expect(saraBytes).toContain(SARA_FILE_LINE);
    expect(saraBytes).toContain(PW['s.alharbi']); // her own card
    expect(omarBytes).toContain('l.haddad');
    expect(omarBytes).toContain(PW['o.farouk']); // his own card

    for (const [name, bytes, own] of [['sara', saraBytes, PW['s.alharbi']], ['omar', omarBytes, PW['o.farouk']]] as const) {
      for (const secret of ALL_SECRETS) {
        if (secret === own) continue;
        expect(bytes.includes(secret), `${name}'s browser received the secret "${secret}"`).toBe(false);
      }
      for (const marker of MASTER_LOG_MARKERS) expect(bytes.includes(marker), `${name}'s browser received "${marker}"`).toBe(false);
      expect(bytes).not.toContain('Master event log');
    }
    // Sara's screen text did not travel to Omar's browser.
    expect(omarBytes).not.toContain(SARA_FILE_LINE);
    // The browsers asked for dev tools (in the join options and with messages) and got nothing.
    expect(sara.devReplies() + omar.devReplies()).toBe(0);

    // Sanity: the scenario really has those other secrets.
    expect(scenario.accounts.length).toBeGreaterThanOrEqual(10);

    await sara.room.leave();
    await omar.room.leave();
  }, 60_000);
});
