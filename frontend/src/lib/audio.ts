/**
 * Procedural audio engine for Newisance — all sound is synthesised at runtime
 * with the Web Audio API, so the app ships zero audio assets. It powers the
 * background music for the 3D town and the three games, plus the games' sound
 * effects (the Flappy "flap", the Truth Tower "stack", quiz hits, etc.).
 *
 * Browsers block audio until a user gesture, so the context starts suspended;
 * call {@link unlockAudio} from the first click/keypress/pointer event (the
 * {@link useMusic} hook and {@link SoundToggle} do this for you).
 *
 * Everything routes through a master → {music,sfx} gain graph so a single mute
 * toggle silences the lot. The mute state is persisted in localStorage.
 *
 * To swap in real audio files later, replace the body of {@link playSfx} with
 * sample playback and {@link startMusic} with looping `AudioBufferSourceNode`s —
 * the public API used by the rest of the app stays the same.
 */

const MUTE_KEY = 'newisance:muted'

export type TrackName = 'town' | 'flappy' | 'tower' | 'battle'
export type SfxName =
  | 'flap'
  | 'score'
  | 'crash'
  | 'correct'
  | 'wrong'
  | 'stack'
  | 'milestone'
  | 'powerup'
  | 'impact'
  | 'gameover'
  | 'click'

// ---- Context + routing -----------------------------------------------------

let ctx: AudioContext | null = null
let master: GainNode | null = null
let musicGain: GainNode | null = null
let sfxGain: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null

let muted = readMuted()
const muteListeners = new Set<(m: boolean) => void>()

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

/** Lazily build the audio graph. Returns null if Web Audio is unavailable. */
function ensureCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()

  master = ctx.createGain()
  master.gain.value = muted ? 0 : 1
  master.connect(ctx.destination)

  musicGain = ctx.createGain()
  // Background music sits well under the sound effects — it's ambience, not a
  // focal point. (SFX bus is 0.32.)
  musicGain.gain.value = 0.07
  // A gentle feedback delay gives the synth pads some space without a reverb.
  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.26
  const feedback = ctx.createGain()
  feedback.gain.value = 0.22
  musicGain.connect(master)
  musicGain.connect(delay)
  delay.connect(feedback)
  feedback.connect(delay)
  delay.connect(master)

  sfxGain = ctx.createGain()
  sfxGain.gain.value = 0.32
  sfxGain.connect(master)

  // One reusable buffer of white noise for percussive crash/impact sounds.
  const len = ctx.sampleRate * 0.5
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1

  return ctx
}

/** Resume the context from a user gesture. Safe to call repeatedly. */
export function unlockAudio() {
  const c = ensureCtx()
  if (c && c.state === 'suspended') void c.resume()
}

// ---- Mute ------------------------------------------------------------------

export function isMuted() {
  return muted
}

export function setMuted(next: boolean) {
  muted = next
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (master && ctx) {
    // Ramp to avoid clicks.
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(next ? 0 : 1, ctx.currentTime, 0.02)
  }
  muteListeners.forEach((fn) => fn(next))
}

export function toggleMuted() {
  setMuted(!muted)
}

/** Subscribe to mute changes (for the toggle UI). Returns an unsubscribe fn. */
export function onMuteChange(fn: (m: boolean) => void) {
  muteListeners.add(fn)
  return () => {
    muteListeners.delete(fn)
  }
}

// ---- Synth helpers ---------------------------------------------------------

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)

/** Play one enveloped oscillator note on the given bus. */
function tone(
  bus: GainNode,
  freq: number,
  start: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; sweepTo?: number } = {},
) {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = opts.type ?? 'triangle'
  osc.frequency.setValueAtTime(freq, start)
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, start + dur)
  const peak = opts.gain ?? 0.5
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.015, dur * 0.3))
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g)
  g.connect(bus)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

/** Play a short filtered noise burst (crashes, impacts). */
function noise(start: number, dur: number, opts: { gain?: number; freq?: number } = {}) {
  if (!ctx || !sfxGain || !noiseBuffer) return
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = opts.freq ?? 1400
  const g = ctx.createGain()
  g.gain.setValueAtTime(opts.gain ?? 0.6, start)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(sfxGain)
  src.start(start)
  src.stop(start + dur + 0.02)
}

// ---- Sound effects ---------------------------------------------------------

export function playSfx(name: SfxName) {
  const c = ensureCtx()
  if (!c || !sfxGain) return
  if (c.state === 'suspended') void c.resume()
  const t = c.currentTime
  const bus = sfxGain
  switch (name) {
    case 'flap':
      tone(bus, 480, t, 0.1, { type: 'square', gain: 0.35, sweepTo: 760 })
      break
    case 'score':
      tone(bus, midi(72), t, 0.12, { type: 'triangle', gain: 0.45 })
      tone(bus, midi(76), t + 0.08, 0.16, { type: 'triangle', gain: 0.45 })
      break
    case 'correct':
      ;[72, 76, 79, 84].forEach((n, i) => tone(bus, midi(n), t + i * 0.07, 0.18, { gain: 0.4 }))
      break
    case 'wrong':
      tone(bus, midi(55), t, 0.28, { type: 'sawtooth', gain: 0.35, sweepTo: midi(46) })
      break
    case 'stack':
      tone(bus, 180, t, 0.14, { type: 'triangle', gain: 0.6, sweepTo: 120 })
      noise(t, 0.06, { gain: 0.25, freq: 800 })
      break
    case 'milestone':
      ;[76, 81, 84, 88].forEach((n, i) => tone(bus, midi(n), t + i * 0.06, 0.22, { type: 'triangle', gain: 0.4 }))
      break
    case 'powerup':
      tone(bus, midi(64), t, 0.3, { type: 'square', gain: 0.3, sweepTo: midi(88) })
      break
    case 'impact':
      tone(bus, 140, t, 0.18, { type: 'sine', gain: 0.6, sweepTo: 60 })
      noise(t, 0.12, { gain: 0.4, freq: 1000 })
      break
    case 'crash':
      tone(bus, 200, t, 0.3, { type: 'sawtooth', gain: 0.4, sweepTo: 50 })
      noise(t, 0.28, { gain: 0.55, freq: 1200 })
      break
    case 'gameover':
      ;[72, 67, 64, 60].forEach((n, i) => tone(bus, midi(n), t + i * 0.16, 0.4, { type: 'triangle', gain: 0.4 }))
      break
    case 'click':
      tone(bus, 660, t, 0.05, { type: 'square', gain: 0.2 })
      break
  }
}

// ---- Background music ------------------------------------------------------

interface Track {
  step: number // seconds per step
  wave: OscillatorType
  melody: (number | null)[] // MIDI notes, null = rest
  bass: (number | null)[]
}

// Loopable 16-step patterns. Only the town has background music now — the games
// run on sound effects alone — but the engine stays multi-track so a calm bed
// can be dropped onto any screen later.
const TRACKS: Record<TrackName, Track> = {
  // A warm, flowing triangle arpeggio over a I–V–vi–IV progression (C–G–Am–F):
  // the gentle notes ring into each other for a soft music-box lullaby that's
  // easy to wander the town to. Bass plays the chord root on each downbeat.
  town: {
    step: 0.34,
    wave: 'triangle',
    melody: [60, 64, 67, 72, 62, 67, 71, 74, 64, 69, 72, 76, 65, 69, 72, 77],
    bass: [48, null, null, null, 43, null, null, null, 45, null, null, null, 41, null, null, null],
  },
  flappy: {
    step: 0.2,
    wave: 'square',
    melody: [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 81, 79, 76, 74],
    bass: [48, null, 48, null, 53, null, 53, null, 45, null, 45, null, 50, null, 50, null],
  },
  tower: {
    step: 0.28,
    wave: 'triangle',
    melody: [69, 72, 76, 72, 71, 74, 77, 74, 69, 72, 76, 79, 77, 76, 74, 72],
    bass: [45, null, null, null, 50, null, null, null, 43, null, null, null, 48, null, null, null],
  },
  battle: {
    step: 0.18,
    wave: 'sawtooth',
    melody: [69, 69, 76, 74, 72, 72, 79, 77, 69, 69, 76, 79, 81, 79, 77, 76],
    bass: [33, 33, 40, 40, 38, 38, 45, 45, 33, 33, 40, 40, 36, 36, 43, 43],
  },
}

let currentTrack: TrackName | null = null
let schedulerTimer: number | null = null
let stepIndex = 0
let nextStepTime = 0

const LOOKAHEAD = 0.1 // schedule this far ahead (s)
const TICK = 25 // scheduler poll interval (ms)

function scheduler() {
  if (!ctx || !musicGain || !sfxGain || !currentTrack) return
  const track = TRACKS[currentTrack]
  while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
    const i = stepIndex % track.melody.length
    const m = track.melody[i]
    const b = track.bass[i]
    if (m != null) tone(musicGain, midi(m), nextStepTime, track.step * 1.7, { type: track.wave, gain: 0.5 })
    if (b != null) tone(musicGain, midi(b), nextStepTime, track.step * 2.2, { type: 'sine', gain: 0.6 })
    nextStepTime += track.step
    stepIndex++
  }
}

/** Start (or switch to) a looping background track. No-op if already playing it. */
export function startMusic(track: TrackName) {
  const c = ensureCtx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  if (currentTrack === track && schedulerTimer != null) return
  currentTrack = track
  stepIndex = 0
  nextStepTime = c.currentTime + 0.08
  if (schedulerTimer == null) schedulerTimer = window.setInterval(scheduler, TICK)
}

/** Stop the background music (sound effects still play). */
export function stopMusic() {
  if (schedulerTimer != null) {
    window.clearInterval(schedulerTimer)
    schedulerTimer = null
  }
  currentTrack = null
}
