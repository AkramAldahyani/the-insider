/** Phase 4 E: fictional mail and a fictional reset page, entirely inside one World. */
import { findUser, getCred } from '../auth/accounts';
import { sendMail } from '../commands/mail';
import { fail, type CmdCtx } from '../commands/types';
import { errText } from '../commands/util';
import { emit } from '../events/log';
import { chmod, getNode, makeDir, walk, writeFile } from '../fs/vfs';
import type { WebSite, World } from '../types';
import type { ToolDefinition } from './toolkit';

const RESET_HOST = 'password-reset.example';
const RESET_SITE: WebSite = { host: RESET_HOST, ip: '192.0.2.80', title: 'IT password reset', category: 'account' };

/** Resolves only this match's game page. No DNS, HTTP or other host I/O. */
export function phishingSite(world: World, name: string): WebSite | undefined {
  return name.toLowerCase() === RESET_HOST && world.toolkit.phishing.length > 0 ? RESET_SITE : undefined;
}

export const phish: ToolDefinition = {
  name: 'phish', summary: 'sends an in-game IT reset message to one employee', usage: 'phish USER',
  cooldownMs: 60_000, actionMs: () => 0, noise: 'low',
  traces: ['spoofed From, originating host/IP and SPF failure in the message headers', 'mail delivery log', 'DNS and proxy logs when the recipient visits', 'private result file'],
  start(c, args) {
    const recipient = args[0];
    if (args.length !== 1) return fail('usage: phish USER');
    if (!c.world.players.some((p) => p.account === recipient)) return fail('phish: choose an employee account in this match');
    if (!c.world.hosts[c.world.mail.serverHost]?.online || !c.world.hosts[c.world.web.proxyHost]?.online) return fail('phish: the simulated mail server and web proxy must be available');
    const id = c.world.mail.messages.length + 1;
    const url = `https://${RESET_HOST}/reset/${id}`;
    const home = findUser(c.host, c.cred.user)?.home;
    if (!home) return fail('phish: no home directory for this account');
    const dir = `${home}/.tools/loot`;
    const path = `${dir}/phish-${id}.txt`;
    try {
      // The result is a virtual file belonging to the account that sent the message.
      for (const folder of [`${home}/.tools`, dir]) {
        if (!getNode(c.host, folder)) {
          makeDir(c.host, folder, c.cred, c.world.time);
          chmod(c.host, folder, 0o700, c.cred, c.world.time);
        }
      }
      if (getNode(c.host, path)) return fail('phish: result file already exists');
      writeFile(c.host, path, 'Waiting for the recipient to visit.\n', c.cred, c.world.time);
      chmod(c.host, path, 0o600, c.cred, c.world.time);
    } catch (e) { return fail(`phish: ${errText(e)}`); }
    const message = sendMail(c.world, {
      from: c.cred.user, headerFrom: 'IT', to: [recipient], subject: 'IT password reset',
      body: `Please complete your account reset at:\n${url}\n`, sourceHost: c.host.hostname, sourceIp: c.host.ip,
    });
    c.world.toolkit.phishing.push({ mailId: message.id, url, recipient, host: c.host.hostname, account: c.cred.user, path, captured: false });
    return { stdout: `Reset message sent to ${recipient}. Results: ${path}\n` };
  },
};

/**
 * A GET is the game's "follow and submit" action. It uses only the recipient's
 * current scenario credential; no typed password, real form, or external endpoint.
 * Reading mail or requesting HEAD never calls this function.
 */
export function visitPhishing(c: CmdCtx, url: string): string | null {
  const message = c.world.toolkit.phishing.find((m) => m.url === url);
  if (!message) return null;
  if (message.recipient !== c.cred.user) return 'IT password reset: this request belongs to a different employee.\n';
  if (message.captured) return 'IT password reset: this request has already been received.\n';
  const credential = c.world.credentials[c.cred.user];
  const host = c.world.hosts[message.host];
  const owner = host && findUser(host, message.account);
  if (!credential || !host || !owner) return 'IT password reset: request unavailable.\n';
  try {
    const cred = getCred(host, owner.name);
    const file = walk(host, message.path, cred);
    // If the destination is no longer private to the sender, do not disclose a credential into it.
    if (file.type !== 'file' || file.owner !== message.account || (file.mode & 0o077) !== 0) return 'IT password reset: request unavailable.\n';
    writeFile(host, message.path, `${c.cred.user}:${credential.password}\n`, cred, c.world.time);
  } catch (e) { errText(e); return 'IT password reset: request unavailable.\n'; }
  message.captured = true;
  emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.host.ip, type: 'phish.submit', details: { mailId: message.mailId, url } });
  return 'IT password reset: your request has been received.\n';
}
