/**
 * The training day's guide: a colleague's note with the step the player is at
 * (game/training.ts decides which; the store moves it on). It stays on screen
 * at the PC too, above the terminal, because most steps are typed there.
 */
import { TRAINING_STEPS } from '../game/training';
import type { UiState } from '../game/store';
import { Commands } from './panels';

export function TrainingGuide({ ui }: { ui: UiState }) {
  if (ui.solo?.mode !== 'training' || ui.training < 0 || ui.fired) return null;
  const step = TRAINING_STEPS[ui.training];
  const last = ui.training === TRAINING_STEPS.length - 1;
  return (
    <aside className={`guide ${ui.seatedAt ? 'guide-seated' : ''}`} data-testid="guide" data-step={ui.training} aria-live="polite">
      <div className="guide-head">
        <span className="guide-who">Training day · your team lead says</span>
        <span className="guide-count">{last ? 'Done' : `Step ${ui.training + 1} of ${TRAINING_STEPS.length - 1}`}</span>
      </div>
      <div className="guide-bar" aria-hidden="true"><span style={{ width: `${(ui.training / (TRAINING_STEPS.length - 1)) * 100}%` }} /></div>
      <strong className="guide-title">{step.title}</strong>
      <p className="guide-text"><Commands text={step.text} /></p>
    </aside>
  );
}
