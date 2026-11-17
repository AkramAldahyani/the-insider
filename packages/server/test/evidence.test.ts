/**
 * Phase 5, part C: the shared evidence board. Pins must be things the
 * player's own screen really showed; everybody playing sees the board.
 */
import { describe, expect, it } from 'vitest';
import { TICK_RATE, type EvidenceView } from '@insider/shared';
import { PW, Recorder } from './helpers';

const seconds = (s: number) => Math.round(s * TICK_RATE);
const board = (r: Recorder, client: string) => (r.last(client, 'board')?.payload as { items: EvidenceView[] } | undefined)?.items ?? [];

/** Sara (client "s") unlocked at her desk; Omar (client "o") somewhere else in the office. */
function saraAtWork(): Recorder {
  const r = new Recorder();
  r.connect('s', 'p1');
  r.connect('o', 'p4');
  r.sitAt('s', 'p1', 'FIN-LT-07');
  r.type('s', PW['s.alharbi']);
  return r;
}

describe('pinning text from a PC screen', () => {
  it('a line the screen showed goes on the board, for everybody', () => {
    const r = saraAtWork();
    const out = r.type('s', 'last -n 3');
    const line = out.split('\n').find((l) => l.startsWith('s.alharbi'))!;
    r.send('s', 'evidence.pin', { kind: 'screen', text: line });
    expect(r.notice('s')).toBe('Pinned to the evidence board as E1.');
    expect(board(r, 's')).toMatchObject([{ id: 'E1', kind: 'screen', title: 'FIN-LT-07 screen', text: line, pinnedBy: 'Sara Alharbi', mine: true }]);
    expect(board(r, 'o')).toMatchObject([{ id: 'E1', mine: false }]);
  });

  it('a selection may span the prompt, the typed command and its output, over several lines', () => {
    const r = saraAtWork();
    const out = r.type('s', 'whoami');
    const selection = `s.alharbi@FIN-LT-07:~$ whoami\n${out.trim()}\n`;
    r.send('s', 'evidence.pin', { kind: 'screen', text: selection });
    expect(board(r, 's')).toHaveLength(1);
  });

  it('made-up text, or text only someone else saw, is refused', () => {
    const r = saraAtWork();
    r.send('s', 'evidence.pin', { kind: 'screen', text: 'Accepted password for k.nasser from 10.0.2.71 port 40000 ssh2' });
    expect(r.notice('s')).toContain('Only text your screen really showed can be pinned');
    // Omar sits at Lina's open PC and sees something; Sara cannot pin it from her screen.
    r.sitAt('o', 'p4', 'HR-LT-03');
    const theirs = r.type('o', 'ls /home/l.haddad').trim();
    r.send('s', 'evidence.pin', { kind: 'screen', text: theirs });
    expect(board(r, 's')).toEqual([]);
    r.send('o', 'evidence.pin', { kind: 'screen', text: theirs });
    expect(board(r, 'o')).toHaveLength(1);
  });

  it('a password typed on screen is only stars, so the real password cannot be pinned', () => {
    const r = new Recorder();
    r.connect('s', 'p1');
    r.sitAt('s', 'p1', 'FIN-LT-07');
    r.type('s', PW['s.alharbi']);
    r.send('s', 'evidence.pin', { kind: 'screen', text: PW['s.alharbi'] });
    expect(board(r, 's')).toEqual([]);
  });

  it('pinning screen text needs a seat at a PC; nonsense is ignored', () => {
    const r = new Recorder();
    r.connect('s', 'p1');
    r.send('s', 'evidence.pin', { kind: 'screen', text: 'anything at all' });
    expect(r.notice('s')).toContain('Sit at a PC');
    r.send('s', 'evidence.pin', { kind: 'magic', text: 'x' });
    r.send('s', 'evidence.pin', { kind: 'screen', text: 42 });
    expect(r.messages('s', 'board').at(-1)).toMatchObject({ payload: { items: [] } });
  });
});

describe('pinning from the security monitors', () => {
  /** Tariq (client "g") at the monitors, after Maha came to work (badge line, camera picture). */
  function guardLooking(): Recorder {
    const r = new Recorder();
    r.connect('m', 'p9');
    r.tick(seconds(4));
    r.connect('g', 'p10');
    const station = r.map.furniture.find((f) => f.kind === 'monitors')!;
    expect(r.walkTo('g', 'p10', station.x + station.width / 2, station.y - 20)).toBe(true);
    r.send('g', 'monitors.open');
    return r;
  }

  it('a camera picture the guard is looking at can be pinned, with the picture itself', () => {
    const r = guardLooking();
    r.send('g', 'monitors.frame', { camera: 'CAM-01' });
    const shot = r.last('g', 'monitors.frame')!.payload as { id: string };
    r.send('g', 'evidence.pin', { kind: 'snapshot', camera: 'CAM-01', snapshot: shot.id });
    const item = board(r, 'g')[0];
    expect(item).toMatchObject({ kind: 'snapshot', title: 'CAM-01', pinnedBy: 'Tariq Omar' });
    expect(item.text).toContain('Maha Yousef');
    expect(item.frame!.people.map((p) => p.name)).toEqual(['Maha Yousef']);
    expect(board(r, 'm')[0].frame).toBeDefined(); // Maha sees the same picture on the board
  });

  it('a picture never shown to that player cannot be pinned', () => {
    const r = guardLooking();
    const unseen = r.game.cctv.recording('CAM-02').at(-1)!.id;
    r.send('g', 'evidence.pin', { kind: 'snapshot', camera: 'CAM-02', snapshot: unseen });
    expect(r.notice('g')).toContain('camera picture you are looking at');
    r.send('m', 'evidence.pin', { kind: 'snapshot', camera: 'CAM-01', snapshot: r.game.cctv.recording('CAM-01').at(-1)!.id });
    expect(board(r, 'm')).toEqual([]);
  });

  it('a badge-log line from the monitors can be pinned; a made-up one cannot', () => {
    const r = guardLooking();
    const index = r.last('g', 'monitors.index')!.payload as { badges: string[] };
    const line = index.badges.find((l) => l.includes('USER=m.yousef'))!;
    r.send('g', 'evidence.pin', { kind: 'log', source: 'badges', text: line });
    expect(board(r, 'g')).toMatchObject([{ kind: 'log', title: 'Badge log', text: line }]);
    r.send('g', 'evidence.pin', { kind: 'log', source: 'badges', text: line.replace('m.yousef', 'o.farouk') });
    expect(board(r, 'g')).toHaveLength(1);
  });
});

describe('the board', () => {
  it('only the person who pinned an item can take it down', () => {
    const r = saraAtWork();
    const line = r.type('s', 'hostname').trim();
    r.send('s', 'evidence.pin', { kind: 'screen', text: line });
    r.send('o', 'evidence.unpin', { id: 'E1' });
    expect(board(r, 'o')).toHaveLength(1);
    r.send('s', 'evidence.unpin', { id: 'E1' });
    expect(board(r, 'o')).toEqual([]);
  });

  it('a player who joins later gets the board as it is; items carry no player ids', () => {
    const r = saraAtWork();
    r.send('s', 'evidence.pin', { kind: 'screen', text: r.type('s', 'hostname').trim() });
    r.connect('late', 'p6');
    const items = board(r, 'late');
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]).sort()).toEqual(['id', 'kind', 'mine', 'pinnedBy', 'text', 'time', 'title']);
    expect(JSON.stringify(items)).not.toMatch(/"p\d+"/);
  });
});
