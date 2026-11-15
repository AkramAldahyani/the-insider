# The Insider — Game Design Document

> A multiplayer social-deduction game that teaches real cybersecurity and Linux forensics skills.
> Employees of a company must collect digital and physical evidence to unmask the hacker hiding among them — before the hacker steals the admin flag.

This document is the single source of truth for the game's design. Read it fully before working on any phase. If an implementation decision conflicts with this document, ask before deviating, and update this document when a decision changes.

---

## 1. Game concept

- Players are employees of a fictional company, **Nexora Corp**, in a large top-down 2D office.
- Each player has an assigned desk with a personal Linux workstation (a **simulated** Linux shell, see §4).
- One or more players are secretly **HACKERS**. Their mission: read `/root/flag.txt` on `ADMIN-SRV-01` (only the sysadmin/root account can read it) and submit the flag.
- Everyone else is a **DEFENDER**. They keep the company running (job tasks) and investigate digital and physical evidence to identify the hacker.
- Empty player slots are filled with **bots**, so a match works with any mix of humans and bots (e.g. 1 human + 14 bots, or 30 humans).

### Win conditions
- **Hackers win** if:
  - the flag is submitted, OR
  - the number of remaining defenders becomes less than or equal to the number of remaining hackers.
- **Defenders win** if all hackers are voted out or detained.

### Match length
- **No time limit.** A match continues until a win condition is reached.
- **Anti-stall:** as time passes, threat escalation slowly surfaces extra clues in the SIEM (e.g. every 10 minutes one real hacker-generated event is flagged as high severity), so matches cannot drag on forever.

---

## 2. The office map

Top-down 2D map. Players walk with WASD/arrow keys (touch joystick on mobile) and interact with `E`.

Rooms:
- **Reception** — main entrance and badge reader
- **Finance, HR, Marketing** — rows of employee desks
- **IT department** — the sysadmin's desk (high-value target)
- **Server room** — badge-restricted; contains `ADMIN-SRV-01`
- **Security office** — CCTV monitors and badge logs
- **Cafeteria / meeting room** — emergency meeting button
- **Printer room, storage, bathrooms** — camera blind spots

Physical security systems:
- **Badge readers** log every door entry (who, which door, when).
- **CCTV cameras** cover some areas (not all) and record timestamped snapshots. Snapshots are rendered from the game's own view of that area at that moment.
- Players can see who is physically standing at which desk.

Map size scales with lobby size:

| Players | Map |
|---|---|
| 8–12 | Small office (1 floor) |
| 15 | Standard office |
| 20–25 | Large office (2 floors) |
| 30 | Corporate HQ (3 floors, more servers) |

---

## 3. Workstations, credentials and locking

- At match start each player receives an **onboarding card**: username, password, hostname, IP (assigned by a simulated DHCP server) and MAC.
- Walking to **any** desk and pressing `E` opens that PC's screen:
  - **Locked PC:** a Linux-style login prompt; correct credentials are required.
  - **Unlocked PC:** you get that user's shell and act **as that user**.
- PCs stay unlocked when the owner walks away, until they lock manually (Lock button or `loginctl lock-session`) or auto-lock triggers after 60 seconds idle (configurable).
- **Defenders may also use unlocked PCs.** Every action is logged under the PC owner's account, and other players can see who is physically standing at which desk. (This is realistic and also gives the hacker cover: "I was just checking his logs!")

---

## 4. Simulated Linux shell (core system)

**Do not use real VMs, containers, or real exploit code.** Everything is a simulation inside the game engine. This is required for safety, cheat-proofing and scale.

- The terminal is rendered with **xterm.js** so it looks authentic.
- Each machine has a virtual filesystem (`/home/<user>`, `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`, `/var/log/auth.log`, `/tmp`, `/root`, …), users, groups, permissions, processes and network connections.
- Supported commands (realistic output formats and permission checks):
  `whoami, id, hostname, ip a, ls (-la), cd, pwd, cat, less, head, tail, grep, find, stat, file, echo, touch, mkdir, rm, cp, mv, chmod, ssh, scp, exit, logout, su, sudo, last, who, w, history (and ~/.bash_history), ps aux, kill, ss -tnp, netstat, journalctl, dmesg, crontab -l, ping, nslookup, clear, help, man (short pages)`
- Shell features: quotes, pipes `|`, redirection `>` `>>`, `;` and `&&`, `~` expansion, simple globs.
- Every command generates structured **log events** (who, which host, source IP, timestamp, command) that become discoverable evidence according to realistic rules:
  - SSH logins appear in the **target's** `auth.log` and `last`, with the correct source IP.
  - Commands appear in the user's `~/.bash_history` unless cleared.
  - USB insertions appear in `dmesg` / `journalctl`.
- `ssh` between machines works over the simulated network.
- A simulated **DHCP server** keeps lease history (which MAC had which IP and when). An IP address is not a person — players must correlate IP → device → user → physical location.

### Evidence types available in the game
| Source | Example clue |
|---|---|
| Firewall / proxy logs | 400 MB uploaded to an unknown external IP at 14:02 |
| DHCP leases | 10.0.2.37 belonged to FIN-LT-07 at 14:02 |
| Authentication logs | Admin account logged in from a non-admin machine |
| Email headers | Spoofed sender, wrong originating IP, SPF fail |
| Badge logs | Who entered the server room and when |
| File audit logs | Who opened `payroll_2026.xlsx` |
| DNS queries | A machine looked up a suspicious domain |
| USB events | A device was plugged into a workstation |
| CCTV snapshots | Who was near a desk at a given time |
| Shell artefacts | `.bash_history`, `ps aux`, `ss -tnp`, `crontab -l` |

---

## 5. Hacker toolkit (simulated game items only)

The hacker's account looks normal but has a hidden `~/.tools` folder. Each tool has a cooldown, an action time and a noise level. **Every tool must leave at least one discoverable trace. There is no perfect crime, only well-hidden ones.**

| Tool | Effect | Traces left |
|---|---|---|
| BadUSB stick (physical item) | Hold `E` for 5 s at an **unlocked** PC → installs a backdoor | USB event in `dmesg`/`journalctl`, CCTV if in view, visible to nearby players |
| Remote implant | Run commands on a backdoored PC from anywhere | Established connection in `ss -tnp`, odd process in `ps aux` |
| Keylogger | Captures the victim's password at their next login | Hidden process, file in `/tmp` |
| Phishing kit | Fake "IT password reset" email; a victim who clicks submits credentials | Email headers: spoofed sender, wrong originating IP, SPF fail |
| Hash cracker | Cracks hashes from a stolen `/etc/shadow`; time depends on password strength | Read access to `/etc/shadow` is logged |
| Network scanner | Lists hosts and services | Triggers a global IDS alert |
| Log cleaner | Removes some log lines | Leaves a "log cleared" event and a time gap |
| Shoulder surfing (physical) | Stand behind someone typing their password → reveals some characters | Visible behaviour; nearby players can notice |

If the hacker attacks from their own PC, the source IP points straight to them. Pivoting through other machines must be possible and must produce **misleading-but-traceable** evidence chains (framing other players).

---

## 6. Mission paths (randomized per match)

Each match randomly enables 2–4 vulnerabilities so routes cannot be memorized:
- The sysadmin uses a weak (crackable) password.
- A regular employee has `sudo` rights by mistake.
- A plaintext password sits in a script or backup file.
- An admin session has a longer auto-lock timer than normal.
- The server room door can be tailgated (enter within 2 s after someone with access).

Alerts become more frequent as the hacker progresses, without revealing exact progress.

---

## 7. Roles

Default for 15 players:

| Role | Count | Abilities |
|---|---|---|
| Sysadmin | 1 | Holds admin credentials; can read all servers' logs. **Primary hacker target.** |
| SOC analyst | 1–2 | SIEM dashboard with a simple query language across all network logs, e.g. `src_ip=10.0.2.37 \| where bytes > 1MB` |
| Security guard | 1 | CCTV and badge log access; can **detain** a player caught mid-attack (instant win if correct; the guard loses this ability if wrong) |
| IT helpdesk | 1 | Reset passwords; force-lock any PC remotely |
| Regular employees | ~9 | Job tasks; can investigate their own machine and report findings |
| Hacker | 1 | Disguised as a regular employee with a normal-looking job title |

### Lobby scaling
| Players | Hackers |
|---|---|
| 8–12 | 1 |
| 15 | 1 |
| 20–25 | 2 |
| 30 | 2–3 |

### Multiple hackers
- Hackers **know each other** from the start, see each other highlighted, and share a **private chat** to coordinate and help each other.

---

## 8. Job tasks

Defenders have short tasks: approve an invoice file, rotate a log, patch a package, reply to an email, move files, etc. Tasks generate normal log noise, so the hacker can hide among legitimate activity.

---

## 9. Meetings, evidence and voting

- **Emergency button** in the meeting room (limited uses per player).
- **Shared evidence board:** players pin log lines, command outputs, CCTV snapshots and badge entries with one click from any viewer.
- **Accusation** requires linking **at least 3 pieces of evidence** to the accused.
- **Majority vote:**
  - Correct → the hacker is removed (defenders win when all hackers are gone).
  - Wrong → the innocent player is **fired**, company reputation drops, and the game continues.
- **Red-handed:** the security guard can detain a player physically caught mid-attack.
- **Fired players are fully out** (like Among Us ghosts): they can watch the match but cannot chat with or signal living players, use PCs, vote or affect the game. They can chat only with other fired players.
- **Large lobbies (20+):** department meetings (players within a radius) plus one all-hands meeting per match for the final vote.

---

## 10. Bots

- **Bot employees:** walk to desks, do tasks, sometimes forget to lock their PC (difficulty-based), run investigation commands, post findings in chat, vote based on the evidence they have seen.
- **Bot hacker:** picks a randomized attack chain from the enabled vulnerabilities, chooses targets opportunistically (unlocked PCs, a nearby sysadmin), pivots to frame others; stealth vs speed depends on difficulty.
- **Background NPC traffic** always runs, so logs are never suspiciously clean.
- Bot logic uses **behavior trees**. LLM-driven chat is an optional pluggable module behind an interface, **off by default**.

---

## 11. Post-match debrief (key learning feature)

After each match, show a full timeline replay: every hacker action, the evidence it produced, who found what, and which clues were missed — with short explanations of the real-world technique, referencing **MITRE ATT&CK** technique IDs.

---

## 12. Difficulty modes

- **Beginner:** clickable command buttons, explanations of output, hints.
- **Realistic:** raw terminal, no hints.

---

## 13. Art and audio

- **Phases 1–6:** placeholder art (simple shapes and tiles) generated in code. Gameplay first.
- **Phase 7:** one cohesive top-down modern-office pixel-art pack (tiles, furniture, characters), checked for a commercial-use license. Maps are built in **Tiled** (JSON loaded by Phaser).
- Characters: top-down office workers with 4-direction walk, idle and typing animations, and customization (colors, hair, clothes) so 15–30 players look distinct.
- **Do not** imitate Among Us crewmates or any other existing game's characters. The game has its own identity: normal office workers.
- Interface elements (terminal, SIEM, log viewers, evidence board, login screens) are built in code, not drawn.

---

## 14. Tech stack

- **Monorepo**, TypeScript everywhere, pnpm workspaces:
  - `packages/engine` — pure, deterministic simulation (virtual network, DHCP, filesystems, users, processes, shell, event log). No I/O, no networking.
  - `packages/cli` — text REPL for playing the engine without graphics.
  - `packages/server` — multiplayer server.
  - `packages/client` — browser game.
  - `packages/shared` — shared types and constants (if needed).
- **Client:** React + Vite, **Phaser 3** for the office map, **xterm.js** for terminals.
- **Multiplayer:** **Colyseus** (Node.js), server-authoritative. The client never receives logs, files or state its player shouldn't be able to see.
- **Persistence:** PostgreSQL (accounts, match history, replays), Redis (matchmaking, presence). docker-compose for local development.
- **Content:** scenarios, vulnerabilities, tasks and maps are JSON/YAML data files, so content can be added without code changes.
- **Tests:** Vitest for the engine; at least one automated test that runs a full bot-only match to completion.

---

## 15. Build phases

| Phase | Goal | Done when |
|---|---|---|
| 0 | Setup | Tools installed, repo created, this document committed |
| 1 | **Simulation core** — engine + CLI, no graphics | Log in, explore, ssh to another host, fail to read the flag, see actions in `last`, `auth.log`, `.bash_history` |
| 2 | **Office in the browser** — Phaser map, movement, desks, xterm.js, login/lock/unlock | Walk to any desk, log in, lock it, use someone else's unlocked PC |
| 3 | **Living office** — bot employees, tasks, background noise, badges, doors, server room, CCTV | Office feels alive; realistic logs, badge and CCTV records accumulate |
| 4 | **Hacker gameplay** — toolkit, randomized vulnerabilities, flag | Win as the hacker by at least 2 routes; every action is traceable |
| 5 | **Investigation & social deduction** — roles, SIEM, viewers, evidence board, meetings, voting, win conditions, bot hacker, debrief | A full match as defender vs a bot hacker, with debrief |
| 6 | **Multiplayer** — Colyseus rooms, 8–30 lobbies, bot backfill, chat, hacker chat, ghosts, reconnects | Friends on different computers finish a match together |
| 7 | **Art, sound, polish** — art pack, sounds, beginner mode, tutorial, mobile controls | A new player learns from the tutorial alone |
| 8 | **Accounts & launch** — accounts, stats, matchmaking, Docker, deployment, privacy policy, chat reporting | Anyone can open a link, sign up and join a public match |

Work one phase at a time. Each phase must be run, tested and committed before the next begins.

---

## 16. Constraints

- All "hacking" is simulated game logic acting on simulated machines. **No real exploits, malware, network scanning, or shell access to the host.**
- Keep code modular and well-commented; the project owner is not an expert, so explain non-obvious design choices.
- Maintain a `README.md` (setup, run, test, how to add scenarios) and a `TESTING.md` (manual verification steps for the current phase).
- After each phase: summarize what was built, how to run it, and what should be decided before the next phase.
