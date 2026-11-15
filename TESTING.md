# TESTING — Phase 1 manual walkthrough

Type the commands in order and compare with the expected results. The whole tour takes about ten minutes.

Start with the default seed so the IP addresses match this document:

```bash
pnpm cli
```

Things that will differ from the text below, and are fine:

- **Times.** Game time starts at Mon Mar 2 2026 09:00 UTC and follows the real time you take.
- **Process ids and port numbers.**

Passwords are not shown while you type them. The addresses for seed 1 are:

| Host | IP | Owner | Password |
|---|---|---|---|
| FIN-LT-07 | 10.0.2.58 | s.alharbi | `Riyadh2024!` |
| FIN-LT-04 | 10.0.2.182 | r.mansour | `football7` |
| HR-LT-03 | 10.0.2.88 | l.haddad | `Lina@HR#2025` |
| MKT-LT-11 | 10.0.2.71 | o.farouk | `summer2025` |
| IT-WS-02 | 10.0.2.87 | k.nasser (sysadmin) | `Tr0ub4dor&3xK9` |
| ADMIN-SRV-01 | 10.0.1.10 | — | root: `N3x0ra-R00t-Vault!92` |

---

## 1. Start-up

The CLI prints the scenario name, the game time, and a table of five players with usernames and passwords. The prompt is `[p1 standing] > `.

| Type | Expect |
|---|---|
| `:help` | The list of `:` commands. |
| `:hosts` | Six machines. FIN-LT-07, IT-WS-02 and MKT-LT-11 are `locked`, HR-LT-03 is `UNLOCKED (l.haddad)`, FIN-LT-04 and ADMIN-SRV-01 show `login prompt`. |

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
| `last -n 4` | First line: you, from `10.0.2.87`, `still logged in`. Second line: `s.alharbi  pts/0  10.0.2.58  Mon Mar  2 09:0x - 09:0x`. |
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
| `sudo ss -tnp` | One `ESTAB` line: `10.0.1.10:22` ↔ `10.0.2.87:<port>` with `users:(("sshd",pid=…` |
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

## 11. More things to try

- `man ssh`, `help`
- `find / -name "*.csv" 2>/dev/null`
- `stat todo.txt`, `file /usr/bin/ls`
- `chmod 600 todo.txt && ls -l todo.txt`
- `journalctl -u ssh -n 10`, `dmesg`, `crontab -l` (on IT-WS-02 as k.nasser)
- Pivot: as p1 on FIN-LT-07, `ssh k.nasser@IT-WS-02`, then from there `ssh k.nasser@ADMIN-SRV-01`. On the server, `last -n 1` shows `10.0.2.87` (IT-WS-02), not Sara's `10.0.2.58`.
- Kick an intruder: find their shell with `ps aux` on the server and `sudo kill -9 <pid>`. Their next keypress shows `Connection to ADMIN-SRV-01 closed by remote host.` and their history on the server is not saved.

## Automated tests

```bash
pnpm test
```

Expected: `Test Files 9 passed (9)` and `Tests 91 passed (91)`.
