/**
 * Sound placeholders.
 *
 * Real sounds arrive with the art in Phase 7 (DESIGN.md section 13). Until
 * then each sound is a short beep made by the browser itself, so nothing has
 * to be downloaded. The rest of the game only calls `playSound('name')`;
 * swapping the beeps for audio files later changes this file alone.
 */
type SoundName = 'badge-granted' | 'badge-denied';

/** [frequency in Hz, length in seconds] of each beep, played one after another. */
const BEEPS: Record<SoundName, [number, number][]> = {
  'badge-granted': [[880, 0.09], [1320, 0.12]],
  'badge-denied': [[220, 0.16], [180, 0.22]],
};

let audio: AudioContext | null = null;

export function playSound(name: SoundName): void {
  try {
    // Browsers only allow sound after the user has pressed a key or clicked,
    // which has always happened by the time someone taps a badge.
    audio ??= new AudioContext();
    let at = audio.currentTime;
    for (const [frequency, seconds] of BEEPS[name]) {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = 'square';
      tone.frequency.value = frequency;
      volume.gain.value = 0.04;
      tone.connect(volume).connect(audio.destination);
      tone.start(at);
      tone.stop(at + seconds);
      at += seconds + 0.03;
    }
  } catch {
    // No sound available (old browser, automated test): the game works without it.
  }
}
