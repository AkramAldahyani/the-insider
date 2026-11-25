/**
 * The post-match debrief, server side (DESIGN.md section 11).
 *
 * The engine says what the hacker did and what evidence each step left
 * (engine/src/debrief/debrief.ts). This file adds what PEOPLE did with it:
 *  - SEEN: a piece of evidence was on the screen of somebody who was not the
 *    hacker (a terminal, or the security monitors);
 *  - PINNED: it is on the evidence board;
 *  - MISSED: it was there, and nobody looked;
 * plus the camera pictures the hacker is in, what the bots noticed, and how
 * the meetings went.
 *
 * It is built only when the match is over. Nothing here is sent before that.
 * Passwords are removed from every text: the scenario's passwords are the same
 * in the next match, and a debrief must not spoil it (or break the rule that
 * browsers never receive anyone else's credentials).
 */
import { debriefSteps, isHacker, pinShows, shows, weaknessNotes, type DebriefEvidence, type DebriefStep, type World } from '@insider/engine';
import type { DebriefEvidenceView, DebriefStepView, DebriefView } from '@insider/shared';
import type { Cctv } from './cctv';
import type { EvidenceItem } from './evidence';
import type { Finding } from './bots/manager';
import type { Meeting } from './meeting';

/** Cameras: a picture this close in time (game ms) to something physical belongs to it. */
const PICTURE_MS = 60_000;
/** Steps done with the body, which a camera could film. */
const PHYSICAL = new Set(['usb.insert', 'shoulder.surf', 'unattended.use', 'login.success', 'session.unlock', 'unlock.fail', 'login.fail', 'badge.tap', 'door.pass']);
const MAX_STEPS = 300;
const MAX_EVIDENCE = 16;
const MAX_PICTURES_SEEN = 2000;

const clock = (t: number) => new Date(t).toISOString().slice(11, 19);
/** "A", "A and B", "A, B and C". */
export const nameList = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const keyOf = (e: DebriefEvidence) => `${e.host}|${e.where}|${e.text}`;

/** What the debrief needs from the match. */
export interface DebriefInput {
  winner: 'hacker' | 'defenders';
  reason: string;
  at: number;
  startedAt: number;
  cctv: Cctv;
  board: EvidenceItem[];
  meetings: Meeting[];
  detentions: { time: number; guardId: string; targetId: string; wasHacker: boolean }[];
  /** What each bot noticed. */
  findings: { playerId: string; list: Finding[] }[];
  reputation: number;
}

export class Debrief {
  /** Evidence -> players who had it on their screen. */
  private readonly seen = new Map<string, Set<string>>();
  private readonly pictures: { playerId: string; camera: string; time: number; names: string[] }[] = [];
  private cache: { size: number; evidence: DebriefEvidence[] } = { size: -1, evidence: [] };

  constructor(private readonly world: World) {}

  /** Everything findable so far (rebuilt only when the hacker did something new). */
  private evidence(): DebriefEvidence[] {
    const size = this.world.mission.trail.length;
    if (size !== this.cache.size) this.cache = { size, evidence: size === 0 ? [] : debriefSteps(this.world).flatMap((s) => s.evidence) };
    return this.cache.evidence;
  }

  /** Text that appeared on this player's screen (a terminal or the badge and motion lists of the monitors). */
  noteScreen(playerId: string, text: string): void {
    if (isHacker(this.world, playerId)) return;
    const evidence = this.evidence();
    if (evidence.length === 0) return;
    for (const line of text.split('\n')) {
      if (line.trim().length < 8) continue;
      for (const e of evidence) {
        if (this.seen.get(keyOf(e))?.has(playerId) || !shows(e, line)) continue;
        const who = this.seen.get(keyOf(e)) ?? new Set<string>();
        this.seen.set(keyOf(e), who.add(playerId));
      }
    }
  }

  /** A camera picture this player looked at. */
  notePicture(playerId: string, picture: { camera: string; time: number; people: { name: string }[] }): void {
    if (isHacker(this.world, playerId) || picture.people.length === 0) return;
    this.pictures.push({ playerId, camera: picture.camera, time: picture.time, names: picture.people.map((p) => p.name) });
    if (this.pictures.length > MAX_PICTURES_SEEN) this.pictures.shift();
  }

  private name(playerId: string): string {
    return this.world.players.find((p) => p.id === playerId)?.name ?? playerId;
  }

  private names(ids: Iterable<string>): string[] {
    return [...new Set([...ids].map((id) => this.name(id)))];
  }

  /** The finished debrief. Call it only when the match is over. */
  build(input: DebriefInput): DebriefView {
    const { mission } = this.world;
    const steps = debriefSteps(this.world).slice(-MAX_STEPS).map((s) => this.step(s, input));
    const hackers = new Set([...mission.trail.map((t) => t.by), ...mission.hackers]);
    const findable = steps.filter((s) => s.suspicious && s.status !== 'none');
    const view: DebriefView = {
      winner: input.winner, reason: input.reason, hacker: nameList(mission.hackers.map((id) => this.name(id))), hackers: mission.hackers.map((id) => this.name(id)),
      startedAt: input.startedAt, at: input.at, reputation: input.reputation,
      steps,
      totals: {
        steps: findable.length,
        pinned: findable.filter((s) => s.status === 'pinned').length,
        seen: findable.filter((s) => s.status === 'seen').length,
        missed: findable.filter((s) => s.status === 'missed').length,
      },
      weaknesses: weaknessNotes(this.world).map((w) => w.text),
      witnesses: input.findings.flatMap(({ playerId, list }) => list
        .filter((f) => f.weight > 0 && hackers.has(f.suspect) && f.suspect !== playerId)
        .map((f) => ({ time: f.time, name: this.name(playerId), text: f.text }))).sort((a, b) => a.time - b.time),
      meetings: input.meetings.map((m) => ({
        number: m.number, time: m.startedAt, calledBy: this.name(m.calledById),
        accusations: m.accusations.map((a) => ({ accuser: this.name(a.accuserId), suspect: this.name(a.suspectId), right: hackers.has(a.suspectId), evidence: [...a.evidence] })),
        votes: Object.entries(m.votes).map(([voter, target]) => ({ voter: this.name(voter), target: target === 'skip' ? 'skip' : this.name(target) })),
        fired: m.result?.firedId ? this.name(m.result.firedId) : '',
        wasHacker: m.result?.wasHacker ?? false,
      })),
      detentions: input.detentions.map((d) => ({ time: d.time, guard: this.name(d.guardId), target: this.name(d.targetId), right: d.wasHacker })),
    };
    return this.redact(view);
  }

  /** What the hacker themself or a partner pinned or looked at was not FOUND by anybody. */
  private hackedBy(s: DebriefStep, playerId: string): boolean {
    return playerId === s.by || isHacker(this.world, playerId);
  }

  private step(s: DebriefStep, input: DebriefInput): DebriefStepView {
    const evidence: DebriefEvidenceView[] = s.evidence.map((e) => {
      const pins = input.board.filter((i) => i.kind !== 'snapshot' && !this.hackedBy(s, i.pinnedById) && pinShows(e, i.text));
      const seen = this.seen.get(keyOf(e)) ?? new Set<string>();
      return {
        host: e.host, where: e.where, text: e.text, gone: e.gone,
        found: pins.length > 0 ? 'pinned' : seen.size > 0 ? 'seen' : 'missed',
        foundBy: this.names(pins.length > 0 ? pins.map((i) => i.pinnedById) : seen),
      };
    });
    if (PHYSICAL.has(s.type)) evidence.push(...this.filmed(s, input));
    // What was found first, then the rest, so a long list still shows what matters.
    const rank = { pinned: 0, seen: 1, missed: 2 };
    evidence.sort((a, b) => rank[a.found] - rank[b.found]);
    const status = evidence.length === 0 ? 'none' : evidence[0].found;
    return {
      time: s.time, until: s.until, count: s.count, by: this.name(s.by), host: s.host, account: s.account, title: s.title,
      technique: s.technique ? { id: s.technique.id, name: s.technique.name } : null,
      lesson: s.lesson, typed: s.typed, suspicious: s.suspicious, alerts: [...new Set(s.alerts)], flagged: s.flagged,
      evidence: evidence.slice(0, MAX_EVIDENCE), more: Math.max(0, evidence.length - MAX_EVIDENCE), status,
    };
  }

  /** The camera pictures (the last one before and the first one after) with the hacker in view around a physical step. */
  private filmed(s: DebriefStep, input: DebriefInput): DebriefEvidenceView[] {
    const name = this.name(s.by);
    const shots = input.cctv.cameras.flatMap((c) => input.cctv.recording(c.id))
      .filter((x) => x.time >= s.time - PICTURE_MS && x.time <= s.until + PICTURE_MS && x.people.some((p) => p.playerId === s.by))
      .sort((a, b) => a.time - b.time);
    const chosen = [...new Set([shots.filter((x) => x.time <= s.time).at(-1), shots.find((x) => x.time > s.time)])].filter((x) => x !== undefined);
    return chosen.map((shot) => {
      const same = (camera: string, time: number, names: string[]) => camera === shot.camera && Math.abs(time - shot.time) <= PICTURE_MS && names.includes(name);
      const pins = input.board.filter((i) => i.frame && !this.hackedBy(s, i.pinnedById) && same(i.frame.camera, i.frame.time, i.frame.people.map((p) => p.name)));
      const seen = this.pictures.filter((p) => !this.hackedBy(s, p.playerId) && same(p.camera, p.time, p.names));
      const me = shot.people.find((p) => p.playerId === s.by)!;
      const doing = me.activity === 'at-pc' ? ' (crouched at a PC)' : me.seatedAt ? ` (sitting at ${me.seatedAt})` : '';
      return {
        host: '', where: `${shot.camera} picture`, text: `${clock(shot.time)} ${name}${doing} in view`, gone: false,
        found: pins.length > 0 ? 'pinned' as const : seen.length > 0 ? 'seen' as const : 'missed' as const,
        foundBy: this.names((pins.length > 0 ? pins.map((i) => i.pinnedById) : seen.map((p) => p.playerId))),
      };
    });
  }

  /** Replaces every password of the office in every text. */
  private redact(view: DebriefView): DebriefView {
    const secrets = [...new Set(Object.values(this.world.credentials).map((c) => c.password))].filter((p) => p.length >= 4).sort((a, b) => b.length - a.length);
    const clean = (value: unknown): unknown => {
      if (typeof value === 'string') return secrets.reduce((text, secret) => text.split(secret).join('********'), value);
      if (Array.isArray(value)) return value.map(clean);
      if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
      return value;
    };
    return clean(view) as DebriefView;
  }
}
