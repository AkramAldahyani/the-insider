/**
 * Job tasks (Phase 3, part D): handing out, ticking off from what really
 * happens, privacy, and bots doing them.
 */
import { describe, expect, it } from 'vitest';
import { createWorld, queryEvents, type Scenario, type ScenarioTask } from '@insider/engine';
import { TICK_RATE, type TaskView } from '@insider/shared';
import { PW, Recorder, clone, scenario } from './helpers';

const minutes = (m: number) => m * 60 * TICK_RATE;
const START = Date.parse(scenario.startTime);

/** The shipped scenario with only the given tasks, so a test knows exactly what a player gets. */
function withTasks(...ids: string[]): Scenario {
  const s = clone(scenario);
  s.tasks = ids.map((id) => scenario.tasks!.find((t) => t.id === id)!);
  return s;
}
const list = (r: Recorder, client: string) => (r.last(client, 'tasks')!.payload as { tasks: TaskView[]; completed: number });
const task = (r: Recorder, client: string, id: string) => list(r, client).tasks.find((t) => t.id.startsWith(`${id}#`))!;

/** Sara at her own PC, logged in. */
function saraAtDesk(s: Scenario): Recorder {
  const r = new Recorder({ scenario: s });
  r.connect('a', 'p1');
  r.sitAt('a', 'p1', 'FIN-LT-07');
  r.type('a', PW['s.alharbi']);
  return r;
}

describe('handing out tasks', () => {
  it('a player gets three open tasks when they start, with a command hint for each step', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    const { tasks, completed } = list(r, 'a');
    expect(completed).toBe(0);
    expect(tasks).toHaveLength(3);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(3);
    for (const t of tasks) {
      expect(t.done).toBe(false);
      for (const step of t.steps) expect(Object.keys(step).sort()).toEqual(['done', 'hint', 'text']);
    }
    // Placeholders are filled in: no "{date}" or "{n}" left for the player to puzzle over.
    expect(JSON.stringify(tasks)).not.toMatch(/\{(date|n|user)\}/);
  });

  it('tasks follow the role and the department', () => {
    const r = new Recorder();
    const seen: Record<string, Set<string>> = { p1: new Set(), p5: new Set(), p10: new Set() };
    for (const id of Object.keys(seen)) {
      for (let i = 0; i < 40; i++) {
        r.game.tasks.assign(id);
        const next = r.game.tasks.nextStep(id)!;
        seen[id].add(next.task.taskId);
        r.game.tasks.abandon(id, next.task.id);
      }
    }
    expect(seen.p1.has('approve-invoice')).toBe(true); // Sara is in Finance
    for (const id of ['check-backup', 'rotate-log', 'badge-review', 'rounds', 'net-check', 'staff-list']) expect(seen.p1.has(id), id).toBe(false);
    expect(seen.p5.has('check-backup')).toBe(true); // Khalid is the sysadmin
    expect(seen.p5.has('badge-review')).toBe(false);
    expect(seen.p10.has('badge-review') && seen.p10.has('rounds')).toBe(true); // Tariq is the guard
  });

  it('a task list goes only to its owner', () => {
    const r = saraAtDesk(withTasks('daily-report'));
    r.connect('b', 'p4');
    const before = r.messages('b', 'tasks').length;
    r.type('a', 'mkdir -p Documents/reports');
    r.tick();
    expect(task(r, 'a', 'daily-report').steps[0].done).toBe(true);
    expect(r.messages('b', 'tasks')).toHaveLength(before); // Omar heard nothing about Sara's progress
    expect(task(r, 'b', 'daily-report').steps[0].done).toBe(false);
  });

  it('a scenario whose example command does not satisfy its own pattern is refused', () => {
    const broken = clone(scenario);
    broken.tasks = [{ id: 'bad', title: 'Bad', steps: [{ text: 'x', run: 'ls Documents', match: '^cat ' }] } satisfies ScenarioTask];
    expect(() => createWorld(broken, 1)).toThrow('task "bad", step 1: "match" must be a regular expression that matches "run"');
    broken.tasks = [{ id: 'bad', title: 'Bad', steps: [{ text: 'x' }] }];
    expect(() => createWorld(broken, 1)).toThrow('needs either "run" or "visit"');
  });
});

describe('doing tasks', () => {
  it('typing the commands ticks the steps off in order, finishes the task and brings a new one', () => {
    const r = saraAtDesk(withTasks('daily-report', 'archive-draft'));
    // Out of order: the last step first does nothing.
    r.type('a', 'ls Documents/reports');
    r.tick();
    expect(task(r, 'a', 'daily-report').steps.map((s) => s.done)).toEqual([false, false, false]);

    r.type('a', 'mkdir -p Documents/reports');
    r.tick();
    expect(task(r, 'a', 'daily-report').steps.map((s) => s.done)).toEqual([true, false, false]);
    // The player's own wording counts as long as it does the job.
    r.type('a', 'echo "all quiet today" > Documents/reports/monday.txt');
    r.type('a', 'ls -la Documents/reports');
    r.tick();
    expect(list(r, 'a').completed).toBe(1);
    expect(task(r, 'a', 'daily-report').done).toBe(true);
    // The work was real: the file exists on her PC.
    expect(r.type('a', 'cat Documents/reports/monday.txt')).toContain('all quiet today');
    // Finishing a task hands out it again later: there are always open tasks.
    expect(list(r, 'a').tasks.filter((t) => !t.done).length).toBeGreaterThanOrEqual(1);
  });

  it('a step that belongs on another machine only counts there', () => {
    const r = saraAtDesk(withTasks('read-policy'));
    r.type('a', 'ssh ADMIN-SRV-01');
    r.send('a', 'term.cancel'); // changed her mind at the password question
    r.tick();
    expect(task(r, 'a', 'read-policy').steps.map((s) => s.done)).toEqual([true, false, false]);
    r.type('a', 'cat /srv/shared/policies/password-policy.txt'); // on her own PC: no such file, and not the server
    r.tick();
    expect(task(r, 'a', 'read-policy').steps[1].done).toBe(false);

    r.type('a', 'ssh ADMIN-SRV-01');
    r.type('a', PW['s.alharbi']);
    r.type('a', 'cat /srv/shared/policies/password-policy.txt');
    r.type('a', 'exit');
    r.tick();
    expect(task(r, 'a', 'read-policy').done).toBe(true);
  });

  it('a visit step needs the player to stay in the room, not just pass through', () => {
    const r = new Recorder({ scenario: withTasks('coffee') }); // 20 seconds in the cafeteria
    r.connect('a', 'p9'); // Maha, in Reception
    r.walkToTile('a', 'p9', 22, 20);
    expect(r.position('p9').y).toBeGreaterThan(19 * 32);
    r.tick(TICK_RATE * 8);
    r.walkToTile('a', 'p9', 27, 16); // leaves after 8 seconds
    r.tick(TICK_RATE * 20);
    expect(task(r, 'a', 'coffee').done).toBe(false);
    r.walkToTile('a', 'p9', 22, 20);
    r.tick(TICK_RATE * 22);
    expect(list(r, 'a').completed).toBe(1);
  });

  it("work typed at a colleague's PC counts for the person at the keyboard", () => {
    const r = new Recorder({ scenario: withTasks('daily-report') });
    r.connect('a', 'p4'); // Omar...
    r.connect('b', 'p3'); // ...and Lina, who stays away from her unlocked PC
    r.sitAt('a', 'p4', 'HR-LT-03');
    r.type('a', 'mkdir -p Documents/reports');
    r.tick();
    expect(task(r, 'a', 'daily-report').steps[0].done).toBe(true);
    expect(task(r, 'b', 'daily-report').steps[0].done).toBe(false);
  });
});

describe('bots doing tasks', () => {
  it('in twenty minutes every employee finishes tasks, and the work leaves real traces', () => {
    const r = new Recorder({ bots: true });
    r.tick(minutes(20));
    const done = scenario.players.map((p) => r.game.tasks.completed(p.id));
    expect(Math.min(...done)).toBeGreaterThanOrEqual(1);
    expect(done.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(20);
    expect(r.game.bots!.list().filter((b) => b.failure)).toEqual([]);

    // Files written by the tasks exist on the employees' PCs.
    const reports = scenario.players.filter((p) => {
      try {
        return r.file(p.desk, `/home/${p.account}/Documents/reports/2026-03-02.txt`).includes('Daily report');
      } catch {
        return false;
      }
    });
    expect(reports.length).toBeGreaterThanOrEqual(3);
    // Ordinary employees logged in to the admin server over ssh (to read the policy): background noise for its auth.log.
    const sshUsers = new Set(queryEvents(r.game.world, { type: 'ssh.accept', host: 'ADMIN-SRV-01', since: START }).map((e) => e.user));
    expect(sshUsers.size).toBeGreaterThanOrEqual(4);
    // The sysadmin used sudo there; the guard read the badge log on the badge server.
    expect(queryEvents(r.game.world, { type: 'sudo.exec', host: 'ADMIN-SRV-01', user: 'k.nasser', since: START }).length).toBeGreaterThanOrEqual(1);
    expect(queryEvents(r.game.world, { type: 'ssh.accept', host: 'SEC-SRV-01', user: 't.omar', since: START }).length).toBeGreaterThanOrEqual(1);
    // Nobody leaves an ssh session hanging when they go for a break: every one that opened was closed, or is still in use.
    const opened = queryEvents(r.game.world, { type: 'ssh.accept', since: START }).length;
    const closed = queryEvents(r.game.world, { type: 'ssh.disconnect', since: START }).length;
    expect(opened - closed).toBeLessThanOrEqual(3);
  });

  it('bots write each other email and browse the web, so those logs fill up too', () => {
    const r = new Recorder({ bots: true });
    r.tick(minutes(20));
    const mails = queryEvents(r.game.world, { type: 'mail.send', since: START });
    expect(mails.length).toBeGreaterThanOrEqual(3);
    expect(mails.every((e) => e.actor !== null && e.origin !== 'system')).toBe(true);
    const browsing = queryEvents(r.game.world, { type: 'web.request', since: START }).filter((e) => e.actor !== null);
    expect(browsing.length).toBeGreaterThanOrEqual(10);
    expect(new Set(browsing.map((e) => e.user)).size).toBeGreaterThanOrEqual(5);
    const proxyLog = r.file('ADMIN-SRV-01', '/var/log/squid/access.log');
    expect(proxyLog).toContain('news.example');
    expect(proxyLog).toContain(' - GET http://archive.ubuntu.example/'); // and the machines' own update checks
  });

  it('bots give up on few tasks', () => {
    const r = new Recorder({ bots: true });
    r.tick(minutes(20));
    const completed = scenario.players.reduce((sum, p) => sum + r.game.tasks.completed(p.id), 0);
    expect(r.game.tasks.abandoned).toBeLessThanOrEqual(Math.ceil(completed * 0.15));
  });
});
