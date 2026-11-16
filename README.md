# The Insider

A multiplayer social-deduction game that teaches real Linux forensics. The full design is in [DESIGN.md](DESIGN.md).

**Current state: Phase 3 — a living office.** You walk around a top-down office full of bot employees, sit at any PC and use its simulated Linux shell. The bots come to work, badge through doors, log in, do job tasks, write each other email, browse, take breaks and sometimes forget to lock their screen, so badge, door, camera, mail, DNS, proxy and system logs fill up even while you stand still. There are no hacker tools, roles, meetings or log viewers yet. The client now has detailed procedural office art, original temporary directional pixel characters, and a dark HUD with a public employee directory. See [visual upgrade notes](docs/design/visual-upgrade.md) for assets, scope and reference differences. `PROGRESS.md` says what was built in which step.

What exists:

- a simulated office network: machines, users, files, logs, a shell, mail, a simulated web, badge and camera logs (`packages/engine`);
- a game server that owns that world, the clock, the doors, the bots, the tasks and the cameras (`packages/server`);
- a browser client: map, movement, PC terminal (`packages/client`);
- a text CLI to use the simulation without graphics (`packages/cli`).

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

## Play in the browser

```bash
pnpm dev
```

This starts the game server (port 2567) and the web page. Open http://localhost:5173.

1. Choose an employee. You appear next to their desk with an onboarding card (username, password, PC, badge). Everyone you did not choose is played by a bot.
   On screen they look exactly like people; nothing tells you who is a bot.
2. Walk with `WASD` or the arrow keys. Stand at a desk's chair and press `E` to use that PC.
3. Type in the terminal. `Esc` stands up; the PC stays exactly as you left it.
4. Your task list (top left) gives you ordinary work to do. Each step shows a command that does it; the step is ticked off when you really typed it (or stood in the room it names).

| Key | Where | What it does |
|---|---|---|
| `WASD` / arrows | office | walk |
| `E` | at a desk | sit down and use the PC |
| `E` | at a door with a reader | tap your badge |
| `C` | office | show / hide your onboarding card |
| `T` | office | show / hide your task list |
| `` ` `` (backtick) | office | developer panel (development only) |
| `Esc` | terminal | stand up |
| `Ctrl+C` | terminal | cancel the line or the password question |
| `F2` | lock screen | switch user |
| `↑` `↓` `←` `→` `Home` `End` | terminal | history and line editing |

On the map, a monitor is green when unlocked, amber when locked (with the user's name) and grey at the login prompt. Muted red camera housings mark CCTV locations. A teal outline marks the desk or badge door in reach.

**Doors.** A closed door is a solid bar across the doorway. Doors with a small box beside them have a badge reader: stand at the door and press `E`. The reader is white by default. If your badge is accepted it turns green and the door opens for 3 seconds (anyone can walk through while it is open); if declined, it turns red. It returns to white when the door closes or the denial indicator clears. Dark red doors (server room, security office) open only for certain badges; your onboarding card says what yours opens. Doors without a box open by themselves. Every tap is written to `/var/log/badge/access.log` on `SEC-SRV-01`, which the security guard and the sysadmin can read over ssh.

Other commands:

| Command | What it does |
|---|---|
| `pnpm server` | only the game server |
| `pnpm client` | only the web page |
| `pnpm build` | production build of the web page (`packages/client/dist`) |
| `BOTS=0 pnpm dev` | an empty office without bot employees (PowerShell: `$env:BOTS=0; pnpm dev`) |
| `pnpm map` | regenerate `maps/office-small.json` from `maps/build-office.ts` (overwrites edits made in Tiled) |

Server settings are environment variables: `GAME_PORT` (2567), `SCENARIO` (`nexora-small`), `MAP` (`office-small`), `SEED` (1), `TIME_SPEED` (game seconds per real second, 1), `BOTS` (`0` = an empty office with no bot employees), and `NODE_ENV=production` to switch the developer tools off.

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
| `:switch` | On a lock screen: switch user (log in as someone else; the locked session stays). |
| `:as <player>` | Become another player (`p1`…`p5`). This is who is *physically* at the keyboard. |
| `:players` / `:hosts` | List players with credentials / machines with IP, MAC and screen state. |
| `:time` / `:time +5m` | Show / advance game time (`s`, `m`, `h`, `d`, e.g. `+1h30m`). |
| `:events [N]` | Debug view of the master event log (last N entries). |
| `:dump [file]` | Save the whole world to JSON (default: `dumps/`). |
| `:help` / `:quit` | Help / exit. |

Passwords show as `*` while you type them. Game time also advances by the real time that passes between your inputs. A screen never locks itself: lock it with `loginctl lock-session`.

A step-by-step tour with expected results is in [TESTING.md](TESTING.md).

## Run the tests

```bash
pnpm test
```

```bash
pnpm typecheck
```

226 Vitest tests cover the engine (mail, web and DNS logs, background noise, permissions, ssh logging and source IPs, sudo, su, history, DHCP, lock/unlock, unattended-PC records, switch user, pipes, deterministic replay) and the server (movement, sitting, doors and badges, bots, job tasks, CCTV, a three-hour soak run, map checks, and the visibility rule).

```bash
pnpm e2e
```

Five Playwright tests drive real Chromium clients through the game (on their own server, ports 2577 and 5183, without bots, so they never share an office with a game you have open). They cover the existing interactions plus two-client movement, responsive HUD layout, and stable canvas/camera sizing after repeated task-panel toggles. Screenshots go to `e2e/screenshots/` and `test-results/design/`. The first time, download the browser with:

```bash
pnpm exec playwright install chromium
```

## Project layout

```
scenarios/            office definitions (data only)
maps/                 office maps in Tiled JSON format, and the script that generated the first one
e2e/                  Playwright browser tests and their screenshots
scripts/dev.mjs       starts server + web page together
packages/shared/      message types, map format, movement rules and route finding used by server AND client
packages/server/      the game server (Colyseus)
  src/game.ts         one match: world + players' bodies; all rules, no networking
  src/visibility.ts   the ONLY place that builds data sent to a browser
  src/OfficeRoom.ts   thin network wrapper around game.ts
  src/state.ts        the public state synced to every browser
  src/mapCheck.ts     start-up check: map and scenario agree (desks, doors, badges, cameras, reachability)
  src/doors.ts        doors: closed = wall, badge taps, 3 s open, passage counting
  src/tasks.ts        job tasks: handed out, ticked off from what really happened
  src/cctv.ts         cameras: snapshots of who is in view
  src/bots/           bot employees
    manager.ts        one bot per employee nobody plays; arrival; observations
    mover.ts          walking a route at human speed, through doors
    brain.ts          the daily routine as a behaviour tree (tree.ts)
    random.ts         the bots' own seeded random numbers
packages/client/      the browser game
  src/game/store.ts   connection + the data React, Phaser and xterm share
  src/game/           Phaser scene (map, players, monitors) and keyboard
  src/ui/             terminal window, line editor, HUD, start screen, card, dev panel
packages/engine/      the simulation: pure TypeScript, no I/O, no Node APIs
  src/core/           clock, background noise, random numbers, scenario format, world builder
  src/fs/             virtual filesystem and permission checks
  src/auth/           /etc/passwd & co, passwords, sudo rules, login sessions
  src/net/            DHCP (with lease history) and DNS
  src/physical/       badge taps, door and camera events (the logs on SEC-SRV-01)
  src/proc/           process table
  src/events/         master event log and the log lines made from it
  src/shell/          lexer, parser, expansion, executor, prompt
  src/commands/       the shell commands, grouped by topic
  src/terminal.ts     openTerminal / sendInput (login, lock screen, prompts)
  test/               Vitest tests
packages/cli/         the terminal REPL (the only place that reads files or the keyboard)
```

## How the browser game fits together

```
keyboard -> client --(move / sit / line)--> server (OfficeGame) --> engine World
client <--(state patches: positions, desks, clock)--------+
client <--(messages: text of the PC I am sitting at)------+
```

**The server decides everything.** The browser sends what the player wants ("walk left", "sit here", "this line"). The server moves the player, checks walls and the distance to the desk, runs the line in the engine and sends back the result. 20 times a second it advances the game clock by the real time that passed.

**The visibility rule.** The server knows every password and the true identity behind every action. A browser receives only: the public physical state (where people are, who sits where, whether each monitor is locked), its own onboarding card, and the text on the screen of the PC it is sitting at. Every outgoing payload is built field by field in `visibility.ts`; nothing from the engine is passed through whole. Tests record every message, and every byte on a real connection, and check that no other password and no master-log entry is in them.

**The map** is a Tiled JSON file. Open `maps/office-small.json` in [Tiled](https://www.mapeditor.org) to edit it. Each object in the `desks` layer has a `hostname` property naming a scenario host; if the two lists differ, the server stops at start-up and prints every mismatch.

**Bots are ordinary bodies.** A bot is the same kind of object as a human player and acts through the same functions (walk, tap a badge, sit, type a line), so it is bound by the same rules and leaves the same logs. A browser receives a bot exactly like a human: the same fields and nothing else. The only difference is where the decisions come from: a keyboard, or `bots/brain.ts`. Bots have their own seeded random numbers, so a match replays identically.

**Doors** are pieces of wall that can be switched off. Closed, a door's tiles are solid; a granted badge tap makes them walkable for 3 seconds for anyone, which is what makes tailgating possible.

**Evidence the office produces by itself** (all readable with the shell on the machine that stores it):

| What | Where |
|---|---|
| Badge taps, granted and denied | `SEC-SRV-01:/var/log/badge/access.log` |
| Door open/close with the number of people who passed | `SEC-SRV-01:/var/log/badge/doors.log` |
| Camera motion (head count and snapshot id, no names) | `SEC-SRV-01:/var/log/cctv/motion.log` |
| Mail traffic; each user's mailbox | `ADMIN-SRV-01:/var/log/mail.log`, `/var/mail/USER` |
| Web requests (PC, account, URL, size) | `ADMIN-SRV-01:/var/log/squid/access.log` |
| Name lookups | `ADMIN-SRV-01:/var/log/named/queries.log` |
| Connections to a machine's ssh port | that machine's `kern.log` / `dmesg` (`[UFW ALLOW]`) |
| Logins, sudo, locks, cron, timers, clock sync | each machine's `auth.log` and `syslog` |

`SEC-SRV-01` has no screen: reach it with `ssh SEC-SRV-01` as the security guard or the sysadmin.

**The developer panel** can show the master event log, which bodies are bots, camera snapshots and any file, so it is locked twice: the server ignores `dev.*` messages unless it runs in development mode, and the production build of the page does not contain the panel.

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
- **No auto-lock.** A PC stays unlocked until someone locks it. The engine records every stretch of time a PC stood open while its user was away, and who sat at it meanwhile (`world.unattended`, for the Phase 5 debrief; never sent to players).
- **Arrivals.** Picking an employee writes their arrival at the main entrance in the badge log; leaving the game writes their departure.
- **Ended sessions are forgotten** from memory (matches have no time limit); `last`, `auth.log` and `.bash_history` keep the record.
- **Switch user.** A lock screen accepts any account of that machine as a second login; the locked session stays underneath and returns when the second one logs out.
- **Remote `loginctl lock-session` / `unlock-session`** write a `REMOTE …` line with the source IP to that machine's `auth.log`.
- **Every master event has an `origin`**: `physical`, `remote` or `system`.

## Known simplifications

- After `ssh`, `su` or `exit` switches shells, the rest of that command line is dropped (`ssh host; ls` does not run `ls` afterwards).
- `ssh host command` (remote command without logging in) is not supported; `scp` copies single files only.
- No symlinks, no background jobs (`&`), no shell scripts: files can be read but not executed.
- `less` prints the file; there is no pager.
- A screen locked remotely while a password question (ssh, sudo) is open drops that question.
- Humans start at their desk without an arrival line in today's badge log; bots walk in through the main entrance and (mostly) have one.
- Camera snapshots are recorded but there is no viewer yet (Phase 5); the developer panel can print one.
- Movement in the browser is not predicted locally: your character follows the server's position, which is smooth on a local network but would lag on a slow connection.
- Reloading the page starts you again at the start screen; the PCs keep their state.

## Adding a scenario

Copy [scenarios/nexora-small.json](scenarios/nexora-small.json) and edit it. The format is documented field by field in [packages/engine/src/core/scenario.ts](packages/engine/src/core/scenario.ts). In short:

- `accounts`: username, full name, password and a `strength` (0–100, for the future password cracker).
- `hosts`: hostname, MAC, department, which accounts exist there, who has sudo, optional `staticIp`, files, crontabs, and who is logged in at the screen when the game starts (`locked` or `unlocked`).
- `dhcp`: the address pool, plus optional old leases.
- `history`: past logins, failed logins and sudo use. They are replayed through the same code as live actions, so old log lines look exactly like new ones.
- `players`: who sits where, and their `role` (bots use it for their routine and tasks).
- `accounts[].badge`: badge number and the restricted zones it opens. `badgeSystem`: which host stores the badge and camera logs.
- `tasks`: job tasks (see the comments on `ScenarioTask`). `mail`: mail server and old messages. `web`: the simulated sites and the proxy.

A host with `"headless": true` is a box in a rack: no desk, ssh only.

For the browser game, every other host also needs a desk on the map (an object in the `desks` layer with that `hostname`, and a point in `spawns` with `desk` set to it).

The CLI lists every `.json` file in `scenarios/`. A scenario with mistakes (unknown user, bad MAC…) is rejected at start with a list of problems.

## Adding a shell command

Write a `Handler` in one of the files in [packages/engine/src/commands/](packages/engine/src/commands/), add it to that file's exported map, and add a manual entry in `help.ts`. A handler receives its arguments and stdin as text and returns `{ stdout, stderr, exit }`; pipes and redirection are handled for it.
