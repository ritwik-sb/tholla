import { useRef, type ReactNode } from 'react'
import { click } from '../lib/clicks'

const RIVETS = 14

export function Case({ children, className = '', rivets = true }: { children: ReactNode; className?: string; rivets?: boolean }) {
  return (
    <div className={`radio-case ${className}`}>
      {/* rust weeping from the screws and a couple of rivets */}
      <span className="streak" style={{ top: 24, left: 20, height: 110 }} aria-hidden="true" />
      <span className="streak" style={{ top: 24, right: 14, height: 70, opacity: 0.6 }} aria-hidden="true" />
      {rivets && (
        <>
          <span className="streak" style={{ top: 22, left: '37%', height: 54, width: 8, opacity: 0.55 }} aria-hidden="true" />
          <span className="streak" style={{ top: 22, left: '71%', height: 80, width: 9, opacity: 0.7 }} aria-hidden="true" />
          <div className="rivets top" aria-hidden="true">{Array.from({ length: RIVETS }, (_, i) => <span key={i} className="rivet" />)}</div>
          <div className="rivets bottom" aria-hidden="true">{Array.from({ length: RIVETS }, (_, i) => <span key={i} className="rivet" />)}</div>
        </>
      )}
      <span className="screw tl" aria-hidden="true" />
      <span className="screw tr" aria-hidden="true" />
      <span className="screw bl" aria-hidden="true" />
      <span className="screw br" aria-hidden="true" />
      {children}
    </div>
  )
}

export function Grille({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`grille panel ${className}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="slot" />)}
    </div>
  )
}

export function Wordmark({ size = 'text-4xl', heading = false }: { size?: string; heading?: boolean }) {
  const Tag = heading ? 'h1' : 'span'
  return (
    <div className="nameplate inline-block">
      <Tag className={`wordmark cut-paint ${size}`}>
        <span className="cut">തൊള്ള</span>
        <span className="paint" aria-hidden="true">തൊള്ള</span>
      </Tag>
    </div>
  )
}

const paths = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  stop: 'M6 6h12v12H6z',
  prev: 'M6 6h2v12H6zM9.5 12l8.5 6V6z',
  next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
  eject: 'M5 17h14v2H5zM12 5l7 9H5z',
  back: 'M15 5l-7 7 7 7',
} as const

export function Icon({ name }: { name: keyof typeof paths }) {
  const stroke = name === 'back'
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill={stroke ? 'none' : 'currentColor'} stroke={stroke ? 'currentColor' : 'none'} strokeWidth={stroke ? 3 : 0} strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  )
}

const SWEEP = 270 // degrees of travel, centred on 12 o'clock

/** A knurled rotary knob that snaps to a fixed set of positions. Tap to step, drag to turn. */
export function Knob({
  values, value, onChange, label, format = String, size = 84,
}: {
  values: number[]
  value: number
  onChange: (v: number) => void
  label: string
  format?: (v: number) => string
  size?: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ moved: boolean; x: number; y: number } | null>(null)
  const index = Math.max(0, values.indexOf(value))
  const change = (v: number) => { if (v !== value) { click('tick'); onChange(v) } }
  const angleOf = (i: number) => -SWEEP / 2 + (SWEEP * i) / (values.length - 1)

  const pick = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect()
    const deg = (Math.atan2(clientX - (r.left + r.width / 2), (r.top + r.height / 2) - clientY) * 180) / Math.PI
    let best = 0
    values.forEach((_, i) => { if (Math.abs(angleOf(i) - deg) < Math.abs(angleOf(best) - deg)) best = i })
    change(values[best])
  }

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div className="relative" style={{ width: size + 40, height: size + 34 }}>
        {values.map((v, i) => {
          const a = (angleOf(i) * Math.PI) / 180
          const rr = size / 2 + 13
          return (
            <span
              key={v}
              className={`absolute stamp text-[10px] tracking-normal -translate-x-1/2 -translate-y-1/2 ${i === index ? 'engraved' : 'engraved-dark'}`}
              style={{ left: (size + 40) / 2 + Math.sin(a) * rr, top: (size + 34) / 2 + 4 - Math.cos(a) * rr }}
              aria-hidden="true"
            >
              {format(v)}
            </span>
          )
        })}
        <div
          ref={ref}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={values[0]}
          aria-valuemax={values[values.length - 1]}
          aria-valuenow={value}
          aria-valuetext={format(value)}
          className="knob absolute"
          style={{ width: size, height: size, left: 20, top: 21 }}
          onPointerDown={e => {
            drag.current = { moved: false, x: e.clientX, y: e.clientY }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={e => {
            const d = drag.current
            if (!d) return
            if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return
            d.moved = true
            pick(e.clientX, e.clientY)
          }}
          onPointerUp={() => {
            const d = drag.current
            drag.current = null
            if (d && !d.moved) change(values[(index + 1) % values.length])
          }}
          onPointerCancel={() => { drag.current = null }}
          onKeyDown={e => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); change(values[Math.min(values.length - 1, index + 1)]) }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); change(values[Math.max(0, index - 1)]) }
          }}
        >
          <div className="pointer" style={{ transform: `rotate(${angleOf(index)}deg)` }} />
        </div>
      </div>
      <span className="stamp text-[10px] engraved -mt-2">{label}</span>
    </div>
  )
}

export function SerialPlate() {
  return (
    <div className="serial" aria-hidden="true">
      <span className="stamp text-[9px] tracking-[.25em]">Ser. No. 0082 · Type K-82</span>
      <span className="stamp text-[8px] tracking-[.3em] opacity-80">Made in Kerala · 220 V ~ 50 c/s</span>
    </div>
  )
}
