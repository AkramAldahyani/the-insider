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
| B | Bot movement and pathfinding | next |
| C | Bot behaviour (routines, desk use, observations) | not started |
| D | Job tasks (bots and humans) | not started |
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

## Things the next part must know

- Bots must use the same paths as humans: `Doors.tap(walker, code)` for badge doors, and the `Walker`
  shape in `doors.ts`. A bot body should be an `Avatar` like a human's, so the public state cannot tell them apart.
- Plan routes on `game.map.solid` (doors passable); move bodies against `game.collision`.
- Open question for Part B: humans start at their desks without an arrival line in today's badge log, while
  bots will walk in through the main entrance. Decide whether to write an arrival line for a human when they
  pick an employee, or leave it (currently: no line).
- Door timers and walking use real time; the game clock can run faster (dev panel). At speed 1 they agree.
- Writing files from Bash heredocs breaks on apostrophes in this environment: use the Write tool or a script file.
- `pnpm` is not on PATH here: use `corepack pnpm ...`.

## Not done / not verified

- README and TESTING.md have short Part A notes only; the full Phase 3 docs are Part G.
- The dev panel has no door or badge tools yet (Part G).
- Typing a masked password in the CLI at a real keyboard was never verified by hand (Phase 2 leftover).
