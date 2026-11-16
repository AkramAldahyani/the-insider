# Progress

This file says where the work stands, so a new session can continue from it alone.
Update it at the end of every part.

## Phases

| Phase | State |
|---|---|
| 1 Simulation core | done |
| 2 Office in the browser | done |
| 3 Living office | **in progress** (parts below) |

## Phase 3 parts

| Part | What | State |
|---|---|---|
| A | Decisions, doors and badges | **done** |
| B | Bot movement and pathfinding | **done** |
| C | Bot behaviour (routines, desk use, observations) | **done** |
| D | Job tasks (bots and humans) | next |
| E | Internal email, network/DNS/proxy logs, background service noise | not started |
| F | CCTV recording | not started |
| G | Dev panel additions, soak test, docs | not started |

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

## Things the next part must know

- Bots must use the same paths as humans: `Doors.tap(walker, code)` for badge doors, and the `Walker`
  shape in `doors.ts`. A bot body should be an `Avatar` like a human's, so the public state cannot tell them apart.
- Plan routes on `game.map.solid` (doors passable); move bodies against `game.collision`.
- Humans start at their desks WITHOUT an arrival line in today's badge log; bots walk in and (mostly) have one.
  Left as is for now; tell the owner in the Phase 3 summary (a later lobby/"match start" in Phase 6 can fix it).
- Part D plan: task definitions in the scenario (`tasks[]`: id, title, who may get it, steps as shell commands or
  "go to room"), an engine/server task tracker that marks a step done from master events, the same tasks handed to
  bots (the `work` leaf picks task commands instead of random ones) and to humans (a HUD list, key `T`).
  Private per player: a player's task list goes only to that player (visibility rule).
- The dev server (`pnpm dev`) restarts itself when server files change; Playwright reuses a running one.
- Door timers and walking use real time; the game clock can run faster (dev panel). At speed 1 they agree.
- Writing files from Bash heredocs breaks on apostrophes in this environment: use the Write tool or a script file.
- `pnpm` is not on PATH here: use `corepack pnpm ...`.

## Not done / not verified

- README and TESTING.md have short Part A notes only; the full Phase 3 docs are Part G.
- The dev panel has no door or badge tools yet (Part G).
- Typing a masked password in the CLI at a real keyboard was never verified by hand (Phase 2 leftover).
