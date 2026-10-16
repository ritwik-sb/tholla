import { useEffect, useMemo, useRef, useState } from 'react'
import { saveProgress, getProgress } from '../lib/storage'
import { buildReading } from '../lib/reading'
import { loadKokoro, generate, isKokoroLoaded, CancelledError, type Generation } from '../lib/kokoro'
import { VOICES, DEFAULT_VOICE, getVoice } from '../lib/voices'
import VoiceAvatar from './VoiceAvatar'
import VoiceDial, { unlockSampleAudio } from './VoiceDial'
import type { Book } from '../types'

const VOICE_KEY = 'tholla.voice'

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
  const [speed, setSpeed] = useState(1)
  const [voice, setVoice] = useState(() => {
    const saved = localStorage.getItem(VOICE_KEY)
    return saved && VOICES.some(v => v.id === saved) ? saved : DEFAULT_VOICE
  })
  const [dialOpen, setDialOpen] = useState(false)
  const [kokoroReady, setKokoroReady] = useState(isKokoroLoaded())
  const [kokoroLoading, setKokoroLoading] = useState(false)
  const [kokoroProgress, setKokoroProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playerRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<any>(null)
  const playingRef = useRef(false)
  const runRef = useRef(0)
  const voiceRef = useRef(voice)
  const speedRef = useRef(speed)
  const idxRef = useRef(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const voiceButtonRef = useRef<HTMLButtonElement | null>(null)

  const total = sentences.current.length
  const WINDOW = 80
  const start = total > 160 ? Math.max(0, idx - WINDOW) : 0
  const end = total > 160 ? Math.min(total, idx + WINDOW + 1) : total
  const character = getVoice(voice)

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

  // cleanup on unmount
  useEffect(() => {
    return () => {
      runRef.current++
      const a = playerRef.current
      a?.pause()
      if (a?.src.startsWith('blob:')) URL.revokeObjectURL(a.src)
      saveProgress(book.id, chapterIndex, idxRef.current)
    }
  }, [book.id])

  // scroll active sentence
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-i="${idx}"]`)
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [idx])

  // Prepared audio for upcoming sentences, keyed by voice + chapter + sentence.
  const cacheRef = useRef(new Map<string, Generation>())
  const wasPlayingRef = useRef(false)
  const PREFETCH = 3

  const audioFor = (i: number): Generation | null => {
    if (i < 0 || i >= sentences.current.length) return null
    const key = `${voiceRef.current}|${chapterIndexRef.current}|${i}`
    let g = cacheRef.current.get(key)
    if (!g) {
      g = generate(sentences.current[i], voiceRef.current, { padMs: pauses.current[i] || 0 })
      cacheRef.current.set(key, g)
    }
    return g
  }

  const clearCache = (keepFrom?: number) => {
    for (const [key, g] of cacheRef.current) {
      const [v, ch, i] = key.split('|')
      const keep = keepFrom != null && v === voiceRef.current && Number(ch) === chapterIndexRef.current &&
        Number(i) >= keepFrom && Number(i) <= keepFrom + PREFETCH
      if (!keep) { g.cancel(); cacheRef.current.delete(key) }
    }
  }

  // One reused element: mobile browsers keep it playing with the screen off.
  const player = () => {
    if (!playerRef.current) {
      const a = new Audio()
      a.preservesPitch = true
      playerRef.current = a
    }
    return playerRef.current
  }

  const haltAudio = () => {
    runRef.current++
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }

  const stop = () => {
    playingRef.current = false
    setPlaying(false)
    haltAudio()
    saveProgress(book.id, chapterIndex, idxRef.current)
  }

  const speak = async (i: number, run: number) => {
    if (run !== runRef.current || !playingRef.current) return
    if (i >= sentences.current.length) { stop(); return }
    setIdx(i); idxRef.current = i
    clearCache(i)
    const current = audioFor(i)!
    // queue the next sentences while this one is generated/played
    for (let k = 1; k <= PREFETCH; k++) audioFor(i + k)
    try {
      const blob = await current.promise
      if (run !== runRef.current || !playingRef.current) return
      const a = player()
      const url = URL.createObjectURL(blob)
      if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src)
      a.src = url
      a.playbackRate = speedRef.current
      audioRef.current = a
      // the pause after the sentence is already part of the audio, so chain immediately
      a.onended = () => {
        if (audioRef.current === a) audioRef.current = null
        if (run !== runRef.current || !playingRef.current) return
        speak(i + 1, run)
      }
      a.onerror = () => { if (run === runRef.current) speak(i + 1, run) }
      await a.play()
    } catch (e: any) {
      if (run !== runRef.current || e instanceof CancelledError) return
      setError(e?.message || 'TTS error')
      speak(i + 1, run)
    }
  }

  // speed is applied at playback, so changing it never needs regeneration
  useEffect(() => {
    speedRef.current = speed
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const ensureKokoro = async () => {
    if (isKokoroLoaded()) { setKokoroReady(true); return true }
    setKokoroLoading(true)
    try {
      await loadKokoro(p => {
        setKokoroProgress(p.status + (p.progress ? ` ${Math.round(p.progress)}%` : '') + (p.file ? ` ${p.file}` : ''))
      })
      setKokoroReady(true)
      return true
    } catch (e: any) {
      setError(e?.message || 'Failed to load voice model')
      return false
    } finally {
      setKokoroLoading(false)
    }
  }

  const play = async () => {
    // resume if paused mid-sentence
    if (audioRef.current && audioRef.current.paused && idxRef.current === idx) {
      try { await audioRef.current.play(); playingRef.current = true; setPlaying(true); return } catch {}
    }
    haltAudio()
    const run = runRef.current
    playingRef.current = true
    setPlaying(true)
    setError(null)
    if (!(await ensureKokoro())) {
      playingRef.current = false
      setPlaying(false)
      return
    }
    speak(idxRef.current, run)
  }

  const pause = () => {
    playingRef.current = false
    setPlaying(false)
    audioRef.current?.pause()
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
    clearCache()
    pendingIdxRef.current = null
    chapterChangedRef.current = true
    setChapterIndex(i)
  }

  const changeVoice = (id: string) => {
    if (id === voiceRef.current) return
    voiceRef.current = id
    setVoice(id)
    localStorage.setItem(VOICE_KEY, id)
    clearCache()
    if (playingRef.current) {
      // restart the current sentence in the new voice
      haltAudio()
      speak(idxRef.current, runRef.current)
    } else if (audioRef.current) {
      // drop paused audio so resume uses the new voice
      haltAudio()
    }
  }

  const openDial = () => {
    // pause the book so voice samples can be heard
    wasPlayingRef.current = playingRef.current
    if (playingRef.current) pause()
    unlockSampleAudio()
    setDialOpen(true)
  }

  const closeDial = () => {
    setDialOpen(false)
    requestAnimationFrame(() => voiceButtonRef.current?.focus())
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      play()
    }
  }

  useEffect(() => () => clearCache(), [])

  // Lock-screen / headphone controls
  const controls = useRef({ play: () => {}, pause: () => {}, next: () => {}, prev: () => {} })
  controls.current = { play, pause, next: () => jump(idxRef.current + 1), prev: () => jump(idxRef.current - 1) }
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    ms.metadata = new MediaMetadata({
      title: chapters[chapterIndex]?.title || book.name,
      artist: `${character.name} · തൊള്ള`,
      album: book.name,
      artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    })
    ms.playbackState = playing ? 'playing' : 'paused'
  }, [book.name, chapterIndex, character.name, playing])
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    const set = (a: MediaSessionAction, f: (() => void) | null) => { try { ms.setActionHandler(a, f) } catch {} }
    set('play', () => controls.current.play())
    set('pause', () => controls.current.pause())
    set('nexttrack', () => { controls.current.next(); controls.current.play() })
    set('previoustrack', () => { controls.current.prev(); controls.current.play() })
    return () => { for (const a of ['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) set(a, null) }
  }, [])

  // App warms the engine at startup; reflect when it's ready
  useEffect(() => {
    let alive = true
    loadKokoro().then(() => alive && setKokoroReady(true), () => {})
    return () => { alive = false }
  }, [])

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 pb-44">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => { stop(); onBack() }} className="text-slate-300 hover:text-white">← Library</button>
        <h2 className="text-xl font-semibold truncate min-w-0">{book.name}</h2>
      </div>

      {chapters.length > 1 && (
        <div className="mb-4 bg-slate-800 rounded-2xl p-2" aria-label="Chapters">
          {chapters.map((c, i) => (
            <details key={i} open={i === chapterIndex} className="border-b border-slate-700 last:border-0">
              <summary
                className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700/40 focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                onClick={e => { e.preventDefault(); selectChapter(i) }}
              >
                {c.title || `Chapter ${i + 1}`}
              </summary>
              {i === chapterIndex && (
                <p className="px-3 pb-2 text-xs text-slate-400">Reading this chapter. Use the play controls below.</p>
              )}
            </details>
          ))}
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
        <details className="mt-4 text-xs text-slate-300">
          <summary className="cursor-pointer">Chapters detected ({chapters.length})</summary>
          <span className="block mt-1">{chapters.map(c => c.title).join(' · ')}</span>
        </details>
      )}
      {/* Controls */}
      <div className="fixed inset-x-0 bottom-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-700/70 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-4xl mx-auto px-4 pt-2 pb-3">
          <div className="h-1 rounded-full bg-slate-700/70 overflow-hidden mb-2" aria-hidden="true">
            <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${total ? ((idx + 1) / total) * 100 : 0}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2 min-h-[1rem]" aria-live="polite">
            <span className="truncate">
              {error
                ? <span className="text-red-400">{error}</span>
                : kokoroLoading
                  ? `Preparing voice… ${kokoroProgress}`
                  : !kokoroReady
                    ? 'Voice engine warming up…'
                    : `Sentence ${Math.min(idx + 1, total)} of ${total}`}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              ref={voiceButtonRef}
              type="button"
              onClick={openDial}
              aria-haspopup="dialog"
              aria-label={`Voice: ${character.name}. Change voice`}
              className="flex items-center gap-2 min-w-0 rounded-full pr-3 hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <span className="rounded-full ring-2 ring-slate-600 shrink-0">
                <VoiceAvatar voice={character} size={52} talking={playing && !kokoroLoading} />
              </span>
              <span className="hidden sm:flex flex-col items-start text-left min-w-0">
                <span className="text-sm font-medium truncate">{character.name}</span>
                <span className="text-[11px] text-slate-400">{character.accent}</span>
              </span>
            </button>

            <div className="flex-1 flex items-center justify-center gap-2">
              <button onClick={() => jump(idx - 1)} className="min-h-[44px] min-w-[44px] rounded-full hover:bg-slate-800 text-lg focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Previous sentence">⏮</button>
              {!playing ? (
                <button onClick={play} disabled={kokoroLoading} className="h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-xl disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Play">▶</button>
              ) : (
                <button onClick={pause} className="h-14 w-14 rounded-full bg-amber-600 hover:bg-amber-500 text-xl focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Pause">⏸</button>
              )}
              <button onClick={() => jump(idx + 1)} className="min-h-[44px] min-w-[44px] rounded-full hover:bg-slate-800 text-lg focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Next sentence">⏭</button>
              <button onClick={stop} className="min-h-[44px] min-w-[44px] rounded-full hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Stop playback">⏹</button>
            </div>

            <label className="flex items-center gap-1">
              <span className="sr-only">Speed</span>
              <select
                value={speed}
                onChange={e => setSpeed(Number(e.target.value))}
                className="min-h-[44px] bg-slate-800 border border-slate-600 rounded-full px-3 text-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {[0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                  <option key={s} value={s}>{s}×</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {dialOpen && <VoiceDial value={voice} onSelect={changeVoice} onClose={closeDial} />}
    </main>
  )
}
