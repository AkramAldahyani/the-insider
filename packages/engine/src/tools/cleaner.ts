/** Removes matching lines from one virtual log, retaining evidence of the removal. */
import { fail } from '../commands/types';
import { abs, errText, readTracked, writeTracked } from '../commands/util';
import { emit } from '../events/log';
import type { ToolDefinition } from './toolkit';

export const clean: ToolDefinition = {
  name: 'clean', summary: 'removes literal matching lines from one writable simulated log', usage: 'clean LOG "TEXT"',
  cooldownMs: 30_000, actionMs: () => 0, noise: 'low',
  traces: ['a log cleared marker in the edited file', 'a log cleared event in the system journal', 'missing original lines and timestamps; the master event history is retained'],
  start(c, args) {
    if (args.length !== 2 || !args[1].trim() || /[\r\n]/.test(args[1])) return fail('usage: clean LOG "TEXT" (non-empty literal text)');
    const path = abs(c, args[0]);
    if (!path.startsWith('/var/log/') || /[\s\x00-\x1f]/.test(path)) return fail('clean: choose a file under /var/log on this simulated host');
    try {
      const original = readTracked(c, path);
      // Literal matching avoids arbitrary regular expressions and preserves untouched bytes.
      const lines = original.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      const kept = lines.filter((line) => !line.includes(args[1]));
      const removed = lines.length - kept.length;
      if (!removed) return { stdout: 'clean: no matching lines; log unchanged.\n' };
      writeTracked(c, path, kept.join(''));
      emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'log.clear', details: { path, removed } });
      return { stdout: `clean: removed ${removed} line(s) from ${path}; a log cleared trace remains.\n` };
    } catch (e) { return fail(`clean: ${errText(e)}`); }
  },
};
