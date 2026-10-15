import { useEffect, useRef, useState } from 'react'
import { saveProgress, getProgress } from '../lib/storage'
import { splitSentences } from '../lib/sentences'
import { loadKokoro, generateSentence } from '../lib/kokoro'
import type { Book, Engine } from '../types'

interface Props {
  book: Book
  onBack: () => void
}

export default function Reader({ book, onBack }: Props) {
  const sentences = useRef(splitSentences(book.text))
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [engine, setEngine] = useState<Engine>('webspeech')
  const [speed, setSpeed] = useState(1)
  const [voice, setVoice] = useState('')
  const [wsVoices, setWsVoices] = useState<SpeechSynthesisVoice[]>([])
  const [kokoroVoices, setKokoroVoices] = useState<string[]>([])
  const [kokoroReady, setKokoroReady] = useState(false)
  const [kokoroLoading, setKokoroLoading] = useState(false)
  const [kokoroProgress, setKokoroProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playingRef = useRef(false)
  const idxRef = useRef(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const total = sentences.current.length

  useEffect(() => {
    idxRef.current = idx
  }, [idx])

  // load progress
  useEffect(() => {
    let cancelled = false
    getProgress(book.id).then(p => {
      if (!cancelled) { setIdx(p); idxRef.current = p }
    })
    return () => { cancelled = true }
  }, [book.id])

  // web speech voices
  useEffect(() => {
    const load = () => {
      const vs = window.speechSynthesis?.getVoices() || []
      if (vs.length) {
        setWsVoices(vs)
        if (!voice) {
          const prefer = vs.find(v => /samantha|alex|jenny|aria|zira/i.test(v.name)) || vs.find(v => v.lang.startsWith('en')) || vs[0]
          if (prefer) setVoice(prefer.name)
        }
      }
    }
    load()
    window.speechSynthesis?.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load)
  }, [])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel()
      audioRef.current?.pause()
      if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src)
      saveProgress(book.id, idxRef.current)
    }
  }, [book.id])

  // scroll active sentence
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-i="${idx}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [idx])

  const stop = () => {
    playingRef.current = false
    setPlaying(false)
    window.speechSynthesis?.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    saveProgress(book.id, idxRef.current)
  }

  const speakWS = (i: number) => {
    if (!playingRef.current || i >= total) { stop(); return }
    setIdx(i); idxRef.current = i
    const u = new SpeechSynthesisUtterance(sentences.current[i])
    const v = wsVoices.find(x => x.name === voice)
    if (v) u.voice = v
    u.rate = speed
    u.onend = () => { if (playingRef.current) speakWS(i + 1) }
    u.onerror = () => { if (playingRef.current) speakWS(i + 1) }
    window.speechSynthesis.speak(u)
  }

  const speakKokoro = async (i: number) => {
    if (!playingRef.current || i >= total) { stop(); return }
    setIdx(i); idxRef.current = i
    try {
      const blob = await generateSentence(sentences.current[i], voice || 'af_heart', speed)
      if (!playingRef.current) return
      const url = URL.createObjectURL(blob)
      const a = new Audio(url)
      audioRef.current = a
      a.onended = () => { URL.revokeObjectURL(url); if (playingRef.current) speakKokoro(i + 1) }
      a.onerror = () => { URL.revokeObjectURL(url); if (playingRef.current) speakKokoro(i + 1) }
      await a.play()
    } catch (e: any) {
      setError(e?.message || 'TTS error')
      if (playingRef.current) speakKokoro(i + 1)
    }
  }

  const play = async () => {
    // resume if paused
    if (audioRef.current && audioRef.current.paused && idxRef.current === idx) {
      try { await audioRef.current.play(); playingRef.current = true; setPlaying(true); return } catch {}
    }
    playingRef.current = true
    setPlaying(true)
    setError(null)
    if (engine === 'kokoro') {
      if (!kokoroReady) {
        setKokoroLoading(true)
        try {
          const model = await loadKokoro(p => {
            setKokoroProgress(p.status + (p.progress ? ` ${Math.round(p.progress)}%` : '') + (p.file ? ` ${p.file}` : ''))
          })
          setKokoroVoices(Object.keys(model.voices))
          if (!voice) setVoice('af_heart')
          setKokoroReady(true)
        } catch (e: any) {
          setError(e?.message || 'Failed to load high-quality voice')
          setKokoroLoading(false)
          playingRef.current = false
          setPlaying(false)
          return
        }
        setKokoroLoading(false)
      }
      speakKokoro(idxRef.current)
    } else {
      window.speechSynthesis?.cancel()
      speakWS(idxRef.current)
    }
  }

  const pause = () => {
    playingRef.current = false
    setPlaying(false)
    if (engine === 'webspeech') window.speechSynthesis?.pause()
    else audioRef.current?.pause()
    saveProgress(book.id, idxRef.current)
  }

  const jump = (i: number) => {
    stop()
    const v = Math.max(0, Math.min(total - 1, i))
    setIdx(v); idxRef.current = v
  }

  const loadKokoroNow = async () => {
    setKokoroLoading(true)
    setError(null)
    try {
      const model = await loadKokoro(p => {
        setKokoroProgress(p.status + (p.progress ? ` ${Math.round(p.progress)}%` : '') + (p.file ? ` ${p.file}` : ''))
      })
      setKokoroVoices(Object.keys(model.voices))
      if (!kokoroVoices.length) setVoice('af_heart')
      setKokoroReady(true)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setKokoroLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => { stop(); onBack() }} className="text-slate-300 hover:text-white">← Library</button>
        <h2 className="text-xl font-semibold truncate">{book.name}</h2>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {!playing ? (
            <button onClick={play} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium">▶ Play</button>
          ) : (
            <button onClick={pause} className="px-5 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg font-medium">⏸ Pause</button>
          )}
          <button onClick={stop} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg">⏹ Stop</button>
          <button onClick={() => jump(idx - 1)} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg">⏮</button>
          <button onClick={() => jump(idx + 1)} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg">⏭</button>

          <div className="flex items-center gap-2 ml-2">
            <span className="text-sm text-slate-400">Engine</span>
            <select
              value={engine}
              onChange={e => setEngine(e.target.value as Engine)}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm"
            >
              <option value="webspeech">Web Speech (instant)</option>
              <option value="kokoro">Kokoro (high quality)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Speed</span>
            <select
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm"
            >
              {[0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Voice</span>
            <select
              value={voice}
              onChange={e => setVoice(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm max-w-[220px]"
            >
              {engine === 'webspeech'
                ? wsVoices.filter(v => v.lang.startsWith('en')).map(v => (
                    <option key={v.name} value={v.name}>{v.name}</option>
                  ))
                : (kokoroVoices.length ? kokoroVoices : ['af_heart']).map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
            </select>
          </div>
        </div>

        {engine === 'kokoro' && !kokoroReady && (
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={loadKokoroNow}
              disabled={kokoroLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm disabled:opacity-50"
            >
              {kokoroLoading ? 'Downloading voice model…' : 'Download high-quality voice (~80MB, one time)'}
            </button>
            {kokoroLoading && <span className="text-xs text-slate-400">{kokoroProgress}</span>}
          </div>
        )}
        {error && <div className="mt-3 text-red-400 text-sm">{error}</div>}
        <div className="mt-2 text-xs text-slate-500">
          Sentence {Math.min(idx + 1, total)} of {total}
        </div>
      </div>

      {/* Text */}
      <div ref={containerRef} className="bg-slate-900 rounded-2xl p-5 max-h-[60vh] overflow-y-auto leading-7">
        {sentences.current.map((s, i) => (
          <span
            key={i}
            data-i={i}
            onClick={() => jump(i)}
            className={`cursor-pointer rounded px-1 transition ${i === idx ? 'bg-indigo-600/40 text-white' : 'hover:bg-slate-700/60'}`}
          >
            {s}{' '}
          </span>
        ))}
      </div>

      {book.chapters.length > 1 && (
        <div className="mt-4 text-xs text-slate-500">
          Chapters detected: {book.chapters.slice(0, 8).join(' · ')}
          {book.chapters.length > 8 ? ' …' : ''}
        </div>
      )}
    </div>
  )
}
