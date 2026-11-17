# Progress

This file says where the work stands, so a new session can continue from it alone.
Update it at the end of every part.

## Phases

| Phase | State |
|---|---|
| 1 Simulation core | done |
| 2 Office in the browser | done |
| 3 Living office | done, pushed by the owner |
| 3+ Owner's changes after Phase 3 | done (section below) |
| 4 Hacker gameplay | **planned, waiting for the owner's OK** (plan below) |

## Phase 4 status: Parts A, B, C, F and G DONE; Parts D and E DEFERRED by the owner; H partly done

| Part | State |
|---|---|
| A Match secrets: the hacker and the weaknesses | **done** |
| B Tool framework | **done** (mechanism + the harmless `selftest` tool only) |
| C Physical tools: USB stick, shoulder surfing | **done** |
| D Remote tools: implant, keylogger, hash cracker, network scanner | **deferred** (see below) |
| E Phishing kit and log cleaner | **deferred** (see below) |
| F Flag, winning, audit log, security alerts | **done** |
| G Route tests (2+ complete routes) | **done** (2 routes, see below) |
| H Dev panel, browser test, CLI, docs | partly: dev panel and browser test done; CLI cannot join as the hacker yet |

**Parts D and E are deferred (owner, 2026-11-17): "skip this part for now but we will do it later".** Under
Opus 5.5 the first attempt at Part D was stopped by a safety classifier before any file changed. Do not start
D or E again unless the owner asks. When they do: each tool is one `ToolDefinition` in `TOOLS`
(`engine/src/tools/toolkit.ts`); the USB backdoors from Part C are in `world.toolkit.backdoors`.
Without D and E the hacker can still reach the flag through the weaknesses (plaintext root password, extra sudo,
careless sysadmin, weak admin password via shoulder surfing). Suggested next, pending the owner's choice:
the defender-side parts of F (flag delivery and win, end screen, /etc/shadow audit line, IDS log and global
alert), then Phase 5 work that needs no more tools.

Owner-approved defaults: "join as the hacker" on the start screen (one per match); the hacker is NOT told which
weaknesses are on; winning = exfiltrating the flag; bots fall for phishing about 30 %; scanner alerts go to everyone.

### Part A: what exists now

- Engine `mission/mission.ts`: `applyWeaknesses` rewrites a COPY of the scenario before the world is built
  (weak sysadmin password, extra sudo for one of three candidates on the server and their own PC, an old backup
  script with the root password on the shared folder); `world.mission` (hacker, flag, weaknesses, extraSudoAccount,
  carelessPlayer, onePersonDoors, won); `setHacker` creates `~/.tools` (+ `loot/`, README) on the hacker's own PC;
  `briefing` (goal, tools path, rumours; never today's weaknesses). Its own random sequence: seed-1 IPs unchanged.
  `createWorld(scenario, seed, { weaknesses })`: default NONE (engine tests and the CLI get a plain office).
- Scenario `mission` block (data) + validation.
- Server: `weaknesses` option, default "random"; env `VULNS=random|none|id,id`. `choose { playerId, hacker: true }`,
  `welcome.mission` (hacker only, else null), `lobby.hackerOpen`. The role frees up when the hacker disconnects.
  One-person doors: `Doors` keeps such a door solid for everyone except walkers whose badge it accepted
  (`withAccess` wraps every body's movement; `isOnePerson`); it closes as soon as that person is through. The server
  room is one-person unless the "tailgate" weakness is on. Careless sysadmin: persona `forgetLock` from the scenario (0.8).
  Dev view `mission`.
- Client: start screen option, private briefing panel (`M`; shown once the onboarding card is closed), dev button.
- Test defaults: `Recorder` uses `weaknesses: ['tailgate']`; Playwright server uses `VULNS=none`. Vitest timeout is 30 s.
- With the default seed 1, `pnpm dev` has weak-admin-password + extra-sudo (r.mansour): Khalid's password is then
  `nexora2026`, not the one in TESTING.md's table (noted there).
- 250 Vitest tests (new: engine and server `mission.test.ts`), 6 Playwright tests.

### Part B: what exists now

- **Safety-filter note:** under the Fable 5.2 model, three attempts at Part B were stopped by a safety classifier
  before any file changed. The owner switched to Opus 5.5 and Part B went through. If Parts C to E get stopped,
  tell the owner plainly and offer the defender-side work (audit log, IDS log, win condition) or Phase 5 work instead.
- `engine/src/tools/toolkit.ts`: `ToolDefinition` (name, summary, usage, cooldownMs, actionMs(args), noise,
  traces[], start(c, args), finish?(world, host, job)); `TOOLS` registry (only `selftest` so far); `installTools`
  (called by `setHacker`: one 700 file per tool with a `# toolkit: NAME` marker line, plus README and loot/);
  `runTool` (cooldown per player+tool in `world.toolkit.cooldowns`, master event `tool.run` with tool, args, noise,
  background, path); background jobs (`world.toolkit.jobs`, a `ps aux` process not tied to the login session;
  `nextToolJob` is scheduled by the clock; on finish `tool.done` with result done or killed); `writeLoot`.
- `commands/table.ts` dispatcher: an executable, readable file with the marker runs its tool; other scripts still
  do not run. Bare names do not work (tools are not on PATH): `~/.tools/NAME`.
- A test enforces that every tool lists at least one trace.
- 265 Vitest tests (new: `engine/test/toolkit.test.ts`, one server test).

### Part C: what exists now

- Engine `tools/physical.ts`: `plugUsb(world, hostname, playerId)`: always `usb.insert` + `usb.remove` (kernel lines in
  dmesg / kern.log); on an UNLOCKED console session also a backdoor for that session's user: hidden program
  `~/.cache/.sysupd/sysupd`, a process, a listening port (4440 + n, `ss -tlnp`), an `@reboot` crontab line,
  `world.toolkit.backdoors` record, `backdoor.install` event. Cooldown 60 s (`usbCooldown`). Killing the process
  closes the port (Part D's remote tool must check the process is alive). `shoulderSurf` appends to the hacker's
  `~/.tools/loot/shoulder.txt` on their own PC and emits `shoulder.surf` (no password in the event). `glimpse`
  shows about 40 % of characters. Engine `awaitingSecret(world, terminalId)`.
- Server: messages `item.start { item: 'usb', hostname }` / `item.stop`. Only the hacker; standing (not seated),
  within INTERACT_DISTANCE of the chair, nobody seated there, cooldown over. Hold 5 s real time (`USB_HOLD_MS`);
  moving, walking off, someone sitting down or letting go cancels with nothing logged. While holding,
  `PublicPlayer.activity = 'at-pc'` (new public field; CCTV snapshots record it too).
  Shoulder surfing: every line typed by a human or bot goes through `game.typeLine`; if it answers a masked prompt
  and the HUMAN hacker stands just behind the chair (0 < dy <= 52 px below the seat, |dx| <= 32 px, not seated),
  the hacker gets a notice and loot; a bot victim remembers it 7 times in 10 (`Observation.note`).
- Client: hold `U` near a desk (hacker only; hint says so), "···" bubble and crouch for anyone `at-pc`.
- 287 Vitest tests (new: engine and server `physical.test.ts`), 6 Playwright (the hacker test now uses the stick).

### Part F and G: what exists now

- Owner chose (2026-11-17) "Flag, win, alerts" after deferring D and E.
- **Handing in the flag** (deviation from the earlier "exfiltrate" default, which would have been a Part D/E
  tool): the hacker pastes the flag text into the briefing panel (`flag.submit`). Engine `submitFlag` accepts it
  only from the hacker, only the exact text of the flag file, and only if the master log shows this player
  really read that file in this match. Then `world.mission.won`, event `mission.won`, the server stands the
  hacker up and sends `match.over { winner, hacker, at }` to every connected client (start screen included).
  Client: end screen overlay. DESIGN.md section 1 already said "submit the flag".
- **Audit log** (`/var/log/audit/audit.log`, root only, auditd-style SYSCALL + PATH lines) on the machine where
  `/etc/shadow` or the flag file is read, successful or refused. `auid`/login account survives `su`
  (`readTracked` follows the su chain). `watchedFile` in `engine/src/security/alerts.ts`.
- **Security alerts** (`engine/src/security/alerts.ts`, hooked into `emit`): rules usb-keyboard (LOW),
  new-listener (MEDIUM, a backdoor), sudo-denied (LOW), shadow-read (MEDIUM), flag-read (HIGH), *-denied (LOW),
  auth-failures (MEDIUM: 3 failures for one account on one host within 2 min). Same rule/host/account at most
  once per 5 min (except HIGH). Lines in `/var/log/security/alerts.log` on SEC-SRV-01 (root:adm 640: guard,
  sysadmin). Server: any MEDIUM/HIGH alert -> one vague banner (`alert { text }`) to every PLAYING human,
  at most one per 60 s game time. A test checks 30 minutes of bots raise no MEDIUM/HIGH alert.
- **Route tests** (`packages/server/test/win.test.ts`): (1) plaintext root password in the old backup script ->
  `su` on the server -> flag -> win; (2) shoulder-surf the sysadmin unlocking his PC several times, piece the
  password together, ssh as k.nasser from Omar's PC, `sudo cat` the flag -> win. Both check the traces.
- Dev panel `mission` view also lists backdoors (alive or dead) and the number of alerts.
- Playwright server now runs with `VULNS=plaintext-password`; new browser test plays route 1 to the end screen.
- 304 Vitest tests (new: engine `security.test.ts`, server `win.test.ts`), 7 Playwright.

### What is left of Phase 4

- Parts D and E (deferred by the owner).
- CLI: joining as the hacker (`setHacker`) is not exposed in the CLI.
- No "match over" reset: a new match needs every client to leave (the room then closes) or a server restart.

### Notes for Part D onwards

- Add a tool = add a `ToolDefinition` to `TOOLS`; it gets its file, README line, cooldown and job handling for free.
- Physical tools (BadUSB: hold E 5 s at an unlocked PC; shoulder surfing) also need server/client work: a hold
  action and a "busy at desk" look in the public state.

## Phase 4 plan (hacker gameplay)

Goal (DESIGN.md section 15): win as the hacker by at least 2 routes; every action is traceable.
Sources: DESIGN.md sections 5 (toolkit), 6 (vulnerabilities), 15. Everything stays simulated game logic.
Not in Phase 4: roles and their powers, SIEM, viewers, meetings, voting, bot hacker, debrief UI (all Phase 5).
After each part: all tests, commit locally, update this file.

| Part | What |
|---|---|
| A | Match secrets: the hacker and the vulnerabilities |
| B | Tool framework: `~/.tools`, action time, cooldown, noise, background jobs |
| C | Physical tools: BadUSB, shoulder surfing |
| D | Remote tools: implant, keylogger, hash cracker, network scanner (+ IDS) |
| E | Phishing kit and log cleaner |
| F | The flag, exfiltration and winning; escalating global alerts |
| G | Route tests (2+ complete routes) and the traceability test |
| H | Dev panel, browser test of one route, CLI support, docs |

A. `engine/src/mission/`: `world.mission = { hacker, vulnerabilities, ... }`, secret (never sent except the
   hacker's own briefing). Vulnerabilities drawn from their own seeded generator, 2-4 per match, forceable with
   env `VULNS=`: weak sysadmin password (strength ~10); a regular employee in group sudo by mistake (server and their
   own PC); root password in plain text in an old backup script on the shared folder; the sysadmin's bot extra
   careless (forgets to lock ~80 %); server room door tailgatable. When tailgating is OFF the server room door
   becomes one-person: it closes as soon as one body has passed. Hacker's PC gets `~/.tools/` (hidden folder).
   Visibility test: no other browser learns who the hacker is or which weaknesses exist.
B. Tools are shell commands that exist only as files in the hacker's `~/.tools` (`~/.tools/scan ...`). Each has a
   cooldown, an action time and a noise level. Long actions (cracking) run as a background process, visible in
   `ps aux` (a trace), and write their result to `~/.tools/loot/`. Every tool run is a master event with the actor.
C. BadUSB: an item; hold `E` 5 s at an UNLOCKED PC -> backdoor service on that PC (USB lines in dmesg/kern.log,
   CCTV if in view, the hacker shows a visible "busy at desk" pose to everyone). Shoulder surfing: stand right
   behind a seated person while they type a password -> a few characters revealed privately to the hacker
   (visible behaviour; bots note "X stood behind me" in their observations).
D. Implant: shell on a backdoored PC as its user, no password (ESTAB connection in `ss -tnp` both ends, odd
   process). Keylogger: installed from a shell on a PC; captures the next password typed there (hidden process,
   file in /tmp). Hash cracker: needs a copy of a shadow file; time depends on password strength; reading
   /etc/shadow writes an audit line on that host. Network scanner: lists hosts and services; triggers an IDS
   alert in a new IDS log on the server and a vague global HUD alert.
E. Phishing: spoofed "IT password reset" mail (From: IT, Received: the hacker's real PC/IP, SPF fail) with a link to
   a fake site; a victim who opens it "submits" their password (proxy + DNS logs show the visit); bots fall for it
   sometimes. Log cleaner: removes matching lines from a log the hacker can write (root); leaves a "log cleared"
   event and a visible time gap.
F. Flag `/root/flag.txt` on ADMIN-SRV-01. The hacker wins by exfiltrating it with a tool (upload to an external drop
   site: a large request in the proxy log). Global announcement and a simple end screen; the match record is kept
   for the Phase 5 debrief. Global alerts get more frequent as the hacker reaches milestones, without saying which.
G. Server tests play full routes: (1) careless sysadmin -> his unlocked PC -> keylogger catches his sudo password ->
   root on the server -> flag; (2) plaintext root password in the backup script -> su root -> flag; (3) sudo-by-mistake
   employee phished -> sudo on the server -> flag; (4) weak sysadmin password: shadow copied from the sudo-by-mistake
   employee's PC -> cracked quickly. A traceability test checks every tool left at least one trace a defender can find.

## Owner's changes after Phase 3 (done)

The owner asked for six changes before Phase 4:

1. **Auto-lock removed completely.** No `autoLockMs`, no `lastPhysicalInput`, no `touchTerminal`, no `term.activity`
   message, no `autoLockSeconds` in scenarios. A PC stays unlocked until someone locks it (deliberate: the game
   teaches locking). DESIGN.md section 3 rewritten; section 6's "longer auto-lock" vulnerability replaced by "the
   sysadmin's bot is extra careless and often leaves the admin PC unlocked" (to implement in Phase 4).
   New: `engine/src/auth/unattended.ts` keeps `world.unattended`: every window a PC stood unlocked while its
   user's player was away, how it ended (`locked` + by whom, `logged out`, `owner returned`) and the visitors with
   the number of lines each typed. For the Phase 5 debrief; never sent to players. Dev panel view `unlocked`.
2. **Arrival line:** picking an employee taps their badge IN at MAIN-ENT (door opens 3 s, one passage);
   disconnecting taps OUT. Not when the employee's bot was already inside. `Doors.passThrough`.
3. **Bot task pace:** `botOptions.taskMinutes` (default 3). A bot starts a new task only after `nextTaskAt`; between
   tasks an everyday command 60 % of the time, else idle; pauses 15-50 s. Measured: ~21 tasks per bot per hour.
4. **Camera CAM-06** inside the server room (sees its door from inside and the whole room). Department rooms and
   the security office stay blind spots.
5. Bot forget-to-lock rate stays 25 %.
6. **Ended sessions pruned:** `pruneSessions` (auth/sessions.ts) runs after every clock advance and drops ended
   sessions nothing points at. Soak: about 10 sessions in memory after hours.

Tests: 226 Vitest, 5 Playwright (3 smoke + the owner's 2 design tests).

## Phase 3 parts

| Part | What | State |
|---|---|---|
| A | Decisions, doors and badges | **done** |
| B | Bot movement and pathfinding | **done** |
| C | Bot behaviour (routines, desk use, observations) | **done** |
| D | Job tasks (bots and humans) | **done** |
| E | Internal email, network/DNS/proxy logs, background service noise | **done** |
| F | CCTV recording | **done** |
| G | Dev panel additions, soak test, docs | **done** |

The Phase 3 brief the owner pasted was cut off in the middle of Part B. The owner then said:
"use your plan and DESIGN.md for Parts B to G, and ask me if something is unclear when you get there."
Scope limits from the brief: no hacker tools, vulnerabilities, flag mission, roles, SIEM/CCTV viewer UIs,
meetings, voting, chat, multiplayer lobbies or real art in Phase 3. After each part: run all tests, commit
locally (never push), update this file.

## Part A: what exists now

- **Decisions recorded** in DESIGN.md section 2 ("Doors and badges") and section 3: players do not collide;
  one occupant per PC; reconnect and movement prediction wait for Phase 6; badge access per user in the scenario.
- **Engine**
  - `packages/engine/src/physical/badges.ts`: `tapBadge` (the access rule), `doorOpened`, `doorClosed`, `doorPassed`.
  - Events `badge.tap`, `door.open`, `door.close` become lines in `/var/log/badge/access.log` and `doors.log`
    on the badge server (`events/materialize.ts`). `door.pass` (who walked through) is master-log only.
  - Scenario: `accounts[].badge { id, access[] }`, `hosts[].headless`, `badgeSystem { server, entranceDoor }`.
  - `createWorld` writes the previous working day's arrivals and departures into the badge log.
  - Headless hosts cannot be sat at (`openTerminal` throws; the CLI's `:sit` refuses).
- **Scenario** `nexora-small`: every account has a badge; new headless host `SEC-SRV-01` (10.0.1.20,
  accounts t.omar and k.nasser, both may read the logs).
- **Map** (`maps/build-office.ts`, regenerate with `pnpm map`): doors have `code`, `room`, `reader`,
  `restricted`, `zone`; 7 badge readers; a pavement row outside the main entrance with an `outside` spawn
  (for arriving bots in Part B); the CCTV monitors moved off the security office doorway (they sealed the room).
- **Shared**: `MapDoor` (with `axis` and `inside`), door helpers in `map.ts`, `PublicDoor`, `tap` message, door timing constants.
- **Server**: `src/doors.ts` (door state machine, passage counting), wired into `game.ts`; closed doors are
  solid in `game.collision` while `game.map.solid` stays door-free for route planning; `mapCheck.ts` checks
  headless hosts, badge zones, the entrance door and that every desk can be reached on foot.
- **Client**: doors drawn live, reader light, `E` taps, hint, badge on the onboarding card, beep placeholders (`game/sound.ts`).
- **Tests**: 153 Vitest tests (new: `packages/server/test/doors.test.ts`), 3 Playwright tests.

## Part B: what exists now

- `packages/shared/src/path.ts`: `findPath` (A*, 4 directions, corner points, optional `avoid` tiles).
- `packages/server/src/bots/random.ts`: the bots' own seeded generator (separate from the engine's, so bots do not change IPs).
- `packages/server/src/bots/mover.ts`: `Mover` walks one body along a route at human speed against `game.collision`;
  taps badge doors after a short pause (sometimes walks through an already open door without tapping);
  plans around restricted doors its badge does not open; reports `arrived` or `failed` (`no-route`, `denied`, `stuck`).
- `packages/server/src/bots/manager.ts`: `BotManager`. One bot per employee no human plays. Bots appear on the
  pavement 4-240 game seconds after the match starts, enter through MAIN-ENT and walk to their own chair, then stand there
  (Part C gives them things to do). A bot body is a normal `Avatar` with key `bot:<playerId>`; it is not in `game.clients`.
- `game.ts`: option `bots` (default true; env `BOTS=0` for an empty office). A human choosing an employee removes
  that employee's bot; a human disconnecting schedules a bot for that employee. The lobby's `taken` flag counts humans only.
- Tests run with `bots: false` unless they ask (`new Recorder({ bots: true })`). 163 Vitest tests (new: `bots.test.ts`).
- Adding SEC-SRV-01 in Part A shifted the seed-1 DHCP addresses (a new host draws random numbers while booting);
  TESTING.md's tables were updated in this part.

## Part C: what exists now

- `bots/tree.ts`: a tiny behaviour tree (`sequence`, `selector`, `condition`; nodes answer success / failure / running).
- `bots/brain.ts`: `employeeTree` = break time (lock or forget, stand, walk somewhere, linger) OR work (walk to own
  desk, sit, log in / unlock / switch user, type an everyday command every 6-24 s). All memory is in `Mind` (plain data).
  Rhythm and break places depend on the scenario role: the guard patrols, the helpdesk visits desks, the sysadmin
  sometimes goes to the server room. A 6 % password typo leaves honest auth failures.
- `bots/manager.ts`: builds each bot's `Persona` (own account and password, own files to `cat`), gives the brain its
  hands (`BrainWorld`), and records **observations** once a game second: who a bot saw in its own room within 320 px,
  only when that changes (appeared / sat down / stood up). `bots.observations(playerId)`, `bots.mind(playerId)`, `bots.list()`.
- `game.ts`: `sitBody` / `standBody` are the one implementation of sitting and standing for humans and bots;
  option `botOptions.forgetLock` (default 0.25).
- Playwright now starts its own server (ports 2577 / 5183, `BOTS=0`), independent of `pnpm dev`.
- 175 Vitest tests (new: `behaviour.test.ts`), 3 Playwright tests.

## Part D: what exists now

- Scenario `tasks[]` (`ScenarioTask`, `ScenarioTaskStep` in `engine/src/core/scenario.ts`): steps are either
  `run` + `match` (+ optional `host`) or `visit` (+ `staySeconds`); placeholders `{date}`, `{n}`, `{user}`;
  optional `roles` / `departments`. `validateScenario` refuses a step whose `run` does not satisfy its own `match`.
  `nexora-small` has 14 tasks (general, per department, sysadmin, helpdesk, guard).
- `packages/server/src/tasks.ts`: `TaskBoard`. Three open tasks per player; steps are ticked off IN ORDER from the
  master event list (`command` events, by `actor`) and from where bodies stand (visits). `abandon`, `abandoned`,
  `completed(playerId)`, `view(playerId)`.
- Humans: message `tasks` (own list only, built in `visibility.ts` `taskList`), HUD panel (`T` toggles), terminal moves
  right while the list is shown.
- Bots: `brain.ts` `work` types the next step, answers ssh/sudo password questions with its own password, treats a
  visit step as an errand (a break with a destination), closes its ssh sessions before leaving, gives a task up
  after two failed attempts. `Mind.typing` tells a bot's own password question from one somebody else left.
- 185 Vitest tests (new: `tasks.test.ts`), 3 Playwright tests.

## Part E: what exists now (all in the engine, so the CLI has it too)

- **Mail**: `commands/mail.ts`. `mail` (inbox), `mail N` (read with full headers), `mail -s "S" USER "BODY"` (send; body
  may come from a pipe). `world.mail` holds the messages; `mail.send` materializes Postfix lines in
  `/var/log/mail.log` and an mbox copy in `/var/mail/USER` (mode 600) on the mail server. Headers carry the sending
  machine and its IP. `MailMessage.headerFrom` vs `from` is ready for spoofing in Phase 4. Scenario: `mail.server`, `mail.history`.
- **Web**: `curl URL` (in `commands/net.ts`) against the scenario's `web.sites` (made-up `.example` names only).
  `web.request` -> `/var/log/squid/access.log` on the proxy (readable format: time, PC IP, account or `-`, method, URL,
  status, bytes, ms, destination IP). `dns.query` (nslookup, curl) -> `/var/log/named/queries.log` on the DNS server.
- **Firewall**: every connection to a machine's ssh port writes a `[UFW ALLOW] ... SRC= DST= SPT= DPT=22` kernel line there.
- **Noise**: `core/noise.ts`, driven by the clock from the match start only. Per machine: clock sync every 16 min,
  systemd timer lines every 11 min, workstation update checks every 23 min (DNS + proxy lines with account `-`).
  No random numbers; the phase comes from the hostname. Seed-1 addresses are unchanged (a test checks two of them).
- Tasks `answer-mail`, `intranet-news`, `supplier-check`; placeholder `{colleague}`. Bots' everyday commands
  include `mail` and `curl`.
- 204 Vitest tests (new: `packages/engine/test/office.test.ts`).

## Part F: what exists now

- `packages/server/src/cctv.ts`: `Cctv`. Cameras come from the map (`covers` room, `range` in tiles). Every 2 game
  seconds each camera's scene is compared with its last stored snapshot; a new `Snapshot` (people with name, position,
  facing, desk) is stored on change, plus a keyframe a minute. `cctv.at(cameraId, time)`, `recording(id)`, `find(snapshotId)`, `sees(camera, x, y)`.
- Text evidence: `/var/log/cctv/motion.log` on SEC-SRV-01 (`CAM-01 MOTION persons=2 snapshot=CAM-01-000042`), written
  when a camera's head count changes. No names on purpose; the picture needs the viewer (Phase 5).
- Snapshots are never sent to browsers. `mapCheck` refuses a camera that covers an unknown room.
- 215 Vitest tests (new: `cctv.test.ts`).

## Part G: what exists now

- Dev panel (development servers only): message `dev.show` with views `bots`, `tasks`, `doors`, `badges`, `cctv <camera>`,
  `saw <playerId>`, `file <HOST:/path>`; buttons in `client/src/ui/DevPanel.tsx`; `game.ts` `devShow`.
- `packages/server/test/soak.test.ts`: a full office for three game hours, checked hour by hour (nobody stuck or in a
  wall, every log grows, tasks get done, no refused badges, caps hold). Measured after 3 h: about 25,000 master events,
  290 sessions, 10 MB serialized world, about 200 tasks finished per bot, 2 given up.
- README, TESTING.md ("Phase 3", steps L to T) and DESIGN.md (sections 2, 3, 4, 8, 10) are up to date.
- 218 Vitest tests in 19 files, 3 Playwright tests.

## Things the next part must know

- Bots must use the same paths as humans: `Doors.tap(walker, code)` for badge doors, and the `Walker`
  shape in `doors.ts`. A bot body should be an `Avatar` like a human's, so the public state cannot tell them apart.
- Plan routes on `game.map.solid` (doors passable); move bodies against `game.collision`.
- Humans start at their desks WITHOUT an arrival line in today's badge log; bots walk in and (mostly) have one.
  Left as is for now; tell the owner in the Phase 3 summary (a later lobby/"match start" in Phase 6 can fix it).
- Do NOT start coding Phase 4 until the owner approves the plan in "Phase 4 plan" below.
- Known flake: the first Playwright test (keyboard-steered walk) got stuck about 1 run in 10. Cause not found;
  the walker now re-centres when it stops moving and the config allows one retry. The server-side walk tests are stable.
- The dev server (`pnpm dev`) restarts itself when server files change; Playwright reuses a running one.
- Door timers and walking use real time; the game clock can run faster (dev panel). At speed 1 they agree.
- Writing files from Bash heredocs breaks on apostrophes in this environment: use the Write tool or a script file.
- `pnpm` is not on PATH here: use `corepack pnpm ...`.

## Not done / not verified

- Typing a masked password in the CLI at a real keyboard was never verified by hand (Phase 2 leftover).
