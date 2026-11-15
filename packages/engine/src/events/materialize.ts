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
import type { GameEvent, Host, World } from '../types';

const str = (v: unknown) => String(v ?? '');

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
      auth('sshd', pid, `Accepted password for ${e.user} from ${from} ssh2`);
      auth('sshd', pid, `pam_unix(sshd:session): session opened for user ${e.user}(uid=${str(d.uid)}) by (uid=0)`);
      logind(`New session ${str(d.logindId)} of user ${e.user}.`);
      break;
    case 'ssh.fail':
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
      auth('login', pid, `pam_unix(login:auth): authentication failure; logname=LOGIN uid=0 euid=0 tty=/dev/tty1 ruser= rhost=  user=${e.user}`);
      auth('login', pid, `FAILED LOGIN (${str(d.attempt)}) on '/dev/tty1' FOR '${e.user}', Authentication failure`);
      break;
    case 'logout':
      auth('login', pid, `pam_unix(login:session): session closed for user ${e.user}`);
      logind(`Session ${str(d.logindId)} logged out. Waiting for processes to exit.`);
      logind(`Removed session ${str(d.logindId)}.`);
      break;

    // ── Screen lock ──
    case 'session.lock':
      logind(`Session ${str(d.logindId)} of user ${e.user} locked.`);
      break;
    case 'session.unlock':
      auth('gdm-password]', pid, 'gkr-pam: unlocked login keyring');
      logind(`Session ${str(d.logindId)} of user ${e.user} unlocked.`);
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
