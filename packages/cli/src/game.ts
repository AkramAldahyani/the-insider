/**
 * The state of one CLI play session and the ":" meta commands.
 *
 * Lines starting with ":" are instructions to the CLI itself (walk to a desk,
 * let time pass, save the world...). Everything else is typed into whatever
 * PC you are sitting at and handled by the engine.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceTime, createWorld, currentPrompt, dateStamp, leaveTerminal, openTerminal, parseDuration,
  refreshTerminal, screenState, sendInput, serializeWorld, switchUser,
  type GameEvent, type Scenario, type TerminalResult, type World,
} from '@insider/engine';

export const META_HELP = `CLI commands (they start with a colon):
  :sit <hostname>   sit at a PC (login prompt, lock screen, or an open shell)
  :leave            stand up; the PC stays exactly as you left it
  :switch           on a lock screen: "switch user" (log in as someone else; the locked session stays)
  :as <player>      become another player (who is physically at the keyboard)
  :players          list players, desks and credentials
  :hosts            list machines with their current IP and MAC
  :time             show the game time
  :time +5m         advance game time (units: s m h d, e.g. +90s, +1h30m)
  :events [N]       debug: show the last N entries of the master event log (default 15)
  :dump [file]      save the whole world state to a JSON file
  :help             this list
  :quit             exit

Anything else is typed into the PC you are sitting at. Type "help" there for shell commands.
Game time also moves forward by the real time that passes between your inputs,
so a screen you leave alone for a minute locks itself.`;

export interface Screen {
  /** Text to print. */
  output: string;
  /** Prompt for the next line. */
  prompt: string;
  /** Hide what is typed next (password). */
  masked: boolean;
  quit?: boolean;
}

export class Game {
  world: World;
  playerId: string;
  terminalId: string | null = null;
  private masked = false;
  private lastInputAt = Date.now();

  constructor(
    private scenario: Scenario,
    seed: number,
    private dumpDir: string,
  ) {
    this.world = createWorld(scenario, seed);
    this.playerId = this.world.players[0]?.id ?? 'p1';
  }

  /** The intro shown when the game starts. */
  intro(): string {
    return (
      `\nScenario: ${this.world.scenarioName}   (seed ${this.world.seed})\n` +
      `Game time: ${dateStamp(this.world.time)}\n\n` +
      this.playersTable() +
      `\nYou are ${this.playerId}. Try:  :sit ${this.world.players[0]?.desk ?? ''}     (":help" lists CLI commands)\n`
    );
  }

  prompt(): string {
    if (this.terminalId) return currentPrompt(this.world, this.terminalId);
    return `[${this.playerId} standing] > `;
  }

  private screen(output: string, quit = false): Screen {
    return { output, prompt: this.prompt(), masked: this.terminalId ? this.masked : false, quit };
  }

  private fromEngine(r: TerminalResult): Screen {
    this.masked = r.awaitingInput?.masked ?? false;
    return this.screen(r.output);
  }

  /** Handles one line typed by the human. */
  handle(line: string): Screen {
    // Real time that passed since the last input also passes in the game.
    const now = Date.now();
    const elapsed = Math.max(1000, Math.round((now - this.lastInputAt) / 1000) * 1000);
    this.lastInputAt = now;

    if (line.trim().startsWith(':')) return this.meta(line.trim());
    if (!this.terminalId) {
      return this.screen(line.trim() ? 'You are standing in the office. Use :sit <hostname> to sit at a PC, or :help.\n' : '');
    }
    advanceTime(this.world, elapsed);
    // If the screen changed while you were away from the keyboard (it locked
    // itself), show that instead of typing your line into the new screen.
    const changed = refreshTerminal(this.world, this.terminalId);
    if (changed) {
      const screen = this.fromEngine(changed);
      return { ...screen, output: `(the screen changed while you were idle; your line was not sent)\n${screen.output}` };
    }
    return this.fromEngine(sendInput(this.world, this.terminalId, line));
  }

  private meta(line: string): Screen {
    const [cmd, ...args] = line.split(/\s+/);
    switch (cmd) {
      case ':help':
        return this.screen(`${META_HELP}\n`);
      case ':quit':
      case ':q':
      case ':exit':
        return this.screen('Bye.\n', true);
      case ':players':
        return this.screen(this.playersTable());
      case ':hosts':
        return this.screen(this.hostsTable());

      case ':as': {
        const player = this.world.players.find((p) => p.id === args[0] || p.account === args[0]);
        if (!player) return this.screen(`Unknown player. Known: ${this.world.players.map((p) => p.id).join(', ')}\n`);
        if (this.terminalId) leaveTerminal(this.world, this.terminalId);
        this.terminalId = null;
        this.playerId = player.id;
        return this.screen(`You are now ${player.id} (${player.name}), standing.\n`);
      }

      case ':sit': {
        const wanted = (args[0] ?? '').toLowerCase();
        const host = Object.keys(this.world.hosts).find((h) => h.toLowerCase() === wanted);
        if (!host) return this.screen(`Usage: :sit <hostname>   Known: ${Object.keys(this.world.hosts).join(', ')}\n`);
        if (this.world.hosts[host].headless) return this.screen(`${host} is a box in a rack with no screen or keyboard. Reach it with ssh from another PC.\n`);
        if (this.terminalId) leaveTerminal(this.world, this.terminalId);
        const opened = openTerminal(this.world, host, this.playerId);
        this.terminalId = opened.terminalId;
        const h = this.world.hosts[host];
        const header = `--- ${this.playerId} sits at ${host} (${h.location}) ---\n`;
        const screen = this.fromEngine(opened);
        return { ...screen, output: header + screen.output };
      }

      case ':leave': {
        if (!this.terminalId) return this.screen('You are not sitting anywhere.\n');
        const host = this.world.terminals[this.terminalId].host;
        leaveTerminal(this.world, this.terminalId);
        this.terminalId = null;
        return this.screen(`--- ${this.playerId} leaves ${host} (the screen stays as it was) ---\n`);
      }

      case ':switch': {
        if (!this.terminalId) return this.screen('You are not sitting anywhere.\n');
        const result = switchUser(this.world, this.terminalId);
        if (result.screen !== 'login') return this.screen('Switch user is only possible on a lock screen.\n');
        return this.fromEngine(result);
      }

      case ':time': {
        if (!args[0]) return this.screen(`Game time: ${dateStamp(this.world.time)}\n`);
        const ms = parseDuration(args[0]);
        if (ms === null) return this.screen('Usage: :time +5m   (units: s, m, h, d)\n');
        advanceTime(this.world, ms);
        const note = `Game time is now ${dateStamp(this.world.time)}\n`;
        // Time passing can lock the screen you are sitting at.
        const changed = this.terminalId ? refreshTerminal(this.world, this.terminalId) : null;
        if (!changed) return this.screen(note);
        const screen = this.fromEngine(changed);
        return { ...screen, output: note + screen.output };
      }

      case ':events': {
        const n = Math.max(1, parseInt(args[0] ?? '15', 10) || 15);
        const events = this.world.events.slice(-n);
        return this.screen(`Master event log: last ${events.length} of ${this.world.events.length}\n${events.map(formatEvent).join('')}`);
      }

      case ':dump': {
        const stamp = new Date(this.world.time).toISOString().replace(/[:.]/g, '-');
        const file = args[0] ?? join(this.dumpDir, `${this.world.scenarioId}-${stamp}.json`);
        try {
          if (!args[0]) mkdirSync(this.dumpDir, { recursive: true });
          const json = serializeWorld(this.world, true);
          writeFileSync(file, json);
          return this.screen(`World saved to ${file} (${(json.length / 1024).toFixed(0)} KB)\n`);
        } catch (e) {
          return this.screen(`Could not write ${file}: ${(e as Error).message}\n`);
        }
      }

      default:
        return this.screen(`Unknown CLI command ${cmd}. Type :help\n`);
    }
  }

  private playersTable(): string {
    const rows = this.world.players.map((p) => {
      const cred = this.world.credentials[p.account];
      return [p.id, p.name, p.role, p.account, cred?.password ?? '?', p.desk, this.world.hosts[p.desk]?.ip ?? ''];
    });
    let out = table(['ID', 'NAME', 'ROLE', 'USERNAME', 'PASSWORD', 'DESK', 'IP'], rows);
    const roots = Object.entries(this.world.credentials).filter(([k]) => k.startsWith('root@'));
    for (const [key, cred] of roots) out += `${key} password: ${cred.password}\n`;
    return out;
  }

  private hostsTable(): string {
    const rows = Object.values(this.world.hosts).map((h) => {
      const s = screenState(this.world, h.hostname);
      const screen = s.state === 'login' ? 'login prompt' : s.state === 'locked' ? `locked (${s.user})` : `UNLOCKED (${s.user})`;
      return [h.hostname, h.ip, h.mac, h.location, screen];
    });
    return table(['HOSTNAME', 'IP', 'MAC', 'LOCATION', 'SCREEN'], rows);
  }
}

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd() + '\n';
  return line(head) + line(widths.map((w) => '-'.repeat(w))) + rows.map(line).join('');
}

function formatEvent(e: GameEvent): string {
  const time = new Date(e.time).toISOString().slice(11, 19);
  const details = JSON.stringify(e.details);
  return `#${String(e.id).padStart(4)} ${time} ${e.host.padEnd(13)} ${(e.user || '-').padEnd(10)} ${(e.sourceIp ?? 'local').padEnd(11)} ${e.type.padEnd(15)} ${details.length > 110 ? `${details.slice(0, 107)}...` : details}${e.actor ? `  [actor ${e.actor}]` : ''}\n`;
}
