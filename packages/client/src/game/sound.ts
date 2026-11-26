/**
 * The game's sounds, made by the browser itself (Web Audio), so nothing has to
 * be downloaded. The rest of the game only calls `playSound('name')` and
 * `ambience(true/false)`; real recordings can replace these later by changing
 * this file alone.
 *
 * Sound can be switched off (the speaker button in the bottom bar); the choice
 * is remembered in this browser. Browsers allow sound only after the player has
 * clicked or pressed a key, which has always happened before a match starts.
 */
export type SoundName =
  | 'badge-granted' | 'badge-denied'
  | 'alert' | 'meeting' | 'ballot' | 'verdict-caught' | 'verdict-wrong' | 'verdict-none'
  | 'win' | 'lose' | 'reveal' | 'step' | 'notebook' | 'key';

/** One note: frequency (Hz), when it starts and how long it lasts (s), its wave and loudness, and where it slides to. */
interface Note { f: number; at: number; len: number; wave?: OscillatorType; gain?: number; to?: number }

const SOUNDS: Record<SoundName, Note[]> = {
  'badge-granted': [{ f: 880, at: 0, len: 0.09, wave: 'square' }, { f: 1320, at: 0.12, len: 0.12, wave: 'square' }],
  'badge-denied': [{ f: 220, at: 0, len: 0.16, wave: 'square' }, { f: 180, at: 0.19, len: 0.22, wave: 'square' }],
  // Three falling two-tone calls, like a building's alarm far away.
  alert: [0, 0.42, 0.84].flatMap((t) => [{ f: 988, at: t, len: 0.18, wave: 'sawtooth' as const, gain: 0.025 }, { f: 740, at: t + 0.19, len: 0.18, wave: 'sawtooth' as const, gain: 0.025 }]),
  // A bell: two clear tones that ring out.
  meeting: [{ f: 659, at: 0, len: 1.2, wave: 'sine', gain: 0.09 }, { f: 988, at: 0, len: 0.9, wave: 'sine', gain: 0.05 }, { f: 659, at: 0.5, len: 1.2, wave: 'sine', gain: 0.07 }],
  // A ballot dropped into the box.
  ballot: [{ f: 180, at: 0, len: 0.09, wave: 'triangle', gain: 0.12, to: 90 }],
  'verdict-caught': [523, 659, 784, 1047].map((f, i) => ({ f, at: i * 0.11, len: 0.35, wave: 'triangle' as const, gain: 0.07 })),
  'verdict-wrong': [{ f: 392, at: 0, len: 0.4, wave: 'triangle', gain: 0.08 }, { f: 311, at: 0.3, len: 0.7, wave: 'triangle', gain: 0.08 }],
  'verdict-none': [{ f: 440, at: 0, len: 0.25, wave: 'sine', gain: 0.05 }, { f: 440, at: 0.3, len: 0.25, wave: 'sine', gain: 0.05 }],
  win: [523, 659, 784, 1047, 1319].map((f, i) => ({ f, at: i * 0.13, len: 0.5, wave: 'triangle' as const, gain: 0.07 })),
  lose: [{ f: 392, at: 0, len: 0.5, wave: 'triangle', gain: 0.07 }, { f: 349, at: 0.35, len: 0.5, wave: 'triangle', gain: 0.07 }, { f: 262, at: 0.7, len: 1.1, wave: 'triangle', gain: 0.07 }],
  // A rising sweep for the secret part.
  reveal: [{ f: 220, at: 0, len: 0.7, wave: 'sine', gain: 0.06, to: 880 }, { f: 1320, at: 0.62, len: 0.6, wave: 'sine', gain: 0.04 }],
  step: [{ f: 784, at: 0, len: 0.16, wave: 'sine', gain: 0.06 }, { f: 1175, at: 0.1, len: 0.3, wave: 'sine', gain: 0.05 }],
  notebook: [{ f: 1568, at: 0, len: 0.12, wave: 'sine', gain: 0.03 }, { f: 2093, at: 0.07, len: 0.16, wave: 'sine', gain: 0.025 }],
  key: [{ f: 2600, at: 0, len: 0.012, wave: 'square', gain: 0.006 }],
};

const SETTING = 'insider-sound';
let audio: AudioContext | null = null;
let on = readSetting();
let hum: { source: AudioBufferSourceNode; volume: GainNode } | null = null;
let humWanted = false;

function readSetting(): boolean {
  try {
    return window.localStorage.getItem(SETTING) !== 'off';
  } catch {
    return true;
  }
}

function context(): AudioContext | null {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  } catch {
    return null; // no sound available (old browser, automated test): the game works without it
  }
}

/** Is sound on? */
export const soundOn = (): boolean => on;

/** Switches all sound on or off (remembered in this browser). */
export function setSound(value: boolean): void {
  on = value;
  try {
    window.localStorage.setItem(SETTING, value ? 'on' : 'off');
  } catch {
    // Not remembered; it still works for this visit.
  }
  if (!value) stopHum();
  else if (humWanted) startHum();
}

export function playSound(name: SoundName): void {
  if (!on) return;
  const ctx = context();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (const n of SOUNDS[name]) {
      const tone = ctx.createOscillator();
      const volume = ctx.createGain();
      tone.type = n.wave ?? 'sine';
      tone.frequency.setValueAtTime(n.f, now + n.at);
      if (n.to) tone.frequency.exponentialRampToValueAtTime(n.to, now + n.at + n.len);
      // A short attack and a fading tail: no clicks.
      const peak = n.gain ?? 0.04;
      volume.gain.setValueAtTime(0.0001, now + n.at);
      volume.gain.exponentialRampToValueAtTime(peak, now + n.at + Math.min(0.015, n.len / 3));
      volume.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.len);
      tone.connect(volume).connect(ctx.destination);
      tone.start(now + n.at);
      tone.stop(now + n.at + n.len + 0.02);
    }
  } catch {
    // A sound that cannot be played is not a reason to stop the game.
  }
}

/** The quiet hum of an office (air conditioning, far-away voices) while a match is on screen. */
export function ambience(wanted: boolean): void {
  humWanted = wanted;
  if (wanted && on) startHum();
  else stopHum();
}

function startHum(): void {
  if (hum) return;
  const ctx = context();
  if (!ctx) return;
  try {
    // Two seconds of soft "brown" noise, looped, with the highs taken away.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const volume = ctx.createGain();
    volume.gain.setValueAtTime(0.0001, ctx.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 2);
    source.connect(filter).connect(volume).connect(ctx.destination);
    source.start();
    hum = { source, volume };
  } catch {
    hum = null;
  }
}

function stopHum(): void {
  if (!hum || !audio) return;
  const { source, volume } = hum;
  hum = null;
  try {
    volume.gain.cancelScheduledValues(audio.currentTime);
    volume.gain.setValueAtTime(volume.gain.value, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.6);
    source.stop(audio.currentTime + 0.7);
  } catch {
    // Already stopped.
  }
}
