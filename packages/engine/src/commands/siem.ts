/**
 * `siem` - the SOC analyst's search over every machine's logs (see security/siem.ts).
 *
 * It is installed only on machines that have /etc/siem.conf (the SOC
 * analyst's PC in the sample office). Anywhere else the shell does not know
 * it, like any program that is not installed. Whoever sits at that PC can use
 * it; every search is recorded in the master log for the debrief.
 */
import { emit } from '../events/log';
import { getNode } from '../fs/vfs';
import { SIEM_HELP, siemQuery } from '../security/siem';
import { fail, type Handler } from './types';

const siem: Handler = (c, args) => {
  if (!getNode(c.host, '/etc/siem.conf')) return fail('bash: siem: command not found', 127);
  const query = args.join(' ').trim();
  if (!query || query === 'help' || query === '--help') return { stdout: SIEM_HELP };
  const result = siemQuery(c.world, query);
  emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'siem.query', details: { query, matched: result.matched } });
  if (result.error) return fail(result.error);
  return { stdout: result.text };
};

export const siemCommands: Record<string, Handler> = { siem };
