// Mechanical switch sounds, synthesised with Web Audio (no audio files to download).
// A press is a sharp contact click plus a low "thunk" from the case; the release is
// a lighter click; detents on knobs and the voice dial are short ticks.

type Kind = 'press' | 'release' | 'tick'

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let lastTick = 0

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    ctx = new AC({ latencyHint: 'interactive' })
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function burst(c: AudioContext, at: number, freq: number, q: number, gain: number, len: number) {
  const src = c.createBufferSource()
  src.buffer = noise
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq * (0.92 + Math.random() * 0.16) // a little variation so it isn't robotic
  bp.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  src.connect(bp).connect(g).connect(c.destination)
  src.start(at)
  src.stop(at + len + 0.01)
}

function thunk(c: AudioContext, at: number, freq: number, gain: number, len: number) {
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(freq, at)
  o.frequency.exponentialRampToValueAtTime(freq * 0.6, at + len)
  const g = c.createGain()
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(g).connect(c.destination)
  o.start(at)
  o.stop(at + len + 0.01)
}

export function click(kind: Kind) {
  if (localStorage.getItem('tholla.clicks') === 'off') return
  const c = audio()
  if (!c) return
  const t = c.currentTime + 0.002
  if (kind === 'press') {
    burst(c, t, 2600, 1.4, 0.32, 0.018)
    burst(c, t + 0.006, 5200, 3, 0.12, 0.01)
    thunk(c, t, 150, 0.22, 0.06)
  } else if (kind === 'release') {
    burst(c, t, 3400, 2, 0.14, 0.012)
    thunk(c, t, 220, 0.06, 0.03)
  } else {
    // rapid detents while turning shouldn't pile up into a buzz
    const now = performance.now()
    if (now - lastTick < 28) return
    lastTick = now
    burst(c, t, 4200, 4, 0.16, 0.008)
  }
}

const CLICKABLE = '.key, .porthole, [data-click]'

/** Attach press/release sounds to every radio key in the app. */
export function initClicks() {
  let pressed: Element | null = null
  document.addEventListener('pointerdown', e => {
    const el = (e.target as Element)?.closest?.(CLICKABLE)
    if (!el || (el as HTMLButtonElement).disabled) return
    pressed = el
    click('press')
  }, { capture: true, passive: true })
  const up = () => {
    if (!pressed) return
    pressed = null
    click('release')
  }
  document.addEventListener('pointerup', up, { capture: true, passive: true })
  document.addEventListener('pointercancel', up, { capture: true, passive: true })
  document.addEventListener('keydown', e => {
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return
    const el = (e.target as Element)?.closest?.(CLICKABLE)
    if (el && !(el as HTMLButtonElement).disabled) click('press')
  }, { capture: true })
}
