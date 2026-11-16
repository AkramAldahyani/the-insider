/**
 * Job tasks: the small pieces of ordinary work every employee has.
 *
 * Tasks exist for two reasons (DESIGN.md section 8):
 *  - they give players and bots something legitimate to do, so the office is
 *    busy and the logs are full of normal activity a hacker can hide in;
 *  - they pull people away from their desks (the printer, the cafeteria),
 *    which is when an unlocked PC becomes an opportunity.
 *
 * WHAT A TASK IS. Pure data in the scenario file: a title and a list of
 * steps. A step is either a shell command to type, or a room to visit.
 *
 * HOW A STEP GETS TICKED OFF. Nobody "claims" a step. The board watches what
 * really happens: the master event list for typed commands, and where bodies
 * are standing for visits. So a human and a bot complete a task in exactly
 * the same way, and typing the command on somebody else's PC counts too (the
 * master log knows who was at the keyboard).
 *
 * A player's task list is private: it is sent only to that player.
 */
import type { GameEvent, Scenario, ScenarioTask, World } from '@insider/engine';
import { roomAt, type OfficeMap, type TaskView } from '@insider/shared';
import type { Random } from './bots/random';

/** One step of a task that was handed to a player (placeholders already filled in). */
export interface AssignedStep {
  text: string;
  /** Command step: what to type, and the pattern a typed command must match. */
  run?: string;
  match?: RegExp;
  /** Command step: the machine the command must run on (undefined = any). */
  host?: string;
  /** Visit step: the room, and how long to stay (game ms). */
  visit?: string;
  stayMs?: number;
  /** Visit step: game time the player entered the room (0 = not there). */
  enteredAt: number;
  done: boolean;
}

export interface AssignedTask {
  /** Unique per assignment: "daily-report#3". */
  id: string;
  taskId: string;
  title: string;
  steps: AssignedStep[];
  done: boolean;
}

interface Sheet {
  open: AssignedTask[];
  completed: number;
}

/** How many tasks a player has at the same time. */
const OPEN_TASKS = 3;

/** Fills {date}, {n}, {user} and {colleague} in a step's text. */
function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export class TaskBoard {
  private readonly sheets = new Map<string, Sheet>();
  /** Index of the next master event to look at. */
  private cursor: number;
  private counter = 0;
  /** How many tasks were given up (a number to watch in tests: it should stay small). */
  abandoned = 0;
  /** Player ids whose list changed since the last `takeChanged()`. */
  private readonly changed = new Set<string>();

  constructor(private readonly world: World, private readonly scenario: Scenario, private readonly map: OfficeMap, private readonly random: Random) {
    this.cursor = world.events.length; // only what happens during the match counts
  }

  private tasksFor(playerId: string): ScenarioTask[] {
    const player = this.world.players.find((p) => p.id === playerId);
    const department = this.scenario.accounts.find((a) => a.username === player?.account)?.department ?? '';
    return (this.scenario.tasks ?? []).filter((t) =>
      (!t.roles || t.roles.includes(player?.role ?? '')) && (!t.departments || t.departments.includes(department)));
  }

  /** Gives a player tasks until they have OPEN_TASKS open ones. Called when someone starts playing and after each completion. */
  assign(playerId: string): void {
    const sheet = this.sheets.get(playerId) ?? { open: [], completed: 0 };
    this.sheets.set(playerId, sheet);
    const account = this.world.players.find((p) => p.id === playerId)?.account ?? '';
    for (let guard = 0; guard < 20 && sheet.open.filter((t) => !t.done).length < OPEN_TASKS; guard++) {
      // Not a task they already have open.
      const candidates = this.tasksFor(playerId).filter((t) => !sheet.open.some((o) => !o.done && o.taskId === t.id));
      if (candidates.length === 0) break;
      const task = this.random.pick(candidates);
      const others = this.world.players.map((p) => p.account).filter((a) => a !== account);
      const values = {
        date: new Date(this.world.time).toISOString().slice(0, 10),
        n: String(this.random.int(100, 999)),
        user: account,
        colleague: others.length > 0 ? this.random.pick(others) : account,
      };
      sheet.open.push({
        id: `${task.id}#${++this.counter}`,
        taskId: task.id,
        title: task.title,
        done: false,
        steps: task.steps.map((s) => ({
          text: fill(s.text, values),
          run: s.run === undefined ? undefined : fill(s.run, values),
          match: s.match === undefined ? undefined : new RegExp(fill(s.match, values)),
          host: s.host,
          visit: s.visit,
          stayMs: (s.staySeconds ?? 5) * 1000,
          enteredAt: 0,
          done: false,
        })),
      });
      this.changed.add(playerId);
    }
    // Keep the list short: finished tasks drop off once there are more than three of them.
    while (sheet.open.filter((t) => t.done).length > 3) sheet.open.splice(sheet.open.findIndex((t) => t.done), 1);
  }

  /** The step a player should do next: the first unfinished step of their first unfinished task. */
  nextStep(playerId: string): { task: AssignedTask; step: AssignedStep } | null {
    for (const task of this.sheets.get(playerId)?.open ?? []) {
      if (task.done) continue;
      const step = task.steps.find((s) => !s.done);
      if (step) return { task, step };
    }
    return null;
  }

  /** Drops a task without completing it (a bot that cannot get a step to work gives up on it). */
  abandon(playerId: string, assignmentId: string): void {
    const sheet = this.sheets.get(playerId);
    if (!sheet) return;
    sheet.open = sheet.open.filter((t) => t.id !== assignmentId);
    this.abandoned++;
    this.changed.add(playerId);
    this.assign(playerId);
  }

  completed(playerId: string): number {
    return this.sheets.get(playerId)?.completed ?? 0;
  }

  private finishStep(playerId: string, task: AssignedTask, step: AssignedStep): void {
    step.done = true;
    this.changed.add(playerId);
    if (task.steps.every((s) => s.done)) {
      task.done = true;
      this.sheets.get(playerId)!.completed++;
      this.assign(playerId);
    }
  }

  /**
   * Looks at what happened since the last call and ticks off steps.
   * Steps of a task are done in order: only each task's FIRST open step is checked.
   * @param bodies where everybody is standing (player id, position)
   */
  update(bodies: { playerId: string; x: number; y: number }[]): void {
    // 1. Typed commands. `actor` is the player physically at the keyboard.
    for (; this.cursor < this.world.events.length; this.cursor++) {
      const event: GameEvent = this.world.events[this.cursor];
      if (event.type !== 'command' || !event.actor) continue;
      const sheet = this.sheets.get(event.actor);
      if (!sheet) continue;
      const typed = String(event.details.command ?? '');
      for (const task of sheet.open) {
        if (task.done) continue;
        const step = task.steps.find((s) => !s.done);
        if (!step?.match || (step.host && step.host !== event.host) || !step.match.test(typed)) continue;
        this.finishStep(event.actor, task, step);
        break; // one typed line completes at most one step
      }
    }
    // 2. Visits: stand in the room for the required time.
    for (const body of bodies) {
      const sheet = this.sheets.get(body.playerId);
      if (!sheet) continue;
      const room = roomAt(this.map, body.x, body.y);
      for (const task of sheet.open) {
        if (task.done) continue;
        const step = task.steps.find((s) => !s.done);
        if (!step?.visit) continue;
        if (room !== step.visit) step.enteredAt = 0;
        else if (step.enteredAt === 0) step.enteredAt = this.world.time;
        else if (this.world.time - step.enteredAt >= (step.stayMs ?? 0)) this.finishStep(body.playerId, task, step);
      }
    }
  }

  /** Players whose list changed since the last call (so the game can tell their browsers). */
  takeChanged(): string[] {
    const ids = [...this.changed];
    this.changed.clear();
    return ids;
  }

  /** A player's own list, in the shape sent to their browser. */
  view(playerId: string): { tasks: TaskView[]; completed: number } {
    const sheet = this.sheets.get(playerId);
    return {
      completed: sheet?.completed ?? 0,
      tasks: (sheet?.open ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        done: t.done,
        steps: t.steps.map((s) => ({ text: s.text, hint: s.run ?? '', done: s.done })),
      })),
    };
  }
}
