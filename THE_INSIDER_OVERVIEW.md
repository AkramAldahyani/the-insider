# The Insider

### A multiplayer social-deduction game that teaches real cybersecurity

> *Somewhere in the office, one of your coworkers is a hacker.*
> *They're smiling at you in the meeting room. They're "just checking something" on your PC.*
> *The logs know the truth. Can you find it before they steal the admin flag?*

---

## Table of contents

1. [The idea in one minute](#1-the-idea-in-one-minute)
2. [Why this game should exist](#2-why-this-game-should-exist)
3. [Who it's for](#3-who-its-for)
4. [The world: Nexora Corp](#4-the-world-nexora-corp)
5. [Your computer: a real-feeling Linux machine](#5-your-computer-a-real-feeling-linux-machine)
6. [The two sides](#6-the-two-sides)
7. [How a match plays, step by step](#7-how-a-match-plays-step-by-step)
8. [The hacker's toolkit](#8-the-hackers-toolkit)
9. [Evidence: how hackers get caught](#9-evidence-how-hackers-get-caught)
10. [Roles](#10-roles)
11. [Meetings, accusations and voting](#11-meetings-accusations-and-voting)
12. [Winning and losing](#12-winning-and-losing)
13. [Bots](#13-bots)
14. [Lobby sizes and multiple hackers](#14-lobby-sizes-and-multiple-hackers)
15. [The debrief: where the learning happens](#15-the-debrief-where-the-learning-happens)
16. [Difficulty modes](#16-difficulty-modes)
17. [An example match](#17-an-example-match)
18. [What players actually learn](#18-what-players-actually-learn)
19. [Look and feel](#19-look-and-feel)
20. [How it's built](#20-how-its-built)
21. [Roadmap](#21-roadmap)
22. [What makes it different](#22-what-makes-it-different)
23. [Future ideas](#23-future-ideas)

---

## 1. The idea in one minute

**The Insider** is an Among Us–style game set in a big modern company office.

- Every player is an **employee** with their own desk and their own **Linux computer**, with a real username and password.
- One player (or more, in big lobbies) is secretly a **hacker** whose mission is to break into the **admin server** and steal a secret **flag**.
- The hacker has tools: a malicious USB stick, remote-access implants, keyloggers, phishing emails, password crackers…
- Everyone else must **investigate like real security professionals**: reading login logs, tracing IP addresses, checking badge records and CCTV, and connecting the clues.
- To accuse someone, you can't just guess — you need **evidence**.
- If the defenders catch the hacker first, they win. If the hacker grabs the flag first, the hacker wins.

It's a party game on the surface, and a cybersecurity training ground underneath.

---

## 2. Why this game should exist

Cybersecurity learning today mostly falls into two buckets:

| Existing option | Problem |
|---|---|
| Awareness quizzes ("spot the phishing email") | Too shallow, boring, forgotten quickly |
| Hardcore CTF platforms and labs | Intimidating, solo, steep learning curve |

There's a huge gap in the middle: something **fun, social, and replayable** that still teaches **real skills**.

The Insider fills that gap by turning the most important — and most overlooked — parts of security into gameplay:

- **People are the weakest link.** Unlocked computers, weak passwords, and trusting coworkers are how most real breaches begin. In this game, they are literally how the hacker wins.
- **Investigation is a skill.** Real defenders don't "see" hackers — they correlate logs. Here, that's how you catch them.
- **Attackers leave traces.** Every action in the game leaves evidence, teaching players to think like both sides.

---

## 3. Who it's for

- **Students and beginners** curious about cybersecurity who want a fun first step.
- **Aspiring SOC analysts, pentesters and sysadmins** who want to practise Linux and forensics in a realistic setting.
- **Friends and gamers** who love social deduction games and want something with more depth than "who looked sus."
- **Later:** schools, universities, bootcamps, and companies running security-awareness training.

---

## 4. The world: Nexora Corp

The game takes place in the office of a fictional company, **Nexora Corp**. The office is a large top-down 2D map you walk around freely, like Among Us — but bigger.

### Rooms

| Room | Why it matters |
|---|---|
| **Reception** | Main entrance with a badge reader |
| **Finance, HR, Marketing** | Rows of employee desks — most players work here |
| **IT department** | The **sysadmin's desk**, the hacker's favourite target |
| **Server room** | Badge-locked. Contains **ADMIN-SRV-01**, where the flag lives |
| **Security office** | CCTV monitors and badge logs |
| **Cafeteria / meeting room** | The emergency meeting button |
| **Printer room, storage, bathrooms** | No cameras — blind spots for sneaky moves |

### Physical security

- **Badge readers** record every door entry: who, which door, what time.
- **CCTV cameras** cover some (not all) areas and take timestamped snapshots.
- **Your eyes**: everyone can see who is standing at which desk. If someone is hovering at your PC while you're away, that's a clue.

The office grows with the number of players — from a one-floor office for small games to a three-floor headquarters for 30 players.

---

## 5. Your computer: a real-feeling Linux machine

This is the heart of the game.

### Getting your credentials

When the match starts, every player receives an **onboarding card**:

```
Welcome to Nexora Corp!
Username: s.alharbi
Password: Sunrise#2026
Computer: FIN-LT-07
IP:       10.0.2.37
```

Every player gets **different** credentials.

### Using a computer

Walk to a desk and press **E**:

- If the PC is **locked**, you see a Linux login prompt. You need the correct username and password.
- If the PC is **unlocked**, you're in — acting **as whoever owns that computer**.

Inside, you get a terminal that looks and behaves like real Linux:

```
s.alharbi@FIN-LT-07:~$ ls
invoices/  notes.txt  todo.md
s.alharbi@FIN-LT-07:~$ last
s.alharbi  pts/0   10.0.2.37    Sun 14:02   still logged in
s.alharbi  pts/1   10.0.3.14    Sun 13:41 - 13:44
```

That second line is a clue: someone logged into Sara's account from a **different machine** (10.0.3.14) twenty minutes ago. Was it her?

### Locking: the most important habit

- When you walk away, your PC **stays unlocked** unless you lock it.
- It does **not** lock by itself: there is no auto-lock, on purpose.
- **Anyone** who reaches an unlocked PC can use it — including the hacker.

This single mechanic teaches a real lesson better than any slideshow: *lock your screen*.

### Defenders can use unlocked PCs too

Anyone can sit at an unlocked computer, not just the hacker. That's realistic — and it creates great tension. Every action is logged under the **PC owner's** account, so if you see someone at your desk, they'd better have a good explanation. And the hacker can always claim: *"I was just checking his logs!"*

### What you can do in the terminal

Real commands, real output: browsing files (`ls`, `cat`, `find`), connecting to other machines (`ssh`), checking who logged in (`last`, `who`), reading logs (`/var/log/auth.log`, `journalctl`), seeing running programs (`ps aux`), checking network connections (`ss -tnp`), looking at command history (`.bash_history`), and more.

> **Important:** none of this is a real computer. It's a complete **simulation** inside the game. It's safe, it can't be used to hack anything real, and every action automatically creates evidence.

---

## 6. The two sides

### 🕵️ The Hacker

- Looks like a normal employee with a normal job title.
- Has a hidden folder of hacking tools on their account.
- **Mission:** read the file `/root/flag.txt` on the admin server and submit the flag.
- Only the **sysadmin** account can read that file — so the hacker must steal access step by step.
- Must stay hidden, blend in, and ideally make someone else look guilty.

### 🛡️ The Defenders

- Everyone else.
- Do their job tasks to keep the company running.
- Watch for anything strange: weird logins, unknown connections, people at the wrong desk.
- Collect evidence, share it, and build a case.
- **Mission:** identify and remove the hacker before the flag is stolen.

---

## 7. How a match plays, step by step

1. **Lobby.** Players join. Empty slots are filled with bots. Roles are assigned secretly.
2. **Onboarding.** Everyone receives their credentials card and their role.
3. **Work.** Players walk to their desks, log in, and start job tasks. Normal activity fills the logs — which is exactly the noise the hacker hides in.
4. **The attack begins.** The hacker quietly looks for an opening: an unlocked PC, a weak password, a careless sysadmin.
5. **Alerts.** Security systems start raising alerts — some real, some false alarms. Alerts become more frequent as the hacker gets closer to the flag.
6. **Investigation.** Defenders dig through logs, check badges and cameras, and pin clues to the shared **evidence board**.
7. **Emergency meeting.** Someone presses the button. Everyone gathers to discuss.
8. **Accusation and vote.** A player presents an evidence chain against a suspect. Everyone votes.
9. **Repeat** until someone wins.
10. **Debrief.** The full story of the match is revealed — every hacker move, and every clue that was found or missed.

There is **no time limit**. The match ends only when one side wins.

---

## 8. The hacker's toolkit

All tools are **game simulations** — they only affect the fake computers inside the game. Each has a cooldown, takes time to use, and makes a certain amount of "noise".

> **Golden rule:** every tool leaves at least one trace. There is no perfect crime — only well-hidden ones.

| Tool | What it does | What it leaves behind |
|---|---|---|
| **BadUSB stick** | Plug into an **unlocked** PC (takes 5 seconds, standing at the desk) to install a backdoor | A "USB device connected" log entry, possibly CCTV footage, and players might see you |
| **Remote implant** | Control a backdoored PC from anywhere in the office | A suspicious network connection and a strange running process |
| **Keylogger** | Steals the victim's password the next time they log in | A hidden process and a file in `/tmp` |
| **Phishing kit** | Sends a fake "IT password reset" email; victims who fall for it give up their password | Email headers with a spoofed sender and the wrong origin IP |
| **Password cracker** | Cracks stolen password hashes — weak passwords fall fast, strong ones take too long | A log entry showing someone read the password file |
| **Network scanner** | Maps all computers and services | Loud — triggers an alert for everyone |
| **Log cleaner** | Erases some evidence | Leaves a "log cleared" event and a suspicious gap in time |
| **Shoulder surfing** | Stand behind someone while they type their password to see part of it | Purely physical — people can notice you hovering |

### The art of framing

If the hacker attacks from their **own** computer, the IP address points straight at them. Smart hackers **pivot** through other people's machines so the evidence points to innocent coworkers. Defenders must dig deeper to see through the setup.

### Randomized paths to the flag

Every match randomly opens 2–4 weaknesses, so no two games are the same:

- The sysadmin uses a weak, crackable password.
- A regular employee was accidentally given admin (`sudo`) rights.
- A password was left in plain text inside a script or backup file.
- The sysadmin is extra careless and often leaves the admin PC unlocked.
- The server room door can be **tailgated** — slip in right behind someone with access.

---

## 9. Evidence: how hackers get caught

Defenders win by **connecting clues**, just like real incident responders.

### Types of evidence

| Evidence | Example |
|---|---|
| **Login records** | The admin account logged in from a Finance laptop |
| **IP addresses and DHCP** | Which computer had IP 10.0.2.37 at 14:02 |
| **Network connections** | A PC is connected to an unknown address |
| **Firewall logs** | 400 MB uploaded to an outside server |
| **Email headers** | A "message from IT" actually came from an employee's machine |
| **Command history** | Someone ran commands on your account that you didn't |
| **Running processes** | A strange program is running on your PC |
| **USB events** | A device was plugged into your computer while you were at lunch |
| **Badge logs** | Who entered the server room, and when |
| **CCTV snapshots** | Who was standing near a desk at a certain time |
| **Eyewitnesses** | "I saw Omar at Sara's desk" |

### Correlation: the core skill

One clue is rarely enough. The magic is in the **chain**:

> Data was sent out from **10.0.2.37** at 14:02
> → the DHCP records say that IP belonged to **FIN-LT-07** at that time
> → the login records say **Sara** was logged in on FIN-LT-07
> → but the badge logs show Sara was **in the cafeteria** at 14:00
> → so someone used her **unlocked** PC…
> → CCTV shows **Khalid** walking into Finance at 13:58.

A key lesson: **an IP address is not a person.** You have to trace IP → device → account → physical person.

---

## 10. Roles

Not every defender sees everything — so teamwork is essential.

| Role | Count (15 players) | Special abilities |
|---|---|---|
| **Sysadmin** | 1 | Holds the admin password and can read all server logs. **The hacker's #1 target.** |
| **SOC analyst** | 1–2 | A security dashboard (SIEM) to search logs across the whole company |
| **Security guard** | 1 | Watches CCTV and badge logs. Can **detain** someone caught in the act |
| **IT helpdesk** | 1 | Can reset passwords and remotely lock any computer |
| **Regular employees** | ~9 | Do tasks, investigate their own computers, report what they find |
| **Hacker** | 1 | Disguised as a regular employee |

Regular employees matter a lot: the first clue is often someone noticing a strange login on their own machine.

---

## 11. Meetings, accusations and voting

### Emergency meetings

- Anyone can press the **emergency button** in the meeting room (limited uses per player).
- Everyone gathers to share findings and argue their case.

### The evidence board

A shared board where players pin clues with one click: log lines, command output, CCTV snapshots, badge entries. It becomes the visual "case file" of the match.

### Accusing someone

- You **cannot** accuse on a hunch.
- An accusation needs **at least 3 linked pieces of evidence** pointing to the suspect.
- Then everyone votes. Majority decides.

### Results

- **Correct:** the hacker is removed.
- **Wrong:** an innocent employee is **fired** — and the hacker is still out there.

### Caught red-handed

If the **security guard** catches someone mid-attack (say, plugging a USB stick into someone else's PC), they can **detain** them on the spot. If they're right, it's an instant win. If they're wrong, the guard loses that power.

### Fired players

Fired players are **fully out**, like ghosts in Among Us. They can watch the rest of the match, but they can't talk to living players, use computers, vote, or influence the game. They can only chat with other fired players.

### Big lobbies

With 20+ players, everyone shouting in one meeting is chaos. Instead there are **department meetings** (only nearby players) plus one **all-hands meeting** per match for the big vote.

---

## 12. Winning and losing

| Side | Wins when… |
|---|---|
| **Hackers** | The flag is submitted, **or** the remaining defenders are equal to or fewer than the remaining hackers |
| **Defenders** | Every hacker has been voted out or detained |

### No time limit — but no endless games

Matches last until someone wins. To stop a very careful hacker from hiding forever, the game uses **threat escalation**: as time goes on, the security system slowly highlights real hacker activity (for example, one genuine suspicious event every 10 minutes). The longer the hacker waits, the more exposed they become.

---

## 13. Bots

The game is always playable — even alone.

- **Bot employees** walk around, do tasks, sometimes forget to lock their PCs, investigate, share findings in chat, and vote based on what they've seen.
- **Bot hackers** pick a random attack plan, look for unlocked PCs and careless sysadmins, and try to frame others. Harder bots are stealthier.
- **Background activity** always runs: normal logins, emails, file access. Logs are never suspiciously empty — just like a real company.

Any mix works: 1 human with 14 bots, 15 humans, or anything in between.

---

## 14. Lobby sizes and multiple hackers

| Players | Hackers | Office |
|---|---|---|
| 8–12 | 1 | Small office, one floor |
| 15 | 1 | Standard office |
| 20–25 | 2 | Large office, two floors |
| 30 | 2–3 | Corporate HQ, three floors |

With 15 players, it's genuinely hard to guess the hacker — you need evidence.

### Hacker teams

When there's more than one hacker:

- They **know each other** from the start.
- They have a **private chat** to plan, share stolen passwords, cover for each other, and coordinate attacks.

---

## 15. The debrief: where the learning happens

When the match ends, everyone sees the **full story**:

- A timeline of **every action the hacker took**.
- The **evidence** each action produced.
- **Who found which clue** — and which clues nobody noticed.
- Short explanations of each technique and how it works in the real world, linked to the **MITRE ATT&CK** framework that real security teams use.

> Example debrief entry:
> **13:58 — Khalid plugged a BadUSB into FIN-LT-07 (Sara's unlocked PC).**
> *Evidence left:* USB event in `journalctl`; CCTV snapshot in Finance.
> *Found by:* nobody. 😬
> *Real world:* Attacks using malicious USB devices are a known technique (Hardware Additions / Replication Through Removable Media). Lesson: lock your screen, every time.

This is how a fun party game turns into real skill-building — players **feel** the mistake, then **understand** it.

---

## 16. Difficulty modes

| Mode | For | How it works |
|---|---|---|
| **Beginner** | New players | Clickable buttons run commands for you, results are explained, hints guide you |
| **Realistic** | Experienced players | Raw terminal, no hints — just you and the logs |

A tutorial match will teach the basics before a player's first real game.

---

## 17. An example match

*15 players. Sara is a Finance employee. Khalid is secretly the hacker. Omar is the sysadmin.*

**Minute 1.** Everyone logs in. Sara starts approving invoices. Omar patches a server. Khalid "organizes marketing files" — and watches.

**Minute 4.** Sara walks to the printer room and forgets to lock her PC. Khalid walks past Finance, stops at her desk for five seconds, and plugs in his BadUSB. Her machine now has a backdoor.

**Minute 6.** From his own desk, Khalid uses the implant on Sara's PC to send a phishing email: *"IT notice: please re-verify your password."* It goes to Omar — from Sara's computer.

**Minute 7.** Omar is suspicious and doesn't click. But a bot employee does, handing over its password. Not the admin, but a step closer.

**Minute 9.** Sara returns, runs `last` out of habit, and sees nothing odd. But her `ps aux` shows a process she doesn't recognize. She pins it to the evidence board.

**Minute 10.** The SOC analyst sees that the phishing email came from FIN-LT-07 — Sara's PC. Suspicion falls on Sara. **Emergency meeting.**

**Minute 11.** Sara argues: "I was in the printer room!" The security guard checks badge logs: confirmed, she badged into the printer room at 13:56. And CCTV caught **someone** walking into Finance at 13:58…

**Minute 12.** The snapshot shows Khalid. The journal on Sara's PC shows a USB device connected at 13:58. Three linked pieces of evidence: **CCTV + USB log + Sara's alibi.**

**Vote:** Khalid is caught. **Defenders win.**

**Debrief:** Everyone sees exactly how the attack worked — and Sara learns, painfully, why you lock your screen.

---

## 18. What players actually learn

### Technical skills
- Basic **Linux** command line: navigating files, users, permissions, processes
- **Log analysis**: `auth.log`, `last`, `journalctl`, command history
- **Networking basics**: IP addresses, DHCP, SSH, connections
- **Forensic correlation**: connecting clues across different sources
- **Email analysis**: spotting spoofed senders through headers
- **SIEM-style searching**: querying logs like a SOC analyst

### Security awareness
- Why you **lock your screen**
- Why **weak passwords** fall quickly
- How **phishing** really works
- Why **plugging in unknown USB devices** is dangerous
- Why **physical security** (badges, tailgating, cameras) matters
- How attackers **pivot** and **frame** others

### Soft skills
- Building an argument from evidence
- Teamwork under pressure
- Communicating technical findings clearly

---

## 19. Look and feel

- **Style:** top-down 2D pixel art of a modern office, with normal office workers as characters.
- **Characters:** customizable (colors, hair, clothes) so 15–30 players are easy to tell apart, with walking and typing animations.
- **Original identity:** the characters are deliberately **not** like Among Us crewmates or any other game's characters.
- **Interfaces:** the terminal, security dashboard, log viewers, evidence board and login screens are crisp, realistic UI — they should feel like real tools.
- **Development approach:** simple placeholder graphics while the gameplay is built and tested, then a professional, consistent office art pack once the game is proven fun.

---

## 20. How it's built

| Part | Technology |
|---|---|
| Game in the browser | React + TypeScript, **Phaser** for the office map |
| Terminal | **xterm.js** — the same terminal technology used in professional code editors |
| Multiplayer | **Colyseus** on Node.js — the server is the single source of truth, so players can't cheat |
| Simulation engine | Custom TypeScript engine: fake network, computers, files, users and logs |
| Bots | Behavior trees (optional AI-powered chat later) |
| Data | PostgreSQL for accounts and match history, Redis for matchmaking |
| Maps | Built in **Tiled** and loaded by the game |
| Content | Scenarios, weaknesses, and tasks stored as data files — new content without new code |

**Safety by design:** nothing in the game touches real systems. All hacking happens inside a simulation, which keeps players and servers safe and means every action can be logged as evidence.

---

## 21. Roadmap

| Phase | What gets built |
|---|---|
| **0. Setup** | Tools, repository, design documents |
| **1. Simulation core** | The fake computers, Linux shell, network and logs — played in a text terminal |
| **2. Office in the browser** | The map, walking, desks, terminals, login and locking |
| **3. Living office** | Bots, job tasks, background activity, badges, doors, CCTV |
| **4. Hacker gameplay** | The hacker toolkit, random weaknesses, the flag |
| **5. Investigation** | Roles, security dashboard, evidence board, meetings, voting, debrief — **first full playable game** |
| **6. Multiplayer** | Online lobbies of 8–30, bots filling empty slots, hacker chat, ghosts |
| **7. Art and polish** | Real art, sound, beginner mode, tutorial, mobile controls |
| **8. Launch** | Accounts, stats, matchmaking, online hosting |

---

## 22. What makes it different

- **Evidence, not vibes.** You can't vote on a hunch — you have to prove it.
- **A real-feeling Linux machine for every player.** Learning happens by doing, not by reading.
- **Physical meets digital.** Walking, watching, badges and cameras matter as much as logs.
- **Both sides teach.** Playing the hacker teaches how attacks work; playing defender teaches how to catch them.
- **Always playable.** Bots mean you never need a full lobby.
- **Every match is different.** Randomized weaknesses and human unpredictability keep it fresh.
- **The debrief turns fun into knowledge.** Every match ends with a lesson.

---

## 23. Future ideas

- **New maps:** a hospital, a bank, a university, a factory with industrial control systems.
- **New scenarios:** ransomware, insider data leaks, cloud account takeovers.
- **Ranked mode** with separate ratings for hackers and defenders.
- **Classroom mode** for teachers: private lobbies, progress reports, chosen scenarios.
- **Corporate training edition** for companies' security-awareness programs.
- **Custom scenario editor** so the community can design their own offices and attacks.
- **Seasonal events** based on real, publicly known security incidents.
- **Career paths** in the profile, showing skills earned (SOC analyst, pentester, sysadmin).

---

*The Insider — trust no one. Check the logs.*
