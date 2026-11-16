/**
 * `mail` - the company's internal email.
 *
 *   mail                                  list your inbox
 *   mail 3                                read message 3, with its full headers
 *   mail -s "Subject" USER "Body text"    send a message
 *   echo "Body text" | mail -s "Subject" USER
 *
 * All mail goes through one mail server (scenario: `mail.server`). Sending
 * leaves three kinds of evidence there:
 *   - a copy in the recipient's mailbox file  /var/mail/USER  (only USER and root can read it);
 *   - Postfix-style lines in                  /var/log/mail.log;
 *   - the message's own headers, which name the MACHINE and IP it was sent from.
 *
 * The headers are the forensic lesson: the "From:" line is only what the
 * sender wrote, while the "Received:" line is written by the server and says
 * where the message really came from. (Spoofing arrives with the hacker
 * toolkit in Phase 4; the fields for it, `headerFrom` vs `from`, exist already.)
 */
import { hashString } from '../core/rng';
import { emit } from '../events/log';
import type { MailMessage, World } from '../types';
import { fail, type CmdCtx, type Handler } from './types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** "Mon,  2 Mar 2026 09:12:01 +0000" - the date format of email headers. */
export function mailDate(t: number): string {
  const d = new Date(t);
  return `${DAYS[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, ' ')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`;
}

const address = (world: World, user: string) => `${user}@${world.domain}`;
/** "Sara Alharbi <s.alharbi@nexora.local>" when the name is known. */
function display(world: World, user: string): string {
  const name = world.players.find((p) => p.account === user)?.name;
  return name ? `${name} <${address(world, user)}>` : address(world, user);
}

/** The complete message as it sits in a mailbox: server-written headers first, then what the sender wrote. */
export function renderMail(world: World, m: MailMessage): string {
  const server = `mail.${world.domain}`;
  return [
    `Return-Path: <${address(world, m.from)}>`,
    `Received: from ${m.sourceHost}.${world.domain} (${m.sourceHost}.${world.domain} [${m.sourceIp}])`,
    `\tby ${server} (Postfix) with ESMTP id ${m.queueId}`,
    `\tfor <${address(world, m.to[0])}>; ${mailDate(m.time)} (UTC)`,
    `Authentication-Results: ${server}; spf=pass smtp.mailfrom=${world.domain}`,
    `Message-ID: <${m.queueId.toLowerCase()}.${m.id}@${m.sourceHost}.${world.domain}>`,
    `Date: ${mailDate(m.time)}`,
    `From: ${display(world, m.headerFrom)}`,
    `To: ${m.to.map((u) => address(world, u)).join(', ')}`,
    `Subject: ${m.subject}`,
    '',
    m.body,
    '',
  ].join('\n');
}

/**
 * Delivers a message. Used by the `mail` command and by scenario history.
 * It draws NO random numbers (the queue id is derived from the message), so
 * old mail in a scenario does not change anything else in the world.
 */
export function sendMail(world: World, input: { from: string; to: string[]; subject: string; body: string; sourceHost: string; sourceIp: string }): MailMessage {
  const id = world.mail.messages.length + 1;
  const queueId = hashString(`${id}|${world.time}|${input.from}|${input.subject}`).toString(16).toUpperCase().padStart(8, '0') + (hashString(input.body, id) % 256).toString(16).toUpperCase().padStart(2, '0');
  const message: MailMessage = { id, queueId, time: world.time, from: input.from, headerFrom: input.from, to: input.to, subject: input.subject, body: input.body, sourceHost: input.sourceHost, sourceIp: input.sourceIp, readBy: [] };
  world.mail.messages.push(message);
  emit(world, {
    host: world.mail.serverHost,
    user: input.from,
    sourceIp: input.sourceIp,
    type: 'mail.send',
    details: { id, queueId, to: input.to, subject: input.subject, size: renderMail(world, message).length, clientHost: input.sourceHost },
  });
  return message;
}

const inbox = (c: CmdCtx) => c.world.mail.messages.filter((m) => m.to.includes(c.cred.user));

const mail: Handler = (c, args, stdin) => {
  const { world } = c;
  if (!world.mail.serverHost) return fail('mail: no mail server configured');
  const me = c.cred.user;

  // ── send ──
  if (args[0] === '-s') {
    const [, subject, ...rest] = args;
    const recipients: string[] = [];
    while (rest.length > 0 && /^[a-z_][a-z0-9_.-]*(@[\w.-]+)?$/i.test(rest[0]) && recipients.length < 5) {
      const user = rest[0].split('@')[0];
      // After the first recipient, a word is another recipient only if it is a real account.
      if (recipients.length > 0 && !world.credentials[user]) break;
      recipients.push(user);
      rest.shift();
    }
    if (!subject || recipients.length === 0) return fail('Usage: mail -s "SUBJECT" USER [USER...] "BODY"   (or: echo "BODY" | mail -s "SUBJECT" USER)');
    const unknown = recipients.find((u) => !world.credentials[u]);
    if (unknown) return fail(`mail: ${unknown}@${world.domain}: no such user (the message was not sent)`);
    const body = (rest.join(' ') || stdin).trim();
    if (!body) return fail('mail: refusing to send an empty message');
    const message = sendMail(world, { from: me, to: recipients, subject, body, sourceHost: c.host.hostname, sourceIp: c.host.ip });
    return { stdout: `Message ${message.queueId} sent to ${recipients.map((u) => address(world, u)).join(', ')}\n` };
  }

  // ── read one ──
  if (args[0] !== undefined) {
    const n = Number(args[0]);
    const message = inbox(c)[n - 1];
    if (!Number.isInteger(n) || !message) return fail(`mail: no message ${args[0]} (type \`mail\` to list your inbox)`);
    if (!message.readBy.includes(me)) message.readBy.push(me);
    emit(world, { host: world.mail.serverHost, user: me, sourceIp: c.host.ip, type: 'mail.read', details: { id: message.id, clientHost: c.host.hostname } });
    return { stdout: renderMail(world, message) };
  }

  // ── list ──
  const messages = inbox(c);
  if (messages.length === 0) return { stdout: `No mail for ${me}\n` };
  const unread = messages.filter((m) => !m.readBy.includes(me)).length;
  let out = `"/var/mail/${me}": ${messages.length} message${messages.length === 1 ? '' : 's'}${unread ? ` ${unread} new` : ''}\n`;
  messages.forEach((m, i) => {
    const flag = m.readBy.includes(me) ? ' ' : 'N';
    out += `${flag}${String(i + 1).padStart(3)} ${m.headerFrom.padEnd(12)} ${mailDate(m.time).slice(0, 22)}  "${m.subject}"\n`;
  });
  out += 'Read one with: mail NUMBER\n';
  return { stdout: out };
};

export const mailCommands: Record<string, Handler> = { mail };
