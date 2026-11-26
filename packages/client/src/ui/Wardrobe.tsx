/**
 * The wardrobe: the rows of choices that dress the player's own character
 * (look.ts). On the home screen under the character, and in the lobby folded
 * away under "Change your look". Every change is remembered in this browser and,
 * in a lobby, shown to the others at once (store.setLook).
 */
import { LOOK_HAIR, LOOK_OUTFITS, LOOK_SKINS, LOOK_STYLES, type Look } from '@insider/shared';
import type { CSSProperties, ReactNode } from 'react';
import { characterPortrait } from '../game/characterArt';
import { store } from '../game/store';

/** One row of the wardrobe: little swatches or faces, one of them chosen. */
function Swatches({ legend, count, value, set, show, title, testid, wide = false }: {
  legend: string; count: number; value: number; set: (n: number) => void; show: (n: number) => ReactNode; title: (n: number) => string; testid: string; wide?: boolean;
}) {
  return (
    <div className={`wardrobe-row ${wide ? 'wardrobe-wide' : ''}`} role="radiogroup" aria-label={legend}>
      <span className="wardrobe-name">{legend}</span>
      <div className="wardrobe-options">
        {Array.from({ length: count }, (_, n) => (
          <button key={n} type="button" role="radio" aria-checked={n === value} title={title(n)} className={n === value ? 'swatch swatch-on' : 'swatch'} data-testid={`${testid}-${n}`} onClick={() => set(n)}>
            {show(n)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Wardrobe({ look }: { look: Look }) {
  const change = (patch: Partial<Look>) => store.setLook({ ...look, ...patch });
  const dot = (color: string) => <span className="swatch-dot" style={{ background: color } as CSSProperties} />;
  return (
    <div className="wardrobe" data-testid="wardrobe">
      <Swatches legend="Hair" count={LOOK_STYLES.length} value={look.style} testid="look-style" title={(n) => LOOK_STYLES[n]} set={(style) => change({ style })}
        show={(n) => <img src={characterPortrait('look', '', { ...look, style: n })} alt="" width="32" height="32" />} />
      <Swatches legend="Skin" count={LOOK_SKINS.length} value={look.skin} testid="look-skin" title={(n) => `Skin ${n + 1}`} set={(skin) => change({ skin })} show={(n) => dot(LOOK_SKINS[n])} />
      <Swatches legend="Hair colour" count={LOOK_HAIR.length} value={look.hair} testid="look-hair" title={(n) => `Hair colour ${n + 1}`} set={(hair) => change({ hair })} show={(n) => dot(LOOK_HAIR[n])} />
      <Swatches legend="Jacket" count={LOOK_OUTFITS.length} value={look.outfit} testid="look-outfit" wide title={(n) => `Jacket ${n + 1}`} set={(outfit) => change({ outfit })} show={(n) => dot(LOOK_OUTFITS[n])} />
      <label className="wardrobe-row wardrobe-glasses">
        <span className="wardrobe-name">Glasses</span>
        <input type="checkbox" data-testid="look-glasses" checked={look.glasses} onChange={(e) => change({ glasses: e.target.checked })} />
      </label>
      <p className="wardrobe-note">Friends see this character in the lobby. In a match only you see it; the others see the employee you play, so nobody can tell who is a person.</p>
    </div>
  );
}
