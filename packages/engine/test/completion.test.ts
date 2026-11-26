/**
 * Tab completion (completeInput): commands at the start of a command, file
 * names elsewhere, only what `ls` would show this user, and no trace at all.
 */
import { describe, expect, it } from 'vitest';
import { completeInput, manualPages, commandNames } from '../src/index';
import { getNode } from '../src/fs/vfs';
import { Term, atDesk, newWorld } from './helpers';

/** Lina's PC is unlocked at the start. */
const lina = (): Term => atDesk(newWorld(), 'l.haddad');
const complete = (t: Term, text: string) => completeInput(t.world, t.id, text);

describe('Tab completion', () => {
  it('the first word becomes a command; several possibilities are listed', () => {
    const t = lina();
    expect(complete(t, 'whoa')).toEqual({ line: 'whoami ', options: [] });
    const l = complete(t, 'l');
    expect(l.line).toBe('l');
    expect(l.options).toEqual(expect.arrayContaining(['last', 'less', 'ls', 'loginctl']));
    expect(complete(t, 'journ')).toEqual({ line: 'journalctl ', options: [] });
    // After a pipe, after ; and after sudo or man a command comes again.
    expect(complete(t, 'cat todo.txt | gre').line).toBe('cat todo.txt | grep ');
    expect(complete(t, 'cat todo.txt | gr').options).toEqual(expect.arrayContaining(['grep', 'groups']));
    expect(complete(t, 'ls; hostn').line).toBe('ls; hostname ');
    expect(complete(t, 'sudo whoa').line).toBe('sudo whoami ');
    expect(complete(t, 'man jour').line).toBe('man journalctl ');
    expect(complete(t, 'nosuchcommand')).toEqual({ line: 'nosuchcommand', options: [] });
  });

  it('other words become file names: folders end in /, files in a space', () => {
    const t = lina();
    expect(complete(t, 'ls Doc').line).toBe('ls Documents/');
    expect(complete(t, 'cat Documents/onb').line).toBe('cat Documents/onboarding_checklist.txt ');
    expect(complete(t, 'cat /etc/pass').line).toBe('cat /etc/passwd ');
    expect(complete(t, 'tail /var/log/au').line).toBe('tail /var/log/auth.log ');
    expect(complete(t, 'ls ~/Doc').line).toBe('ls ~/Documents/');
    // Several: as far as they agree, and the list.
    const logs = complete(t, 'ls /var/log/');
    expect(logs.line).toBe('ls /var/log/');
    expect(logs.options).toEqual(expect.arrayContaining(['auth.log', 'syslog']));
    // Hidden files only when asked for with a dot.
    expect(complete(t, 'ls ').options.some((o) => o.startsWith('.'))).toBe(false);
    expect(complete(t, 'ls .').options.every((o) => o.startsWith('.'))).toBe(true);
  });

  it('only what this user may list, and nothing while a password is asked or the screen is locked', () => {
    const t = lina();
    expect(complete(t, 'ls /root/')).toEqual({ line: 'ls /root/', options: [] });
    expect(complete(t, 'cat /etc/shad').line).toBe('cat /etc/shadow '); // the NAME is in /etc for everybody, as with ls
    expect(complete(t, 'ls /nowhere/x')).toEqual({ line: 'ls /nowhere/x', options: [] });
    t.type('su');
    expect(t.last.awaitingInput).toBeTruthy();
    expect(complete(t, 'whoa')).toEqual({ line: 'whoa', options: [] });
    t.type('wrong');
    t.type('loginctl lock-session');
    expect(complete(t, 'whoa')).toEqual({ line: 'whoa', options: [] });
    expect(complete(t, 'x'.repeat(3000))).toEqual({ line: 'x'.repeat(3000), options: [] });
  });

  it('leaves no trace: no event, no history line, no access time', () => {
    const t = lina();
    const events = t.world.events.length;
    const host = t.world.hosts[t.host];
    const before = getNode(host, '/home/l.haddad/Documents')!.atime;
    const history = t.world.sessions[t.world.terminals[t.id].stack[0]];
    const lines = JSON.stringify(history);
    for (const text of ['cat Documents/', 'ls /var/log/', 'whoa', 'ls ~/']) complete(t, text);
    expect(t.world.events.length).toBe(events);
    expect(getNode(host, '/home/l.haddad/Documents')!.atime).toBe(before);
    expect(JSON.stringify(history)).toBe(lines);
  });

  it('the manual for the notebook has a page for every command there is', () => {
    const pages = manualPages();
    expect(pages.length).toBeGreaterThan(40);
    expect(pages.map((p) => p.name)).toEqual([...pages.map((p) => p.name)].sort());
    for (const p of pages) expect(commandNames(), p.name).toContain(p.name);
    expect(pages.find((p) => p.name === 'grep')).toMatchObject({ summary: 'print lines matching a pattern' });
  });
});
