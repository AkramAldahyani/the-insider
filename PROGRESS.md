# Progress

This file says where the work stands, so a new session can continue from it alone.
Update it at the end of every part.

## Browser walk flake fixed (2026-11-24)

- The detain browser test, repeated alone, failed 4 of 10 and then 8 of 30 ("No progress at waypoint"). Traced in
  `e2e/helpers/movement.ts`: the key was released AT the target, the body coasts one more tick (about 10.5 px on this
  machine, sometimes two ticks), and the Reception doorway leaves an 11.8 px window, so it bounced across it for ever
  (198.7 > 219.6 > 198.7). A test helper problem; the game was not at fault and did not change.
- Now `release()` in `e2e/helpers/navigation.ts` lets go early by the measured coast plus half a step, and taps the key
  for one server tick when the target is closer than that.
- Second, rarer case (2 of 30, seen once the first was gone): public positions are rounded to 0.1 px, so a body can clip
  a corner (SEC-WS-01, x 470.0) that the path check calls clear. After a blocked step the helper now steps sideways.
- A failed walk now lists every press as "from > released at > came to rest at".
- Checked: the detain test 60 of 60 (retries 0), four full browser runs 11 of 11, 471 Vitest tests in 43 files.

## E key beside a desk (2026-11-23)

- Found in review of the walk/sit follow-up below: the desk hint is blank while walking, so E fell through to the
  next thing in range. Right of IT-WS-02 (x 1532-1548, y 132-176) that was the server room reader, which left a
  badge line nobody meant (false evidence). The same overlap: ADMIN-SRV-01 with that door from inside, and
  SOC-WS-01 with the security monitors.
- Rule: while any desk is within sitting distance, E means only that desk (`besidesDesk()` in
  `client/src/game/movement.ts`; used by OfficeScene for the door, monitors and button hints). The server is unchanged.
- Tests (`server/test/desk-hint.test.ts`): the IT-WS-02 spot, and every free spot of the office; they also check that
  each reader (the server room from both sides), the monitors and the button can still be used. Both fail without the rule.
- Also fixed (a Part E mistake that the browser test caught): the guard's detain hint and its warning were hidden beside
  a desk although X still worked there. The hint now shows there too; the detain browser test always stands beside a desk.
- 469 Vitest tests in 43 files, 11 Playwright (retries 0).
- Left as it is: E at a desk does nothing while a movement key is held (stop first), and a standing player has no
  desk hint after a developer teleport until they move.

## Browser walk/sit follow-up (2026-11-18)

- Task 2: reproduced the moving desk-hint race. The HUD refreshed every 120 ms and used a
  40 px radius, while one 50 ms server tick moves 8.5 px and sitting accepts 44 px.
  A hint could therefore remain visible outside sitting range. Refusals already produce a notice.
- Movement inputs now carry a sequence number; the server acknowledges the player's own direction
  and position. Desk hints require the latest confirmed stop and matching public position, and use
  the exact server distance rule. Starting movement clears the hint immediately. Old acknowledgements
  cannot revive it. Positions remain server-authoritative; there is no movement prediction.
- Two regression tests reproduce the stale-hint refusal and cover confirmed stops, delayed replies,
  rounded public positions, the distance boundary, successful sitting and acknowledgement privacy.
  Targeted tests, typecheck, the full unit suite and browser validation passed.
- Task 1: all seven browser PC-sitting steps now use `e2e/helpers/movement.ts`'s `walkAndSit`.
  It waits for the requested hostname's hint, a confirmed stop and the terminal's initial screen,
  and reports the hostname and last position on failure. The Part E test passed with retries disabled.
- Task 3: traced the steering instability to automation round trips and overly precise waypoint
  targets. Instrumentation showed a character crossing the same waypoint repeatedly (for example
  x=566 to x=608 around x=592). On this Windows host, individual movement updates often covered
  about 10.5 px; the old walker's temporary 1 px tolerance could not reliably catch those steps.
  Its 600-iteration limit silently advanced even without arrival. Three instrumented Part E runs
  took 27.6, 30.9 and 32.1 seconds overall; the short desk walks themselves took about 1.4-2.3 seconds.
  The original reported 90-second run was not available as a trace, so its exact delay cannot be assigned.
- Walking now releases the key inside the browser on a state update, then waits for the server's stop.
  The helper follows one axis at a time, checks whole-body clearance before continuing past corners,
  keeps moving through an automatic door's server-authoritative approach strip, and accepts safe interaction distances rather than exact floor pixels.
  It has no fixed sleeps and fails explicitly on lack of progress. Walk timings and waypoint counts
  are attached to Playwright results. Regression tests cover the two observed desk/corridor approaches;
  no collision-physics defect was found or changed.
- Browser retries now default to zero. `pnpm typecheck`, `pnpm test` (43 files, 467 tests) and
  `pnpm e2e` (11 tests) passed. Ten more full `pnpm e2e --retries=0` runs passed with 11 expected,
  zero skipped, zero unexpected and zero flaky tests each: 187.2, 195.4, 189.2, 187.2, 188.0,
  187.8, 188.0, 186.3, 186.5 and 197.2 seconds.

## Phases

| Phase | State |
|---|---|
| 1 Simulation core | done |
| 2 Office in the browser | done |
| 3 Living office | done, pushed by the owner |
| 3+ Owner's changes after Phase 3 | done (section below) |
| 4 Hacker gameplay | **done**: Parts A-H, including CLI hacker support |
| 5 Investigation & social deduction | **done**: Parts A-J |
| 5a Solo modes | **done**: Parts A-H |
| 6 Multiplayer | **in progress**: Parts A-D (lobbies, secret roles, several hackers, chat) done; E (fired and watching) next |

## Phase 6 plan (multiplayer): APPROVED by the owner on 2026-11-24, with all eight defaults

Goal (DESIGN.md section 15): "Friends on different computers finish a match together." Same way of working: after each
part all tests, this file, commit locally (never push), then wait for the owner's yes.

| Part | What | State |
|---|---|---|
| A | Lobbies: create, join with a code, names, ready, host settings, close, remove, start | **done** |
| B | Secret roles: jobs and hackers drawn at the start, private reveal; back to the same lobby after the match | **done** |
| C | Several hackers (1-3) who know each other: win rules, briefing, detain, debrief, alerts | **done** |
| D | Chat: same room, meetings, hackers' private chat, fired players; mute and length limits | **done** |
| E | Fired and watching: free camera, affects nothing | next |
| F | Reconnecting: the place is kept, a bot covers, the host role moves on. **Friends can play a full match here** | |
| G | Bots that fill up: difficulty and voting rules for mixed groups | |
| H | Robustness: rate limits, message checks, load test with 30 players, one address for page and server, home network guide | |
| I | Bigger offices for 15, 20-25 and 30 people (can be postponed) | |
| J | Whole matches with several browsers, long test, balance, docs | |

Defaults (accepted):
1. The hacker is drawn from the human players if there are at least four, otherwise bots can be drawn too. The host can change this.
2. Hand-in wait of 3 game minutes after first reading the flag, for human hackers in multiplayer too (measured in 5a: without it a burst always wins).
3. Several hackers: voting out or detaining one removes that person; the defenders win when all are gone. The role of a detained or fired hacker is announced.
4. Open chat is heard only in the same room; meetings are heard by everyone.
5. Bots in multiplayer vote only on what they saw (as decided in Phase 5 G) and never investigate on their own.
6. A place is held for 60 seconds after a lost connection, then a bot plays until the player returns.
7. Runs on the owner's computer and home network. Internet server, accounts and chat reporting stay in Phase 8.
8. Bigger offices have one wide floor instead of two or three. Department meetings for 20+ players belong to Part I.

Also accepted: bot hackers with partners use only their existing behaviour; no new attack behaviour is written.

### Part A: what exists now (lobbies)

- WORDS: in the code a lobby is a "party" (the message `lobby` already means the list of employees of a match).
- `shared/src/party.ts`: PartyView, PartySettings (bots, difficulty, meetings), and the checks of everything a browser
  sends: `parseCode` (5 consonants), `cleanName` (letters of any language, at most 20), `changeSettings` (fixed lists).
- `server/src/party.ts`: the rules, without network (`Party`), and `partyGameOptions`. `server/src/PartyRoom.ts`: the Colyseus
  room `party`. One room = lobby, then the match in the SAME room. The room id IS the code; the room is private, so
  `joinOrCreate` never finds it. At most LOBBY_LIMIT (20).
- `OfficeRoom` changed: `game` may be null (before the start), `open()` connects messages and clock, `begin(options)` builds
  the match, `received()` gets each message. The shared office and solo rooms call begin, then open.
- Rules: the first one is the host; if the host leaves, whoever has been here longest is. At least 2 people; everybody but
  the host must be ready. The host can close the lobby (the answer to a removed player coming back: there are no accounts,
  so they cannot be recognised), remove people, and change settings. As many people as the scenario has employees (11).
- No network id is sent to other members (they have numbers like "m3" that are never reused). During a match the lobby is
  locked and its settings cannot change. The page shows one text for a wrong code and for a full, closed or playing lobby (the server itself does tell them apart; guessing codes is for the rate limits of Part H).
- The match has a new random seed (unless SEED is set) and the operator's weaknesses. `difficulty` sets only what the bot
  hacker knows and its pace so far (Part G: more). Meetings: short 45/30 s, normal = the server's, long 150/60.
- Client: `ui/PartyScreen.tsx` (menu card and lobby), `game/playerName.ts` (name in localStorage, `?lobby=CODE` link), store
  `createParty/joinParty`, phase `party`.
- A settings checkbox changes when the server has answered, not at once (the server is the only truth).
- Tests: `server/test/party.test.ts` (16, half of them over a real connection), `e2e/party.spec.ts` (three browsers).
- 677 Vitest tests in 54 files, 15 Playwright (12 office, 3 match).
- Not checked: two real computers on one network (Part H has the guide). With `pnpm dev` the developer panel also works in a
  lobby's match, so playing seriously needs NODE_ENV=production (Part H).

### Part B: what exists now (secret parts, back to the lobby)

- `server/src/deal.ts`: `deal()` draws, on the server only, when the host starts: everybody gets a different random employee;
  the hacker is always an ordinary employee (role "employee"). `whoMayHack`: the new host setting `hacker` is auto (a person
  from 4 people on, otherwise every ordinary employee is equally likely), human, or bot. Without bots, or with people at every
  desk, it is a person. A person as the hacker needs at least 3 people (with two, the other one would know).
- `OfficeGameOptions.assigned`: nobody can `choose`; the room calls `game.seat(client, player, hacker)` for everybody and
  then `everybodyIsIn()`. `botOptions.hackerId` fixes a bot hacker. `handInMinutes` is 3 if the hacker is a person.
- NOTHING TELLS PEOPLE FROM BOTS at the start (checked by tests): bots are at their desks from the first moment (`arriveAll`),
  the entrance logs everybody at the same time, the `lobby` message never says "taken" or whether the hacker role is free, and
  public state lists people by id, not in the order they came (this applies to every match).
- Lobby names are not shown during a match (they would mark the people). When it is over, `PartyView.cast` says who played whom.
- The match ends: the room unlocks again (if the host left it open), everybody reads the debrief as long as they like and goes
  back with **Back to the lobby** (`party.back`). Until then they are `away`, and the host cannot start; the host can remove them.
  The next match is a new OfficeGame in the same room, with a new seed and a new draw. New people may join between matches.
- Client: `RoleReveal` (PartyScreen.tsx), the case panel for defenders in lobbies, the cast in the end box, `backToParty()`.
- If a human hacker leaves during a match, the bot that takes the place goes on as the hacker, as in the shared office. (Their
  leaving still shows that they were a person: Part F.)
- Tests: `server/test/deal.test.ts` (10), three more in `party.test.ts`, `e2e/party-match.spec.ts` (three browsers, a whole match
  and the start of the next one). `e2e/helpers/heist.ts` is what infiltration.spec.ts and it share.
- 690 Vitest tests in 55 files, 16 Playwright (12 office, 4 match). On 2026-11-25 the machine was busy (everything took two to
  three times as long, also on the previous commit): five office tests failed in the full run and passed when run again.
- Not checked: how matches with human hackers balance (Part J), and a match with people and bots by hand.

### Part C: what exists now (several hackers)

- ENGINE: `world.mission.hacker` (one or null) became `mission.hackers` (a list) and `mission.caught` (those who are out).
  `isHacker` / `activeHackers` (mission/hackers.ts); `setHacker` still allows only one, `addHacker` adds a partner.
  The trail, the debrief, the anti-stall rule (only hackers still in the game) and the flag rule follow. A partner may hand
  in what one of them read (also one who was caught since); a reset mail's victim is on the trail of whoever sent it.
- HOW MANY: `hackerCount` (shared/party.ts): one up to 15 people, two up to 25, then three; the host may choose 1-3
  (`settings.hackers`, 0 = by size), but at most one for every three others. Without bots only the people count.
  At least two people are not hackers (with three or more people). How many there are is public, so is how many are left.
- WIN RULES: a hacker voted out or detained is out (human: watches, like a fired player), it is announced, no reputation is
  lost; the last one ends the match. Parity compares with the hackers still in the game; in a lobby's match without bots the
  staff is the people who were given a desk.
- HACKERS KNOW EACH OTHER: the briefing lists the partners (reveal screen, briefing, red names, "partner" in the list). Nobody else's
  browser gets that list. A bot hacker tells meetings nothing about its partners and does not vote for them; otherwise bot hackers
  use only their existing behaviour. A partner's pins and screens do not count as "found" in the debrief.
- Messages: `match.over` and the debrief have `hackers` (names) besides `hacker` (all in one text).
- FIXED on the way: reading the flag and handing it in within one server tick (50 ms) slipped past the hand-in wait, also in
  Infiltration. `submitFlag` now looks at everything that happened since the last tick first.
- Tests: `server/test/hackers.test.ts` (20). The shared office, solo modes and CLI still have exactly one hacker.
- 710 Vitest tests in 56 files, 17 Playwright (13 office, 4 match).
- Not there yet: a private chat for hackers (Part D); a hacker who leaves a match without bots (Part F: the match cannot end then).

### Part D: what exists now (chat)

- `shared/src/chat.ts`: the channels (room, meeting, hackers, fired), `cleanChat` (one line of any language, at most 300
  characters, no invisible or direction-changing characters), and the limits.
- WHO HEARS (`listeners` in game.ts; the server decides, a browser only asks for "room" or "hackers"): open chat is heard by the
  people in the same room (in a doorway, outside all rooms, within 128 px); a meeting by everybody and by people who are out;
  the private channel by the hackers still in the game, only in matches with several hackers, also during meetings;
  people who are out only by each other. A request for a channel one may not use is ignored, not turned into open chat.
- LIMIT: 5 lines at once, then one every 1.5 s of real time, all channels together, per person.
- Open chat is also in the shared office; solo matches have only the meeting chat, as before. Bots neither hear nor answer it.
- Client: `ui/ChatPanel.tsx`. Enter or the Chat button opens it, Esc closes it (at a PC the cursor goes back to the terminal);
  closed, the last lines show for 12 seconds. A click on a name mutes that person in this browser until the match ends.
- Messages: `chat` has `fromId`. Source files must not contain invisible characters: write them as escapes.
- Tests: `server/test/chat.test.ts` (13), `e2e/chat.spec.ts`, the private tab in `e2e/party.spec.ts`.
- 723 Vitest tests in 57 files, 18 Playwright (14 office, 4 match).
- Not there: chat in the lobby itself and after the match; people who are out hear no open chat yet (Part E). Who writes in open chat
  is obviously a person; bots are silent there.

## Phase 5a plan (solo modes): APPROVED by the owner on 2026-11-24, with all five defaults

Goal (DESIGN.md section 15): "One human can finish an Investigation match and an Infiltration match against bots, each
with debrief." After each part: all tests, this file, commit locally (never push), then wait for the owner's yes.

| Part | What | State |
|---|---|---|
| A | Start menu and private matches: mode, role, difficulty; own room, new random seed; play again, back to menu; the server checks every choice | **done** |
| B | Evidence that convinces: bots judge whether the pins point at the accused (account, PC, address, camera picture) and vote on that; never the hidden truth | **done** |
| C | Investigation mode: role choice, three difficulty levels, a rating in the debrief (proven case / lucky guess), browser test. Investigation playable | **done** |
| D | Bots notice more: `ps aux`, `ss -tnp`, USB events, people at the wrong desk; they pin what they find | **done** |
| E | Bot SOC analyst (reads the SIEM, follows addresses) and guard (cameras, patrols; detains only on strong evidence) | **done** |
| F | Infiltration mode: bots call meetings, accuse with evidence and vote; the hacker's start and end screens. Infiltration playable | **done** |
| G | Scenario ladder: five levels in the existing office, each with a briefing; progress kept in the browser | **done** |
| H | Balance, soak test of both modes, browser tests, docs | **done** |

Defaults (accepted):
1. Weak evidence: at least two of the three pins must point at the accused, otherwise the bots vote "skip". A correct
   accusation with good evidence wins.
2. Emergency meetings: two per player in solo matches.
3. Help in Investigation: on Easy bot colleagues pin some clues; on Normal and Hard they only speak in meetings. They
   never solve the case.
4. Infiltration is won only by handing in the flag (parity and reputation wins off there).
5. Difficulty changes the weaknesses, how often bots forget to lock, the bot hacker's EXISTING knowledge and pace, and how
   closely bot defenders look. No new attack behaviour for the bot hacker ("stealth" in DESIGN section 1a = pace only).

### Part A: what exists now

- `shared/src/solo.ts`: `SoloChoice {mode, role, difficulty}`, the allowed values, `parseSoloChoice` (the only thing the
  server accepts from a browser about a match; unknown values = refused, extra fields = dropped). Only the mode
  `investigation` was listed here at first; Part F added `infiltration`.
- `server/src/solo.ts` `soloGameOptions(base, choice, seed)`: bots and bot hacker always on, the chosen difficulty,
  two meetings, the employee (picked by the match's seed among the role's people; own random sequence), and
  `botOptions.hackerNot` so the hacker is never the player. Part C adds the rest of the difficulty here.
- `OfficeRoom.ts` `soloRoom`: Colyseus room type `solo`, private, one browser, disposed when it leaves; a new random seed
  per match unless SEED is set (tests); at most SOLO_LIMIT (20) at a time, more get "The server is full".
  `OfficeGameOptions.soloPlayer`: the player is put in the office on connecting; `choose` is ignored.
- A finished match locks its room, so the next player of the shared office gets a new match (before, everybody had to leave).
- Client: `ui/StartMenu.tsx`; the page opens on the menu and connects only after a choice. Store: `enterOffice`,
  `startSolo`, `leave`, `playAgain`, `reset` (one START state; messages of a left match are ignored). HUD: mode and
  difficulty, **Leave** (asks once). Match-over box: Play again, Back to the menu.
- Tests: `server/test/solo.test.ts` (10; also over a real connection). Browser: `e2e/helpers/menu.ts` `openOffice`;
  `match.spec.ts` now plays a solo match from the menu, then Play again, then Leave.
- The shared office is unchanged otherwise (its seed is still 1 unless SEED is set).
- For Part C: a human sysadmin makes the weakness `careless-admin` meaningless (it only affects that bot).
- 529 Vitest tests in 46 files, 12 Playwright.

### Part B: what exists now

- `server/src/judge.ts` (pure functions, no World): `judgePiece` / `judgeAccusation` / `comment`. A piece POINTS at the
  accused by account, full name, own PC, that PC's address, user number (`uid=`/`auid=`), badge number, or a camera picture
  of them in the act (crouched at a PC, at somebody else's desk, in the server room without an IT job). It is UNUSUAL when
  the same line shows an alert, a refusal, root rights for somebody outside IT, another account used from their
  address... An accusation convinces with two pointing pieces (the owner's rule) of which one is unusual.
- The "one unusual piece" half was added while building (the owner's rule alone lets two ordinary login lines fire
  anybody); the owner decided on 2026-11-24 to keep it.
- Not counted: lines dated another day, pieces naming more than three people, the same text twice, and the pinner's own
  words (`EvidenceItem.shown`, from `EvidenceBoard.withoutOwnWords`; never sent).
- It knows only what everybody could (staff list, current addresses), never who the hacker is. So it can be fooled, also
  into firing the owner of a stolen account (tested on purpose).
- game.ts: `judge()`, `verdicts()`, `planComment()` (a few seconds after an accusation one colleague says in the chat what
  the evidence is worth); `BotManager.ballot(..., verdicts)`: own sightings first, then the convincing accusation, else
  "skip". ONLY in solo matches (`soloPlayer`); in the shared office bots still abstain, as decided in Phase 5 G.
- The accuse form explains the rule in solo matches.
- Measured: the scripted SOC analyst of Phase 5 J (alert, lease, login) convinces the bots in 75 of 75 solo matches
  (25 seeds x 3 levels). Tests: `server/test/judge.test.ts` (25).
- Limits: the pieces are judged as they stand when the bots vote (an unpinned piece no longer counts); addresses are the
  current ones; a screen text joined or cut by hand (a changed browser) could cheat, which only matters in solo matches.
- 554 Vitest tests in 47 files, 12 Playwright.

### Part C: what exists now (Investigation is playable)

- Levels (`LEVELS` in server/src/solo.ts): weaknesses 2 / 3 / 4, forgetting to lock 15 / 25 / 40 %, colleagues pin clues on
  Easy only; plus the bot hacker's knowledge and pace as before. A solo match always has `plaintext-password` or
  `weak-admin-password` (no days of waiting for the administrator); `careless-admin` never when the player is the sysadmin.
  VULNS still wins. The shared office is not affected.
- The bot SOC analyst's job (brain.ts `SOC_CHECK`, in every match): `siem source=alert | tail 5` about every two minutes and
  before starting a task; each alert becomes a finding ("The SIEM shows a security alert at ..."), told at meetings. When
  the alert banner goes out (`BotManager.alarm`) it drops a break, an errand or a server session to look at once.
- Easy: `botOptions.pinClues` puts the screen line of a fresh finding on the board (`pinForBot`, at most that many
  per match (3), with a notice to the player).
- Testimony (judge.ts): what bots told meetings about what THEY saw is remembered for the match and can stand in for the
  unusual piece, never for the two pieces about the accused. Without it an employee or the helpdesk could not prove much,
  because they cannot read alerts. Comments on accusations are worked out when spoken, so they include it.
- Rating (`server/src/rating.ts`, `DebriefView.rating`, solo only): "Case proven", "Case proven, at a price", "Lucky guess",
  "So close", "The hacker got away", with the reasons. Shown in the match-over box and on top of the debrief.
- Client: `ui/CasePanel.tsx` (after the card; M): goal, where this job looks, what convinces, meetings left.
- Fixed (older): the anti-stall alert could pick the hacker's ORDINARY actions: an ordinary mail, or mistyping the own
  password (`OWN_SLIPS` in engine security/alerts.ts). Those led nowhere; DESIGN says ordinary actions are never picked.
- Measured: scripted players who wait for the banner and trace the address with what their job may read solved 375 of 375
  matches (5 jobs x 3 levels x 25 seeds). Humans are slower and will lose some.
- Tests: `server/test/investigation.test.ts` (26); `match.spec.ts` checks the case panel and the rating.
- 582 Vitest tests in 48 files, 12 Playwright.

### Part D: what exists now (bots notice more)

- A check is now a ROUND (brain.ts `checkOwnPc`, `mind.checkQueue`): all of `SELF_CHECKS` one after another, in a different
  order each time: `last -n 10`, `crontab -l`, `ps aux`, `ss -tnp`, `ss -tlnp`, `dmesg | tail -8`. `inspect` finds: a program
  from a hidden folder or calling itself a remote shell, a connection between two high ports (with the address at its
  other end), a listener other than ssh, a USB keyboard plugged in after the start, somebody else logged in at the
  keyboard, plus what it found before. It reads only what is on the bot's screen.
- `botOptions.checkMinutes` (default 8-20 game minutes between rounds; the first after half of that): how closely bots
  look. For the difficulty of Infiltration (Part F).
- `botOptions.pinClues` is now a NUMBER: how many clues bots pin in a match (default 0; solo Easy 3). Part F will use more.
- Sightings (bots/manager.ts): somebody outside IT sitting at a colleague's PC (weight 1), doing something to it standing
  (weight 2); before, only at the bot's own PC. `speech` returns the suspect with each sentence, and testimony counts
  against that person only, not against the owner of the PC a witness names.
- The bot hacker runs the same checks but never reports its own traces.
- judge.ts recognises the new lines (hidden folders, remote shell, high-port connections).
- Fixed (older): a bot could mistype its password three times in a row and raise a false auth-failures alert; now never
  twice in a row (`mind.slipped`).
- Applies to every match, also the shared office (findings are told at meetings); pinning only where `pinClues` says so.
- Measured: no false alarm in 48 office hours (24 seeds x 2 hours, no hacker); Investigation still 375 of 375.
- Tests: `server/test/vigilance.test.ts` (15).
- Limits: `dmesg` lines carry no time of day, so an old USB keyboard would be reported too (the scenario has none); bots do
  not look at their own `.bash_history`.
- 597 Vitest tests in 49 files, 12 Playwright.

### Part E: what exists now (bots that investigate)

- Switched on by `botOptions.investigate` (default off: the shared office and Investigation are unchanged, colleagues there
  never solve the case). Part F turns it on for Infiltration, together with a larger `pinClues`.
- `server/src/bots/investigators.ts` (no World): `Analyst` (the SOC bot): `saw` the alerts, `next` query, `read` answer:
  alert > address > DHCP lease > PC > owner; the newest login from there; and, if it was the owner's own account outside
  IT, whether it became root. Leads also come from what colleagues pinned (ESTAB peers, odd logins). Pins its rows. An
  escalated or LOW alert is only a lead (weight 1). Addresses of servers, and its own, lead nowhere.
  `suspicious` / `refusedBadge`: what the guard makes of a camera picture or a badge line.
- Guard (bots/manager.ts): half of its rounds go to the monitors (`watchSpot`, `watch`): pictures since the last look and
  the last 40 badge lines, like a human there. `pursue`: when `strongCase` (judge.ts) names somebody, walks up and detains
  through the same `detain` as a human; a wrong one costs the power. Five game minutes, then a pause.
- `strongCase` is stricter than a vote: three pointing pieces with two unusual ones (not counted: anti-stall alerts, LOW
  alerts, refusals), or the guard saw them fiddling with a PC (`Finding.caught`), or at a wrong desk plus one unusual piece.
- Nothing here knows the hacker: working from somebody else's open PC frames its owner (tested).
- Measured: a careless human hacker (own desk, su, flag) is detained 0.9 to 1.5 game minutes after reading the flag (25
  seeds); no pin and no detention in 24 ordinary office hours (12 seeds). FOR PART F/H: that is quick; difficulty should
  slow the investigators down (pauses between queries, how often the guard thinks), and the anti-stall alerts lead to the
  hacker's own login every 10 minutes.
- Tests: `server/test/investigators.test.ts` (17).
- 614 Vitest tests in 50 files, 12 Playwright.

### Part F: what exists now (Infiltration is playable)

- `infiltration` in SOLO_MODES; only role `any`/`employee` is accepted. `soloGameOptions` (server/src/solo.ts): the player is
  a random ordinary employee and the hacker (`OfficeGameOptions.soloHacker`), no bot hacker, `investigate` on, up to 40
  bot pins. Levels (`INFILTRATION`), easy / normal / hard: weaknesses 4 / 3 / 2 (one direct way always), forgotten screens
  45 / 30 / 15 %, own-PC checks every 12-25 / 7-15 / 4-9 minutes, anti-stall every 20 / 15 / 10, hand-in wait 2 / 4 / 5.
  Everybody is at work within 20 seconds (`botOptions.arriveSeconds`), or the empty office would be the perfect moment.
- THE WAIT (added while building, not in the approved defaults): the flag can be handed in only some game minutes after it
  was FIRST read (`handInMinutes`; notice and briefing say so). Measured without it: a hacker who does everything in one
  burst was never caught at any level, because nobody can react within seconds. Set it to 0 in `INFILTRATION` to drop it.
  The owner was asked "which part next, keeping the hand-in wait?" and chose Part G without objecting, so it stays.
- `bots/investigation-pace.ts`: how fast bots look at alerts, query, think (guard) and call meetings, by level;
  FAST_INVESTIGATION = part E. Elsewhere unchanged.
- Meetings by bots (bots/manager.ts `consider` / `convene`): when the board would convince a meeting about somebody
  (`convincingCase` in game.ts; anti-stall alerts do not count, so doing one's job is safe), the SOC analyst, or somebody who found a
  part of it, walks to the button, calls, and accuses early in the discussion with the pieces that point. The same case is
  raised once; more evidence is a new case. Bots vote as in part B; a wrong firing costs reputation but ends nothing.
- Won only with the flag (`checkHackerWins` returns for soloHacker); lost when detained or voted out.
- `rateInfiltration`: "Like a ghost", "Clean getaway", "By a hair"; "Detained", "Voted out"; who was blamed instead.
- Client: menu card with its own difficulty, the briefing explains the risk and the wait.
- Measured with the existing bot hacker in the player's place (own desk, own account, no tricks), 40 seeds each: it wins
  40 of 40 on Easy, 8 to 13 on Normal, 0 on Hard; no innocent was ever fired or detained. Working from a colleague's PC
  wins on Hard (tested). Doing only one's job for an hour on Hard: left alone (3 seeds).
- Tests: `server/test/infiltration.test.ts` (25); browser `e2e/infiltration.spec.ts` (project `match`, 45 s).
- For Part H: humans have not played it; phishing, log cleaning and the remote tools were not part of the measurements.
- 639 Vitest tests in 51 files, 13 Playwright (11 office, 2 match).

### Part G: what exists now (the scenario ladder)

- `shared/src/ladder.ts` `LADDER`: five levels with name, briefing (menu and top of the mission), lesson (after the match)
  and, on levels 4 and 5, three extra cameras in the departments (`withCameras` adds them to a COPY of the map file, on the
  server to record and on the page to draw; the map itself is unchanged). `server/src/ladder.ts` `LADDER_SETTINGS`: seed,
  player, weaknesses, pace, forgetting, checks, anti-stall, hand-in wait.
- A level is an Infiltration with `SoloChoice.level` (1-5; anything else is refused); everything in it is fixed, whatever
  SEED, VULNS or STALL_MINUTES say. The server does not know which levels are open.
- 1 Old habits (Omar; old script; easy; wait 1), 2 The company password (Sara; weak admin password; easy; 2), 3 The borrowed
  chair (Yousef; old script; normal; open PCs; 5), 4 Eyes everywhere (Noor; weak admin password; normal; cameras; 4),
  5 Locked down (Rami; weak admin password; hard; cameras; locked screens; 5).
- Client: `game/ladderProgress.ts` (localStorage key `insider-ladder`: level -> best rating; works without storage, then
  only until the page is reloaded), ladder card in `ui/StartMenu.tsx`, `matchName`, "Next: ..." and the lesson at the end.
- Measured with scripted players and several starting times: from the own desk levels 1 and 2 are always won, 3 and 4
  mostly lost (1 win in 6 starts), 5 always lost; a borrowed chair wins 3; going through another machine wins 4 and 5 in 5
  of 6 starts. The trick each briefing hints at works, and not only once.
- Tests: `server/test/ladder.test.ts` (11); browser: level 1 to 2 and a page reload (`infiltration.spec.ts`).
- Limit: progress is per browser and can be edited there (no accounts before Phase 8; nothing depends on it).
- 650 Vitest tests in 52 files, 14 Playwright (11 office, 3 match).

### Part H: what exists now (balance, long tests; Phase 5a is complete)

- BALANCE CHANGE: the bot hacker waits longer between reading the flag and handing it in (hacker-pace.ts): easy 7-9 game
  minutes (was 4-6), normal 5.5-7.5 (was 3-5), hard 4-5.5 (was 2-3). Pacing only. It applies to the shared office too.
  Why: the earlier 375-of-375 came from players who type instantly. With players who need 20 s per step (12 seeds per
  job and level) Normal was won 4 to 12 of 12 times depending on the job, Hard 0 to 6. Now at 20 s: Easy and Normal
  12 of 12 with every job, Hard 12 (employee, SOC analyst, helpdesk) and 6 (guard, sysadmin). At 35 s: Easy 11-12; Normal
  12 (employee, helpdesk), 8 (SOC analyst), 1-2 (guard, sysadmin); Hard 12 and 0. Calling a meeting early buys time
  (the hacker must lie low and read the flag again), which is why employee and helpdesk do best.
- Match lengths if nobody interferes (25 seeds): Investigation 19-35 / 14-28 / 11-16 game minutes (easy / normal / hard).
  The shared office is the same but for days without a direct way in (up to 110).
- Infiltration was measured again and left as it is (16 seeds): own desk 16 of 16 on Easy, 3 (12 s per line) to 7 (5 s) on
  Normal, 0 on Hard; a borrowed chair with nobody near won every time one was free (14, 8 and 4 of 16 starts found one
  within 25 minutes).
- Server load: 0.1 (Investigation) to 0.9 (Infiltration) ms per second of play and match, worst tick about 8 ms.
- Tests: `server/test/solo-soak.test.ts` (9: two hours of Infiltration doing only one's job at each level, passive
  Investigations, no secret in a browser, caps, replay, load); `investigation.test.ts` also plays at a human pace.
- Not done: phishing and the remote tools were not measured as ways to win Infiltration. Nobody has played either mode by
  hand for a whole match yet; the numbers come from scripts.
- 661 Vitest tests in 53 files, 14 Playwright (11 office, 3 match; 7.5 minutes). On a busy machine the office tests took twice as
  long and one or two timed out (three runs that day, different tests, also slow on the previous commit); rerun them then.

## Phase 5 status: DONE (Parts A-J; plan approved by the owner, defaults 1-6 accepted)

**Part F (bot hacker) is now DONE (2026-11-17), following the owner's request to complete it.** A normal browser
match has a simulated bot hacker by default. `BOT_HACKER=0` disables that controller while retaining employee bots;
`BOTS=0` disables all bots. Human hacker selection remains available. No Phase 5 part is currently marked skipped.

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
  another living body within `DETAIN_DISTANCE` (64 px, shared constant). Target is a hacker (`isHacker`; one `world.mission.hacker` then) ->
  `endMatch('defenders', name, "GUARD caught NAME in the act.")`. Otherwise every human gets a notice, and the guard
  is in `detainLost` for the rest of the match. Every attempt is in `game.detentions` (for the debrief, Part I).
  Not allowed during meetings or after the match (the existing message filter already drops it).
- Client: the scene computes `nearPerson` (nearest other body within 60 px); a guard sees "Caught NAME in the act?
  Press X to detain" (`data-testid="detain-hint"`); first X arms for 3 s ("Press X again..."), second X sends.
  The store applies `card` updates.
- 352 Vitest tests (new: engine `helpdesk.test.ts`, server `guard.test.ts`), 10 Playwright (new: detain in the browser).
- Later parts add the bot hacker (F) and defender speech/voting (G), both now implemented below. Bots still do not call meetings, accuse or detain.

### Part F: simulated bot hacker (completed 2026-11-17)

- `bots/hacker.ts` is a bounded decision controller: it receives mission hints, its own credentials, visible
  screen output and partial password observations. It has no filesystem, process, network, credential-store,
  master-event-log or direct flag-content access. All commands run through the existing simulated terminal.
- Originally `BotManager` preferred the employee affected by extra-sudo; the fairness follow-up below removes that preference.
  After arrival the bot follows its normal office routine before starting its mission (two game minutes then; see Part J).
  It chooses a supported route from the enabled weaknesses, with an opportunistic physical fallback.
- Implemented routes use the readable backup, the bot's own accidental sudo access, the fixed fictional-company
  weak-password guess, or actual shoulder observations / an unattended-PC USB hold and simulated recorder.
  New secrets are learned from visible output, and the ordinary flag-submission rule must succeed to win.
  Failed access causes a pause and fallback; it does not grant privileges or force a win. Restricted doors,
  occupied/locked screens, terminal permissions, cooldowns and evidence generation remain enforced.
- Physical actions use the same proximity checks and hold duration as humans. Bots receive only the partial
  glimpse a human would see, and only attribute an unlock or named sudo prompt to that account.
- Meetings interrupt pending input; the bot can resume afterwards, including an existing recorder. Helpdesk
  locks, deleted recorder files, detention and voting all affect it. A finished match stops ticks and rejects
  new employee/role selection, so the bot cannot continue acting after either side wins.
- Taking over the bot hacker's employee preserves that identity's hacker role and gives the human its briefing.
  Explicitly choosing another employee as the human hacker stops the old bot controller. A disconnected human
  hacker is taken over by a bot after the normal return delay when automated hackers are enabled.
- `BOT_HACKER=0` is independent of `BOTS=0`. Existing office-only tests explicitly disable the hacker; the new
  `server/test/hacker.test.ts` covers defaults, route completion, several random seeds, deterministic replay,
  visible evidence, private data, human handoff, meetings, helpdesk locks, recorder removal and defender wins.
- Scope: these are game-specific strategies for the current scenario conventions, not a general planner or
  autonomous use of every toolkit item. Debrief remains Part I; final acceptance/balance work remains Part J.
- Validation: **442 Vitest tests in 40 files passed** with `--maxWorkers=4`, including 21 new bot hacker
  integration tests; **11 Playwright regression tests passed on their first attempt**; typecheck and production
  build passed. The first unrestricted Vitest run had three timeouts in existing long-running office tests;
  the complete bounded-worker rerun passed. The browser suite checks existing flows; the new bot behavior
  is covered by the server integration tests.

### Phase 5 F follow-up: fairness, knowledge difficulty, browser synchronization (completed 2026-11-18)

- Task 1 (`1c420ba`): hacker identity is a uniform draw among eligible employees from its own match-seeded
  sequence. It does not depend on weaknesses or their recipients. Tests sample 210 fixed seeds with tolerant
  distribution bounds, vary weakness/recipient data, and complete three matches without the hacker owning
  mistaken sudo. The old direct-sudo route fixture now explicitly grants sudo to the independently chosen hacker.
- Task 2 (`c8834bf`): `BOT_HACKER_DIFFICULTY=easy|normal|hard`, default Normal. Shared rumour definitions
  supply both human briefings and bot hypotheses. Easy gets no match confirmations or private backup path;
  it learns paths and secrets through normal terminal output. Normal gets a seeded subset of enabled facts
  (half rounded down; a lone fact has a seeded 50% chance). Hard retains Part F's full knowledge/priorities.
  The existing development-only Mission view displays the configured difficulty; invalid values fail startup.
- False direct rumours cause ordinary failures and evidence, then other routes, including physical observation.
  Nine full matches (seeds 1, 7, 19 at all three levels) reach the flag with every direct rumour false.
  Easy/Normal assertions verify denied-sudo and failed-login evidence before the physical fallback succeeds.
  Additional tests cover changed backup locations, information boundaries, Normal replay and configuration.
- Task 3 (`f5b6be6`): the Part E reset-mail browser test checked a visible terminal before its initial `term.open` was
  applied. `TerminalOverlay` initially renders `data-screen=""`; the immediate conditional could skip entering
  the password, after which the screen became `locked`. The test now waits explicitly for `locked`, enters the
  password, then waits for `shell`. This fixes test synchronization; no client behavior change was needed.
- Validation, in order: typecheck passed, then **462 Vitest tests in 41 files passed** with four workers,
  then **10 consecutive full Playwright suites passed with `--retries=0`** (11 tests each, 110 passes total,
  zero failures or retries). Each browser run started its own server with bots disabled and took 3.1–3.2 minutes.
  Per-run logs are in `%TEMP%/insider-5f-followup-e2e/run-1.log` through `run-10.log`.
  The first Task 2 run had two test assertions fail on normal sudo-log account padding; corrected assertions
  passed in the complete rerun. All requested automated checks are complete. The new difficulty walkthrough
  in TESTING.md was not separately performed by hand; settings and the developer response are covered by tests.
- Scope stays within the three requested fixes. Debrief (5 I), final acceptance/balance work (5 J), and the
  pre-existing interactive CLI password-masking manual check are unchanged.

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

### Part I: what exists now (the debrief)

- `engine/src/events/trail.ts`: while the match runs, `emit()` records for every NOTABLE event of the hacker the exact
  lines it appended under /var/log and /var/mail (`watchAppends` in fs/vfs.ts) in `world.mission.trail`. The victim's
  part of a phishing mail (page visit, submit) is on the trail too. Never sent to a browser.
- `engine/src/debrief/debrief.ts`: `debriefSteps(world)` turns the trail into steps (title, MITRE ATT&CK id and name or
  null, a lesson, the typed line, count of repeats within 2 minutes, alerts raised, anti-stall flag, evidence with
  `gone` when the log cleaner removed it) and adds uses of PCs left unlocked (`world.unattended`). `suspicious: false`
  marks what honest people do too (own-account ssh). `shows` / `pinShows` recognise a piece of evidence on a screen:
  time + message, or a SIEM row (time, machine, source, and account/address/rule). `weaknessNotes(world)`.
- `server/src/debrief.ts` (`game.debrief`): notes what non-hackers had on their terminals and monitors while the match
  runs; `build()` at the end marks each piece of evidence pinned / seen / missed with names, adds camera pictures around
  physical steps (last before, first after, 60 s), bot witnesses (findings against the hacker), meetings with votes,
  detentions and weaknesses. Every password of the office is replaced by ******** in every text.
- Message `debrief { debrief: DebriefView }` right after `match.over`, to every client; never before.
- Client `ui/DebriefPanel.tsx`: opened from the match-over box or the HUD's Debrief button; steps open on click; filter
  "Only what was not pinned"; ATT&CK links. The match-over title no longer claims the flag was taken when the hacker won
  by reputation or parity.
- Limits: bots' own checks count only as witness statements; evidence a person read but that scrolled in another format
  (e.g. SIEM `| count` or `| fields`) may not be recognised as seen; ATT&CK has no entry for shoulder surfing or
  tailgating (shown without an id); a client that connects after the end does not get the debrief.
- Balance as found here (fixed in Part J): in five bot-hacker matches (seeds 1, 2, 3, 5, 8; easy and hard) the hacker won every time after
  3 to 7 game minutes. Measured: three game hours = 12,315 events, 6 ms to rebuild the steps.
- 488 Vitest tests in 44 files (new: server `debrief.test.ts`), 11 Playwright (the hacker-wins test opens the debrief).

### Part J: what exists now (whole matches: pace, soak test, browser test)

- `server/src/bots/hacker-pace.ts`: how fast the bot hacker plays, by difficulty (`paceFor`): ordinary work before the
  first attempt, pause between terminal lines (password questions are answered at once), ordinary work after a failure
  or a meeting, and ordinary work between reading the flag and handing it in. `hacker.ts` only gained `lieLow` (its body
  follows the employee routine until `coverUntil`) and `handInLater` (closes the remote shells first); its routes and
  knowledge did not change. `botOptions.hackerPace` overrides it; `BOT_HACKER_PACE=fast` = `FAST_PACE` (as before Part J).
  Test helper `Recorder` uses FAST_PACE unless a test passes its own (`hackerPace: undefined` = as in a real game).
- Measured, 25 seeds per level, random weaknesses, nobody investigating (game minutes until the flag is handed in):
  easy 16-29, normal 12-23, hard 8-14 (before: 3-7 for all). Two of the 25 days had no direct route (only
  careless-admin with tailgate or extra-sudo): there the hacker waits for the administrator, 18 to 150 minutes, by luck.
- A scripted SOC analyst who reacts ONLY to the flag-read alert (the last one) and follows alert > address > DHCP lease >
  whose PC, then accuses: the defenders won 75 of 75 matches (25 seeds x 3 levels).
- `server/test/match-soak.test.ts` (31 tests): 18 whole matches (3 levels x 6 seeds) checked for health (ends, no secret
  before the end, debrief once and complete, nobody in a wall or with a failed walk, nothing after the end) and fairness
  (cover time, hand-in time, duration, harder = faster); the SOC analyst above (9 matches); the guard detaining in that
  time; the pace setting; a meeting after the flag was read makes the hacker lie low and read it again.
- Bug found and fixed (older, Phase 3): bots picked break spots nobody can reach (the floor inside the toilet cubicles,
  a desk behind a door their badge does not open) and stood there with a failed walk for a minute.
  `Mover.canReach()` is now asked first (`spotIn` in bots/manager.ts, `chooseBreak` in bots/brain.ts).
- Browser: `e2e/match.spec.ts`, Playwright project `match`, with its own server (ports 2578/5184; bots on, TIME_SPEED=4,
  STALL_MINUTES=1): Huda waits for a HIGH alert, pins three rows, calls a meeting, accuses, votes, wins, reads the
  debrief. About 3.5 minutes; it does not know who the hacker is. Screenshots 19 and 20. Alone:
  `node_modules/.bin/playwright test --project=match`; the other tests are project `office`.
- Known: `siem` takes the rest of the line only when it is the first command on it (`clear; siem a | tail 1` pipes in the
  shell instead). A meeting makes the bot hacker forget a flag it read but did not hand in (as in Part F). The wait on
  days without a direct route varies a lot.
- 519 Vitest tests in 45 files, 12 Playwright (11 office, 1 match).

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
4. The bot hacker uses only existing tools. Phase 4 D/E and Phase 5 F are now implemented; the bot's selected routes are described in Part F above.
5. Detain: the guard may detain someone within 2 tiles; right = defenders win, wrong = the guard loses the power.
6. No time limit; anti-stall as in DESIGN.md section 1 (every 10 game minutes the SIEM flags one real hacker event HIGH).

## Phase 4 status: Parts A-H DONE

| Part | State |
|---|---|
| A Match secrets: the hacker and the weaknesses | **done** |
| B Tool framework | **done** (mechanism and `selftest`; D and E add the remaining shell tools) |
| C Physical tools: USB stick, shoulder surfing | **done** |
| D Remote tools: implant, keylogger, hash cracker, network scanner | **done** (owner asked to finish it, 2026-11-17; see below) |
| E Phishing kit and log cleaner | **done** (owner requested completion, 2026-11-17; see below) |
| F Flag, winning, audit log, security alerts | **done** |
| G Route tests (2+ complete routes) | **done** (2 routes, see below) |
| H Dev panel, browser test, CLI, docs | **done** (CLI hacker support completed 2026-11-17; see below) |

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

### Part H: CLI support completed (2026-11-17)

- The dev panel and browser test of a complete route were already implemented in earlier Phase 4 work.
- `pnpm cli --hacker PLAYER` accepts a player ID or account, calls `setHacker`, installs the existing tools,
  starts at the selected player, and shows the engine's briefing. Invalid players or mission-less scenarios fail clearly.
- `--vulns random|none|ID,ID` configures the simulated weaknesses; hacker mode defaults to seeded random,
  while ordinary CLI startup keeps its original no-hacker/no-weakness defaults.
- `:briefing` is available while controlling the hacker. `:as` changes the controlled player, not the hacker role.
- `:flag TEXT` uses the engine's submission checks, including evidence that this player read the flag in this match.
  Winning closes the terminal and freezes gameplay/time while preserving inspection and dump commands.
- Fifteen CLI tests cover startup settings/errors, role checks, a complete traceable route, post-win behavior,
  and the actual CLI executable receiving piped input. README and TESTING describe startup and expected results.
- The CLI remains an engine/debug sandbox with visible scenario credentials, not the browser server's bot/physical/social game.
- Validation: **421 Vitest tests in 39 files passed**, **11 Playwright tests passed on their first attempt**,
  typecheck passed, and production build passed. Interactive CLI password masking remains the previously
  recorded manual verification item; the new executable tests use piped input.

### Remaining lifecycle limitation (outside the Part H checklist)

- No browser "match over" reset: a new match needs every client to leave (the room then closes) or a server restart.
  A completed CLI match is restarted by quitting and running the CLI again.

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
- The historical keyboard-walk flake is addressed by the browser walk/sit follow-up above; retries are now disabled.
- The dev server (`pnpm dev`) restarts itself when server files change; Playwright reuses a running one.
- Door timers and walking use real time; the game clock can run faster (dev panel). At speed 1 they agree.
- Writing files from Bash heredocs breaks on apostrophes in this environment: use the Write tool or a script file.
- `pnpm` is not on PATH here: use `corepack pnpm ...`.

## Not done / not verified

- Typing a masked password in the CLI at a real keyboard was never verified by hand (Phase 2 leftover).
