/** help, man and clear. The manual pages are short on purpose: just enough to learn the command. */
import type { Handler } from './types';
import { fail } from './types';

/** name -> [one-line summary, synopsis, description] */
const MANUAL: Record<string, [string, string, string]> = {
  whoami: ['print the current user name', 'whoami', 'Shows which account your commands run as. After `su` or under `sudo` this changes.'],
  id: ['print user and group IDs', 'id [USER]', 'Shows the uid, primary group and all groups of a user. Group membership decides what you can read: members of "adm" can read logs, members of "sudo" can use sudo.'],
  groups: ['print the groups a user is in', 'groups [USER]', 'Lists group names only.'],
  hostname: ['show the system host name', 'hostname [-I] [-f]', '-I prints the IP address, -f the full domain name.'],
  ip: ['show network addresses and routes', 'ip a | ip r | ip link', '`ip a` shows the MAC address (link/ether) and IP address (inet) of this machine. The MAC identifies the device; the IP can change.'],
  pwd: ['print the current directory', 'pwd', 'Shows where you are in the filesystem.'],
  cd: ['change directory', 'cd [DIR]', '`cd` alone goes home, `cd -` goes back to the previous directory, `cd ..` goes up one level.'],
  ls: ['list directory contents', 'ls [-l] [-a] [-h] [-d] [FILE]...', '-l long format (permissions, owner, size, date); -a include hidden files (names starting with a dot); -h human-readable sizes.'],
  cat: ['print files', 'cat [-n] [FILE]...', 'Prints files one after another. -n numbers the lines. With no file, prints its standard input.'],
  head: ['print the first lines of a file', 'head [-n N] [FILE]...', 'Default is 10 lines.'],
  tail: ['print the last lines of a file', 'tail [-n N] [FILE]...', 'Default is 10 lines. `tail -n +5` prints from line 5 onward. Useful on logs: `tail -n 20 /var/log/auth.log`.'],
  less: ['view a file', 'less FILE', 'In this simulation less simply prints the file.'],
  grep: ['print lines matching a pattern', 'grep [-i] [-v] [-n] [-r] [-c] [-l] [-E] [-A N] [-B N] PATTERN [FILE]...', '-i ignore case; -v show lines that do NOT match; -n show line numbers; -r search directories recursively; -c count; -l file names only; -A N / -B N also show N lines after / before each match. Example: `grep "Failed password" /var/log/auth.log`.'],
  find: ['search for files', 'find [PATH]... [-name PATTERN] [-type f|d] [-user USER] [-maxdepth N]', 'Walks a directory tree. Example: `find / -name "*.bak" 2>/dev/null`.'],
  stat: ['show file details', 'stat FILE...', 'Shows size, owner, permissions and the three timestamps: Access (last read), Modify (content changed), Change (permissions/owner changed).'],
  file: ['guess the type of a file', 'file FILE...', 'Looks at the content and name to say what kind of file it is.'],
  echo: ['print text', 'echo [-n] [-e] [TEXT]...', 'Often used with redirection: `echo hello > note.txt`.'],
  touch: ['create an empty file or update its timestamp', 'touch FILE...', ''],
  mkdir: ['create directories', 'mkdir [-p] DIR...', '-p also creates missing parent directories.'],
  rm: ['remove files', 'rm [-r] [-f] FILE...', '-r removes directories and their contents; -f ignores missing files. There is no undo.'],
  cp: ['copy files', 'cp [-r] SOURCE... DEST', '-r copies directories.'],
  mv: ['move or rename files', 'mv SOURCE... DEST', ''],
  chmod: ['change permissions', 'chmod [-R] MODE FILE...', 'MODE is octal (644, 600, 755) or symbolic (u+x, go-r). Only the owner or root may change a file\'s mode.'],
  chown: ['change owner and group', 'chown [-R] OWNER[:GROUP] FILE...', 'Only root may do this.'],
  wc: ['count lines, words and characters', 'wc [-l] [-w] [-c] [FILE]...', 'Example: `grep Failed /var/log/auth.log | wc -l`.'],
  sort: ['sort lines', 'sort [-n] [-r] [-u] [FILE]...', ''],
  uniq: ['collapse repeated lines', 'uniq [-c] [FILE]...', 'Only neighbouring lines are compared, so sort first. -c prefixes a count.'],
  ssh: ['log in to another machine', 'ssh [USER@]HOST', 'Asks for the password of USER on HOST and opens a shell there. The login is recorded on HOST (auth.log, last) together with the IP address you came from. Type `exit` to come back.'],
  scp: ['copy files between machines', 'scp FILE USER@HOST:PATH   |   scp USER@HOST:PATH FILE', 'Copies one file over ssh. Leaves a login record on HOST.'],
  exit: ['leave the current shell', 'exit', 'Returns to the previous shell (after ssh or su), or logs out.'],
  logout: ['leave the current shell', 'logout', 'Same as exit.'],
  su: ['become another user', 'su [-] [USER]', 'Asks for the password of USER (root if not given). `su -` also moves to that user\'s home directory.'],
  sudo: ['run a command as root', 'sudo [-u USER] COMMAND   |   sudo -i   |   sudo -l', 'Asks for YOUR password. Works only if /etc/sudoers allows you. Every use is logged in /var/log/auth.log. -l lists what you may run; -i opens a root shell.'],
  last: ['show the login history', 'last [-n N] [USER]', 'Newest first. Remote logins show the source IP address. "still logged in" means the session is open now.'],
  who: ['show who is logged in', 'who', ''],
  w: ['show who is logged in and what they do', 'w', 'Includes where each user connected FROM and how long they have been idle.'],
  history: ['show the commands typed in this shell', 'history [N] | history -c', 'History is kept in memory and written to ~/.bash_history when the shell exits. Lines starting with a space are not recorded.'],
  ps: ['list processes', 'ps aux | ps -ef | ps', '`ps aux` lists every process with its owner, pid and command.'],
  kill: ['end a process', 'kill [-9] PID...', 'You may only kill your own processes unless you are root. Killing someone\'s sshd or shell process disconnects them.'],
  ss: ['show network sockets', 'ss -tnp | ss -tlnp | ss -tanp', 'Without -l: established connections (who is connected to whom). -l: listening services. -a: both. -p adds the process.'],
  netstat: ['show network connections', 'netstat -tnp | netstat -tlnp', 'Older equivalent of ss.'],
  journalctl: ['read the system journal', 'journalctl [-n N] [-u UNIT] [-k] [-r] [-g TEXT]', 'Needs root or membership of group adm. Example: `journalctl -u ssh -n 20`.'],
  dmesg: ['print kernel messages', 'dmesg', 'Hardware events since boot, such as USB devices being plugged in.'],
  crontab: ['show scheduled jobs', 'crontab -l [-u USER]', 'Lists the commands a user has scheduled to run automatically.'],
  ping: ['check that a machine answers', 'ping [-c COUNT] HOST', 'Sends COUNT (default 4) probes.'],
  curl: ['fetch a web page', 'curl [-I] [-s] URL', 'Prints the page (-I: only the response headers). Every request goes through the company web proxy, which logs it with your PC\'s IP address and your account in /var/log/squid/access.log on the proxy server. The name lookup is logged by the DNS server in /var/log/named/queries.log. The "internet" here is simulated.'],
  helpdesk: ['the IT helpdesk console', 'helpdesk status | helpdesk lock HOST | helpdesk reset USER', 'Only on the helpdesk\'s PC, for helpdesk accounts. `status` shows every PC\'s screen; `lock` locks one remotely (logged on that PC with your address); `reset` gives an account a new password (logged on the admin server).'],
  siem: ['search the logs of every machine (SOC analyst)', 'siem QUERY | siem help', 'Only on the SOC analyst\'s PC. Example: `siem source=auth result=failure | count by user`. `siem help` lists the fields and steps.'],
  mail: ['read and send internal email', 'mail | mail NUMBER | mail -s "SUBJECT" USER "BODY"', '`mail` lists your inbox; `mail 2` shows message 2 with all its headers. The "Received:" header is written by the mail server and names the machine and IP the message really came from; "From:" is only what the sender wrote. The server keeps /var/log/mail.log.'],
  nslookup: ['look up a name or an IP address', 'nslookup NAME|IP', 'Name -> IP, or IP -> name (reverse lookup).'],
  loginctl: ['control login sessions', 'loginctl lock-session | loginctl list-sessions', '`loginctl lock-session` locks this PC\'s screen. Unlocking needs your password.'],
  uname: ['print system information', 'uname [-a]', ''],
  date: ['print the current date and time', 'date', 'All times in this world are UTC.'],
  uptime: ['show how long the system has been running', 'uptime', ''],
  clear: ['clear the screen', 'clear', ''],
  help: ['list the available commands', 'help', ''],
  man: ['show the manual page of a command', 'man COMMAND', ''],
};

const help: Handler = () => {
  const names = Object.keys(MANUAL).sort();
  let out = 'Available commands (type `man COMMAND` for details):\n\n';
  for (const n of names) out += `  ${n.padEnd(12)} ${MANUAL[n][0]}\n`;
  out += '\nShell features: pipes (a | b), redirection (> >> 2> <), a ; b, a && b, a || b,\nquotes, ~ and $HOME, wildcards (* ?).\n';
  return { stdout: out };
};

const man: Handler = (_c, args) => {
  const name = args.find((a) => !a.startsWith('-'));
  if (!name) return fail('What manual page do you want?\nFor example, try \'man man\'.');
  const page = Object.hasOwn(MANUAL, name) ? MANUAL[name] : undefined;
  if (!page) return fail(`No manual entry for ${name}`, 16);
  const upper = name.toUpperCase();
  let out = `${upper}(1)                    User Commands                    ${upper}(1)\n\n`;
  out += `NAME\n       ${name} - ${page[0]}\n\nSYNOPSIS\n       ${page[1]}\n`;
  if (page[2]) out += `\nDESCRIPTION\n       ${page[2]}\n`;
  return { stdout: out };
};

/** clear: sends the ANSI codes that wipe a terminal (works in real terminals and in xterm.js). */
const clear: Handler = () => ({ stdout: '\x1b[H\x1b[2J\x1b[3J' });

export const helpCommands: Record<string, Handler> = { help, man, clear };
export const MANUAL_NAMES = Object.keys(MANUAL);

/** One manual page, for the player's notebook in the browser (the same text `help` and `man` print). */
export interface ManualPage {
  name: string;
  summary: string;
  usage: string;
  about: string;
}

/** Every manual page, sorted by name. Nothing secret: it is what `help` and `man` show anybody. */
export const manualPages = (): ManualPage[] =>
  Object.keys(MANUAL).sort().map((name) => ({ name, summary: MANUAL[name][0], usage: MANUAL[name][1], about: MANUAL[name][2] }));
