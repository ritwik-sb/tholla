import { useEffect, useRef, useState } from 'react'
import VoiceAvatar from './VoiceAvatar'
import { Case, Icon, Wordmark } from './radio'
import { VOICES } from '../lib/voices'
import { kokoroDevice, loadKokoro, prefetchVoices } from '../lib/kokoro'

export const SETUP_KEY = 'tholla.setup.v1'

interface Props {
  onDone: () => void
}

type Phase = 'engine' | 'voices' | 'done' | 'error'

const mb = (n: number) => `${Math.round(n / 1e6)} MB`

export default function Setup({ onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('engine')
  const [bytes, setBytes] = useState({ loaded: 0, total: 0 })
  const [voicesDone, setVoicesDone] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [torn, setTorn] = useState(false)
  useEffect(() => { if (phase === 'done') { const t = setTimeout(() => setTorn(true), 700); return () => clearTimeout(t) } }, [phase])
  const files = useRef(new Map<string, { loaded: number; total: number }>())
  const started = useRef(false)

  const run = async () => {
    setError(null)
    setPhase('engine')
    try {
      // ask the browser not to evict the downloaded model under storage pressure
      navigator.storage?.persist?.().catch(() => {})
      await loadKokoro(p => {
        if (!p.file || p.total == null) return
        files.current.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
        let loaded = 0, total = 0
        for (const f of files.current.values()) { loaded += f.loaded; total += f.total }
        setBytes({ loaded, total })
      })
      setPhase('voices')
      await prefetchVoices(VOICES.map(v => v.id), setVoicesDone)
      localStorage.setItem(SETUP_KEY, kokoroDevice() ?? 'done')
      setPhase('done')
    } catch (e: any) {
      setError(e?.message || 'Download failed')
      setPhase('error')
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    run()
  }, [])

  // small config files finish first; wait until the model file's size is known
  const engineFrac = bytes.total > 20e6 ? bytes.loaded / bytes.total : 0
  const overall = phase === 'done' ? 1
    : phase === 'voices' ? 0.9 + 0.1 * (voicesDone / VOICES.length)
    : 0.9 * engineFrac
  const pct = Math.round(overall * 100)
  const featured = VOICES.slice(0, 5)

  const heading =
    phase === 'engine' ? 'Warming up the valves'
    : phase === 'voices' ? 'Tuning in the voices'
    : phase === 'done' ? 'Ready to play'
    : 'Signal lost'
  const detail =
    phase === 'engine' ? (bytes.total > 20e6 ? `${mb(bytes.loaded)} of ${mb(bytes.total)}` : 'Starting…')
    : phase === 'voices' ? `${voicesDone} of ${VOICES.length} voices`
    : phase === 'done' ? 'Everything is stored on this device · works offline'
    : error

  return (
    <main className="min-h-dvh flex justify-center md:p-6">
      <Case className="w-full max-w-md md:rounded-[30px] px-6 pt-9 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-6">
        <span
          className={`paper-tape ${torn ? 'rip' : ''}`}
          role="status"
          aria-live="polite"
          style={{ opacity: phase === 'done' ? 0 : 1, transform: torn ? 'translateX(-110%)' : undefined }}
        >
          NOTICE: unit is storing voice engine on disk — keep this window open
        </span>
        <Wordmark heading size="text-6xl" />
        <p className="stamp text-[10px] engraved-dark -mt-3">First-time setup</p>

        <div className="panel w-full px-6 pt-6 pb-5 flex items-end justify-center gap-8">
          <div aria-hidden="true">
            <div className="tube">
              <div className="filament" />
              <div className="glow" style={{ opacity: 0.15 + 0.85 * overall }} />
            </div>
            <div className="tube-base" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="meter w-36 h-24" aria-hidden="true">
              <div className="absolute inset-x-3 top-3 flex justify-between stamp text-[9px] text-[#4a3b26]">
                <span>0</span><span>50</span><span>100</span>
              </div>
              <div className="arm" style={{ transform: `rotate(${-55 + 110 * overall}deg)` }} />
            </div>
            <span className="stamp text-xs engraved tabular-nums" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              {pct}%
            </span>
          </div>
        </div>

        <div className="text-center" aria-live="polite">
          <p className="stamp text-base engraved">{heading}</p>
          <p className={`stamp text-[10px] mt-1 ${phase === 'error' ? 'text-red-300' : 'engraved-dark'}`}>{detail}</p>
        </div>

        <div className="flex -space-x-3" aria-hidden="true">
          {featured.map(v => (
            <span key={v.id} className="porthole p-[3px]">
              <span className="glass block"><VoiceAvatar voice={v} size={46} talking={phase === 'done'} /></span>
            </span>
          ))}
        </div>

        <ul className="w-full panel px-5 py-4 flex flex-col gap-2">
          <li className="stamp text-[10px] engraved-dark">· A one-time download — keep this screen open, Wi-Fi recommended</li>
          <li className="stamp text-[10px] engraved-dark">· Books never leave your device · voices run locally</li>
          <li className="stamp text-[10px] engraved-dark">· Once set up, reading starts instantly, even offline</li>
        </ul>

        <div className="mt-auto w-full flex justify-center">
          {phase === 'done' && (
            <button type="button" onClick={onDone} className="key dark px-8 min-h-[58px] text-base">
              <Icon name="play" /> <span className="ml-2">Start listening</span>
            </button>
          )}
          {phase === 'error' && (
            <button type="button" onClick={run} className="key px-8 min-h-[58px] text-base">Try again</button>
          )}
        </div>
      </Case>
    </main>
  )
}
