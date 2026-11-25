/**
 * The front door (Phase 6, part H): every request from the network passes here
 * before Colyseus or the game sees it.
 *
 *  - The web page is served from the same address as the game, so friends need
 *    one link and one open port. All its files are read once at the start; a
 *    request can only name one of those, so it can never reach another file.
 *  - Requests to come into a room are limited per network address, in size and
 *    in number, which also makes guessing lobby codes hopeless.
 *  - Other web pages may not talk to this server through a visitor's browser.
 */
import { createSocket } from 'node:dgram';
import { readFileSync, readdirSync } from 'node:fs';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Allowances, JOIN_POINTS, JOIN_REFILL, joinPrice } from './allowance';

/** The largest request to come into a room. (It holds a name or a solo choice.) */
const MAX_BODY = 4096;
/** Open connections, all together and from one network address. */
export const MAX_CONNECTIONS = 300;
export const MAX_PER_ADDRESS = 60;
const METHODS = ['joinOrCreate', 'create', 'join', 'joinById', 'reconnect'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};
/** What the page may do: load its own files and talk to this server, nothing else. */
const POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

interface PageFile {
  body: Buffer;
  /** Compressed, if that is smaller. */
  zipped: Buffer | null;
  type: string;
  /** Files with a hash in their name never change. */
  forEver: boolean;
}

/** Reads the built page. An empty list if there is none (in development Vite serves it). */
export function readPage(dir: string): Map<string, PageFile> {
  const files = new Map<string, PageFile>();
  const visit = (folder: string, url: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(folder, entry.name), `${url}${entry.name}/`);
      else if (entry.isFile()) {
        const body = readFileSync(join(folder, entry.name));
        const zipped = gzipSync(body);
        files.set(`${url}${entry.name}`, { body, zipped: zipped.length < body.length * 0.9 ? zipped : null, type: TYPES[extname(entry.name)] ?? 'application/octet-stream', forEver: url.startsWith('/assets/') });
      }
    }
  };
  try {
    visit(dir, '/');
  } catch {
    return new Map();
  }
  const index = files.get('/index.html');
  if (index) files.set('/', index);
  return files;
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|::ffff:127\.\d+\.\d+\.\d+)$/i;
export const isLoopback = (name: string | undefined): boolean => LOOPBACK.test(name ?? '');
const hostOf = (address: string): string => address.replace(/:\d+$/, '').toLowerCase();

/**
 * Was this request made by one of our own pages? Browsers say where a page came
 * from ("Origin") and programs say nothing. The port may differ: in development
 * the page has another one than the game.
 */
export function ownOrigin(req: Pick<IncomingMessage, 'headers'>): boolean {
  const { origin, host } = req.headers;
  if (origin === undefined) return true;
  let name: string;
  try {
    name = new URL(origin).hostname.toLowerCase();
  } catch {
    return false; // "null": a page without an address
  }
  const here = hostOf(host ?? '');
  return name === here || (isLoopback(name) && isLoopback(here));
}

/** Network adapters that other computers in the house cannot reach. */
const VIRTUAL = /vethernet|wsl|virtualbox|vmware|hyper-v|docker|loopback|tailscale|zerotier|vpn|tun|tap/i;

/**
 * The address this computer uses to talk to other networks: the one friends at
 * home can reach. The operating system is only asked which way it WOULD go
 * ("connecting" a UDP socket sends nothing, and 192.0.2.1 belongs to nobody).
 */
export function mainAddress(): Promise<string> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const done = (address: string) => {
      try {
        socket.close();
      } catch {
        // Closed already.
      }
      resolve(address);
    };
    socket.on('error', () => done(''));
    socket.connect(9, '192.0.2.1', () => done(socket.address().address));
  });
}

/** The addresses of this computer in the home network, the likeliest first. `main`: see mainAddress. */
export function homeAddresses(interfaces = networkInterfaces(), main = ''): string[] {
  const rank = (ip: string, name: string) => (ip === main ? -100 : 0) + (VIRTUAL.test(name) ? 10 : 0) + (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 5);
  return Object.entries(interfaces)
    .flatMap(([name, list]) => (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map((a) => ({ ip: a.address, rank: rank(a.address, name) })))
    .sort((a, b) => a.rank - b.rank)
    .map((a) => a.ip);
}

export class Gate {
  private readonly joins = new Allowances(JOIN_POINTS, JOIN_REFILL);
  private readonly page: Map<string, PageFile>;
  /** Network address -> open connections. */
  private readonly open = new Map<string, number>();
  private total = 0;
  private main = '';

  constructor(pageDir?: string) {
    this.page = pageDir ? readPage(pageDir) : new Map();
    void mainAddress().then((address) => { this.main = address; });
  }

  get hasPage(): boolean {
    return this.page.has('/');
  }

  /** May this connection be opened? (The `verifyClient` of the WebSocket server.) */
  mayConnect = ({ req }: { req: IncomingMessage }): boolean => {
    const address = req.socket.remoteAddress ?? '';
    const mine = this.open.get(address) ?? 0;
    if (!ownOrigin(req) || this.total >= MAX_CONNECTIONS || mine >= MAX_PER_ADDRESS) return false;
    this.total++;
    this.open.set(address, mine + 1);
    req.socket.once('close', () => {
      this.total--;
      const left = (this.open.get(address) ?? 1) - 1;
      if (left > 0) this.open.set(address, left);
      else this.open.delete(address);
    });
    return true;
  };

  /** Stands in front of everything that answers requests on this server. Call it after Colyseus has attached itself. */
  guard(server: HttpServer): void {
    const inside = server.listeners('request').slice() as ((req: IncomingMessage, res: ServerResponse) => void)[];
    server.removeAllListeners('request');
    // A request must arrive quickly: nobody may keep connections busy by sending one letter a minute.
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    server.on('request', (req, res) => {
      if ((req.url ?? '').includes('/matchmake')) {
        if (this.refuse(req, res)) return;
        for (const listener of inside) listener.call(server, req, res);
      } else this.serve(req, res);
    });
  }

  /** Requests to come into a room. True = answered here (with no). */
  private refuse(req: IncomingMessage, res: ServerResponse): boolean {
    // (A no to somebody who plays looks like one of Colyseus' own: its client then knows the text.)
    const no = (status: number, text: string): true => {
      res.writeHead(status === 429 ? 200 : status, { 'Content-Type': 'application/json', Connection: 'close', 'Access-Control-Allow-Origin': req.headers.origin ?? '*' });
      res.end(JSON.stringify({ code: status, error: text }));
      return true;
    };
    if (!ownOrigin(req)) return no(403, 'This page may not use this server.');
    if (req.method === 'OPTIONS') return false;
    if (req.method !== 'POST') return no(405, 'Not possible.');
    const length = Number(req.headers['content-length']);
    if (!(length >= 0 && length <= MAX_BODY)) return no(413, 'Too much.');
    const method = METHODS.find((m) => new RegExp(`/matchmake/${m}/[A-Za-z0-9_-]{1,64}$`).test(req.url ?? ''));
    if (!method) return no(404, 'There is nothing here.');
    // The address of the connection itself. (What a request SAYS about where it comes from can be invented.)
    if (!this.joins.of(req.socket.remoteAddress ?? '').tryTake(joinPrice(method))) return no(429, 'Too many tries. Wait a moment.');
    return false;
  }

  /** The web page. */
  private serve(req: IncomingMessage, res: ServerResponse): void {
    const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const answer = (status: number, type: string, body: string | Buffer, more: Record<string, string> = {}) => {
      res.writeHead(status, { ...headers, 'Content-Type': type, ...more });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return answer(405, 'text/plain', 'Not possible.', { Connection: 'close' });
    const path = (req.url ?? '/').split('?')[0];
    // For the host's own page only: which address friends at home can use. (Others reached this server, so they know it.)
    if (path === '/address') {
      if (!isLoopback(req.socket.remoteAddress) || !ownOrigin(req)) return answer(404, 'text/plain', 'There is nothing here.');
      return answer(200, 'application/json', JSON.stringify({ addresses: homeAddresses(undefined, this.main) }), { 'Cache-Control': 'no-store' });
    }
    const file = this.page.get(path);
    if (!file) return answer(404, 'text/plain', 'There is nothing here.');
    const zip = file.zipped !== null && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    answer(200, file.type, zip ? file.zipped! : file.body, {
      'Content-Security-Policy': POLICY,
      'Cache-Control': file.forEver ? 'public, max-age=31536000, immutable' : 'no-cache',
      Vary: 'Accept-Encoding',
      ...(zip ? { 'Content-Encoding': 'gzip' } : {}),
    });
  }
}
