/**
 * Phase 6, part H: the server stands up to strange, huge and too many
 * requests, and serves the page from the same address without giving anything
 * else away.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchMaker } from '@colyseus/core';
import type { Room } from 'colyseus.js';
import { PARTY_ROOM_NAME, ROOM_NAME, type ClientMessageType, type PartyView } from '@insider/shared';
import { Allowance, Allowances, JOIN_POINTS, MAX_WAITING, MESSAGE_POINTS, joinPrice, price } from '../src/allowance';
import { createGameServer } from '../src/app';
import type { OfficeGame } from '../src/game';
import { Gate, MAX_PER_ADDRESS, homeAddresses, isLoopback, mainAddress, ownOrigin, readPage } from '../src/gate';
import { TOO_MANY } from '../src/OfficeRoom';
import { Recorder } from './helpers';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(what: () => boolean, times = 150): Promise<void> {
  for (let i = 0; i < times && !what(); i++) await wait(20);
  expect(what()).toBe(true);
}

describe('allowances', () => {
  it('fill up slowly, and never above their size', () => {
    let now = 0;
    const a = new Allowance(10, 2, () => now);
    expect(a.full).toBe(true);
    a.take(10);
    expect(a.some).toBe(false);
    now = 600;
    expect(a.some).toBe(true);
    a.take(21); // an expensive one: below zero
    now = 5000;
    expect(a.some).toBe(false);
    now = 1_000_000;
    expect(a.full).toBe(true);
    expect(a.tryTake(10)).toBe(true);
    expect(a.tryTake(1)).toBe(false);
    now = 999_000; // a clock that goes back gives nothing
    expect(a.some).toBe(false);
  });

  it('the list of addresses forgets those that have not asked for a while', () => {
    const list = new Allowances(5, 1000);
    for (let i = 0; i < 5000; i++) list.of(`10.0.${i >> 8}.${i & 255}`);
    expect(list.count).toBeLessThanOrEqual(1001);
  });

  it('an ordinary player is far below the limits', () => {
    // Walking with all four keys, a line every second, chat, the board: some 15 messages a second.
    const second = 10 * price('move') + 3 * price('term.line') + 2 * price('chat.send');
    expect(second).toBeLessThan(MESSAGE_POINTS / 4);
    expect(joinPrice('joinById') * 30).toBeLessThan(JOIN_POINTS); // a whole class behind one address
  });
});

describe('who may ask', () => {
  const from = (origin: string | undefined, host = 'localhost:2567') => ownOrigin({ headers: { origin, host } as IncomingHttpHeaders });
  it('our own page, whatever its port; not other web pages', () => {
    for (const ok of [undefined, 'http://localhost:2567', 'http://localhost:5173', 'http://127.0.0.1:2567', 'http://[::1]:9']) expect(from(ok), String(ok)).toBe(true);
    expect(from('http://192.168.1.5:2567', '192.168.1.5:2567')).toBe(true);
    expect(from('https://game.example', 'game.example')).toBe(true);
    for (const bad of ['http://evil.example', 'https://localhost.evil.example', 'null', '', 'http://192.168.1.5:2567', 'file://']) expect(from(bad), bad).toBe(false);
    expect(from('http://192.168.1.6:2567', '192.168.1.5:2567')).toBe(false);
    expect([isLoopback('::1'), isLoopback('::ffff:127.0.0.1'), isLoopback('127.0.0.1.evil.example'), isLoopback('192.168.1.5'), isLoopback(undefined)]).toEqual([true, true, false, false, false]);
  });

  it('addresses at home: the real network first, virtual ones last', () => {
    const a = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as never;
    expect(homeAddresses({ 'vEthernet (WSL)': [a('172.20.0.1')], Loopback: [a('127.0.0.1', true)], 'Wi-Fi': [a('192.168.1.5')], Ethernet: [a('10.0.0.7')], x: [a('169.254.3.4')] })).toEqual(['192.168.1.5', '10.0.0.7', '172.20.0.1']);
    expect(homeAddresses({ a: [a('192.168.56.1')], b: [a('10.0.0.7')] }, '10.0.0.7')).toEqual(['10.0.0.7', '192.168.56.1']);
    expect(homeAddresses({})).toEqual([]);
  });
});

describe('the front door', () => {
  const PORT = 2595;
  let server: ReturnType<typeof createGameServer>;
  let dir = '';
  const client = async () => new (await import('colyseus.js')).Client(`ws://localhost:${PORT}`);
  const game = (roomId: string) => (matchMaker.getLocalRoomById(roomId) as unknown as { game: OfficeGame | null }).game;

  interface Answer { status: number; body: string; headers: IncomingHttpHeaders }
  function ask(path: string, { method = 'GET', headers = {}, body = '' as string | Buffer } = {}): Promise<Answer> {
    return new Promise((resolve, reject) => {
      const req = request({ port: PORT, host: 'localhost', path, method, headers }, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (d: Buffer) => parts.push(d));
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(parts).toString('latin1'), headers: res.headers }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  const post = (path: string, body: string, headers: Record<string, string> = {}) => ask(path, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), ...headers } });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'insider-page-'));
    mkdirSync(join(dir, 'dist', 'assets'), { recursive: true });
    writeFileSync(join(dir, 'secret.txt'), 'not for you');
    writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><title>The Insider</title>');
    writeFileSync(join(dir, 'dist', 'assets', 'index-abc.js'), `console.log("${'x'.repeat(5000)}")`);
    server = createGameServer({ dev: true });
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.gracefullyShutdown(false);
    rmSync(dir, { recursive: true, force: true });
  });
  afterEach(() => void vi.restoreAllMocks());

  it('serves exactly the files of the page', async () => {
    const files = readPage(join(dir, 'dist'));
    expect([...files.keys()].sort()).toEqual(['/', '/assets/index-abc.js', '/index.html']);
    expect(files.get('/assets/index-abc.js')).toMatchObject({ forEver: true, type: 'text/javascript; charset=utf-8' });
    expect(files.get('/assets/index-abc.js')!.zipped!.length).toBeLessThan(500);
    expect(files.get('/')).toMatchObject({ forEver: false, zipped: null });
    expect(readPage(join(dir, 'nothing')).size).toBe(0);
    expect(new Gate(join(dir, 'dist')).hasPage).toBe(true);
    expect(new Gate().hasPage).toBe(false);
  });

  it('sends them compressed, with rules for the browser', async () => {
    const http = createServer();
    new Gate(join(dir, 'dist')).guard(http);
    await new Promise<void>((resolve) => http.listen(PORT - 101, 'localhost', resolve));
    const get = async (path: string, init: RequestInit = {}) => fetch(`http://localhost:${PORT - 101}${path}`, init);
    const page = await get('/?lobby=BCDFG');
    expect([page.status, page.headers.get('content-type'), page.headers.get('cache-control')]).toEqual([200, 'text/html; charset=utf-8', 'no-cache']);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await page.text()).toContain('The Insider');
    const script = await get('/assets/index-abc.js');
    expect([script.headers.get('content-encoding'), script.headers.get('cache-control')]).toEqual(['gzip', 'public, max-age=31536000, immutable']);
    expect((await script.text()).length).toBeGreaterThan(5000);
    expect((await (await get('/', { method: 'HEAD' })).text())).toBe('');
    for (const path of ['/secret.txt', '/assets/', '/assets', '/..%2fsecret.txt', '/index.html/']) expect((await get(path)).status, path).toBe(404);
    await new Promise((resolve) => { http.close(resolve); http.closeAllConnections(); });
  });

  it('gives nothing else away', async () => {
    for (const path of ['/', '/secret.txt', '/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/..%2f..%2fpackage.json', '/package.json', '/.env', '/__proto__', '/constructor', '/colyseus', '/monitor', '/matchmaking', '//evil.example', '/\\..\\secret.txt']) {
      const a = await ask(path);
      if (path.includes('/matchmake')) expect(a.status, path).toBeGreaterThanOrEqual(400);
      else expect([a.status, a.body], path).toEqual([404, 'There is nothing here.']);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'TRACE']) expect((await ask('/', { method })).status, method).toBe(405);
  });

  it('tells its home address to pages on this computer only', async () => {
    const a = await ask('/address');
    expect(a.status).toBe(200);
    expect(JSON.parse(a.body)).toEqual({ addresses: homeAddresses(undefined, await mainAddress()) });
    expect((await ask('/address', { headers: { Origin: 'http://evil.example' } })).status).toBe(404);
  });

  it('requests to come in: only known ones, small, and not from other web pages', async () => {
    const ok = await post(`/matchmake/create/${PARTY_ROOM_NAME}`, '{"name":"Sam"}');
    expect(JSON.parse(ok.body)).toMatchObject({ sessionId: expect.any(String) });
    expect((await post(`/matchmake/create/${PARTY_ROOM_NAME}`, '{}', { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await ask('/matchmake/create/party', { method: 'PUT' })).status).toBe(405);
    expect((await ask('/matchmake/create/party')).status).toBe(405);
    for (const path of ['/matchmake/query/party', '/matchmake/', '/matchmake/create/', '/x?/matchmake/create/party/..', '/matchmake/__proto__/x', `/matchmake/create/${'a'.repeat(100)}`]) expect((await post(path, '{}')).status, path).toBe(404);
    expect((await post('/matchmake/create/party', JSON.stringify({ name: 'x'.repeat(10_000) }))).status).toBe(413);
    // Without saying how long it is, or pretending.
    expect((await ask('/matchmake/create/party', { method: 'POST', body: '{}', headers: { 'Transfer-Encoding': 'chunked' } })).status).toBe(413);
    for (const body of ['', 'null', '[]', '5', '"x"', '{', '{"name":{"toString":1}}', '{"__proto__":{"dev":true}}', '\u0000']) {
      const a = await post('/matchmake/joinById/ZZZZZ', body);
      expect([200, 400, 500], body).toContain(a.status);
      expect(JSON.parse(a.body).error, body).toBeTruthy();
    }
    expect(({} as { dev?: boolean }).dev).toBeUndefined();
  });

  it('so many connections from one address, and no more', () => {
    const gate = new Gate();
    const close: (() => void)[] = [];
    const req = (remoteAddress: string, origin?: string) => ({ req: { headers: { host: 'localhost:1', origin }, socket: { remoteAddress, once: (_: string, f: () => void) => void close.push(f) } } }) as never;
    for (let i = 0; i < MAX_PER_ADDRESS; i++) expect(gate.mayConnect(req('10.0.0.1'))).toBe(true);
    expect(gate.mayConnect(req('10.0.0.1'))).toBe(false);
    expect(gate.mayConnect(req('10.0.0.2'))).toBe(true);
    expect(gate.mayConnect(req('10.0.0.3', 'http://evil.example'))).toBe(false);
    close[0]();
    expect(gate.mayConnect(req('10.0.0.1'))).toBe(true);
    let total = MAX_PER_ADDRESS + 1;
    for (let i = 10; i < 30; i++) for (let k = 0; k < MAX_PER_ADDRESS; k++) if (gate.mayConnect(req(`10.0.0.${i}`))) total++;
    expect(total).toBe(300);
  });

  // ── Messages ──
  function watch(room: Room) {
    const messages: { type: string; payload: unknown }[] = [];
    let closed = 0;
    room.onMessage('*', (type, payload) => void messages.push({ type: String(type), payload }));
    room.onLeave((code) => { closed = code; });
    return { room, messages, closed: () => closed, last: (type: string) => messages.filter((m) => m.type === type).at(-1)?.payload };
  }
  const office = async (playerId: string) => {
    const b = watch(await (await client()).joinOrCreate(ROOM_NAME));
    b.room.send('choose', { playerId });
    await eventually(() => b.last('welcome') !== undefined);
    return b;
  };

  it('a burst is served in order, the rest waits; nothing is lost', async () => {
    const a = await office('p1');
    for (let i = 1; i <= 250; i++) a.room.send('move', { dx: 0, dy: 0, sequence: i });
    await eventually(() => (a.last('move.ack') as { sequence: number } | undefined)?.sequence === 250, 400);
    const order = a.messages.filter((m) => m.type === 'move.ack').map((m) => (m.payload as { sequence: number }).sequence);
    expect(order).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(a.closed()).toBe(0);
    await a.room.leave();
  }, 20_000);

  it('a flood closes the connection of the one who floods, and the others go on', async () => {
    const a = await office('p1');
    const b = await office('p2');
    for (let i = 0; i < MESSAGE_POINTS + MAX_WAITING + 300; i++) a.room.send('move', { dx: 0, dy: 0 });
    await eventually(() => a.closed() !== 0);
    expect(a.closed()).toBe(TOO_MANY);
    b.room.send('move', { dx: 0, dy: 0, sequence: 5 });
    await eventually(() => (b.last('move.ack') as { sequence: number } | undefined)?.sequence === 5);
    await b.room.leave();
  }, 20_000);

  it('a huge or broken message closes only that connection', async () => {
    const b = await office('p2');
    const a = await office('p1');
    a.room.send('chat.send', { text: 'x'.repeat(20_000) });
    await eventually(() => a.closed() !== 0);
    const c = await office('p3');
    (c.room as unknown as { connection: { send(data: Uint8Array): void } }).connection.send(new Uint8Array([13, 255, 255, 255, 255, 1, 2, 3]));
    await wait(200);
    b.room.send('move', { dx: 0, dy: 0, sequence: 9 });
    await eventually(() => (b.last('move.ack') as { sequence: number } | undefined)?.sequence === 9);
    await b.room.leave();
    if (c.closed() === 0) await c.room.leave();
  }, 20_000);

  it('a mistake in the program does not stop the match', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const a = await office('p1');
    const g = game(a.room.roomId)!;
    const handle = vi.spyOn(g, 'handle').mockImplementationOnce(() => { throw new Error('a mistake'); });
    a.room.send('stand', {});
    await eventually(() => error.mock.calls.length > 0);
    expect(String(error.mock.calls[0][0])).toContain('[insider] room');
    handle.mockRestore();
    const tick = vi.spyOn(g, 'tick').mockImplementationOnce(() => { throw new Error('another mistake'); });
    await eventually(() => error.mock.calls.length > 1);
    tick.mockRestore();
    const clock = g.world.time;
    await wait(200);
    expect(g.world.time).toBeGreaterThan(clock);
    a.room.send('move', { dx: 0, dy: 0, sequence: 3 });
    await eventually(() => (a.last('move.ack') as { sequence: number } | undefined)?.sequence === 3);
    await a.room.leave();
  }, 20_000);

  it('somebody whose messages always go wrong is sent away; the others stay', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const a = await office('p1');
    const b = await office('p2');
    const g = game(a.room.roomId)!;
    const real = g.handle.bind(g);
    vi.spyOn(g, 'handle').mockImplementation((id, type, payload) => { if (type === 'detain') throw new Error('a mistake'); real(id, type, payload); });
    for (let i = 0; i < 60; i++) a.room.send('detain', { target: 'p2' });
    await eventually(() => a.closed() !== 0);
    expect(a.closed()).toBe(TOO_MANY);
    expect(error.mock.calls.length).toBeLessThanOrEqual(60);
    b.room.send('move', { dx: 0, dy: 0, sequence: 8 });
    await eventually(() => (b.last('move.ack') as { sequence: number } | undefined)?.sequence === 8);
    await b.room.leave();
  }, 20_000);

  it('a room in which everything goes wrong is closed, and the server goes on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const a = await office('p1');
    vi.spyOn(game(a.room.roomId)!, 'tick').mockImplementation(() => { throw new Error('always'); });
    await eventually(() => a.closed() !== 0, 400);
    vi.restoreAllMocks();
    const b = await office('p2');
    expect(b.last('welcome')).toBeDefined();
    await b.room.leave();
  }, 20_000);

  it('a lobby’s match has no developer panel, also on a development server', async () => {
    const a = watch(await (await client()).create(PARTY_ROOM_NAME, { name: 'A' }));
    const b = watch(await (await client()).joinById(a.room.roomId, { name: 'B' }));
    b.room.send('party.ready', { ready: true });
    await eventually(() => (a.last('party') as PartyView | undefined)?.notYet === '');
    a.room.send('party.start', {});
    await eventually(() => a.last('welcome') !== undefined);
    expect(game(a.room.roomId)!.dev).toBe(false);
    // The host, who has just started it, is answered at once (a new world is not on their account).
    a.room.send('move', { dx: 0, dy: 0, sequence: 77 });
    const start = performance.now();
    await eventually(() => (a.last('move.ack') as { sequence: number } | undefined)?.sequence === 77);
    expect(performance.now() - start).toBeLessThan(500);
    expect(a.last('lobby')).toMatchObject({ dev: false });
    const speed = game(a.room.roomId)!.speed;
    a.room.send('dev.show', { what: 'mission' });
    a.room.send('dev.speed', { multiplier: 100 });
    await wait(200);
    expect(a.last('dev.result')).toBeUndefined();
    expect(game(a.room.roomId)!.speed).toBe(speed);
    // The shared office of a development server still has it.
    const o = await office('p1');
    expect(game(o.room.roomId)!.dev).toBe(true);
    for (const x of [a, b, o]) await x.room.leave();
  }, 20_000);

  // (The last one: it uses up this address's allowance.)
  it('guessing codes runs into the limit quickly', async () => {
    const answers: string[] = [];
    for (let i = 0; i < 60; i++) answers.push((await post('/matchmake/joinById/BBBBB', '{}')).body);
    expect(answers[0]).toContain('not found');
    expect(answers.at(-1)).toContain('Too many tries. Wait a moment.');
    expect(answers.filter((a) => a.includes('not found')).length).toBeLessThanOrEqual(JOIN_POINTS / 5 + 2);
    // The player is told so in words.
    await expect((await client()).create(PARTY_ROOM_NAME, { name: 'Sam' })).rejects.toThrow('Too many tries. Wait a moment.');
    // The page is still served.
    expect((await ask('/address')).status).toBe(200);
  }, 20_000);
});

describe('strange messages', () => {
  const TYPES: Record<ClientMessageType, true> = {
    'party.ready': true, 'party.settings': true, 'party.open': true, 'party.remove': true, 'party.start': true, 'party.back': true, 'party.look': true, choose: true, move: true, sit: true, stand: true, tap: true,
    'item.start': true, 'item.stop': true, 'monitors.open': true, 'monitors.frame': true, 'evidence.pin': true, 'evidence.unpin': true, detain: true, 'meeting.call': true, 'talk.call': true, 'meeting.accuse': true,
    'meeting.vote': true, 'chat.send': true, 'flag.submit': true, 'term.line': true, 'term.complete': true, 'term.cancel': true, 'term.switchUser': true, 'dev.speed': true, 'dev.jump': true, 'dev.events': true, 'dev.teleport': true, 'dev.dump': true, 'dev.show': true,
  };
  const STRANGE: unknown[] = [undefined, null, true, 0, -1, NaN, Infinity, 1e308, '', 'x', 'x'.repeat(5000), [], [[]], {}, { length: 5 }, '__proto__', 'constructor', 'p1', 'p4', 'E1', 'CAM-01', 'screen', 'snapshot', 'log', 'badges', 'usb', 'skip', 'FIN-LT-07', new Date(0), () => 1, Symbol.iterator, { toString: null }, { valueOf: () => { throw new Error('x'); } }, 10n];
  const FIELDS = ['playerId', 'hacker', 'dx', 'dy', 'sequence', 'hostname', 'door', 'item', 'camera', 'time', 'kind', 'text', 'snapshot', 'source', 'id', 'target', 'suspect', 'evidence', 'channel', 'multiplier', 'duration', 'count', 'what', 'arg', 'ready', 'open', 'name'];

  it('thousands of random ones: no exception, and nobody ends up somewhere impossible', () => {
    for (const dev of [false, true]) {
      const r = new Recorder({ dev, bots: true, meetingTimes: { discussionMs: 300, votingMs: 300, resultMs: 100, cooldownMs: 0, usesPerPlayer: 99 } });
      for (const id of ['p1', 'p4', 'p9']) r.connect(id, id);
      let s = 3;
      const pick = <T>(list: readonly T[]): T => list[(s = (Math.imul(s, 1103515245) + 12345) >>> 0) % list.length];
      const types = Object.keys(TYPES).concat(['', 'nonsense', '__proto__', 'constructor', 'dev.', 'party.', 'term.', 'x'.repeat(300)]);
      for (let i = 0; i < 6000; i++) {
        const type = pick(types);
        // (Time jumps and speeds would turn this test into a very long one.)
        if (type === 'dev.jump' || type === 'dev.speed' || type === 'dev.dump') continue;
        let payload: unknown = pick(STRANGE);
        if (pick([true, true, false])) {
          payload = {};
          for (let k = 0; k < 4; k++) {
            const v = pick(STRANGE);
            // What arrives over the network is plain data.
            if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' || (typeof v === 'object' && v !== null && 'valueOf' in v && Object.hasOwn(v, 'valueOf'))) continue;
            (payload as Record<string, unknown>)[pick(FIELDS)] = v;
          }
        }
        const who = pick(['p1', 'p4', 'p9', 'nobody', '']);
        try {
          r.game.handle(who, type, payload);
        } catch (error) {
          throw new Error(`${type} ${String(JSON.stringify(payload))}: ${(error as Error).stack}`);
        }
        if (i % 3 === 0) r.game.tick(50);
        r.game.drain();
      }
      for (const p of Object.values(r.game.publicState().players)) {
        expect([Number.isFinite(p.x), Number.isFinite(p.y)]).toEqual([true, true]);
        expect(p.x >= 0 && p.x <= r.map.width && p.y >= 0 && p.y <= r.map.height).toBe(true);
      }
      expect(Number.isFinite(r.game.world.time)).toBe(true);
      expect(Object.keys(Object.prototype)).toEqual([]);
      expect(() => JSON.stringify(r.game.world)).not.toThrow();
    }
  }, 60_000);
});
