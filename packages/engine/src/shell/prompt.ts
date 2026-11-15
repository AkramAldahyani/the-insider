/** The shell prompt and the banner printed after a successful login. */
import { findUser } from '../auth/accounts';
import { fullStamp } from '../core/time';
import type { Host, Session, World } from '../types';

/** e.g. "s.alharbi@FIN-LT-07:~/Documents$ " - ends in "#" for root. */
export function shellPrompt(world: World, session: Session): string {
  const host = world.hosts[session.host];
  const home = findUser(host, session.user)?.home;
  let cwd = session.cwd;
  if (home && home !== '/' && (cwd === home || cwd.startsWith(`${home}/`))) cwd = `~${cwd.slice(home.length)}`;
  return `${session.user}@${host.hostname}:${cwd}${session.user === 'root' ? '#' : '$'} `;
}

/** "Welcome to Ubuntu..." plus the "Last login" line (itself a small piece of evidence). */
export function loginBanner(host: Host, session: Session): string {
  let text = 'Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 5.15.0-105-generic x86_64)\n\n';
  const previous = host.wtmp.filter((w) => w.user === session.user && w.sessionId !== session.id).pop();
  if (previous) {
    text += `Last login: ${fullStamp(previous.login)}${previous.from ? ` from ${previous.from}` : ` on ${previous.tty}`}\n`;
  }
  return text;
}
