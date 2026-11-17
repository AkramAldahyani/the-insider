/**
 * The simulated hacker's decisions. No World, filesystem, process or network APIs:
 * secrets come from its own terminal output or the same partial view a human gets.
 * All lines below go to the game's in-memory terminal, never an operating-system shell.
 */
import type { TerminalResult } from '@insider/engine';
import type { Point } from '@insider/shared';
import type { BotSubject } from './brain';

export interface HackerPlan {
  flag: { host: string; path: string };
  backup?: { host: string; path: string };
  ownSudo: boolean;
  weakAdmin: boolean;
  admin?: { playerId: string; account: string; desk: string; chair: Point };
}

export interface HackerActions {
  /** Only returns a screen/occupancy visible from the bot's current room and position. */
  look(hostname: string): { unlocked: boolean; occupied: boolean } | null;
  usb(hostname: string): void;
  submit(text: string): boolean;
}

type Screen = Pick<TerminalResult, 'output' | 'prompt' | 'screen' | 'awaitingInput'>;
interface Step {
  accepts(screen: Screen): boolean;
  line(): string;
  then(screen: Screen): boolean;
}
type Route = 'backup' | 'sudo' | 'weak-password' | 'physical';
const shell = (s: Screen | null, user: string, host: string) =>
  s?.screen === 'shell' && !s.awaitingInput && s.prompt.startsWith(`${user}@${host}:`);
const question = (s: Screen, prompt: string) => s.screen === 'shell' && s.awaitingInput?.masked === true && s.prompt === prompt;
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

export class HackerBrain {
  private started = false;
  private nextAt = 0;
  private mode: 'prepare' | 'script' | 'observe' | 'usb' | 'poll' | 'submit' | 'rest' = 'prepare';
  private queue: Step[] = [];
  private done: () => void = () => {};
  private route: Route = 'physical';
  private readonly tried = new Set<Route>();
  private loginTries = 0;
  private rootPassword = '';
  private adminPassword = '';
  private flag = '';
  private recorder = '';
  private pollUntil = 0;
  private readonly patterns = new Map<number, string[]>();

  constructor(private readonly plan: HackerPlan, private readonly actions: HackerActions, private readonly startAt: number) {}

  /** Meetings invalidate pending terminal steps, but not already observed information. */
  interrupt(): void {
    this.queue = [];
    this.mode = 'rest';
    this.nextAt = 0;
    this.flag = '';
  }

  /** This receives only the visible characters, never the typed password. */
  glimpse(victim: string, pattern: string): void {
    if (victim !== this.plan.admin?.playerId || !pattern || pattern.length > 128) return;
    const old = this.patterns.get(pattern.length) ?? Array(pattern.length).fill('?');
    const incoming = [...pattern];
    if (incoming.some((ch, i) => ch !== '?' && old[i] !== '?' && old[i] !== ch)) old.fill('?');
    incoming.forEach((ch, i) => { if (ch !== '?') old[i] = ch; });
    this.patterns.set(pattern.length, old);
    if (this.patterns.size > 3) this.patterns.delete(this.patterns.keys().next().value!);
    if (!old.includes('?')) this.adminPassword = old.join('');
  }

  /** Result of its own USB action, identical to the notice a human receives. */
  itemResult(text: string): void {
    if (this.mode !== 'usb') return;
    this.mode = text.startsWith('Backdoor installed on ') ? 'rest' : 'observe';
    // A successful installation is followed by a terminal connection, not privileged state access.
    if (text.startsWith('Backdoor installed on ')) this.recorder = 'connect';
  }

  private command(user: string, host: string, line: string, then: (s: Screen) => boolean = () => true): Step {
    return { accepts: (s) => shell(s, user, host), line: () => line, then };
  }

  private answer(prompt: string, password: () => string, then: (s: Screen) => boolean): Step {
    return { accepts: (s) => question(s, prompt), line: password, then };
  }

  private ssh(b: BotSubject, user: string, password: () => string): Step[] {
    const host = this.plan.flag.host;
    return [
      this.command(b.persona.account, b.persona.desk, `ssh ${quote(`${user}@${host}`)}`),
      this.answer(`${user}@${host}'s password: `, password, (s) => shell(s, user, host)),
    ];
  }

  private captureFlag(s: Screen): boolean {
    if (s.awaitingInput || !s.output.trim() || /(?:Permission denied|No such file|not allowed)/i.test(s.output)) return false;
    this.flag = s.output.trim();
    return true;
  }

  private sudoRead(user: string, password: () => string): Step {
    return this.command(user, this.plan.flag.host, `sudo cat ${quote(this.plan.flag.path)}`, (s) => {
      if (question(s, `[sudo] password for ${user}: `)) {
        this.queue.unshift(this.answer(s.prompt, password, (result) => this.captureFlag(result)));
        return true;
      }
      return this.captureFlag(s);
    });
  }

  private fromOwnDesk(b: BotSubject, steps: Step[], done: () => void): void {
    if (b.body.seatedAt && b.body.seatedAt !== b.persona.desk) b.world.stand();
    b.mover.stop();
    this.queue = steps;
    this.done = done;
    this.loginTries = 0;
    this.mode = 'prepare';
  }

  private begin(b: BotSubject): void {
    const { plan } = this;
    this.route = plan.backup && !this.tried.has('backup') ? 'backup'
      : plan.ownSudo && !this.tried.has('sudo') ? 'sudo'
      : plan.weakAdmin && plan.admin && !this.tried.has('weak-password') ? 'weak-password' : 'physical';
    const own = () => b.persona.password;
    const won = () => { this.mode = 'submit'; };
    if (this.route === 'backup' && plan.backup?.host === plan.flag.host) {
      this.fromOwnDesk(b, [
        ...this.ssh(b, b.persona.account, own),
        this.command(b.persona.account, plan.flag.host, `cat ${quote(plan.backup.path)}`, (s) => {
          this.rootPassword = /^ROOT_PW='([^'\r\n]+)'$/m.exec(s.output)?.[1] ?? '';
          return !!this.rootPassword;
        }),
        this.command(b.persona.account, plan.flag.host, 'su'),
        this.answer('Password: ', () => this.rootPassword, (s) => shell(s, 'root', plan.flag.host)),
        this.command('root', plan.flag.host, `cat ${quote(plan.flag.path)}`, (s) => this.captureFlag(s)),
      ], won);
    } else if (this.route === 'sudo') {
      this.fromOwnDesk(b, [...this.ssh(b, b.persona.account, own), this.sudoRead(b.persona.account, own)], won);
    } else if (this.route === 'weak-password' && plan.admin) {
      // A fixed guess from this game's fictional company, not a lookup of the administrator's secret.
      this.adminPassword = 'nexora2026';
      this.useAdmin(b);
    } else if (plan.admin) {
      if (this.adminPassword) return this.useAdmin(b);
      const destination = `${b.persona.account}@${plan.flag.host}:/home/${b.persona.account}/.bot-recorder`;
      this.fromOwnDesk(b, [
        this.command(b.persona.account, b.persona.desk, `scp ~/.tools/keylogger ${quote(destination)}`),
        this.answer(`${b.persona.account}@${plan.flag.host}'s password: `, own, (s) => !s.awaitingInput && !/denied|not found/i.test(s.output)),
      ], () => { b.world.stand(); b.mind.screen = null; b.mover.stop(); this.mode = 'observe'; });
    } else {
      this.mode = 'rest';
      this.nextAt = b.world.now() + 60_000;
    }
  }

  private useAdmin(b: BotSubject): void {
    const user = this.plan.admin!.account;
    this.fromOwnDesk(b, [...this.ssh(b, user, () => this.adminPassword), this.sudoRead(user, () => this.adminPassword)], () => { this.mode = 'submit'; });
  }

  private connectRecorder(b: BotSubject): void {
    const admin = this.plan.admin!;
    const source = `${b.persona.account}@${this.plan.flag.host}:/home/${b.persona.account}/.bot-recorder`;
    const resume = /^\/tmp\/\.keys-\d+$/.test(this.recorder);
    if (!resume) this.recorder = '';
    this.fromOwnDesk(b, [
      this.command(b.persona.account, b.persona.desk, `~/.tools/implant ${quote(admin.desk)}`, (s) => shell(s, admin.account, admin.desk)),
      ...(resume ? [] : [
      this.command(admin.account, admin.desk, `scp ${quote(source)} /tmp/insider-recorder`),
      this.answer(`${b.persona.account}@${this.plan.flag.host}'s password: `, () => b.persona.password, (s) => shell(s, admin.account, admin.desk)),
      this.command(admin.account, admin.desk, 'chmod 700 /tmp/insider-recorder'),
      this.command(admin.account, admin.desk, '/tmp/insider-recorder', (s) => {
        this.recorder = /Read (\/tmp\/\.keys-\d+) here/.exec(s.output)?.[1] ?? '';
        return !!this.recorder;
      }),
      ]),
    ], () => { this.mode = 'poll'; this.pollUntil = b.world.now() + 10 * 60_000; });
  }

  private fail(b: BotSubject): void {
    this.tried.add(this.route);
    this.rootPassword = '';
    this.adminPassword = '';
    this.patterns.clear();
    this.flag = '';
    this.recorder = '';
    this.queue = [];
    if (b.body.seatedAt) b.world.stand();
    b.mind.screen = null;
    b.mover.stop();
    this.mode = 'rest';
    this.nextAt = b.world.now() + 30_000;
  }

  /** False during its initial cover routine; true when the hacker controls its own body. */
  tick(b: BotSubject): boolean {
    const now = b.world.now();
    if (!this.started) {
      if (now < this.startAt) return false;
      this.started = true;
      b.mover.stop();
      this.begin(b);
    }
    b.mind.doing = `hacker: ${this.route} / ${this.mode}`; // developer panel only
    if (now < this.nextAt) return true;
    this.nextAt = now + b.random.between(2, 5) * 1000;
    if (this.mode === 'rest') {
      if (this.recorder === 'connect' || /^\/tmp\/\.keys-\d+$/.test(this.recorder)) this.connectRecorder(b);
      else this.begin(b);
    } else if (this.mode === 'prepare') {
      if (!b.body.seatedAt) {
        if (Math.hypot(b.body.x - b.persona.chair.x, b.body.y - b.persona.chair.y) > 2) {
          if (b.mover.state !== 'walking' && !b.mover.goTo(b.persona.chair.x, b.persona.chair.y)) this.fail(b);
        } else {
          const result = b.world.sit(b.persona.desk);
          if (typeof result !== 'string') b.mind.screen = result;
        }
        return true;
      }
      const s = b.mind.screen;
      if (!s || ++this.loginTries > 12) { this.fail(b); return true; }
      if (shell(s, b.persona.account, b.persona.desk)) { this.mode = 'script'; return true; }
      if (s.screen === 'locked') {
        b.mind.screen = b.world.lockedBy() === b.persona.account ? b.world.type(b.persona.password) : b.world.switchUser();
      } else if (s.screen === 'login') {
        b.mind.screen = b.world.type(s.awaitingInput?.masked ? b.persona.password : b.persona.account);
      } else b.mind.screen = s.awaitingInput ? b.world.cancel() : b.world.type('exit');
    } else if (this.mode === 'script') {
      const step = this.queue.shift();
      if (!step) { this.done(); return true; }
      if (!b.body.terminalId || !b.mind.screen || !step.accepts(b.mind.screen)) { this.fail(b); return true; }
      b.mind.screen = b.world.type(step.line());
      if (!step.then(b.mind.screen)) this.fail(b);
    } else if (this.mode === 'observe') {
      if (this.adminPassword) { this.useAdmin(b); return true; }
      const admin = this.plan.admin!;
      const spot = { x: admin.chair.x, y: admin.chair.y + 32 };
      if (Math.hypot(b.body.x - spot.x, b.body.y - spot.y) > 2) {
        if (b.mover.state !== 'walking' && !b.mover.goTo(spot.x, spot.y)) this.fail(b);
        return true;
      }
      const seen = this.actions.look(admin.desk);
      if (seen?.unlocked && !seen.occupied) {
        this.mode = 'usb';
        this.actions.usb(admin.desk);
        if (!b.body.hold) this.mode = 'observe';
      }
    } else if (this.mode === 'poll') {
      const admin = this.plan.admin!;
      if (!b.body.terminalId || !shell(b.mind.screen, admin.account, admin.desk) || now > this.pollUntil) { this.fail(b); return true; }
      b.mind.screen = b.world.type(`cat ${quote(this.recorder)}`);
      // Only accept the owner's unlock/login or sudo prompt; a different account's password is not theirs.
      const output = b.mind.screen.output.trim();
      const prefixes = ['Password: ', `[sudo] password for ${admin.account}: `];
      const payload = output.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /, '');
      const prefix = prefixes.find((p) => payload.startsWith(p));
      if (prefix) {
        this.adminPassword = payload.slice(prefix.length);
        this.useAdmin(b);
      } else if (output) this.fail(b);
      else this.nextAt = now + 15_000;
    } else if (this.mode === 'submit') {
      if (!this.actions.submit(this.flag)) this.fail(b);
    }
    return true;
  }
}
