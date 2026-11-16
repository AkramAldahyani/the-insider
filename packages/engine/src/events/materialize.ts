/**
 * Turns structured events into the log lines a real Linux machine would write.
 *
 * This is the single place that decides "what evidence does action X leave,
 * and where?". The wording of each line copies real Ubuntu logs so that the
 * skills players learn transfer to real systems.
 *
 * Events that are NOT listed here (e.g. "command", "file.read") leave no log
 * line: they exist only in the master event list.
 */
import { syslog, pidOf } from './journal';
import { renderMail } from '../commands/mail';
import { fullStamp, isoSecond, syslogStamp } from '../core/time';
import { sysWrite } from '../fs/vfs';
import type { GameEvent, Host, World } from '../types';

const str = (v: unknown) => String(v ?? '');

/** The host firewall notes every new connection to the ssh port, whether or not the login then succeeds. */
function firewall(world: World, host: Host, e: GameEvent, d: Record<string, unknown>): void {
  syslog(world, host, 'kernel', null, `[UFW ALLOW] IN=eth0 OUT= MAC=${host.mac} SRC=${e.sourceIp} DST=${host.ip} LEN=60 TTL=64 PROTO=TCP SPT=${str(d.port)} DPT=22 WINDOW=64240 SYN`, 'kernel');
}

/** Appends one line to a badge-system log. Like /var/log, readable by root and group "adm". */
function badgeLog(host: Host, time: number, file: string, text: string): void {
  sysWrite(host, `/var/log/badge/${file}`, `${isoSecond(time)} ${text}\n`, { owner: 'root', group: 'adm', mode: 0o640, time, append: true });
}

export function materialize(world: World, e: GameEvent): void {
  const host: Host | undefined = world.hosts[e.host];
  if (!host) return;
  const d = e.details;
  const auth = (ident: string, pid: number | null, msg: string) => syslog(world, host, ident, pid, msg, 'auth');
  const logind = (msg: string) => auth('systemd-logind', pidOf(host, 'systemd-logind'), msg);
  const pid = Number(d.pid ?? 0);
  const from = `${e.sourceIp} port ${str(d.port)}`;
  // The "who ran sudo/su" part shared by several lines.
  const pamCaller = `logname=${e.user} uid=${str(d.uid)} euid=0 tty=/dev/${str(d.tty)} ruser=${e.user} rhost= `;
  const sudoCtx = `TTY=${str(d.tty)} ; PWD=${str(d.cwd)} ; USER=${str(d.runAs)} ; COMMAND=${str(d.command)}`;

  switch (e.type) {
    // ── badge system (files on the badge server; see physical/badges.ts) ──
    case 'badge.tap':
      badgeLog(host, world.time, 'access.log', `DOOR=${str(d.door)} BADGE=${str(d.badge)} USER=${e.user} RESULT=${d.granted ? 'GRANTED' : 'DENIED'} DIR=${str(d.direction)}`);
      break;
    case 'door.open':
      badgeLog(host, world.time, 'doors.log', `DOOR=${str(d.door)} EVENT=OPEN`);
      break;
    case 'door.close':
      badgeLog(host, world.time, 'doors.log', `DOOR=${str(d.door)} EVENT=CLOSE OPEN_FOR=${(Number(d.openMs) / 1000).toFixed(1)}s PASSAGES=${str(d.passages)}`);
      break;

    case 'cctv.motion':
      sysWrite(host, '/var/log/cctv/motion.log', `${isoSecond(world.time)} ${str(d.camera)} MOTION persons=${str(d.persons)} snapshot=${str(d.snapshot)}\n`, { owner: 'root', group: 'adm', mode: 0o640, time: world.time, append: true });
      break;

    // ── mail (files on the mail server; see commands/mail.ts) ──
    case 'mail.send': {
      const message = world.mail.messages.find((m) => m.id === d.id);
      if (!message) break;
      const domain = world.domain;
      const client = `${str(d.clientHost)}.${domain}[${e.sourceIp}]`;
      const mlog = (ident: string, text: string) => sysWrite(host, '/var/log/mail.log', `${syslogStamp(world.time)} ${host.hostname} postfix/${ident}[${pidOf(host, 'master') || 1100}]: ${text}\n`, { owner: 'syslog', group: 'adm', mode: 0o640, time: world.time, append: true });
      mlog('smtpd', `connect from ${client}`);
      mlog('smtpd', `${message.queueId}: client=${client}, sasl_username=${e.user}`);
      mlog('cleanup', `${message.queueId}: message-id=<${message.queueId.toLowerCase()}.${message.id}@${str(d.clientHost)}.${domain}>`);
      mlog('qmgr', `${message.queueId}: from=<${e.user}@${domain}>, size=${str(d.size)}, nrcpt=${message.to.length} (queue active)`);
      for (const to of message.to) {
        mlog('local', `${message.queueId}: to=<${to}@${domain}>, relay=local, delay=0.02, status=sent (delivered to mailbox)`);
        // The recipient's mailbox: "mbox" format, one file per user, readable only by that user.
        sysWrite(host, `/var/mail/${to}`, `From ${e.user}@${domain}  ${fullStamp(world.time)}\n${renderMail(world, message)}\n`, { owner: to, group: 'mail', mode: 0o600, time: world.time, append: true });
      }
      mlog('qmgr', `${message.queueId}: removed`);
      mlog('smtpd', `disconnect from ${client}`);
      break;
    }

    // ── DNS and web (files on the DNS server and on the proxy; see `curl`) ──
    case 'dns.query': {
      const dns = world.hosts[world.dnsServer];
      if (!dns || !host.ip) break;
      const dt = new Date(world.time);
      const stamp = `${String(dt.getUTCDate()).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]}-${dt.getUTCFullYear()} ${isoSecond(world.time).slice(11)}.${String(e.id % 1000).padStart(3, '0')}`;
      const name = str(d.name);
      // The query log records who ASKED and what for; it does not say whether the name exists.
      sysWrite(dns, '/var/log/named/queries.log', `${stamp} client ${host.ip}#${32768 + ((e.id * 7919) % 28000)} (${name}): query: ${name} IN ${/^\d+\.\d+\.\d+\.\d+$/.test(name) ? 'PTR' : 'A'} +E(0)K (${dns.ip})\n`, { owner: 'bind', group: 'adm', mode: 0o640, time: world.time, append: true });
      break;
    }
    case 'web.request': {
      const proxy = world.hosts[world.web.proxyHost];
      if (!proxy) break;
      // One line per request: when, which PC, which account ("-" = the system itself), what, result, size, time taken, destination.
      sysWrite(proxy, '/var/log/squid/access.log', `${isoSecond(world.time)} ${host.ip} ${e.user || '-'} ${str(d.method)} ${str(d.url)} ${str(d.status)} ${str(d.bytes)} ${str(d.ms)}ms ${Number(d.status) === 304 ? 'TCP_REFRESH_UNMODIFIED' : 'TCP_MISS'} DIRECT/${str(d.ip)}\n`, { owner: 'proxy', group: 'adm', mode: 0o640, time: world.time, append: true });
      break;
    }

    // ── boot ──
    case 'host.boot': {
      // Kernel lines get slightly increasing timestamps, like a real boot.
      const bootAt = world.time;
      let ms = 0;
      const k = (msg: string) => {
        world.time = bootAt + ms;
        ms += 137 + (msg.length % 7) * 61;
        syslog(world, host, 'kernel', null, msg, 'kernel');
      };
      k('Linux version 5.15.0-105-generic (buildd@lcy02-amd64-007) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0) #115-Ubuntu SMP');
      k('Command line: BOOT_IMAGE=/vmlinuz-5.15.0-105-generic root=/dev/sda2 ro quiet splash');
      k('DMI: Nexora Standard PC, BIOS 1.16.2 04/01/2024');
      k('Memory: 8037120K/8388608K available');
      k('usb usb1: New USB device found, idVendor=1d6b, idProduct=0002, bcdDevice= 5.15');
      k('usb usb1: Product: xHCI Host Controller');
      k(`e1000 0000:00:03.0 eth0: (PCI:33MHz:32-bit) ${host.mac}`);
      k('EXT4-fs (sda2): mounted filesystem with ordered data mode. Opts: (null). Quota mode: none.');
      k('e1000: eth0 NIC Link is Up 1000 Mbps Full Duplex, Flow Control: RX');
      world.time = bootAt;
      syslog(world, host, 'systemd', 1, `Set hostname to <${host.hostname}>.`);
      syslog(world, host, 'systemd', 1, 'Started OpenBSD Secure Shell server.');
      syslog(world, host, 'systemd', 1, 'Started Regular background program processing daemon.');
      syslog(world, host, 'systemd', 1, 'Reached target Multi-User System.');
      break;
    }

    // ── DHCP (server side on the DHCP server, client side on the host itself) ──
    case 'dhcp.ack': {
      const server = world.hosts[world.dhcp.serverHost];
      const who = `${str(d.mac)} (${e.host}) via eth0`;
      if (server) {
        const dpid = pidOf(server, 'dhcpd');
        if (d.kind === 'new') {
          syslog(world, server, 'dhcpd', dpid, `DHCPDISCOVER from ${who}`);
          syslog(world, server, 'dhcpd', dpid, `DHCPOFFER on ${str(d.ip)} to ${who}`);
        }
        syslog(world, server, 'dhcpd', dpid, `DHCPREQUEST for ${str(d.ip)} from ${who}`);
        syslog(world, server, 'dhcpd', dpid, `DHCPACK on ${str(d.ip)} to ${who}`);
      }
      const cpid = pidOf(host, 'NetworkManager') || pidOf(host, 'dhclient');
      syslog(world, host, 'NetworkManager', cpid, `<info>  dhcp4 (eth0): state changed ${d.kind === 'new' ? 'new lease' : 'renewed'}, address=${str(d.ip)}`);
      break;
    }
    case 'dhcp.release': {
      const server = world.hosts[world.dhcp.serverHost];
      if (server) {
        syslog(world, server, 'dhcpd', pidOf(server, 'dhcpd'), `DHCPRELEASE of ${str(d.ip)} from ${str(d.mac)} (${e.host}) via eth0 (found)`);
      }
      break;
    }

    // ── SSH (always logged on the TARGET host, with the SOURCE ip) ──
    case 'ssh.accept':
      firewall(world, host, e, d);
      auth('sshd', pid, `Accepted password for ${e.user} from ${from} ssh2`);
      auth('sshd', pid, `pam_unix(sshd:session): session opened for user ${e.user}(uid=${str(d.uid)}) by (uid=0)`);
      logind(`New session ${str(d.logindId)} of user ${e.user}.`);
      break;
    case 'ssh.fail':
      if (Number(d.attempt ?? 1) === 1) firewall(world, host, e, d);
      if (d.invalidUser) {
        auth('sshd', pid, `Invalid user ${e.user} from ${from}`);
        auth('sshd', pid, `Failed password for invalid user ${e.user} from ${from} ssh2`);
      } else {
        auth('sshd', pid, `pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=${e.sourceIp}  user=${e.user}`);
        auth('sshd', pid, `Failed password for ${e.user} from ${from} ssh2`);
      }
      break;
    case 'ssh.giveup':
      auth('sshd', pid, `Connection closed by authenticating user ${e.user} ${from} [preauth]`);
      break;
    case 'ssh.disconnect':
      auth('sshd', pid, `Received disconnect from ${from}:11: disconnected by user`);
      auth('sshd', pid, `Disconnected from user ${e.user} ${from}`);
      auth('sshd', pid, `pam_unix(sshd:session): session closed for user ${e.user}`);
      logind(`Session ${str(d.logindId)} logged out. Waiting for processes to exit.`);
      logind(`Removed session ${str(d.logindId)}.`);
      break;

    // ── Console login / logout ──
    case 'login.success':
      auth('login', pid, `pam_unix(login:session): session opened for user ${e.user}(uid=${str(d.uid)}) by LOGIN(uid=0)`);
      logind(`New session ${str(d.logindId)} of user ${e.user}.`);
      break;
    case 'login.fail':
      auth('login', pid, `pam_unix(login:auth): authentication failure; logname=LOGIN uid=0 euid=0 tty=/dev/${str(d.tty)} ruser= rhost=  user=${e.user}`);
      auth('login', pid, `FAILED LOGIN (${str(d.attempt)}) on '/dev/${str(d.tty)}' FOR '${e.user}', Authentication failure`);
      break;
    case 'logout':
      auth('login', pid, `pam_unix(login:session): session closed for user ${e.user}`);
      logind(`Session ${str(d.logindId)} logged out. Waiting for processes to exit.`);
      logind(`Removed session ${str(d.logindId)}.`);
      break;

    // ── Screen lock ──
    // Three ways a screen gets locked/unlocked, each with its own evidence:
    //  - by password at the keyboard  -> the gdm line (only for unlock);
    //  - by the idle timer            -> "(idle timeout ...)";
    //  - by `loginctl` over ssh       -> an extra line naming WHO asked and
    //    FROM WHICH ADDRESS. Real systemd does not log that address; we add it
    //    on purpose so a remote lock/unlock can always be traced.
    case 'session.lock':
      logind(`Session ${str(d.logindId)} of user ${e.user} locked${d.via === 'idle' ? ` (idle timeout, ${str(d.idleSeconds)}s without keyboard input)` : ''}.`);
      if (e.sourceIp) auth('loginctl', null, `REMOTE lock-session: session ${str(d.logindId)} of user ${e.user} locked by ${str(d.by)} from ${e.sourceIp} (${str(d.tty)})`);
      break;
    case 'session.unlock':
      if (d.via === 'loginctl') {
        logind(`Session ${str(d.logindId)} of user ${e.user} unlocked by request of ${str(d.by)} (no password entered).`);
        if (e.sourceIp) auth('loginctl', null, `REMOTE unlock-session: session ${str(d.logindId)} of user ${e.user} unlocked by ${str(d.by)} from ${e.sourceIp} (${str(d.tty)})`);
      } else {
        auth('gdm-password]', pid, 'gkr-pam: unlocked login keyring');
        logind(`Session ${str(d.logindId)} of user ${e.user} unlocked.`);
      }
      break;
    case 'session.switch':
      logind(`Session ${str(d.logindId)} of user ${e.user} moved to the background (switch user).`);
      break;
    case 'unlock.fail':
      auth('gdm-password]', pid, `pam_unix(gdm-password:auth): authentication failure; logname= uid=0 euid=0 tty=/dev/tty1 ruser= rhost=  user=${e.user}`);
      break;

    // ── sudo ──
    case 'sudo.exec':
      auth('sudo', null, `${e.user.padStart(8)} : ${sudoCtx}`);
      auth('sudo', null, `pam_unix(sudo:session): session opened for user ${str(d.runAs)}(uid=${str(d.runAsUid)}) by ${e.user}(uid=${str(d.uid)})`);
      auth('sudo', null, `pam_unix(sudo:session): session closed for user ${str(d.runAs)}`);
      break;
    case 'sudo.denied':
      auth('sudo', null, `${e.user.padStart(8)} : user NOT in sudoers ; ${sudoCtx}`);
      break;
    case 'sudo.fail':
      auth('sudo', null, `pam_unix(sudo:auth): authentication failure; ${pamCaller} user=${e.user}`);
      if (d.final) auth('sudo', null, `${e.user.padStart(8)} : ${str(d.attempts)} incorrect password attempts ; ${sudoCtx}`);
      break;

    // ── su ──
    case 'su.success':
      auth('su', pid, `(to ${str(d.to)}) ${e.user} on ${str(d.tty)}`);
      auth('su', pid, `pam_unix(su:session): session opened for user ${str(d.to)}(uid=${str(d.toUid)}) by ${e.user}(uid=${str(d.uid)})`);
      break;
    case 'su.fail':
      auth('su', pid, `pam_unix(su:auth): authentication failure; ${pamCaller} user=${str(d.to)}`);
      auth('su', pid, `FAILED SU (to ${str(d.to)}) ${e.user} on ${str(d.tty)}`);
      break;
    case 'su.close':
      auth('su', pid, `pam_unix(su:session): session closed for user ${str(d.to)}`);
      break;

    default:
      break;
  }
}
