import { useEffect, useRef, useState } from 'react'
import VoiceAvatar from './VoiceAvatar'
import { click } from '../lib/clicks'
import { VOICES } from '../lib/voices'
import { cancelPendingSamples, getSample, isKokoroLoaded, loadKokoro } from '../lib/kokoro'

// One shared element, unlocked by the tap that opens the dial, so mobile
// browsers allow samples to play after async generation.
let sampleAudio: HTMLAudioElement | null = null
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

export function unlockSampleAudio() {
  if (!sampleAudio) sampleAudio = new Audio()
  sampleAudio.src = SILENT_WAV
  sampleAudio.play().catch(() => {})
}

interface Props {
  value: string
  onSelect: (id: string) => void
  onClose: () => void
}

const N = VOICES.length
const STEP = 360 / N
const mod = (a: number, n: number) => ((a % n) + n) % n
const indexForRot = (rot: number) => mod(Math.round(-rot / STEP), N)

function useDialSize() {
  const calc = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const d = Math.min(Math.max(w * 1.5, 520), 760, h * 1.3)
    return { d, r: d / 2 - 46 }
  }
  const [size, setSize] = useState(calc)
  useEffect(() => {
    const on = () => setSize(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export default function VoiceDial({ value, onSelect, onClose }: Props) {
  const initialIndex = Math.max(0, VOICES.findIndex(v => v.id === value))
  const [rot, setRot] = useState(-initialIndex * STEP)
  const [dragging, setDragging] = useState(false)
  const { d, r } = useDialSize()
  const dialRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ angle: number; moved: number; x: number; y: number; target: number | null } | null>(null)
  const selected = indexForRot(rot)
  const current = VOICES[selected]

  // preventScroll: otherwise the browser scrolls the overlay to fit the (mostly off-screen) dial
  useEffect(() => { dialRef.current?.focus({ preventScroll: true }) }, [])

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    click('tick')
    if (dragging) navigator.vibrate?.(6)
  }, [selected])

  // Load the voice model while the dial is open, then play a sample when it settles.
  const [modelReady, setModelReady] = useState(isKokoroLoaded())
  const [loadPct, setLoadPct] = useState<number | null>(null)
  const [sampleState, setSampleState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const sampleToken = useRef(0)

  useEffect(() => {
    if (modelReady) return
    let alive = true
    loadKokoro(p => { if (alive && p.progress != null) setLoadPct(Math.round(p.progress)) })
      .then(() => alive && setModelReady(true))
      .catch(() => alive && setLoadPct(null))
    return () => { alive = false }
  }, [])

  const playSample = async (v: (typeof VOICES)[number]) => {
    const token = ++sampleToken.current
    sampleAudio?.pause()
    setSampleState('loading')
    try {
      const blob = await getSample(v.id, v.name)
      if (token !== sampleToken.current) return
      if (!sampleAudio) sampleAudio = new Audio()
      if (sampleAudio.src.startsWith('blob:')) URL.revokeObjectURL(sampleAudio.src)
      sampleAudio.src = URL.createObjectURL(blob)
      sampleAudio.onended = () => token === sampleToken.current && setSampleState('idle')
      setSampleState('playing')
      await sampleAudio.play()
    } catch {
      if (token === sampleToken.current) setSampleState('idle')
    }
  }

  useEffect(() => {
    if (dragging || !modelReady) return
    const t = setTimeout(() => {
      playSample(current).then(() => {
        // warm up the neighbours so turning the dial one step plays instantly
        for (const d of [1, -1]) {
          const v = VOICES[mod(selected + d, N)]
          getSample(v.id, v.name)
        }
      })
    }, 350)
    return () => clearTimeout(t)
  }, [selected, dragging, modelReady])

  useEffect(() => () => { sampleToken.current++; sampleAudio?.pause(); cancelPendingSamples() }, [])

  const center = () => {
    const rect = dialRef.current!.getBoundingClientRect()
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
  }
  const angleAt = (x: number, y: number) => {
    const { cx, cy } = center()
    return (Math.atan2(x - cx, cy - y) * 180) / Math.PI
  }

  const snap = (value: number) => Math.round(value / STEP) * STEP
  const rotateTo = (i: number) => {
    // take the shortest way round to index i
    const target = -i * STEP
    const delta = mod(target - rot + 180, 360) - 180
    setRot(snap(rot + delta))
  }

  const commit = () => {
    onSelect(current.id)
    onClose()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null
    drag.current = {
      angle: angleAt(e.clientX, e.clientY),
      moved: 0,
      x: e.clientX,
      y: e.clientY,
      target: el ? Number(el.dataset.index) : null,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x, e.clientY - g.y))
    const a = angleAt(e.clientX, e.clientY)
    const delta = mod(a - g.angle + 180, 360) - 180
    g.angle = a
    if (g.moved > 6) setRot(prev => prev + delta)
  }

  const onPointerUp = () => {
    const g = drag.current
    drag.current = null
    setDragging(false)
    if (!g) return
    if (g.moved <= 6) {
      if (g.target === null) return
      if (g.target === selected) commit()
      else rotateTo(g.target)
      return
    }
    setRot(prev => snap(prev))
  }

  const onWheel = (e: React.WheelEvent) => {
    const dir = Math.sign(e.deltaY || e.deltaX)
    if (dir) setRot(prev => snap(prev) - dir * STEP)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setRot(prev => snap(prev) - STEP) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setRot(prev => snap(prev) + STEP) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit() }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  const transition = dragging ? 'none' : 'transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.1)'

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-[radial-gradient(90%_70%_at_50%_100%,rgba(70,45,25,.75),rgba(10,7,4,.92))] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a voice"
      onPointerDown={e => { if (e.target === e.currentTarget) commit() }}
    >
      <div
        className="absolute inset-x-0 text-center pointer-events-none"
        style={{ bottom: r + 70 }}
        aria-live="polite"
      >
        <div className="brass inline-block px-6 py-1.5">
          <div className="stamp text-2xl tracking-[.14em]">{current.name}</div>
        </div>
        <div className="stamp text-[10px] mt-2 text-[var(--paint-dim)]">{current.accent} · {current.gender}</div>
        <button
          type="button"
          onClick={() => playSample(current)}
          disabled={!modelReady}
          className="key small pointer-events-auto mt-3"
        >
          {!modelReady
            ? `Loading voices${loadPct != null ? ` ${loadPct}%` : '…'}`
            : sampleState === 'loading' ? 'Preparing sample…'
            : sampleState === 'playing' ? '♪ Playing sample'
            : '▶ Hear sample'}
        </button>
      </div>

      {/* pointer notch marking the selected slot */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-[12px] border-t-[#ff4b2b] drop-shadow-[0_0_6px_rgba(255,80,40,.8)] pointer-events-none"
        style={{ bottom: r + 46 }}
        aria-hidden="true"
      />

      <div
        ref={dialRef}
        tabIndex={0}
        role="listbox"
        aria-label="Voice dial. Use arrow keys to rotate, Enter to choose, Escape to cancel."
        aria-activedescendant={`voice-opt-${current.id}`}
        className="dial-in absolute left-1/2 bottom-0 rounded-full touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-none"
        style={{ width: d, height: d, transform: 'translate(-50%, 50%)' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        {/* bakelite dial: knurled rim, brass ring, polished face */}
        <div className="absolute inset-0 rounded-full shadow-[0_-12px_50px_rgba(0,0,0,.7)]" style={{ background: 'repeating-conic-gradient(#1b130d 0deg 2deg, #3a2a1d 2deg 4deg)' }} />
        <div className="absolute rounded-full" style={{ inset: 10, background: 'radial-gradient(circle at 50% 22%, #6a4a30, #3b2717 55%, #1e130b 100%)', boxShadow: 'inset 0 2px 3px rgba(255,220,170,.25), inset 0 -10px 30px rgba(0,0,0,.6)' }} />
        <div className="absolute rounded-full" style={{ inset: d / 2 - r + 36, boxShadow: '0 0 0 3px #6e5426, 0 0 0 5px #e7c98a, 0 0 0 7px #8a6a33', background: 'radial-gradient(circle at 50% 30%, #4a3322, #24170d 70%)' }} />
        <div
          className="absolute inset-2 rounded-full opacity-40"
          style={{
            background: `repeating-conic-gradient(from ${STEP / 2 - 0.6}deg, #e7c98a 0deg 1.2deg, transparent 1.2deg ${STEP}deg)`,
            WebkitMask: 'radial-gradient(circle, transparent calc(100% - 22px), #000 calc(100% - 21px), #000 calc(100% - 12px), transparent calc(100% - 11px))',
            mask: 'radial-gradient(circle, transparent calc(100% - 22px), #000 calc(100% - 21px), #000 calc(100% - 12px), transparent calc(100% - 11px))',
            transform: `rotate(${rot}deg)`,
            transition,
          }}
          aria-hidden="true"
        />

        {VOICES.map((v, i) => {
          const a = i * STEP + rot
          const isSel = i === selected
          return (
            <div
              key={v.id}
              id={`voice-opt-${v.id}`}
              role="option"
              aria-selected={isSel}
              aria-label={`${v.name}, ${v.accent} ${v.gender}`}
              data-index={i}
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `translate(-50%, -50%) rotate(${a}deg) translateY(${-r}px) rotate(${-a}deg) scale(${isSel ? 1.3 : 0.85})`,
                transition,
              }}
            >
              <div className={`porthole p-[3px] transition-[filter] ${isSel ? 'drop-shadow-[0_0_12px_rgba(255,170,60,.55)]' : 'brightness-75'}`}>
                <span className="glass block"><VoiceAvatar voice={v} size={54} talking={isSel} still={!isSel} /></span>
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={commit}
        className="key dark absolute left-1/2 -translate-x-1/2 bottom-[max(1.5rem,env(safe-area-inset-bottom))] px-6"
      >
        Use {current.name}
      </button>
    </div>
  )
}
