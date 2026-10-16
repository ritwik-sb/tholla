import { useEffect, useMemo, useRef, useState } from 'react'
import { saveProgress, getProgress } from '../lib/storage'
import { buildReading } from '../lib/reading'
import { loadKokoro, generate, isKokoroLoaded, CancelledError, type Generation } from '../lib/kokoro'
import { VOICES, DEFAULT_VOICE, getVoice } from '../lib/voices'
import VoiceAvatar from './VoiceAvatar'
import { Case, Grille, Icon, Knob, Wordmark } from './radio'
import VoiceDial, { unlockSampleAudio } from './VoiceDial'
import type { Book } from '../types'

const VOICE_KEY = 'tholla.voice'
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]

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
  const [bandOpen, setBandOpen] = useState(false)
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

  const chapterTitle = chapters[chapterIndex]?.title || book.name
  const progress = total ? ((idx + 0.5) / total) * 100 : 0
  const statusText = error
    ? error
    : kokoroLoading
      ? `Preparing voice… ${kokoroProgress}`
      : !kokoroReady
        ? 'Warming up the valves…'
        : `Sentence ${Math.min(idx + 1, total)} of ${total}`

  return (
    <main className="h-dvh flex justify-center md:p-6">
      <Case className="w-full max-w-5xl flex flex-col gap-3 md:rounded-[30px] px-4 pt-6 md:px-8 md:pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3 px-3">
          <button type="button" onClick={() => { stop(); onBack() }} className="key small dark" aria-label="Back to bookshelf">
            <Icon name="back" />
          </button>
          <div className="flex-1 min-w-0 flex justify-center"><Wordmark size="text-3xl" /></div>
          <span className={`lamp ${playing ? 'on' : ''}`} aria-hidden="true" />
        </div>

        <div className="brass mx-1 px-3 py-1 text-center">
          <h2 className="stamp text-[11px] truncate">{book.name}</h2>
        </div>

        <div className="flex-1 min-h-0 flex gap-4">
          <Grille rows={16} className="hidden md:flex w-44 shrink-0" />
          <div className="dial-window flex-1 min-h-0 flex flex-col">
            <div className="px-5 pt-3" aria-hidden="true">
              <div className="tuning"><div className="needle" style={{ left: `${progress}%` }} /></div>
              <div className="flex justify-between stamp text-[9px] tracking-[.2em] mt-1.5 text-[rgba(246,220,166,.45)]">
                <span>{chapters.length > 1 ? `Band ${chapterIndex + 1}` : 'Band 1'}</span>
                <span>{Math.round(progress)}%</span>
              </div>
            </div>
            <div ref={containerRef} className="reading flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-6" aria-label="Reading text">
              {total > 160 && start > 0 && (
                <p className="stamp text-[10px] text-[rgba(246,220,166,.4)] mb-2">
                  …{start} sentences above ·{' '}
                  <button type="button" className="underline" onClick={() => jump(0)}>back to start</button>
                </p>
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
                    className={`sent inline text-left rounded-sm ${i === idx ? 'now' : ''}`}
                  >
                    {s}{' '}
                  </button>
                )
              })}
              {end < total && (
                <p className="stamp text-[10px] text-[rgba(246,220,166,.4)] mt-2">…{total - end} sentences below…</p>
              )}
            </div>
          </div>
        </div>

        <p className={`stamp text-[10px] text-center truncate ${error ? 'text-red-300' : 'engraved-dark'}`} aria-live="polite">
          {statusText}
        </p>

        {chapters.length > 1 && (
          <div className="flex items-center gap-2">
            <button type="button" className="key small" onClick={() => selectChapter(chapterIndex - 1)} disabled={chapterIndex === 0} aria-label="Previous chapter">
              <Icon name="prev" />
            </button>
            <button
              type="button"
              onClick={() => setBandOpen(true)}
              aria-haspopup="dialog"
              aria-label={`Chapter: ${chapterTitle}. Choose chapter`}
              className="panel flex-1 min-w-0 min-h-[44px] px-4 text-left"
            >
              <span className="block stamp text-[9px] engraved-dark">Band {chapterIndex + 1} of {chapters.length}</span>
              <span className="block truncate stamp text-[13px] tracking-[.08em] engraved">{chapterTitle}</span>
            </button>
            <button type="button" className="key small" onClick={() => selectChapter(chapterIndex + 1)} disabled={chapterIndex >= chapters.length - 1} aria-label="Next chapter">
              <Icon name="next" />
            </button>
          </div>
        )}

        <div className="flex justify-center">
          <div className="keybed">
            <button type="button" className="key" onClick={() => jump(idx - 1)} aria-label="Previous sentence"><Icon name="prev" /></button>
            <button type="button" className={`key dark ${playing ? 'latched' : ''}`} onClick={() => { if (!playing) play() }} disabled={kokoroLoading} aria-label="Play" aria-pressed={playing}>
              <Icon name="play" />
            </button>
            <button type="button" className="key" onClick={pause} aria-label="Pause"><Icon name="pause" /></button>
            <button type="button" className="key" onClick={() => jump(idx + 1)} aria-label="Next sentence"><Icon name="next" /></button>
            <button type="button" className="key red" onClick={stop} aria-label="Stop playback"><Icon name="stop" /></button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 w-full md:max-w-2xl md:mx-auto">
          <div className="flex flex-col items-center gap-1 w-[120px]">
            <button
              ref={voiceButtonRef}
              type="button"
              onClick={openDial}
              aria-haspopup="dialog"
              aria-label={`Voice: ${character.name}. Change voice`}
              className="porthole"
            >
              <span className="glass block">
                <VoiceAvatar voice={character} size={68} talking={playing && !kokoroLoading} />
              </span>
            </button>
            <span className="stamp text-[10px] engraved">Voice · {character.name}</span>
          </div>

          <Grille rows={5} className="flex-1 self-stretch my-3 max-w-[260px]" />

          <div className="w-[120px] flex justify-center">
            <Knob
              label="Speed"
              values={SPEEDS}
              value={speed}
              onChange={setSpeed}
              format={v => (v === 1 ? '1×' : String(v).replace(/^0/, ''))}
              size={70}
            />
          </div>
        </div>
      </Case>

      {bandOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end md:items-center justify-center p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Choose chapter"
          onClick={e => { if (e.target === e.currentTarget) setBandOpen(false) }}
          onKeyDown={e => { if (e.key === 'Escape') setBandOpen(false) }}
        >
          <Case className="w-full max-w-md rounded-[22px] p-5 pt-7 max-h-[80dvh] flex flex-col">
            <p className="stamp text-xs engraved text-center mb-3">Select band</p>
            <ul className="panel p-2 overflow-y-auto">
              {chapters.map((c, i) => (
                <li key={i}>
                  <button
                    type="button"
                    autoFocus={i === chapterIndex}
                    onClick={() => { selectChapter(i); setBandOpen(false) }}
                    className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-black/15"
                  >
                    <span className={`lamp shrink-0 ${i === chapterIndex ? 'on' : ''}`} aria-hidden="true" />
                    <span className="stamp text-[10px] engraved-dark w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <span className={`stamp text-[13px] tracking-[.06em] truncate ${i === chapterIndex ? 'engraved' : 'engraved-dark'}`}>{c.title || `Chapter ${i + 1}`}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="key mt-4 self-center" onClick={() => setBandOpen(false)}>Close</button>
          </Case>
        </div>
      )}

      {dialOpen && <VoiceDial value={voice} onSelect={changeVoice} onClose={closeDial} />}
    </main>
  )
}
