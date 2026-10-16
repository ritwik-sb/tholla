import { useEffect, useRef, useState } from 'react'
import VoiceAvatar from './VoiceAvatar'
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

  return (
    <main className="min-h-dvh max-w-md mx-auto px-6 py-10 flex flex-col">
      <h1 className="text-3xl font-bold">തൊള്ള</h1>
      <p className="text-slate-400 mt-1">Setting up your reading voices</p>

      <div className="flex -space-x-3 mt-10" aria-hidden="true">
        {featured.map(v => (
          <span key={v.id} className="rounded-full ring-4 ring-slate-900">
            <VoiceAvatar voice={v} size={60} talking={phase === 'done'} />
          </span>
        ))}
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-medium">
            {phase === 'engine' && 'Downloading the voice engine'}
            {phase === 'voices' && 'Fetching voices'}
            {phase === 'done' && 'All set'}
            {phase === 'error' && 'Download interrupted'}
          </span>
          <span className="text-sm text-slate-400 tabular-nums">{pct}%</span>
        </div>
        <div
          className="mt-3 h-2 rounded-full bg-slate-800 overflow-hidden"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full bg-indigo-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm text-slate-400 min-h-[1.25rem]" aria-live="polite">
          {phase === 'engine' && (bytes.total > 20e6 ? `${mb(bytes.loaded)} of ${mb(bytes.total)}` : 'Starting…')}
          {phase === 'voices' && `${voicesDone} of ${VOICES.length} voices`}
          {phase === 'done' && 'Everything is stored on this device. Reading works offline.'}
          {phase === 'error' && <span className="text-red-400">{error}</span>}
        </p>
      </div>

      <ul className="mt-8 space-y-3 text-sm text-slate-300">
        <li className="flex gap-3"><span aria-hidden="true">⬇</span>A one-time download. Keep this screen open; Wi-Fi recommended.</li>
        <li className="flex gap-3"><span aria-hidden="true">🔒</span>Your books never leave your device. Voices run locally.</li>
        <li className="flex gap-3"><span aria-hidden="true">⚡</span>Once set up, reading starts instantly — even offline.</li>
      </ul>

      <div className="mt-auto pt-10">
        {phase === 'done' && (
          <button onClick={onDone} className="w-full min-h-[52px] rounded-full bg-indigo-600 hover:bg-indigo-500 font-medium text-lg">
            Start listening
          </button>
        )}
        {phase === 'error' && (
          <button onClick={run} className="w-full min-h-[52px] rounded-full bg-indigo-600 hover:bg-indigo-500 font-medium text-lg">
            Try again
          </button>
        )}
      </div>
    </main>
  )
}
