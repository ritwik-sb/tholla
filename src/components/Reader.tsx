import { useEffect, useMemo, useRef, useState } from 'react'
import { saveProgress, getProgress } from '../lib/storage'
import { buildReading } from '../lib/reading'
import { loadKokoro, generateSentence } from '../lib/kokoro'
import type { Book, Engine } from '../types'

interface Props {
  book: Book
  onBack: () => void
}

export default function Reader({ book, onBack }: Props) {
  const chapters = book.chapters ?? []
  const [chapterIndex, setChapterIndex] = useState(0)
  const chapterChangedRef = useRef(false)
  const pendingIdxRef = useRef<number | null>(null)
  const chapterText = (chapters[chapterIndex]?.text) || book.text
  const reading = useMemo(() => buildReading(chapterText), [chapterText])
  const sentences = useRef(reading.sentences)
  const pauses = useRef(reading.pauseAfter)
  const autoStart = useRef(reading.startIndex)

  useEffect(() => {
    sentences.current = reading.sentences
    pauses.current = reading.pauseAfter
    autoStart.current = reading.startIndex
    if (chapterChangedRef.current) {
      const start = pendingIdxRef.current != null ? pendingIdxRef.current : reading.startIndex
      setIdx(start); idxRef.current = start
      pendingIdxRef.current = null
      chapterChangedRef.current = false
    }
  }, [reading])
  const [idx, setIdx] = useState(0)
  const chapterIndexRef = useRef(chapterIndex)
  useEffect(() => { chapterIndexRef.current = chapterIndex }, [chapterIndex])
  const [playing, setPlaying] = useState(false)
  const [engine, setEngine] = useState<Engine>('kokoro')
  const [speed, setSpeed] = useState(1)
  const [voice, setVoice] = useState('')
  const [wsVoices, setWsVoices] = useState<SpeechSynthesisVoice[]>([])
  const [kokoroVoices, setKokoroVoices] = useState<string[]>([])
  const [kokoroReady, setKokoroReady] = useState(false)
  const [kokoroLoading, setKokoroLoading] = useState(false)
  const [kokoroProgress, setKokoroProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<any>(null)
  const playingRef = useRef(false)
  const idxRef = useRef(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const total = sentences.current.length
  const WINDOW = 80
  const start = total > 160 ? Math.max(0, idx - WINDOW) : 0
  const end = total > 160 ? Math.min(total, idx + WINDOW + 1) : total

  useEffect(() => {
    idxRef.current = idx
  }, [idx])

  // load progress
  useEffect(() => {
    let cancelled = false
    getProgress(book.id).then(p => {
      if (cancelled) return
      const ch = p.chapterIndex ?? 0
      pendingIdxRef.current = (p.sentenceIndex ?? 0) === 0 ? null : p.sentenceIndex
      chapterChangedRef.current = true
      if (ch === chapterIndexRef.current) {
        const start = pendingIdxRef.current != null ? pendingIdxRef.current : (autoStart.current ?? 0)
        setIdx(start); idxRef.current = start
        pendingIdxRef.current = null
        chapterChangedRef.current = false
      } else {
        setChapterIndex(ch)
      }
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
      saveProgress(book.id, chapterIndex, idxRef.current)
    }
  }, [book.id])

  // scroll active sentence
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-i="${idx}"]`)
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [idx])

  const stop = () => {
    playingRef.current = false
    setPlaying(false)
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    window.speechSynthesis?.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    saveProgress(book.id, chapterIndex, idxRef.current)
  }

  const speakWS = (i: number) => {
    if (!playingRef.current || i >= total) { stop(); return }
    setIdx(i); idxRef.current = i
    const u = new SpeechSynthesisUtterance(sentences.current[i])
    const v = wsVoices.find(x => x.name === voice)
    if (v) u.voice = v
    u.rate = speed
    u.onend = () => {
      if (!playingRef.current) return
      const d = pauses.current[i] || 0
      if (d > 0) timerRef.current = setTimeout(() => speakWS(i + 1), d)
      else speakWS(i + 1)
    }
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
      a.onended = () => {
        URL.revokeObjectURL(url)
        if (!playingRef.current) return
        const d = pauses.current[i] || 0
        if (d > 0) timerRef.current = setTimeout(() => speakKokoro(i + 1), d)
        else speakKokoro(i + 1)
      }
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
    saveProgress(book.id, chapterIndex, idxRef.current)
  }

  const jump = (i: number) => {
    stop()
    const v = Math.max(0, Math.min(total - 1, i))
    setIdx(v); idxRef.current = v
  }

  const selectChapter = (i: number) => {
    stop()
    if (i === chapterIndex) return
    pendingIdxRef.current = null
    chapterChangedRef.current = true
    setChapterIndex(i)
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
    <main className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => { stop(); onBack() }} className="text-slate-300 hover:text-white">← Library</button>
        <h2 className="text-xl font-semibold truncate min-w-0">{book.name}</h2>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {!playing ? (
            <button onClick={play} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium">▶ Play</button>
          ) : (
            <button onClick={pause} className="px-5 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg font-medium">⏸ Pause</button>
          )}
          <button onClick={stop} className="min-h-[44px] px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Stop playback">⏹ Stop</button>
          <button onClick={() => jump(idx - 1)} className="min-h-[44px] min-w-[44px] px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Previous sentence">⏮</button>
          <button onClick={() => jump(idx + 1)} className="min-h-[44px] min-w-[44px] px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Next sentence">⏭</button>

          <label className="flex items-center gap-2 ml-2">
            <span className="text-sm text-slate-300">Engine</span>
            <select
              value={engine}
              onChange={e => setEngine(e.target.value as Engine)}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <option value="webspeech">Web Speech (instant)</option>
              <option value="kokoro">Kokoro (high quality)</option>
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-sm text-slate-300">Speed</span>
            <select
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {[0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-sm text-slate-300">Voice</span>
            <select
              value={voice}
              onChange={e => setVoice(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm max-w-[220px] focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {engine === 'webspeech'
                ? wsVoices.filter(v => v.lang.startsWith('en')).map(v => (
                    <option key={v.name} value={v.name}>{v.name}</option>
                  ))
                : (kokoroVoices.length ? kokoroVoices : ['af_heart']).map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
            </select>
          </label>
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

      {chapters.length > 1 && (
        <div className="mb-4 bg-slate-800 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-3 w-full">
              <span className="text-sm text-slate-300">Chapter</span>
              <select
                value={chapterIndex}
                onChange={e => selectChapter(Number(e.target.value))}
                className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm flex-1 min-w-0 focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {chapters.map((c, i) => (
                  <option key={i} value={i}>{c.title}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {/* Text (windowed for long books) */}
      <div ref={containerRef} className="bg-slate-900 rounded-2xl p-5 max-h-[60vh] overflow-y-auto leading-7" aria-label="Reading text">
        {total > 160 && (
          <p className="text-xs text-slate-400 mb-2">
            Showing sentences around the current position for performance.{' '}
            {start > 0 && <button type="button" className="underline focus-visible:ring-2 focus-visible:ring-indigo-400" onClick={() => jump(0)}>Jump to beginning</button>}
          </p>
        )}
        {start > 0 && (
          <p className="text-xs text-slate-500 mb-2">…{start} sentences above…</p>
        )}
        {sentences.current.slice(start, end).map((s, offset) => {
          const i = start + offset
          return (
          <button
            type="button"
            key={i}
            data-i={i}
            tabIndex={i === idx ? 0 : -1}
            aria-current={i === idx ? 'true' : undefined}
            aria-label={`Sentence ${i + 1}`}
            onClick={() => jump(i)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(i) }
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); jump(i + 1) }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); jump(i - 1) }
            }}
            className={`inline text-left rounded px-1 transition focus-visible:ring-2 focus-visible:ring-indigo-400 ${i === idx ? 'bg-indigo-600/40 text-white' : 'hover:bg-slate-700/60'}`}
          >
            {s}{' '}
          </button>
          )
        })}
        {end < total && (
          <p className="text-xs text-slate-500 mt-2">…{total - end} sentences below…</p>
        )}
      </div>

      {chapters.length > 1 && (
        <div className="mt-4 text-xs text-slate-300">
          Chapters detected: {chapters.slice(0, 8).map(c => c.title).join(' · ')}
          {chapters.length > 8 ? ' …' : ''}
        </div>
      )}
    </main>
  )
}
