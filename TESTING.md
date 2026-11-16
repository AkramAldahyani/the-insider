# TESTING

Manual checks for the current state of the game. Two parts:

- **Phase 2 — the office in the browser** (about ten minutes)
- **Phase 1 — the simulation in the text CLI** (about ten minutes)

Both use the same scenario. With the default seed the machines are:

| Host | Room | IP | Owner | Password | Screen at start |
|---|---|---|---|---|---|
| FIN-LT-07 | Finance | 10.0.2.58 | s.alharbi | `Riyadh2024!` | locked |
| FIN-LT-04 | Finance | 10.0.2.142 | r.mansour | `football7` | login prompt |
| HR-LT-03 | HR | 10.0.2.115 | l.haddad | `Lina@HR#2025` | **unlocked**, never locks itself |
| HR-LT-05 | HR | 10.0.2.134 | n.saleh | `Noor!Saleh#88` | locked |
| MKT-LT-09 | Marketing | 10.0.2.168 | y.khalil | `pixel1234` | **unlocked**, locks after 10 min |
| MKT-LT-11 | Marketing | 10.0.2.71 | o.farouk | `summer2025` | locked |
| IT-WS-01 | IT | 10.0.2.128 | d.aziz (helpdesk) | `H3lpdesk-Dana-42` | login prompt |
| IT-WS-02 | IT | 10.0.2.50 | k.nasser (sysadmin) | `Tr0ub4dor&3xK9` | locked |
| REC-PC-01 | Reception | 10.0.2.42 | m.yousef | `welcome2026` | locked |
| SEC-WS-01 | Security office | 10.0.2.166 | t.omar | `Falcon-Gate-7` | locked |
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

## E. Auto-lock

| Do | Expect |
|---|---|
| Unlock FIN-LT-07 again, then do not touch the keyboard for 60 seconds | The lock screen appears by itself. |
| Unlock, press `Esc`, wait 60 seconds while watching the monitor | It turns from green to amber. |
| Unlock and keep typing slowly (a key every few seconds) for more than a minute | It does not lock: typing at this keyboard counts. |

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
| `sudo grep REMOTE /var/log/auth.log` | `REMOTE unlock-session: session … of user n.saleh unlocked by k.nasser from 10.0.2.50 (pts/0)` |
| `exit`, `Esc`, look at HR-LT-05 | Green for a minute, then it locks itself again. |

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

## L. Phase 3, part A: doors and badges

1. Start as **Sara**. Walk down to the Finance door: it is a solid bar and stops you. The hint says *Press E to tap your badge at the finance door*.
2. Press `E`. You hear a beep, the bar becomes two stubs, and you can walk into the corridor. About 3 seconds later the door closes.
3. Walk along the corridor to the **Security office** door (dark red, below the corridor) and press `E`. Expected: *Access denied*, a lower beep, the reader box turns red for a moment, and you cannot walk in.
4. Walk right to the **Bathrooms** door (no box beside it). It opens by itself as you approach and closes behind you.
5. Open a second browser tab and start as **Tariq** (security guard). He starts inside the security office. Sit at `SEC-WS-01`, unlock it, then:
   ```
   ssh SEC-SRV-01
   tail /var/log/badge/access.log
   tail /var/log/badge/doors.log
   ```
   Expected: Sara's lines, for example `DOOR=FIN BADGE=0412 USER=s.alharbi RESULT=GRANTED DIR=OUT` and `DOOR=SEC-OFFICE BADGE=0412 USER=s.alharbi RESULT=DENIED DIR=IN`. Lines dated 2026-02-27 are the previous working day.
6. **Tailgating.** In a third tab start as **Khalid**. Bring Sara and Khalid to the server room door (top right of IT). Khalid presses `E`; both walk in. In Tariq's terminal, `tail -n 2 /var/log/badge/doors.log` shows `PASSAGES=2` after a single granted tap in `access.log`.
7. Sara, inside the server room, presses `E` at the door: it opens (leaving is always allowed) and `access.log` gets a line with **her** badge and `DIR=OUT`.

## Automated tests

```bash
pnpm test
```

Expected: `Test Files 15 passed (15)` and `Tests 175 passed (175)`.

```bash
pnpm e2e
```

Expected: `3 passed`. This drives a real Chromium browser (first run: `pnpm exec playwright install chromium`) and writes ten screenshots to `e2e/screenshots/`.

---

# Phase 1 — the simulation in the text CLI

Type the commands in order and compare with the expected results.

```bash
pnpm cli
```

Things that will differ from the text below, and are fine:

- **Times.** Game time starts at Mon Mar 2 2026 09:00 UTC and follows the real time you take.
- **Process ids and port numbers.**
- **Auto-lock.** If you leave a PC alone for 60 seconds its screen locks. The CLI then prints the lock screen instead of running your line; type the password and repeat the command.

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
| `last -n 4` | First line: you, from `10.0.2.50`, `still logged in`. Second line: `s.alharbi  pts/0  10.0.2.58  Mon Mar  2 09:0x - 09:0x`. |
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
| `sudo ss -tnp` | One `ESTAB` line: `10.0.1.10:22` ↔ `10.0.2.50:<port>` with `users:(("sshd",pid=…` |
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
- Pivot: as p1 on FIN-LT-07, `ssh k.nasser@IT-WS-02`, then from there `ssh k.nasser@ADMIN-SRV-01`. On the server, `last -n 1` shows `10.0.2.50` (IT-WS-02), not Sara's `10.0.2.58`.
- Kick an intruder: find their shell with `ps aux` on the server and `sudo kill -9 <pid>`. Their next keypress shows `Connection to ADMIN-SRV-01 closed by remote host.` and their history on the server is not saved.

## Automated tests (Phase 1)

See "Automated tests" in the Phase 2 part above.
