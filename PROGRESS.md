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
| 4 Hacker gameplay | Parts A-G done (including D and E); H partly done: CLI hacker selection remains |
| 5 Investigation & social deduction | **in progress**: Parts A-E, G and H done, F skipped (see Phase 5 status) |

## Phase 5 status: plan APPROVED by the owner (defaults 1-6 accepted); Parts A-E, G and H DONE; Part F SKIPPED by the owner; Part I next

**Part F (bot hacker) is SKIPPED for now, at the owner's request ("Skip F, start G").** A first attempt was stopped
by the assistant's safety filter while writing the bot's attack logic; nothing of it was kept. Do not restart F unless
the owner asks. Options the owner was offered for later: a SCRIPTED hacker (the scenario file lists the hacker's day
as fixed content, which the game replays so the logs get the same evidence), or the owner writes the route and the
code only types the given lines. Until then the hacker is a human who joins as the hacker; matches without one have
no hacker at all.

### Part A: what exists now

- `engine/src/core/roles.ts`: `ROLES` (employee, sysadmin, soc, guard, helpdesk) with a title and the abilities
  text for the card; `roleOf`; `validateScenario` refuses unknown roles. The hacker keeps the role of the employee
  they pose as (the card says "Employee"); the briefing is separate.
- Card (`OnboardingCard`): new `role` and `abilities` (own only). Client shows a Role row and the abilities list.
- New 11th employee: **Huda Rahman** (`h.rahman`, SOC analyst, player p11, badge 0141 opening the security office),
  PC `SOC-WS-01` in the security office (desk at tiles 17,26), log reader on ADMIN-SRV-01 and SEC-SRV-01, no sudo.
  Two SOC tasks: alert-review and proxy-review.
- Adding an account shifted the seed-1 DHCP addresses (the admin server creates every account before any PC
  boots). TESTING.md's table and the tests that pin addresses are updated: e.g. IT-WS-02 is now 10.0.2.119,
  REC-PC-01 10.0.2.180; FIN-LT-07 (.58) and MKT-LT-11 (.71) did not change.
- Powers themselves are later parts: SIEM and viewers (B), detain, password reset, force-lock (E).
- 308 Vitest tests, 7 Playwright.

### Part B: what exists now

- **SIEM** (`engine/src/security/siem.ts`): `collect(world)` reads the log FILES of every machine when a query runs
  (auth.log, kern.log UFW/USB lines, dhcpd lines in syslog, mail.log, squid, named, badge, doors, cctv motion,
  alerts, audit) and turns each line into a record { time, host, source, raw, fields }. No ground truth (no player
  ids, no actor). `siemQuery(world, text)`: filters `field=value` (wildcards), `!=`, bare words, `since=`/`until=`;
  steps `| where F OP V` (sizes like 1MB), `| count by F`, `| fields a,b`, `| sort -F`, `| head N`, `| tail N`.
- **`siem` command** (`commands/siem.ts`): only on hosts with `/etc/siem.conf` (SOC-WS-01 in the scenario); anyone
  sitting there can use it; each search is a `siem.query` master event. The shell passes the WHOLE rest of a
  `siem` line as one argument (`shell/exec.ts` `siemLine`), so its `|` steps are not shell pipes.
- **Security-office monitors**: furniture of kind `monitors` on the map. Server messages `monitors.open` ->
  `monitors.index` { cameras[{id, shots[{id,time,count}] (last 400)}], badges (last 40 access.log lines),
  motion (last 25) } and `monitors.frame { camera, time? }` -> the latest snapshot at or before that time, people
  sent as { name, x, y, facing, seatedAt, activity } (no player ids). Only answered while the requester stands
  within INTERACT_DISTANCE of the monitors (anyone, not only the guard: the badge door protects the room).
- Client: `E` at the monitors opens `ui/MonitorsPanel.tsx` (Cameras with a canvas picture, time slider, Live;
  Badge log; Motion log); walking away or Esc closes it. Test hook `window.__insider.monitors()`.
- 321 Vitest tests (new: engine `siem.test.ts`, server `monitors.test.ts`), 8 Playwright.
- Note: the owner's design test ("follows two clients") failed once with a 4.3 px step instead of > 5 under load,
  then passed twice. Likely timing; keep an eye on it.

### Part C: what exists now

- `packages/server/src/evidence.ts`: `EvidenceBoard` with items { id E1.., kind screen|snapshot|log, title, text,
  time, pinnedBy, pinnedById (never sent), frame? }. Max 200 items, 30 lines / 1500 chars each.
- **Pins are checked against what that player was shown.** `game.send` records, per client: screen text
  (term.open / term.output: output + prompt), typed lines (`term.line`; masked input as stars), snapshot ids sent
  in `monitors.frame`, and badge/motion lines sent in `monitors.index`. Screen text is compared with all
  whitespace squeezed, so a multi-line selection matches.
- Messages: `evidence.pin { kind, text?, camera?, snapshot?, source? }`, `evidence.unpin { id }` (own pins only),
  `board { items }` to every playing human on change and on joining (`mine` per recipient).
- Client: **Pin selection** button on the terminal (xterm selection), **Pin this picture** and per-line **Pin**
  on the monitors, `ui/BoardPanel.tsx` on `B` (camera pictures drawn with `drawFrame`), HUD button "B Evidence (n)".
- Part D will need: accusations reference board item ids; fired players must not pin.
- 331 Vitest tests (new: server `evidence.test.ts`), 8 Playwright (the first smoke test now pins and opens the board).

### Part D: what exists now

- `packages/server/src/meeting.ts`: `Meetings` (rules + record of every meeting for the debrief) and `countVotes`.
  Phases (REAL time): discussion 90 s, voting 45 s, result 8 s; button cooldown 60 s; 1 use per player
  (`OfficeGameOptions.meetingTimes`, env `MEETING_SECONDS=90,45,8`). No accusation -> straight to "nobody voted out".
  Voting ends early when every voter has voted. Plurality: the single top suspect wins if they beat "skip"; ties fire nobody.
- Map: furniture "Emergency button" (kind `button`) at tile 32,20 in the meeting room; drawn as a red button.
- `game.ts`: `meeting.call` (within BUTTON_DISTANCE of the button) gathers every body at free tiles around the
  "Meeting table" (seated people are stood up; PCs stay as they were), freezes walking and bots
  (`BotManager.interrupt` afterwards resets their walk and screen). During a meeting only chat, accuse, vote,
  unpin and move (ignored) are handled. `meeting.accuse { suspect, evidence[] }` (3+ existing board ids, living
  suspect, not yourself, one per person); `meeting.vote { target }`; `meeting` message per player (who voted is
  public, not what). Hacker voted out -> `endMatch('defenders', ...)` (`match.over` now has `winner` hacker|defenders
  and `reason`); innocent voted out -> `fire()`: human becomes a ghost (body removed, `fired` message, may only use
  `chat.send` on channel "fired"), bot removed and never rescheduled; `reputation` -25 (public state field).
  After the match ends nothing but dev messages is handled.
- Chat: `chat.send` -> channel "meeting" (only during a meeting, to players and ghosts) or "fired" (ghosts only,
  any time). `game.chatLog` keeps all lines.
- Client: `ui/MeetingPanel.tsx` (meeting screen: chat, accusations, accuse form with board checkboxes, vote
  buttons, result) and `FiredPanel` (ghost chat; arrow keys move the view). HUD shows "Reputation N%".
  Test hook `window.__insider.button()`.
- Not yet (at the time of Part D): guard detain, helpdesk powers (Part E, now done); bots never accuse or vote (Part G); reputation 0 and parity as
  win conditions (Part H).
- 342 Vitest tests (new: server `meetings.test.ts`), 9 Playwright (new: an emergency meeting).

### Part E: what exists now

- Engine `commands/helpdesk.ts`: `helpdesk status | lock HOST | reset USER`. Installed only where
  `/etc/helpdesk.conf` exists (scenario: IT-WS-01, `allow = d.aziz`); other accounts get "not a helpdesk account"
  (root is allowed). `status` lists every workstation's screen (login / locked / UNLOCKED) and user.
  `lock` = `lockConsole(..., via: 'helpdesk')`: the target PC's auth.log gets
  `helpdesk: REMOTE lock-session: ... locked by d.aziz from <IT-WS-01 ip> (helpdesk)`.
  `reset` makes a deterministic password `Word-Word-NN` (hash of account + game time) and calls
  `auth/passwords.ts` `changePassword()`: new `/etc/shadow` hash on every host with the account, `world.credentials`
  updated (strength at least 60), event `password.change` on the DHCP/admin server, which writes two auth.log lines
  (`pam_unix(passwd:chauthtok): password changed for USER`, `password of USER reset by BY from IP`).
  Open sessions stay open. Root cannot be reset.
- Server: `announceAlerts()` also watches `password.change` events. The owner, if human, gets a new `card` message
  (only them) and a notice; a bot's persona learns the password (`BotManager.passwordChanged`).
- Guard detain: client message `detain { target }`. Checks: sender's role is `guard`, has not lost the power, target is
  another living body within `DETAIN_DISTANCE` (64 px, shared constant). Target is `world.mission.hacker` ->
  `endMatch('defenders', name, "GUARD caught NAME in the act.")`. Otherwise every human gets a notice, and the guard
  is in `detainLost` for the rest of the match. Every attempt is in `game.detentions` (for the debrief, Part I).
  Not allowed during meetings or after the match (the existing message filter already drops it).
- Client: the scene computes `nearPerson` (nearest other body within 60 px); a guard sees "Caught NAME in the act?
  Press X to detain" (`data-testid="detain-hint"`); first X arms for 3 s ("Press X again..."), second X sends.
  The store applies `card` updates.
- 352 Vitest tests (new: engine `helpdesk.test.ts`, server `guard.test.ts`), 10 Playwright (new: detain in the browser).
- Not yet: bot hacker (Part F, skipped); bots never accuse, vote or detain (Part G: they now speak and vote, see below).

### Part G: what exists now

- Bots keep FINDINGS (`bots/manager.ts`, `Finding { time, text, suspect, weight }`, `findings(id)`), separate from
  observations and kept across leaving/returning. Sources, all from the bot's own eyes or screen:
  weight 3 "X stood right behind me at DESK while I typed my password" (`watchedBy`, 7 in 10);
  weight 3 "I saw X doing something to my PC" (someone holding the USB stick at the bot's desk, seen in `look()`);
  weight 2 "I saw X sitting at my PC DESK while I was away" (`look()`);
  weight 1 "I saw X in the server room; they do not work in IT" (`look()`, jobs other than sysadmin/helpdesk);
  weight 0 own-PC checks. The same story within 5 minutes is not counted twice. At most 40 findings per bot.
- Own-PC checks (`bots/brain.ts`): every 8-20 game minutes (first after 4-10) a bot at its own shell types
  `last -n 10` or `crontab -l` (`SELF_CHECKS`) and `inspect()` reads the output: a login TODAY over the network from
  another address ("Someone logged in to my PC ... as USER from IP at HH:MM"), or an `@reboot` crontab line.
  These checks use their own random sequence (`BotSubject.checks`, seeded from the player id) so the rest of each
  bot's day did not change (two statistical tests depended on it).
- Meetings (`game.ts` `planBotMeeting` / `tickBotMeeting`): when a meeting is called each bot present decides what
  it will say (`BotManager.speech`: its two strongest findings, or 1 in 4 times "Nothing odd on my side.") and says it
  at 10-60 % of the discussion. In the vote each bot votes at 15-70 % of the voting time (`BotManager.ballot`):
  the accused person it has the most against if that is >= 2 (`VOTE_THRESHOLD`); "skip" if it has >= 3 against
  somebody NOT accused; otherwise it does not vote at all (abstains, so it never outvotes people who have evidence).
  Bots never accuse (an accusation needs board items, which only humans pin) and never detain.
- `postChat()` is now the single way a meeting/fired chat line is sent (humans and bots).
- Engine exports `lastStamp` (time format of `last`).
- 361 Vitest tests (new: server `defenders.test.ts`), 10 Playwright.

### Part H: what exists now

How a match ends (all in `server/src/game.ts`, all through `endMatch(winner, hackerName, reason)`):
- Defenders win: the hacker voted out (Part D), or detained by the guard (Part E).
- Hacker wins: the flag handed in (Phase 4 F), or PARITY (new, `checkParity()`, run after every firing): the
  defenders left (the whole staff list minus the hacker minus the fired, present or not) are no more than the
  hackers left (1). With 11 employees that would be after nine wrong firings. Reason text:
  "Only 1 defender is left, as many as hackers: the hacker took over the company."
- REPUTATION (owner's decision after Part H: "Yes, hacker wins at 0%"): every wrong firing costs 25 points
  (`REPUTATION_PER_FIRING`); at 0 % the hacker wins ("The company's reputation hit 0 %: too many innocent people
  were fired. The hacker wins."). Checked before parity in `checkHackerWins()`. With the defaults this is the 4th
  wrong firing, so in an 11-person office reputation always comes before parity (9 firings); parity stays for small
  offices and future settings. Tests keep reputation at 100 to reach parity.
- No parity, reputation loss or escalation in a match without a hacker.
Anti-stall (DESIGN section 1, "Match length"):
- Engine `security/alerts.ts` `escalate(world)`: picks the OLDEST action of the hacker (event `actor` = hacker,
  since the match started) that is on `ESCALATION_TYPES` (ssh/su/sudo/login failures and successes, USB, backdoor,
  implant, keylogger, scan, scp, log clear, mail sent, tool run, and reads of WATCHED files only) and not yet in
  `world.mission.escalated`, and raises it again as `[HIGH] threat-escalation` with the facts of its log line:
  `earlier activity re-scored HIGH: TYPE on HOST (account USER from IP) at TIME`. Never a player name.
  Returns null when there is nothing new (or no hacker).
- Server: every `escalationMinutes` GAME minutes (default 10; `STALL_MINUTES` env; 0 = off), counted from the
  game's start. A HIGH alert also gives every player the usual vague banner (once a minute at most).
- The SIEM already reads `/var/log/security/alerts.log`, so `siem rule=threat-escalation` (or `severity=high`)
  finds them.
- 406 Vitest tests (new: server `endings.test.ts`), 11 Playwright.

## Phase 5 plan (investigation & social deduction)

Goal (DESIGN.md section 15): "A full match as defender vs a bot hacker, with debrief." This is also the core of
the Investigation solo mode (section 1a), which ships right after Phase 5.
After each part: all tests, commit locally (never push), update this file.

| Part | What |
|---|---|
| A | Roles and their powers: sysadmin, SOC analyst, guard, helpdesk, employees, hacker; who gets which |
| B | Log viewers: SIEM with a small query language (SOC); CCTV and badge viewers in the security office (guard) |
| C | Evidence board: pin a log line, command output, snapshot or badge entry with one click |
| D | Meetings: emergency button, meeting-only chat, accusation with 3+ pieces of evidence, majority vote, fired players as ghosts |
| E | Guard's detain, helpdesk's password reset and remote force-lock |
| F | Bot hacker: picks a route from today's weaknesses, using only the tools that exist (USB stick, shoulder surfing, su/sudo) |
| G | Bot defenders: check their own machines, report findings in meetings, vote on the evidence they have |
| H | Win conditions (vote out / detain the hacker, flag handed in, parity), anti-stall escalation in the SIEM |
| I | Debrief: timeline of every hacker action, the evidence it left, what was found or missed, MITRE ATT&CK ids |
| J | Soak test of whole matches, browser test, docs |

Defaults (approved by the owner):
1. SOC analyst: add an 11th employee with a desk in the security office (the scenario has none today).
2. Chat: meeting-only text chat in Phase 5; open chat and the hackers' private chat stay in Phase 6.
3. Roles follow the scenario's jobs for now; the hacker is a bot by default, a human can still join as the
   hacker. Random secret roles for humans come with multiplayer lobbies (Phase 6).
4. The bot hacker uses only existing tools. Remote tools and phishing were deferred when this plan was approved; Phase 4 D and E are now implemented. Phase 5 F remains skipped.
5. Detain: the guard may detain someone within 2 tiles; right = defenders win, wrong = the guard loses the power.
6. No time limit; anti-stall as in DESIGN.md section 1 (every 10 game minutes the SIEM flags one real hacker event HIGH).

## Phase 4 status: Parts A-G DONE; H partly done

| Part | State |
|---|---|
| A Match secrets: the hacker and the weaknesses | **done** |
| B Tool framework | **done** (mechanism and `selftest`; D and E add the remaining shell tools) |
| C Physical tools: USB stick, shoulder surfing | **done** |
| D Remote tools: implant, keylogger, hash cracker, network scanner | **done** (owner asked to finish it, 2026-11-17; see below) |
| E Phishing kit and log cleaner | **done** (owner requested completion, 2026-11-17; see below) |
| F Flag, winning, audit log, security alerts | **done** |
| G Route tests (2+ complete routes) | **done** (2 routes, see below) |
| H Dev panel, browser test, CLI, docs | partly: dev panel and browser test done; CLI cannot join as the hacker yet |

**Part D is DONE (2026-11-17).** The code appeared uncommitted in the working copy (not written in the assistant's
session); the owner asked to "finish it and commit it". Finishing meant: one server test expected the alert banner
to reach someone still on the start screen, which contradicts the Phase 4 F rule (banner only to players, tested in
`win.test.ts`), so the test was corrected; then the full suite and docs. Everything stays inside the simulation (the
tools import only the engine's own virtual files, processes and DNS).
- `engine/src/tools/remote.ts`: four `ToolDefinition`s added to `TOOLS` (via `remoteTools`), each with its traces:
  `implant HOST [USER]` (a shell through a live Part C USB backdoor: connections in `ss -tnp` on both hosts, processes
  in `ps aux`, history on exit), `keylogger` (records the next password typed at that PC by that account: an
  `.input-helper` process, a hidden capture file in /tmp), `crack FILE [USER]` (a background job on a copied shadow
  file: a process in `ps aux`, the shadow read in the audit log, a result in ~/.tools/loot/), `scan [HOST]` (lists
  simulated hosts and their listening services: an IDS line `RULE=network-scan` in `/var/log/ids/alerts.log` on the
  badge server, a MEDIUM security alert and the vague global banner).
- `engine/src/tools/keyboard.ts` (`recordPassword`): the keylogger's capture, called from the terminal when a password
  is typed. Supporting changes in auth/sessions.ts (implant sessions), commands/procs.ts, commands/remote.ts,
  commands/sessions.ts, core/world.ts, events/materialize.ts, security/alerts.ts, security/siem.ts, shell/exec.ts,
  terminal.ts, types.ts (`world.toolkit.keyloggers` etc.).
- Tests: engine `remote-tools.test.ts` (19), server `remote-tools.test.ts` (2: scan visibility and banner; captured
  passwords and job results never reach bystanders or public state). 383 Vitest, 10 Playwright.

**Part E is DONE (2026-11-17).** The owner resumed it with "finish phase 4 e".
- `engine/src/tools/phishing.ts`: `~/.tools/phish USER` sends a fixed simulated IT reset email to one
  employee, with spoofed From, SPF fail, and the actual simulated sending host/IP in Received and mail.log.
  Cooldown: 60 game seconds. Results belong to the sending account on the sending host, mode 600.
- Following the exact `https://password-reset.example/reset/ID` link with the simulated `curl` submits
  only that recipient account's current in-game credential, once. Reading mail and `curl -I` do not submit.
  DNS and proxy logs identify the visiting PC/account; neither those logs nor the page response contains
  the password. Public, missing, non-file or foreign-owned result destinations are refused. No real network or forms exist.
- Bots notice unread reset subjects in their own inboxes, read messages through the terminal, and decide
  once per message whether to follow (30%, separate seeded randomness). Only a strictly validated game
  link can become a command. Ordinary mail and the existing job/check routines remain in place.
- `engine/src/tools/cleaner.ts`: `~/.tools/clean LOG "TEXT"` removes literal matching lines from a writable
  file under the current simulated host's `/var/log`. Cooldown: 30 game seconds. Unix permissions apply.
  A new `EVENT=log-cleared` marker survives each successful removal, with a journal event and master record.
  Remaining timestamps stay unchanged; the SIEM sees the remaining file and its tamper marker. Previously
  pinned evidence, journal history, and the master event history are not deleted.
- New engine/server tests cover headers, read/HEAD vs visit, current credentials, one-shot capture,
  destinations, privacy, cross-world isolation, pivot attribution, save compatibility, literal matching,
  permissions, SIEM tampering, pinned evidence and bot decisions. Browser coverage plays both tools.
- Simulated `sudo` now accepts tool paths through the normal dispatcher after authorization; regression
  coverage verifies password gating, refusal for unauthorized accounts and refusal to run ordinary scripts.
- Validation: **398 Vitest tests passed**, typecheck passed, production build passed. All **11 browser
  scenarios passed** (10 first attempt, 1 on retry: an edit during the run restarted the watched test server
  and disconnected the first smoke test; its retry passed). The new Phase 4 E browser scenario passed.

Owner-approved defaults: "join as the hacker" on the start screen (one per match); the hacker is NOT told which
weaknesses are on; winning = submitting the flag (Part F decision); bots fall for phishing about 30 %; scanner alerts go to everyone.

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

- Parts D and E are complete; no deferred shell tools remain.
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
