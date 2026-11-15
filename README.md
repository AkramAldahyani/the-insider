# The Insider

A multiplayer social-deduction game that teaches real Linux forensics. The full design is in [DESIGN.md](DESIGN.md).

**Current state: Phase 1 — simulation core.** There are no graphics, multiplayer, bots or hacker tools yet. What exists is a simulated office network (machines, users, files, logs, a shell) and a text CLI to play with it.

Everything is simulated. No real commands are run, no real network is touched, and nothing here is a real exploit.

## Requirements

- Node.js 20 or newer (developed on Node 24)
- pnpm (this repo pins `pnpm@12.21.0`)

If typing `pnpm` gives "command not found", use one of these:

```bash
corepack enable
```

```bash
npm install -g pnpm
```

Or leave pnpm uninstalled and put `corepack` in front of every command below (`corepack pnpm install`, `corepack pnpm cli`, …). Corepack ships with Node.

## Install

```bash
pnpm install
```

## Run the CLI

```bash
pnpm cli
```

Options: `pnpm cli --seed 42` (another random seed) and `pnpm cli --scenario nexora-small` (a scenario id or a path to a `.json` file).

The CLI prints the players and their credentials, then waits for input. Lines starting with `:` are CLI commands; everything else is typed into the PC you are sitting at.

| CLI command | What it does |
|---|---|
| `:sit <hostname>` | Sit at a PC. You get a login prompt, a lock screen, or an open shell, depending on how it was left. |
| `:leave` | Stand up. The PC stays exactly as it is (locked or unlocked). |
| `:as <player>` | Become another player (`p1`…`p5`). This is who is *physically* at the keyboard. |
| `:players` / `:hosts` | List players with credentials / machines with IP, MAC and screen state. |
| `:time` / `:time +5m` | Show / advance game time (`s`, `m`, `h`, `d`, e.g. `+1h30m`). |
| `:events [N]` | Debug view of the master event log (last N entries). |
| `:dump [file]` | Save the whole world to JSON (default: `dumps/`). |
| `:help` / `:quit` | Help / exit. |

Passwords are hidden while you type them. Game time also advances by the real time that passes between your inputs.

A step-by-step tour with expected results is in [TESTING.md](TESTING.md).

## Run the tests

```bash
pnpm test
```

```bash
pnpm typecheck
```

91 Vitest tests cover permissions, ssh logging and source IPs, sudo, su, history, DHCP lease history, lock/unlock, pipes and redirection, and deterministic replay.

## Project layout

```
scenarios/            office definitions (data only)
packages/engine/      the simulation: pure TypeScript, no I/O, no Node APIs
  src/core/           clock, random numbers, scenario format, world builder
  src/fs/             virtual filesystem and permission checks
  src/auth/           /etc/passwd & co, passwords, sudo rules, login sessions
  src/net/            DHCP (with lease history) and DNS
  src/proc/           process table
  src/events/         master event log and the log lines made from it
  src/shell/          lexer, parser, expansion, executor, prompt
  src/commands/       the shell commands, grouped by topic
  src/terminal.ts     openTerminal / sendInput (login, lock screen, prompts)
  test/               Vitest tests
packages/cli/         the terminal REPL (the only place that reads files or the keyboard)
```

`packages/server` and `packages/client` will be added in later phases; the workspace already includes `packages/*`.

## Engine API in one minute

```ts
import { createWorld, openTerminal, sendInput, advanceTime, serializeWorld } from '@insider/engine';

const world = createWorld(scenario, 1);                 // scenario = parsed JSON, 1 = seed
const t = openTerminal(world, 'FIN-LT-07', 'p1');       // player p1 sits at a PC
const r = sendInput(world, t.terminalId, 'whoami');     // type one line
// r = { output, prompt, events, awaitingInput?: { masked } }
advanceTime(world, 5 * 60_000);                         // 5 minutes of game time
const save = serializeWorld(world);                     // complete state as JSON
```

When `awaitingInput` is present, the next `sendInput` is the answer to a question (a login name, a password) rather than a shell command, and `masked` says whether to hide the typing.

## How the main pieces work

**One plain-JSON world.** All state lives in a single `World` object made only of JSON values. That is the save file, and it can be saved even in the middle of a password prompt.

**Deterministic.** The engine never reads the real clock or `Math.random()`. Time moves only when the caller says so, and random numbers come from a seeded generator stored in the world. Same seed and same inputs give exactly the same world.

**Events first, logs second.** Every meaningful action calls `emit()`, which appends to the master event list (the ground truth, never shown to players) and then writes the realistic log lines a defender would find. Each event records the *account* used and, separately, the *player* physically at the keyboard.

**Logs are real files.** `/var/log/auth.log` and `/var/log/syslog` are ordinary files in the virtual filesystem, so `cat`, `grep` and `tail` work on them. `last`, `who` and `w` read the per-host login records; `journalctl` and `dmesg` read the journal.

**Accounts are real files too.** The engine parses `/etc/passwd`, `/etc/shadow`, `/etc/group` and `/etc/sudoers` each time it needs them, so what a player sees with `cat` is what the engine enforces.

**One screen per PC.** A terminal belongs to a host, not to a player, and holds a stack of shells (ssh and `su` push, `exit` pops). Walking away changes nothing, which is how "someone used my unlocked PC" works.

**Interactive commands.** When `ssh`, `su` or `sudo` needs a password, the rest of the command line is stored as data and resumed after the answer, so `sudo cat /etc/shadow | grep root > out.txt` still pipes and redirects correctly.

## Behaviour worth knowing

- **`.bash_history` is written when a shell exits**, as in real bash. `history` shows the in-memory list. A shell killed with `kill -9` saves nothing; lines starting with a space are never recorded.
- **ssh is logged on the target with the source IP of the previous hop.** Pivoting A → B → C leaves only B's address on C.
- **sudo asks for your own password and remembers it for 15 minutes per shell.** Every use, allowed or refused, goes to `auth.log`.
- **A workstation's owner is in group `adm`** on their own machine, so employees can read their own logs. On the server only the sysadmin is.
- **`dmesg` is readable by everyone.** Real Ubuntu restricts it to root; it is open here so employees can later check their own PC for USB events.
- **`last`, `who` and `w` use a 10-character user column** instead of cutting names to 8 like the real tools.
- **Hourly cron lines and DHCP renewals** are generated as time passes, so logs keep growing.

## Known simplifications

- After `ssh`, `su` or `exit` switches shells, the rest of that command line is dropped (`ssh host; ls` does not run `ls` afterwards).
- `ssh host command` (remote command without logging in) is not supported; `scp` copies single files only.
- No symlinks, no background jobs (`&`), no shell scripts: files can be read but not executed.
- `less` prints the file; there is no pager.
- Only the logged-in user's password unlocks a locked PC (no "switch user").
- Auto-lock after idle time is not implemented; `lastActivity` is recorded for it.

## Adding a scenario

Copy [scenarios/nexora-small.json](scenarios/nexora-small.json) and edit it. The format is documented field by field in [packages/engine/src/core/scenario.ts](packages/engine/src/core/scenario.ts). In short:

- `accounts`: username, full name, password and a `strength` (0–100, for the future password cracker).
- `hosts`: hostname, MAC, department, which accounts exist there, who has sudo, optional `staticIp`, files, crontabs, and who is logged in at the screen when the game starts (`locked` or `unlocked`).
- `dhcp`: the address pool, plus optional old leases.
- `history`: past logins, failed logins and sudo use. They are replayed through the same code as live actions, so old log lines look exactly like new ones.
- `players`: who sits where.

The CLI lists every `.json` file in `scenarios/`. A scenario with mistakes (unknown user, bad MAC…) is rejected at start with a list of problems.

## Adding a shell command

Write a `Handler` in one of the files in [packages/engine/src/commands/](packages/engine/src/commands/), add it to that file's exported map, and add a manual entry in `help.ts`. A handler receives its arguments and stdin as text and returns `{ stdout, stderr, exit }`; pipes and redirection are handled for it.
