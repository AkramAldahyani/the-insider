/**
 * The PC screen: an xterm.js terminal in a window over the map.
 *
 * It shows whatever the server says is on the screen of the PC the player is
 * sitting at (a lock screen, a login prompt, or a shell) and sends finished
 * lines back. See lineEditor.ts for the typing itself.
 *
 *   Esc     stand up (the PC stays exactly as it is)
 *   Ctrl+C  cancel the line / the password question
 *   F2      switch user (only on a lock screen)
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import type { TermScreen } from '@insider/shared';
import { store } from '../game/store';
import { LineEditor } from './lineEditor';

const SCREEN_LABEL: Record<TermScreen['screen'], string> = { login: 'login prompt', locked: 'screen locked', shell: 'shell' };

export function TerminalOverlay({ hostname }: { hostname: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<TermScreen | null>(null);
  const focus = useRef<() => void>(() => undefined);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 3000,
      theme: { background: '#0b0d10', foreground: '#d7dae0', cursor: '#3ecf8e', selectionBackground: '#34507a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(holder.current!);
    fit.fit();
    term.focus();
    focus.current = () => term.focus();

    const editor = new LineEditor(term, {
      onLine: (text) => store.send('term.line', { text }),
      onCancel: () => store.send('term.cancel', {}),
      onEscape: () => store.send('stand', {}),
      onSwitchUser: () => store.send('term.switchUser', {}),
    });
    const typing = term.onData((data) => editor.input(data));

    const stopListening = store.onTerm((event) => {
      if (event.kind === 'open') term.reset();
      editor.show(event.screen.output, event.screen.prompt, event.screen.masked);
      setScreen(event.screen);
    });

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      stopListening();
      typing.dispose();
      term.dispose();
    };
  }, [hostname]);

  return (
    <div className="term-backdrop" onMouseDown={() => window.setTimeout(() => focus.current(), 0)}>
      <div className="term-window" data-testid="terminal" data-screen={screen?.screen ?? ''}>
        <div className="term-title">
          <span className="term-host">{hostname}</span>
          <span className={`term-state term-state-${screen?.screen ?? 'login'}`}>{screen ? SCREEN_LABEL[screen.screen] : ''}</span>
          <span className="term-spacer" />
          {screen?.canSwitchUser && (
            <button type="button" onClick={() => store.send('term.switchUser', {})}>Switch user (F2)</button>
          )}
          <button type="button" onClick={() => store.send('stand', {})}>Stand up (Esc)</button>
        </div>
        <div className="term-body" ref={holder} />
        <div className="term-help">
          Enter: run · Ctrl+C: cancel · ↑ ↓: history · Esc: stand up — the PC stays exactly as you leave it
        </div>
      </div>
    </div>
  );
}
