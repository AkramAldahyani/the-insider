/**
 * The page: start menu -> connecting -> (lobby) -> (choose an employee) -> the office.
 * All data comes from the store (game/store.ts); this file only chooses what to show.
 */
import { Suspense, lazy, useSyncExternalStore } from 'react';
import { PhaserView } from './game/PhaserView';
import { store } from './game/store';
import { ChatPanel } from './ui/ChatPanel';
import { BoardPanel } from './ui/BoardPanel';
import { DebriefPanel } from './ui/DebriefPanel';
import { CasePanel } from './ui/CasePanel';
import { RoleReveal, PartyScreen } from './ui/PartyScreen';
import { Reconnecting } from './ui/Reconnecting';
import { StartMenu } from './ui/StartMenu';
import { FiredPanel, MeetingPanel } from './ui/MeetingPanel';
import { MonitorsPanel } from './ui/MonitorsPanel';
import { TerminalOverlay } from './ui/TerminalOverlay';
import { AlertBanner, Hud, MatchOver, MissionPanel, OnboardingCard, StartScreen, TaskList } from './ui/panels';

// The developer panel is loaded only in development. `import.meta.env.DEV` is
// replaced by the word `false` in a production build, so the build tool
// removes the import and the panel's code is not shipped at all.
const DevPanel = import.meta.env.DEV ? lazy(() => import('./ui/DevPanel')) : null;

export function App() {
  const ui = useSyncExternalStore(store.subscribe, store.getUi);

  if (ui.phase === 'menu') return <StartMenu progress={ui.ladder} place={ui.place} />;
  if (ui.phase === 'connecting') return ui.reconnecting ? <Reconnecting /> : <div className="center">Connecting to the office…</div>;
  if (ui.phase === 'error') {
    return (
      <div className="center">
        <div className="error">
          <strong>Something went wrong</strong>
          <p>{ui.error}</p>
          <button type="button" onClick={() => store.leave()}>Back to the menu</button>
        </div>
      </div>
    );
  }
  if (ui.phase === 'party' && ui.party) return <><PartyScreen party={ui.party} />{ui.reconnecting && <Reconnecting />}</>;
  if (ui.phase === 'lobby') return <StartScreen ui={ui} />;

  return (
    <div className="game">
      <PhaserView />
      <Hud ui={ui} />
      {ui.seatedAt && <TerminalOverlay hostname={ui.seatedAt} />}
      <TaskList ui={ui} />
      {/* The briefing shares the right-hand side with the onboarding card: card first, then (after C) the briefing. */}
      {!ui.seatedAt && !ui.cardOpen && <MissionPanel ui={ui} />}
      {!ui.seatedAt && !ui.cardOpen && !ui.fired && <CasePanel ui={ui} />}
      {ui.monitors && !ui.seatedAt && <MonitorsPanel ui={ui} />}
      {!ui.seatedAt && <BoardPanel ui={ui} />}
      <AlertBanner ui={ui} />
      <ChatPanel ui={ui} />
      <MeetingPanel ui={ui} />
      <FiredPanel ui={ui} />
      <MatchOver ui={ui} />
      <RoleReveal ui={ui} />
      <DebriefPanel ui={ui} />
      {ui.reconnecting && <Reconnecting />}
      {ui.cardOpen && ui.card && !ui.seatedAt && <OnboardingCard card={ui.card} />}
      {DevPanel && ui.dev && ui.devOpen && (
        <Suspense fallback={null}>
          <DevPanel ui={ui} />
        </Suspense>
      )}
    </div>
  );
}
