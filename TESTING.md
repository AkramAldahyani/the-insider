# TESTING

Normal browser matches now include a simulated bot hacker. For the earlier office-only manual checks,
set `BOT_HACKER=0` (PowerShell: `$env:BOT_HACKER=0`) before starting the server so it does not finish the
match during unrelated checks. The Phase 5 F section below explicitly turns it back on. `BOTS=0` disables all bots.

Manual checks for the current state of the game. Two parts:

- **Phase 2 — the office in the browser** (about ten minutes)
- **Phase 1 — the simulation in the text CLI** (about ten minutes)

Both use the same scenario. With the default seed the machines are:

| Host | Room | IP | Owner | Password | Screen at start |
|---|---|---|---|---|---|
| FIN-LT-07 | Finance | 10.0.2.58 | s.alharbi | `Riyadh2024!` | locked |
| FIN-LT-04 | Finance | 10.0.2.74 | r.mansour | `football7` | login prompt |
| HR-LT-03 | HR | 10.0.2.185 | l.haddad | `Lina@HR#2025` | **unlocked** |
| HR-LT-05 | HR | 10.0.2.136 | n.saleh | `Noor!Saleh#88` | locked |
| MKT-LT-09 | Marketing | 10.0.2.161 | y.khalil | `pixel1234` | **unlocked** |
| MKT-LT-11 | Marketing | 10.0.2.71 | o.farouk | `summer2025` | locked |
| IT-WS-01 | IT | 10.0.2.110 | d.aziz (helpdesk) | `H3lpdesk-Dana-42` | login prompt |
| IT-WS-02 | IT | 10.0.2.119 | k.nasser (sysadmin) | `Tr0ub4dor&3xK9` | locked |
| REC-PC-01 | Reception | 10.0.2.180 | m.yousef | `welcome2026` | locked |
| SEC-WS-01 | Security office | 10.0.2.140 | t.omar | `Falcon-Gate-7` | locked |
| SOC-WS-01 | Security office | 10.0.2.59 | h.rahman (SOC analyst) | `Sh1eld&Coffee-19` | locked |
| ADMIN-SRV-01 | Server room | 10.0.1.10 | — | root: `N3x0ra-R00t-Vault!92` | login prompt |

k.nasser has an account (with sudo) on every machine. Everyone has an account on ADMIN-SRV-01.

Passwords show as `*` while you type them, in the browser and in the CLI.

---

# Phase 2 — the office in the browser

Start the game server and the web page:

```bash
pnpm dev
```

Open http://localhost:5173. To start from a clean office at any time, stop `pnpm dev` (Ctrl+C) and start it again.

## A. Start screen and onboarding card

| Do | Expect |
|---|---|
| Open the page | "THE INSIDER" and ten employees grouped by department, each with a title and a desk. No passwords are shown. |
| Click **Sara Alharbi** | The office appears. You are a blue circle labelled "Sara Alharbi (you)" in Finance, below desk FIN-LT-07. |
| Look at the card on the right | Username `s.alharbi`, password `Riyadh2024!`, PC `FIN-LT-07`, IP `10.0.2.58`, MAC `52:54:00:f1:07:07`. |
| Press `C` twice | The card hides, then comes back. |
| Look at the top bar | A running clock starting at Mon 2 Mar 2026 09:00 (one game second per real second) and the room name "Finance". |

## B. Walking

| Do | Expect |
|---|---|
| Hold `W`, `A`, `S`, `D` or the arrow keys | You walk; the white triangle on your circle points where you face; the view follows you. |
| Walk into a wall or a desk | You stop. Holding two keys slides you along the wall. |
| Walk down through the gap in Finance's bottom wall | The room name changes to "Corridor". |
| Visit the other rooms | Each is labelled: HR, Marketing, IT department, Server room (inside IT, top right), Reception, Security office, Cafeteria / meeting room, Printer room, Storage, Bathrooms. |
| Look for the markers | Orange strips are doors, red triangles are cameras (CAM-01…05), small green boxes are badge readers. None of them does anything yet; the server room door is open. |
| Look at the monitors | Green + "UNLOCKED", amber + "LOCKED username", grey + "LOGIN". |

## C. Your own PC

| Do | Expect |
|---|---|
| Stand far from any desk and press `E` | Nothing. |
| Walk to the chair of FIN-LT-07 | "Press E to use FIN-LT-07" at the bottom. |
| Press `E` | A terminal window opens: `*** FIN-LT-07: screen locked by s.alharbi ***` and `Password:`. You cannot walk while it is open. |
| Type `wrong` then Enter | Stars while typing, then `Sorry, that password is incorrect.` |
| Type `Riyadh2024!` then Enter | Prompt `s.alharbi@FIN-LT-07:~$`. The badge in the title bar says "shell". |
| `whoami` | `s.alharbi` |
| `ls -la`, `cat todo.txt`, `ip a` | Same output as in the CLI. |
| Press ↑ | The previous command comes back. ← → Home End and Backspace edit the line. |
| Type `rm -rf nothing` and press Ctrl+C | `^C` and a fresh prompt; nothing ran. |
| `ssh k.nasser@ADMIN-SRV-01`, then Ctrl+C at the password | Back at `s.alharbi@FIN-LT-07:~$`. |
| `clear` | The window is wiped. Scroll with the mouse wheel to see older text. |

## D. Standing up does not lock

| Do | Expect |
|---|---|
| Press `Esc` | The terminal closes. The monitor of FIN-LT-07 is **green (UNLOCKED)**. |
| Press `E` again within a minute | Your shell is still there. No password. |
| Type `loginctl lock-session` | The lock screen. Press `Esc`: the monitor is amber, "LOCKED s.alharbi". |

## E. No auto-lock

| Do | Expect |
|---|---|
| Unlock FIN-LT-07 again, then do not touch the keyboard for a few minutes | It stays unlocked: nothing locks a screen except a person. |
| Press `Esc` and watch the monitor | It stays green until someone locks it. |

## F. Someone else's unlocked PC

| Do | Expect |
|---|---|
| Walk to HR (next room to the right) and to desk HR-LT-03 | Its monitor is green. |
| Press `E` | **No password.** Prompt `l.haddad@HR-LT-03:~$`. |
| `whoami` | `l.haddad` |
| `touch /tmp/sara-was-here`, then `Esc` | You acted as Lina. Step I shows how the engine recorded it. |

## G. A PC with nobody logged in

| Do | Expect |
|---|---|
| Walk to FIN-LT-04 and press `E` | `Ubuntu 22.04.4 LTS FIN-LT-04 tty1` and `FIN-LT-04 login:`. |
| `r.mansour`, then `football7` | `r.mansour@FIN-LT-04:~$` |
| `exit` | The login prompt again. |

## H. Switch user

| Do | Expect |
|---|---|
| Reload the page and choose **Khalid Nasser** | You start in IT. Password on the card: `Tr0ub4dor&3xK9`. |
| Walk to FIN-LT-07 (it must be locked; lock it first if not) and press `E` | Sara's lock screen, with a **Switch user (F2)** button in the title bar. |
| Click it or press `F2` | `(still logged in and locked: s.alharbi)` and `FIN-LT-07 login:`. |
| `k.nasser`, then his password | `k.nasser@FIN-LT-07:~$` |
| `who` | Two lines: `s.alharbi tty1` and `k.nasser tty2`. |
| `sudo grep background /var/log/auth.log` | `Session … of user s.alharbi moved to the background (switch user).` |
| `exit` | Sara's lock screen is back. Her session was never touched. |
| On the lock screen press `F2`, then Ctrl+C | Back to the lock screen. |

## I. Remote unlock leaves a trace (as Khalid)

| Do | Expect |
|---|---|
| Sit at IT-WS-02 and unlock it | `k.nasser@IT-WS-02:~$` |
| `ssh k.nasser@HR-LT-05` and the password | `k.nasser@HR-LT-05:~$` |
| `sudo loginctl unlock-session` and the password | No output. |
| `sudo grep REMOTE /var/log/auth.log` | `REMOTE unlock-session: session … of user n.saleh unlocked by k.nasser from 10.0.2.119 (pts/0)` |
| `exit`, `Esc`, look at HR-LT-05 | Green, and it stays green: there is no auto-lock. |

## J. Developer panel (development only)

| Do | Expect |
|---|---|
| Press the backtick key `` ` `` (left of `1`) | A panel with a dashed amber border. |
| Click **×60** | The clock runs a minute per second; "×60" shows next to it. Click **×1** to return. |
| Jump `+1h`, **go** | The clock is one hour later. |
| **show last** | The last 15 master events. Lines from step F show `l.haddad … [physical p1]`: the account was Lina's, the person was Sara. Lines typed over ssh show `[remote …]`. |
| Teleport to `ADMIN-SRV-01`, **go** | You are in the server room. |
| **dump to dumps/** | A file path. The file is the whole world as JSON (it stays on the server). |

## K. The developer panel does not exist in production

Stop `pnpm dev`, then:

```bash
pnpm build
```

```bash
NODE_ENV=production pnpm server
```

(PowerShell: `$env:NODE_ENV="production"; pnpm server`.) In a second terminal:

```bash
pnpm --filter @insider/client preview
```

Open http://localhost:5173, pick an employee and press the backtick key: nothing happens, and the top bar no longer mentions the dev panel. The server prints `dev=false`.

---

# Phase 3 — a living office

Start with `pnpm dev` and open http://localhost:5173. This time the office has bots. Steps L to S take about 15 minutes.
To speed things up, open the developer panel (`` ` ``) and set the speed to ×10: the clock, typing and breaks go faster, but walking and doors stay at real speed.

## L. Doors and badges

1. Start as **Sara**. Her card now shows `Badge #0412` and `Badge opens: all normal doors`.
2. Walk down to the Finance door: it is a solid bar and stops you. The hint says *Press E to tap your badge at the finance door*.
3. Press `E`. You hear a beep, the bar becomes two stubs, and you can walk into the corridor. About 3 seconds later the door closes.
4. Walk to the **Security office** door (dark red, below the corridor) and press `E`. Expected: *Access denied*, a lower beep, the reader box turns red for a moment, and you cannot walk in.
5. Walk right to the **Bathrooms** door (no box beside it). It opens by itself as you approach and closes behind you.

## M. Bots

1. Stand in the corridor and watch. Within four minutes of the match starting, the other nine employees appear at the bottom left (the main entrance in Reception), badge in and walk to their desks. They have name labels and look exactly like you.
2. Follow one into a department room: they sit, their monitor turns green (unlocked), and they stay for a few minutes.
3. Wait for someone to get up. Most monitors turn amber (they locked the screen) just before they stand; about one in four stays green until its owner comes back. That one was forgotten, and anyone could have used it.
4. Open the developer panel and press **bots**. Expected: nine lines, each with a desk or `walking`, a count of finished tasks and what the bot is doing (`working`, `task: …`, `in Cafeteria / meeting room`…), and one line `HUMAN` for you.
5. Press **doors**: every door with its kind and whether it is open.

## N. One occupant per PC

1. Walk to a desk where a colleague is sitting and press `E`. Expected: *<name> is sitting at <PC>.*
2. Sit at a free PC before its owner comes back from a break and stay there. Expected: the owner walks up, cannot sit, and wanders off again.

## O. Job tasks

1. Your task list is at the top left (`T` hides it). Each task shows its next step and, in green, a command that does it.
2. Sit at your PC, unlock it, and type the green command of one task. Expected: the step is crossed out and the next one is highlighted. After the last step a notice says *Task finished*, the counter goes up, and a new task appears.
3. Type a later step before an earlier one. Expected: nothing is ticked: steps count in order.
4. A task that says *Collect the printout from the printer room* or *Team coffee* is done by going there and staying for the seconds it takes. This is on purpose: it gets you away from your desk.

## P. Badge, door and camera logs (as the security guard)

Reload the page and start as **Tariq**. He starts inside the security office. Sit at `SEC-WS-01`, unlock it, then:

| Type | Expected |
|---|---|
| `ssh SEC-SRV-01` then his password | `t.omar@SEC-SRV-01:~$ ` |
| `tail /var/log/badge/access.log` | Lines like `2026-03-02 09:01:12 DOOR=MAIN-ENT BADGE=0412 USER=s.alharbi RESULT=GRANTED DIR=IN`. |
| `grep 2026-02-27 /var/log/badge/access.log \| head -n 4` | The previous working day: arrivals around 08:xx, departures around 17:xx. |
| `grep -c DENIED /var/log/badge/access.log` | `0` unless a human tried a door (bots do not try doors they cannot open). |
| `tail /var/log/badge/doors.log` | `EVENT=OPEN` / `EVENT=CLOSE OPEN_FOR=3.0s PASSAGES=1`. A `PASSAGES=2` after one tap is tailgating; bots do it now and then. |
| `tail /var/log/cctv/motion.log` | `CAM-02 MOTION persons=2 snapshot=CAM-02-000117`: a head count and a snapshot id, never a name. |
| `cat /etc/badge/doors.conf` | The door table: which doors are restricted. |

In the developer panel choose a camera and press **snapshot**: the people in that camera's view right now, with tile positions. Choose `CAM-04`: it shows only the IT side of the server room door.

**Tailgating by hand:** in a second tab start as **Khalid**, in a third as **Sara**. Bring both to the server room door (top right of IT). Khalid presses `E`; both walk in. Tariq's `tail -n 2 /var/log/badge/doors.log` shows `PASSAGES=2` after a single granted tap. Sara, inside, presses `E`: the door opens (leaving is always allowed) and `access.log` gets her badge with `DIR=OUT`.

## Q. Email

At any PC, logged in as yourself:

| Type | Expected |
|---|---|
| `mail` | Your inbox: at least Noor's *Reminder: lock your screen*; after a few minutes, messages from bots. `N` marks unread ones. |
| `mail 1` | The message with headers. `Received: from <PC>.nexora.local (… [10.0.2.x])` names the machine and IP it was sent from; `From:` is what the sender wrote. |
| `mail -s "Hello" r.mansour "Testing the mail."` | `Message … sent to r.mansour@nexora.local`. |
| `mail -s "Hi" nobody "x"` | `no such user`. |

As **Khalid**: `ssh ADMIN-SRV-01`, then `sudo tail /var/log/mail.log`. Expected: Postfix-style lines with `connect from <PC>.nexora.local[<IP>]`, `from=<…>`, `to=<…> … status=sent`. `sudo cat /var/mail/s.alharbi` shows her mailbox; as Sara, `cat /var/mail/t.omar` on the server says `Permission denied`.

## R. Web, DNS and firewall logs

| Type (any PC) | Expected |
|---|---|
| `curl https://news.example/` | A small HTML page titled *World News Today* (simulated). |
| `curl -I http://intranet.nexora.local/` | `HTTP/1.1 200 OK` and a `Via: … (squid)` line. |
| `curl http://no-such-site.example/` | `curl: (6) Could not resolve host`. |

As **Khalid** on `ADMIN-SRV-01` (he is in group `adm` there):

| Type | Expected |
|---|---|
| `tail /var/log/squid/access.log` | One line per request: time, PC IP, account, method, URL, status, bytes, time taken, destination IP. Lines with `-` as the account and `archive.ubuntu.example` are machines checking for updates by themselves. |
| `tail /var/log/named/queries.log` | `client 10.0.2.x#port (name): query: name IN A`: who asked for which name, including the one that did not exist. |
| `dmesg \| grep UFW \| tail -n 3` | `[UFW ALLOW] … SRC=10.0.2.x DST=10.0.1.10 … DPT=22`: every connection to the ssh port, successful or not. |

## S. Background noise

Stand still for a while (or jump the clock: developer panel, **Jump** `+1h`). On any PC, as a user who may read logs (`k.nasser` with `sudo`, or the owner):

```
tail -n 15 /var/log/syslog
```

Expected: `systemd-timesyncd … Contacted time server 10.0.1.10:123`, `systemd[1]: Starting Cleanup of Temporary Directories...` and similar lines with timestamps spread over the hour, plus the hourly `CRON` lines. Nobody typed anything to cause them.

## T2. Changes made after Phase 3

1. **Arrival line.** Start as anyone, then as Tariq read `tail -n 3 /var/log/badge/access.log` on SEC-SRV-01: your employee's `DOOR=MAIN-ENT … DIR=IN` at the second you picked them. The main entrance door also opened for 3 seconds. Close the browser tab: a `DIR=OUT` line follows.
2. **Server room camera.** Developer panel → camera `CAM-06` → **snapshot** while someone is in the server room: they are listed.
3. **Unattended PCs.** Developer panel → **Show: unlocked**: every PC that stood open while its user was away, for how long, how it ended and who sat at it.
4. **Task pace.** After 30 minutes, developer panel → **tasks**: about 8-10 finished per bot, not 30.

## U. Phase 4, part A: the hacker role and today's weaknesses

Each match now switches on 2-4 random weaknesses. **With the default seed, `pnpm dev` has two: the sysadmin's password is `nexora2026` (not the one in the table at the top), and Rami (`r.mansour`) has sudo by mistake.** For the office exactly as in the table, start with `VULNS=none` (PowerShell: `$env:VULNS='none'; pnpm dev`).

1. On the start screen tick **Join as the hacker**, then pick Omar. Close the onboarding card (`C`): a private briefing appears at the bottom right with the goal and some rumours. `M` hides it. It does not say which weaknesses are on.
2. Sit at `MKT-LT-11`, unlock it. `ls` shows nothing unusual; `ls -a` shows `.tools`; `cat .tools/README`.
3. Open a second browser tab: **Join as the hacker** is greyed out. Pick Sara: she gets no briefing.
4. Developer panel -> **mission**: the hacker, the flag, today's weaknesses.
5. With `VULNS=none`: bring Khalid and Sara to the server room door. Khalid taps and walks in; Sara is stopped although the door looked open, and it closes right behind him. With `VULNS=tailgate` both get in.

## V. Phase 4, part B: the toolkit mechanism

As the hacker (Omar), sitting at `MKT-LT-11`:

| Type | Expected |
|---|---|
| `ls -l .tools` | `README`, `loot` and `selftest`, all private to `o.farouk` (`-rwx------` / `drwx------`). |
| `~/.tools/selftest` | `selftest: toolkit OK on MKT-LT-11 (running as o.farouk)` and the list of tools. |
| the same again at once | `selftest: still cooling down (… s left)`. |
| `selftest` (without the path) | `command not found`: tools are not on the PATH. |
| `~/.tools/selftest --long` | Starts a background job and prints `[1] <pid>`. |
| `ps aux \| grep selftest` | The job's process, owned by `o.farouk`. |
| wait 30 s, then `cat ~/.tools/loot/selftest.txt` | `self-test passed on MKT-LT-11 at …`; the process is gone. |
| run `--long` again and `kill <pid>` | No result file appears: the job was stopped. |

As anybody else: `ls /home/o.farouk/.tools` says `Permission denied`. Developer panel -> **Events -> show last** lists `tool.run` and `tool.done` with Omar's player id.

## V2. Phase 4, part E: simulated reset mail and log cleaning

Run `corepack pnpm dev`. Open two tabs: join as the hacker **Khalid (p5)** in the first, and **Lina (p3)**
in the second. Use each character's onboarding card and their own PC. This choice gives the hacker
the sysadmin's ordinary simulated sudo rights for the cleaning check.

1. On Khalid's PC run `~/.tools/phish l.haddad`. Note the private result filename printed on screen.
2. On Lina's PC run `mail`, then `mail NUMBER` for the newest IT reset message. Verify `From: IT`,
   `spf=fail`, and a `Received` header naming `IT-WS-02` and its simulated IP.
3. Read the result file on Khalid's PC: it should still say waiting. On Lina's PC use `curl -I URL`
   with the exact displayed reset link; that also leaves the result waiting.
4. On Lina's PC use `curl URL`. Her screen acknowledges receipt without showing a password.
   Khalid's result file now contains Lina's **game** username/password. Visiting again does not recapture.
5. On Khalid's PC use `ssh ADMIN-SRV-01`, authenticate with his card, and inspect `/var/log/mail.log`,
   `/var/log/named/queries.log` and `/var/log/squid/access.log`. Correlate the message's sender and the
   visiting PC. No password should appear in these logs. `exit` returns to his PC.
6. Pin a selected auth-log line containing `session` to the evidence board. Run
   `sudo ~/.tools/clean /var/log/auth.log "session"` and authenticate. Verify matching lines are removed,
   `tail /var/log/auth.log` shows `EVENT=log-cleared`, and `journalctl -n 5` shows a clearing event.
   The pinned item must still contain the original evidence. A plain account cannot edit the same log.
7. With bots enabled, send a reset message to a bot employee and continue playing. Bots read their own
   inbox and decide once per message whether to follow, with a 30% chance. A non-response is expected
   for many messages. Successful visits leave the same DNS/proxy traces as a human's visit.

Automated coverage: `packages/engine/test/phishing-cleaner.test.ts`,
`packages/server/test/phishing-cleaner.test.ts`, and the `simulated reset mail` browser test.

## W. Phase 4, part C: the USB stick and shoulder surfing

Start with `VULNS=none` and join as the hacker (Omar).

1. Walk to Yousef's desk `MKT-LT-09` (unlocked at the start), stand at the chair. The hint adds *hold U to plug in the USB stick*.
2. Hold `U`. A notice says *keep holding U and stand still (5 s)*; your character crouches with a "···" bubble. After 5 seconds: *Backdoor installed on MKT-LT-09 for y.khalil (listening on port 4440)*.
3. Try again at once elsewhere: *You need … s before you can use the USB stick again*. Let go after 2 seconds, or walk: *Nothing happened*.
4. Hold `U` at a LOCKED PC (for example Noor's `HR-LT-05`): *… is locked: … achieved nothing*.
5. As Khalid (second tab), `ssh k.nasser@MKT-LT-09`, then:

| Type | Expected |
|---|---|
| `dmesg \| grep -i usb` | `New USB device found, idVendor=1b4f, idProduct=9208`, `USB HID v1.11 Keyboard`, `USB disconnect`. |
| `ps aux \| grep sysupd` | `y.khalil … /home/y.khalil/.cache/.sysupd/sysupd -d` |
| `sudo ss -tlnp` | `0.0.0.0:4440 … users:(("sysupd",pid=…` |
| `sudo crontab -l -u y.khalil` | `@reboot /home/y.khalil/.cache/.sysupd/sysupd -d` |
| `sudo kill <pid>`, then `sudo ss -tlnp` | Port 4440 is gone. |

On `HR-LT-05` the `dmesg` lines are there too, even though nothing was installed.

6. **Shoulder surfing.** Third tab as Sara: sit at `FIN-LT-07` (locked). As Omar, stand one tile right behind her chair. When Sara types her password, Omar gets *You saw Sara Alharbi type a password at FIN-LT-07 ("Password:"): R?y??h2??4!* (some characters shown). `cat ~/.tools/loot/shoulder.txt` on Omar's PC has the line. Standing two tiles away, or beside her, shows nothing.

## X. Phase 4, part F: winning, the audit log and alerts

Start with `VULNS=plaintext-password` (PowerShell: `$env:VULNS='plaintext-password'; pnpm dev`). Open two tabs: Omar as the hacker, Sara as an employee.

1. As Omar, sit at `MKT-LT-11`, unlock, then `ssh ADMIN-SRV-01` (his own password).
2. `cat /srv/shared/old/backup-2025.sh`: the root password is in it. `su`, type it, `cat /root/flag.txt`.
   Both tabs get a red banner: *SECURITY ALERT: unusual activity was detected on the company network.* It names nothing.
3. Press `Esc`, open the briefing (`M`), paste the flag into the box, **Hand in**. Omar sees *You got the flag out. You win.*; Sara sees *The hacker got the flag out. The hacker was Omar Farouk.*
4. Handing in a made-up text says *That is not the flag*; handing in the real text without having read it in this match says *read it on the server first*.
5. As Khalid (new match): `ssh ADMIN-SRV-01`, then
   - `sudo tail -n 4 /var/log/audit/audit.log`: `key="flag-read"`, `name="/root/flag.txt"`, `auid=` Omar's uid although he was root;
   - from `SEC-WS-01` as Tariq: `ssh SEC-SRV-01`, `cat /var/log/security/alerts.log`: `[HIGH] flag-read /root/flag.txt on ADMIN-SRV-01 was read as root (login o.farouk) from 10.0.2.71`.
6. Three wrong passwords in a row for any account (`ssh k.nasser@ADMIN-SRV-01`) give `[MEDIUM] auth-failures` and the banner (at most once a minute). A USB stick on a locked PC gives only `[LOW] usb-keyboard`, no banner.

## Y. Phase 5, part A: roles

1. Start as Sara: the card has **Role: Employee** and three lines about what employees can do.
2. Start as Khalid, Dana, Tariq and Huda in other tabs: *System administrator*, *IT helpdesk*, *Security guard*, *SOC analyst*, each with its own lines. No card shows anyone else's role.
3. Join as the hacker (Omar): the card says *Employee* (his disguise); the briefing is separate.
4. As Huda (new, `h.rahman` / `Sh1eld&Coffee-19`): sit at `SOC-WS-01` in the security office, unlock, `ssh ADMIN-SRV-01`, `tail /var/log/squid/access.log` works; `ssh SEC-SRV-01`, `tail /var/log/security/alerts.log` works; `id` shows no `sudo`.

## Z. Phase 5, part B: the SIEM and the security monitors

**SIEM.** As Huda (`h.rahman` / `Sh1eld&Coffee-19`), sit at `SOC-WS-01` and unlock.

| Type | Expected |
|---|---|
| `siem` | The help: filters, steps, sources and their fields. |
| `siem source=auth since=09:00` | Logins, sudo, locks across all machines since 09:00, one per line with named fields. |
| `siem source=auth result=failure \| count by user` | A count per account of failed logins (the `\|` belongs to the SIEM, not the shell). |
| `siem source=proxy \| where bytes > 50KB \| count by domain` | Web traffic by site. |
| `siem source=dhcp client=FIN-LT-07 \| tail 3` | Which address Sara's PC had, and when. |
| `siem source=badge door=SRV-ROOM \| fields time,user,result,dir` | Who badged at the server room. |
| as Sara at her own PC: `siem source=auth` | `bash: siem: command not found` (it is installed only on the SOC PC). |

**Monitors.** As Tariq, walk from your desk to the CCTV monitors at the bottom of the security office. The hint says *Press E to use the security monitors*.

1. `E` opens the monitors. Pick a camera: a green picture of that room with a name over everybody in view. *Live* follows it; the slider and the arrows go back through the recording.
2. **Badge log**: the latest taps, newest first. **Motion log**: the camera head counts.
3. Walk away (or `Esc`): the monitors close. From anywhere else `E` does not open them.
4. With a second tab as anyone else: they receive nothing from the monitors you are using.

## AA. Phase 5, part C: the evidence board

1. As Sara at her PC, run `last -n 5`. Select one line with the mouse (or double-click a word) and press **Pin selection** in the terminal's title bar. Notice: *Pinned to the evidence board as E1.* The bottom bar shows *B Evidence (1)*.
2. Press **Pin selection** with nothing selected: *Select some text in the terminal first*.
3. In a second tab (anyone), press `B`: the board shows E1, *FIN-LT-07 screen*, *pinned by Sara Alharbi*, without a **Take down** button. In Sara's tab the button is there and works.
4. As Tariq at the security monitors: pick a camera, **Pin this picture** (the board shows the drawn picture and who was in it); on the Badge log tab, **Pin** next to a line.
5. Made-up evidence is impossible from the page: the server only accepts text, pictures and lines it showed to that player (the automated tests try it).

## AB. Phase 5, part D: meetings and voting

Shorter meetings make this quicker: start with `MEETING_SECONDS=30,20,5` (PowerShell: `$env:MEETING_SECONDS='30,20,5'; pnpm dev`). Use three tabs: Sara, Maha, and Omar.

1. As Sara, pin three things from her terminal (step AA). The bottom bar shows *Evidence (3)*.
2. As Maha, walk to the red button in the meeting room: *Press E to call an emergency meeting (1 left)*. Press `E`. Everybody is brought to the table and the meeting screen opens for all three, with a countdown. Walking does nothing.
3. Type in the meeting chat: everybody sees it.
4. As Sara: choose *Omar Farouk*, tick the three items, **Accuse**. Everybody sees *Sara Alharbi accuses Omar Farouk: E1, E2, E3*. Trying with fewer than three items is refused.
5. When voting starts, vote *Omar* as Sara and Maha, *Skip* as Omar. Result: *Omar Farouk was voted out. They were not the hacker.* Reputation drops to 75%. Omar's tab shows *YOU WERE FIRED*: arrows move his view; his chat reaches only other fired players.
6. Maha's button now says *0 left*. A meeting with no accusation ends with *Nobody was voted out.*
7. If Omar had joined as the hacker, the vote ends the match: *The hacker was caught.*

## AC. Phase 5, part E: the guard and the helpdesk

Use three tabs: Tariq (the guard), Dana (helpdesk) and Rami.

1. As Rami, walk to FIN-LT-04, log in, and stand up without locking it.
2. As Dana, sit at IT-WS-01 and log in. Type `helpdesk status`: FIN-LT-04 shows *UNLOCKED r.mansour*.
3. `helpdesk lock FIN-LT-04` prints *screen of r.mansour locked*. Rami's PC label now says *LOCKED*. On FIN-LT-04, `sudo tail /var/log/auth.log` (or the SOC analyst's `siem`) shows *REMOTE lock-session ... locked by d.aziz from* Dana's IP.
4. `helpdesk reset r.mansour` prints a new password like *Cedar-Orbit-42*. Rami's tab shows *The helpdesk reset your password*; his card (`C`) shows the new one. Unlocking FIN-LT-04 with the old password fails; the new one works. Sara's tab (if open) never sees it.
5. As anyone but Dana, `helpdesk status` on another PC: *command not found*. Dana's PC, logged in as someone else (`su k.nasser`): *not a helpdesk account*.
6. As Tariq, walk right up to Rami: *Caught Rami Mansour in the act? Press X to detain.* Press `X`: *Press X again...*. Press `X` again. With no hacker in the match, everybody sees *Tariq Omar detained Rami Mansour, who was not the hacker*. Pressing `X` twice again: *you cannot detain anyone any more*.
7. If someone had joined as the hacker and Tariq detained them, the match would end: *Tariq Omar caught NAME in the act.*

## Phase 5, part F: the simulated bot hacker

1. Start a fresh room with `BOTS=1`, `BOT_HACKER=1`, `SEED=1`, `VULNS=plaintext-password`.
   Join as a defender such as the SOC analyst. The lobby does not mark which employee is the hacker.
2. The selected bot arrives normally, does office work for two game minutes, then pursues the mission.
   In a development server, the Bots/Mission views show its identity and progress. Those views are unavailable
   in production. Investigators use the ordinary SIEM, camera/badge records and evidence board instead.
3. With no intervention, the bot must actually read the simulated flag and submit it before a hacker win is
   announced to everyone. Inspect the server authentication and audit logs: the bot's actions leave evidence.
4. A meeting pauses its movement/input; after an inconclusive meeting it can resume. Detaining it or voting
   it out ends the match for defenders. After either outcome, the controller stops and new role selection is refused.
5. Human takeover: choose the bot hacker's employee to inherit that role and its briefing, or explicitly choose
   another human hacker to stop the previous controller. Disconnecting the human allows a bot to resume later.
6. Restart with `BOT_HACKER=0`: employee bots still work, but none automatically pursues the flag. `BOTS=0`
   removes both kinds of bot. A human can still choose the hacker role in either setting.
7. Set `BOT_HACKER=1` and `BOT_HACKER_DIFFICULTY=easy` (PowerShell:
   `$env:BOT_HACKER_DIFFICULTY='easy'`), then restart. Developer panel → **mission** must show
   `bot hacker difficulty: easy`. Repeat with `normal` and `hard`; omitting the setting defaults to `normal`.
   With `SEED=1` and `VULNS=none`, Easy tests false rumours: authentication logs show a denied sudo and a failed
   admin login before it falls back to physical observation. Hard skips those unconfirmed direct attempts.
   Physical opportunities and observed credentials are still needed; no difficulty bypasses permissions.

Automated coverage: `packages/server/test/hacker.test.ts` completes direct and physical routes, checks deterministic
replay and several default seeds, verifies private data stays out of public state/messages, and exercises meetings,
helpdesk interruption, recorder removal, human handoff, detention and voting. Phase 5 I's debrief is still pending.

## AD. Phase 5, part G: bots in meetings

Use `pnpm dev` with bots (the default) and short meetings: `MEETING_SECONDS=40,25,5`. One tab: Sara.

1. Wait until the office is full (a few minutes). Walk to Rami's PC (FIN-LT-04) while he is on a break and sit down there (it is fine if it is locked). Stay until Rami comes back and cannot sit.
2. Walk to the red button and call a meeting. During the discussion, Rami says in the chat: *I saw Sara Alharbi sitting at my PC FIN-LT-04 at HH:MM, while I was away from it.* Others may say *Nothing odd on my side.*
3. Without board evidence nobody can be accused, so the meeting ends with *Nobody was voted out.* (With three pins you could accuse someone; bots then vote for that person only if they saw something themselves, otherwise they do not vote.)
4. Developer panel (`` ` ``): bots show *checking own PC* now and then; their PCs' command history (after they log out) contains `last -n 10` or `crontab -l`.

## AE. Phase 5, part H: anti-stall, reputation and parity

Quicker with `STALL_MINUTES=1` and `TIME_SPEED=10` (PowerShell: `$env:STALL_MINUTES='1'; $env:TIME_SPEED='10'; pnpm dev`). Two tabs: Omar joining **as the hacker**, and Huda (SOC analyst).

1. As Omar, log in at MKT-LT-11 and type `ssh ADMIN-SRV-01` with his password, then `exit`.
2. Wait one game minute. Every tab shows the vague *SECURITY ALERT* banner.
3. As Huda, at SOC-WS-01: `siem rule=threat-escalation`. One line: *earlier activity re-scored HIGH: ssh.accept on ADMIN-SRV-01 (account o.farouk from ...)*. It names an account and an address, never a player.
4. Each further game minute flags the next of Omar's actions, oldest first; ordinary commands (`whoami`, `ls`) never appear. With nothing new to flag, nothing more comes.
5. Reputation: each innocent person voted out costs 25 % (step AB). The fourth one, with a hacker in the match, ends it: *The company's reputation hit 0 %: too many innocent people were fired. The hacker wins.* Parity (nine wrong firings in an office of eleven) is checked by the automated tests (`endings.test.ts`).

## T. What you must NOT be able to see

1. Nothing on screen marks a bot. The start screen never shows an employee as taken because a bot plays them.
2. Your task list shows only your tasks.
3. In a production build (step K of Phase 2) the developer panel does not open, so bots, snapshots and other people's files stay hidden.

## Phase 4 H: CLI hacker support

1. Run `pnpm cli --hacker p4 --seed 42`. Expect Omar's player ID, his desk in the suggested `:sit` command,
   a hacker briefing, and the tools path. `:briefing` repeats the briefing; `:help` lists flag submission.
2. For a repeatable practice office, run `pnpm cli --hacker o.farouk --vulns plaintext-password`.
   Sit at the suggested desk, unlock it with the displayed scenario credential, and check `ls -a ~/.tools`.
3. `:flag wrong` is refused. A correct flag copied from outside this match is also refused until the hacker
   actually reads its file through the simulated terminal. After reading it, `:flag <text>` prints `You win.`.
4. Before winning, `:as p1` followed by `:briefing` or a flag submission is refused. `:as p4` restores control
   of the same hacker; it does not reroll weaknesses or transfer the role.
5. After winning, shell commands, `:sit`, `:as`, and `:time +5m` are refused. `:events` shows `mission.won`,
   `:dump` can save the finished world, and `:quit` exits. Start a new process to play again.
6. `--hacker nobody`, a missing `--hacker` value, and `--vulns unknown` each fail with a useful error.
   Plain `pnpm cli` still starts as the first employee without a hacker or weaknesses.

Automated coverage in `packages/cli/test/mission.test.ts` completes a simulated route, checks its actor/evidence,
verifies post-win immutability, and drives the real CLI executable with piped input. This does not replace
the outstanding manual check of password masking at a real interactive keyboard.

## Automated tests

```bash
pnpm test
```

Expected: `Test Files 41 passed (41)` and `Tests 462 passed (462)`. This includes CLI missions, 36 bot hacker integration tests, 5 knowledge/configuration tests, and a soak test that runs a full office of bots for three game hours.

On a busy machine, use `pnpm exec vitest run --maxWorkers=4` to limit concurrent workers. This passed the complete suite during Phase 5F validation after three existing long-running tests timed out with unrestricted workers.

```bash
pnpm e2e
```

Expected: `11 passed`. Playwright starts its own game (ports 2577 and 5183, no bots, only the plaintext-password weakness), so it does not matter whether `pnpm dev` is running. It drives a real Chromium browser (first run: `pnpm exec playwright install chromium`) and writes its screenshots to `e2e/screenshots/`.

For stability verification, run `pnpm e2e --retries=0` ten times consecutively; each must report 11 passes.
The Part E reset-mail test waits for the initial `locked` terminal state before entering the password, then
waits for `shell`. Window visibility alone can precede the first screen update.

---

# Phase 1 — the simulation in the text CLI

Type the commands in order and compare with the expected results.

```bash
pnpm cli
```

Things that will differ from the text below, and are fine:

- **Times.** Game time starts at Mon Mar 2 2026 09:00 UTC and follows the real time you take.
- **Process ids and port numbers.**

---

## 1. Start-up

The CLI prints the scenario name, the game time, and a table of ten players with usernames and passwords. The prompt is `[p1 standing] > `.

| Type | Expect |
|---|---|
| `:help` | The list of `:` commands. |
| `:hosts` | Eleven machines, with the screen states of the table at the top of this file. |

## 2. Unlock your own PC and look around (as Sara, p1)

| Type | Expect |
|---|---|
| `:sit FIN-LT-07` | `*** FIN-LT-07: screen locked by s.alharbi ***` and a `Password: ` prompt. |
| `wrong` | `Sorry, that password is incorrect.` and `Password: ` again. |
| `Riyadh2024!` | The prompt `s.alharbi@FIN-LT-07:~$ `. |
| `whoami` | `s.alharbi` |
| `id` | `uid=1001(s.alharbi) gid=1001(s.alharbi) groups=1001(s.alharbi),4(adm)` |
| `hostname` | `FIN-LT-07` |
| `ip a` | `link/ether 52:54:00:f1:07:07` and `inet 10.0.2.58/24`. |
| `pwd` | `/home/s.alharbi` |
| `ls -la` | Hidden files (`.bash_history`, `.bashrc`…), `Documents`, `notes.txt`, `todo.txt`, with owner `s.alharbi`. |
| `cat todo.txt` | Four to-do lines. |
| `grep -i overdue Documents/invoices_feb.csv` | One line: `INV-2043,Najd Catering,2300.50,2026-02-20,OVERDUE` |
| `cat Documents/*.csv \| wc -l` | `11` |
| `echo test > /tmp/a.txt && cat /tmp/a.txt` | `test` |
| `history` | Three old commands, then everything you typed. |
| `foo` | `bash: foo: command not found` |

## 3. Permissions on your own PC

| Type | Expect |
|---|---|
| `cat /etc/shadow` | `cat: /etc/shadow: Permission denied` |
| `ls /root` | `ls: cannot open directory '/root': Permission denied` |
| `ls /home/k.nasser` | `ls: cannot open directory '/home/k.nasser': Permission denied` |
| `cat nope.txt` | `cat: nope.txt: No such file or directory` |
| `cat Documents` | `cat: Documents: Is a directory` |
| `tail -n 3 /var/log/auth.log` | Works (you are in group `adm` on your own PC). The last line mentions `gkr-pam: unlocked login keyring` or your session being unlocked, and above it the failed unlock from step 2. |

## 4. ssh to the server and fail to read the flag

| Type | Expect |
|---|---|
| `ping -c 2 ADMIN-SRV-01` | Two replies from `10.0.1.10`, `0% packet loss`. |
| `nslookup ADMIN-SRV-01` | `Name: ADMIN-SRV-01.nexora.local` / `Address: 10.0.1.10` |
| `ssh s.alharbi@ADMIN-SRV-01` | `s.alharbi@ADMIN-SRV-01's password: ` |
| `oops` | `Permission denied, please try again.` and the password prompt again. |
| `Riyadh2024!` | `Welcome to Ubuntu…`, `Last login: Fri Feb 27 16:00:00 2026 from 10.0.2.58`, prompt `s.alharbi@ADMIN-SRV-01:~$ `. |
| `ls /srv/shared` | `policies  README.txt  templates` |
| `cat /root/flag.txt` | `cat: /root/flag.txt: Permission denied` |
| `sudo cat /root/flag.txt` | `[sudo] password for s.alharbi: ` |
| `Riyadh2024!` | `s.alharbi is not in the sudoers file.  This incident will be reported.` |
| `who` | `s.alharbi  pts/0  2026-03-02 09:0x (10.0.2.58)` |
| `tail -n 2 /var/log/auth.log` | `Permission denied` (you are not in `adm` on the server). |
| `cat ~/.bash_history` | Only two old lines from Friday. Today's commands are **not** there yet: history is saved when the shell exits. |
| `exit` | `logout` / `Connection to ADMIN-SRV-01 closed.` and the prompt is back to `s.alharbi@FIN-LT-07:~$ `. |

## 5. Lock and leave

| Type | Expect |
|---|---|
| `loginctl lock-session` | The lock banner and `Password: `. |
| `:leave` | `--- p1 leaves FIN-LT-07 (the screen stays as it was) ---` |
| `:hosts` | FIN-LT-07 shows `locked (s.alharbi)`. |

## 6. Investigate as the sysadmin (Khalid, p5)

| Type | Expect |
|---|---|
| `:as p5` | `You are now p5 (Khalid Nasser), standing.` |
| `:sit IT-WS-02` | Lock screen for k.nasser. |
| `Tr0ub4dor&3xK9` | `k.nasser@IT-WS-02:~$ ` |
| `ssh k.nasser@ADMIN-SRV-01` then the password | `k.nasser@ADMIN-SRV-01:~$ ` |
| `last -n 4` | First line: you, from `10.0.2.119`, `still logged in`. Second line: `s.alharbi  pts/0  10.0.2.58  Mon Mar  2 09:0x - 09:0x`. |
| `grep s.alharbi /var/log/auth.log \| tail -n 11` | In order: `Failed password for s.alharbi from 10.0.2.58`, `Accepted password for s.alharbi from 10.0.2.58` (same `sshd[pid]` and port as the failure), `session opened`, `sudo: s.alharbi : user NOT in sudoers ; TTY=pts/0 ; PWD=/home/s.alharbi ; USER=root ; COMMAND=/usr/bin/cat /root/flag.txt`, `session closed`. |
| `sudo cat /home/s.alharbi/.bash_history` then your password | Sara's commands from step 4, including `cat /root/flag.txt` and `sudo cat /root/flag.txt`, ending with `exit`. Her passwords are not in it. |
| `grep -B 4 f1:07:07 /var/lib/dhcp/dhcpd.leases` | Two leases for `10.0.2.58` with that MAC: an old one (`binding state free`) and the current one (`binding state active`). This is how an IP is tied to a device. |
| `grep -A 5 "lease 10.0.2.58" /var/lib/dhcp/dhcpd.leases \| grep hostname` | Three lines: `MKT-LT-11` once, then `FIN-LT-07` twice. The same IP belonged to a different laptop earlier. |
| `grep "Failed password" /var/log/auth.log \| grep -c invalid` | `3` (old attempts for user `admin` from 10.0.2.71, part of the starting history). |

## 7. sudo as the sysadmin

| Type | Expect |
|---|---|
| `sudo cat /root/flag.txt` | `NEXORA{r00t_0n_adm1n_srv_01}` with no password prompt, because sudo remembers the password from step 6 for 15 minutes. If more than 15 minutes passed, it asks again. |
| `sudo -l` | `(ALL : ALL) ALL` |
| `sudo -i` | Prompt `root@ADMIN-SRV-01:~# ` |
| `whoami` | `root` |
| `exit` | `logout`, back to `k.nasser@ADMIN-SRV-01:~$ ` |
| `sudo tail -n 4 /var/log/auth.log` | Your own sudo lines: `sudo: k.nasser : TTY=pts/0 ; PWD=/home/k.nasser ; USER=root ; COMMAND=…` |
| `sudo ss -tnp` | One `ESTAB` line: `10.0.1.10:22` ↔ `10.0.2.119:<port>` with `users:(("sshd",pid=…` |
| `ps aux \| grep sshd` | The listener plus `sshd: k.nasser [priv]` and `sshd: k.nasser@pts/0`. |
| `su - s.alharbi` then `wrong` | `su: Authentication failure` |
| `exit` | Back to `k.nasser@IT-WS-02:~$ ` |

## 8. Someone else's unlocked PC (Omar, p4)

| Type | Expect |
|---|---|
| `:as p4` | You are Omar, standing. |
| `:sit HR-LT-03` | **No password asked.** Prompt `l.haddad@HR-LT-03:~$ ` — Lina left her PC unlocked. |
| `whoami` | `l.haddad` |
| `touch /tmp/omar-was-here` | (nothing) |
| `:events 3` | The last events show user `l.haddad` but `[actor p4]`. Logs blame Lina; the engine knows it was Omar. |
| `ssh l.haddad@ADMIN-SRV-01` then `:leave` | You leave at the password prompt. |
| `:as p3` then `:sit HR-LT-03` | Lina finds her screen showing `l.haddad@ADMIN-SRV-01's password: ` — exactly as Omar left it. |
| `x` (three times) | `Permission denied (publickey,password).` and the normal prompt returns. |

## 9. A PC with nobody logged in (Rami, p2)

| Type | Expect |
|---|---|
| `:as p2` then `:sit FIN-LT-04` | `Ubuntu 22.04.4 LTS FIN-LT-04 tty1` and `FIN-LT-04 login: ` |
| `r.mansour` then `wrong` | `Login incorrect`, back to `login:` |
| `r.mansour` then `football7` | `Last login: Fri Feb 27 09:40:00 2026 on tty1` and `r.mansour@FIN-LT-04:~$ ` |
| `last` | Today's login `still logged in`, Friday's session, and the `reboot` line. |
| `exit` | The login prompt again. |

## 10. Time, events and saving

| Type | Expect |
|---|---|
| `:time` | The current game time. |
| `:time +2h` | `Game time is now …` two hours later. |
| `:events 5` | The last five master-log entries with id, time, host, user, source IP, type and details. |
| `:dump` | `World saved to …\dumps\nexora-small-….json` (about 1 MB). Open it: it is readable JSON. |
| `:quit` | `Bye.` |

## 11. Switch user in the CLI

| Type | Expect |
|---|---|
| `:as p5` then `:sit FIN-LT-07` | Sara's lock screen. |
| `:switch` | `(still logged in and locked: s.alharbi)` and a login prompt. |
| `k.nasser` then `Tr0ub4dor&3xK9` | `k.nasser@FIN-LT-07:~$` |
| `exit` | Sara's lock screen again. |

## 12. More things to try

- `man ssh`, `help`
- `find / -name "*.csv" 2>/dev/null`
- `stat todo.txt`, `file /usr/bin/ls`
- `chmod 600 todo.txt && ls -l todo.txt`
- `journalctl -u ssh -n 10`, `dmesg`, `crontab -l` (on IT-WS-02 as k.nasser)
- Pivot: as p1 on FIN-LT-07, `ssh k.nasser@IT-WS-02`, then from there `ssh k.nasser@ADMIN-SRV-01`. On the server, `last -n 1` shows `10.0.2.119` (IT-WS-02), not Sara's `10.0.2.58`.
- Kick an intruder: find their shell with `ps aux` on the server and `sudo kill -9 <pid>`. Their next keypress shows `Connection to ADMIN-SRV-01 closed by remote host.` and their history on the server is not saved.

## Automated tests (Phase 1)

See "Automated tests" in the Phase 2 part above.
