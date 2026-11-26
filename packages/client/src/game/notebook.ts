/**
 * The player's notebook: the shell commands this browser has used, kept from
 * match to match (localStorage), so that the manual page of each one is at hand
 * (the panel is ui/NotebookPanel.tsx; the pages come from the server, see the
 * `manual` message).
 *
 * Only the NAMES of commands are kept, never what was typed after them: a
 * line can hold a password or a file name nobody else should read.
 */
const KEY = 'insider-notebook';

export function readNotebook(): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string' && /^[a-z]{1,20}$/.test(x)).slice(0, 200) : [];
  } catch {
    return [];
  }
}

export function saveNotebook(names: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    // Not remembered; it still works for this visit.
  }
}

/**
 * The commands a typed line runs: the first word of every command in it
 * (after `|`, `;`, `&&`, `||`), and what follows `sudo` or `man`.
 *
 *   commandsIn('sudo grep x /var/log/auth.log | wc -l')  ->  ['sudo', 'grep', 'wc']
 */
export function commandsIn(line: string): string[] {
  const found: string[] = [];
  for (const part of line.split(/\|\||&&|[|;&]/)) {
    const words = part.trim().split(/\s+/).filter((w) => w !== '' && !w.includes('='));
    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/^["']|["']$/g, '');
      if (!/^[a-z]{1,20}$/.test(word)) break;
      found.push(word);
      // `sudo grep`, `man last`: the next word is a command too.
      if ((word !== 'sudo' && word !== 'man') || i + 1 >= words.length || words[i + 1].startsWith('-')) break;
    }
  }
  return [...new Set(found)];
}
