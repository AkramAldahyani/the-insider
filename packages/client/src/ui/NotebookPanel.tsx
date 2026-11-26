/**
 * The notebook (H): every shell command this browser has used, with what its
 * manual says, and the ones not tried yet. Kept from match to match
 * (game/notebook.ts). It is open beside the terminal too, where it helps most.
 */
import { useState } from 'react';
import { store, type UiState } from '../game/store';
import { Commands } from './panels';

export function NotebookPanel({ ui }: { ui: UiState }) {
  const [open, setOpen] = useState('');
  if (!ui.notebookOpen) return null;
  const learned = ui.manual.filter((p) => ui.notebook.includes(p.name));
  const rest = ui.manual.filter((p) => !ui.notebook.includes(p.name));
  const shown = ui.manual.find((p) => p.name === open);
  return (
    <aside className={`notebook ${ui.seatedAt ? 'notebook-seated' : ''}`} data-testid="notebook" aria-label="Notebook">
      <div className="notebook-head">
        <span>NOTEBOOK · {learned.length} OF {ui.manual.length} COMMANDS</span>
        <button type="button" onClick={() => store.set({ notebookOpen: false })} aria-label="Close notebook">×</button>
      </div>
      {ui.manual.length === 0 && <p className="notebook-empty">The manual arrives when you are in a match.</p>}
      {ui.manual.length > 0 && learned.length === 0 && <p className="notebook-empty">Nothing yet. Every command you type at a PC is written down here, with what it does.</p>}
      <ul className="notebook-pages">
        {learned.map((p) => (
          <li key={p.name} data-testid={`notebook-${p.name}`}>
            <code className="notebook-name">{p.name}</code> <span>{p.summary}</span>
            <code className="notebook-usage">{p.usage}</code>
            {p.about && <p><Commands text={p.about} /></p>}
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <>
          <div className="notebook-sub">Not tried yet (click one to read about it)</div>
          <div className="notebook-rest">
            {rest.map((p) => (
              <button key={p.name} type="button" aria-pressed={open === p.name} title={p.summary} onClick={() => setOpen(open === p.name ? '' : p.name)}>{p.name}</button>
            ))}
          </div>
          {shown && !ui.notebook.includes(shown.name) && (
            <div className="notebook-preview" data-testid="notebook-preview">
              <code className="notebook-name">{shown.name}</code> <span>{shown.summary}</span>
              <code className="notebook-usage">{shown.usage}</code>
              {shown.about && <p><Commands text={shown.about} /></p>}
            </div>
          )}
        </>
      )}
      <p className="notebook-foot">At a PC: <kbd>Tab</kbd> completes commands and file names, <code>man NAME</code> shows a page.</p>
    </aside>
  );
}
