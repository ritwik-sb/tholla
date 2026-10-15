import { useEffect, useRef, useState } from 'react'
import VoiceAvatar from './VoiceAvatar'
import { VOICES } from '../lib/voices'

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

  useEffect(() => { dialRef.current?.focus() }, [])

  useEffect(() => {
    if (dragging) navigator.vibrate?.(6)
  }, [selected])

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
      className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-sm"
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
        <div className="text-3xl font-semibold tracking-tight">{current.name}</div>
        <div className="text-sm text-slate-400">{current.accent} · {current.gender}</div>
      </div>

      {/* pointer notch marking the selected slot */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-[10px] border-t-indigo-400 pointer-events-none"
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
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_30%,#334155,#0f172a_70%)] border border-slate-600 shadow-[0_-10px_60px_rgba(99,102,241,0.25)]" />
        <div
          className="absolute inset-2 rounded-full opacity-40"
          style={{
            background: `repeating-conic-gradient(from ${STEP / 2 - 0.6}deg, #94a3b8 0deg 1.2deg, transparent 1.2deg ${STEP}deg)`,
            WebkitMask: 'radial-gradient(circle, transparent calc(100% - 14px), #000 calc(100% - 13px))',
            mask: 'radial-gradient(circle, transparent calc(100% - 14px), #000 calc(100% - 13px))',
            transform: `rotate(${rot}deg)`,
            transition,
          }}
          aria-hidden="true"
        />
        <div className="absolute rounded-full border border-slate-700/70" style={{ inset: d / 2 - r + 34 }} aria-hidden="true" />

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
              <div className={`rounded-full transition-shadow ${isSel ? 'ring-4 ring-indigo-400 shadow-lg shadow-indigo-500/40' : 'opacity-70'}`}>
                <VoiceAvatar voice={v} size={58} talking={isSel} />
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={commit}
        className="absolute left-1/2 -translate-x-1/2 bottom-[max(1.5rem,env(safe-area-inset-bottom))] min-h-[44px] px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-full font-medium shadow-lg"
      >
        Use {current.name}
      </button>
    </div>
  )
}
