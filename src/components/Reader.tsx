import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveProgress, getProgress } from '../lib/storage'
import { buildReading } from '../lib/reading'
import { loadKokoro, generate, ensureVoice, onKokoroProgress, readAheadSeconds, needsPrebuffer, scheduleRelease, cancelRelease, CancelledError, type Generation } from '../lib/kokoro'
import { VOICES, DEFAULT_VOICE, getVoice } from '../lib/voices'
import VoiceAvatar from './VoiceAvatar'
import { Case, Grille, Icon, Knob, Wordmark } from './radio'
import VoiceDial, { unlockSampleAudio } from './VoiceDial'
import type { Book } from '../types'

const VOICE_KEY = 'tholla.voice'
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

const Sentence = memo(function Sentence({ i, text, active, onJump }: { i: number; text: string; active: boolean; onJump: (i: number) => void }) {
  return (
    <button
      type="button"
      data-i={i}
      tabIndex={active ? 0 : -1}
      aria-current={active ? 'true' : undefined}
      aria-label={`Sentence ${i + 1}`}
      onClick={() => onJump(i)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(i) }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onJump(i + 1) }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onJump(i - 1) }
      }}
      className={`sent inline text-left rounded-sm ${active ? 'now' : ''}`}
    >
      {text}{' '}
    </button>
  )
})

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
  const [kokoroLoading, setKokoroLoading] = useState(false)
  const [kokoroProgress, setKokoroProgress] = useState('')
  const [speechLoading, setSpeechLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceLoading, setVoiceLoading] = useState(false)

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
      // live ref, not the chapterIndex captured when this effect first ran
      saveProgress(book.id, chapterIndexRef.current, idxRef.current)
    }
  }, [book.id])

  // scroll active sentence
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-i="${idx}"]`)
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [idx])

  // ── Speech segments ──────────────────────────────────────────
  // Short sentences in a paragraph are voiced together (each model call has a fixed cost,
  // and joined speech flows better). The highlight still moves per sentence, timed from
  // the audio. Segments are built greedily from wherever playback starts.
  type Segment = { first: number; last: number; text: string; pad: number; weights: number[] }
  const MERGE_CHARS = 220
  const MAX_MERGE = 6
  const CHARS_PER_SECOND = 15

  const segmentAt = (i: number): Segment => {
    const ss = sentences.current, ps = pauses.current
    let last = i
    let text = ss[i]
    while (
      last + 1 < ss.length && (ps[last] || 0) === 0 && last - i + 1 < MAX_MERGE &&
      text.length + 1 + ss[last + 1].length <= MERGE_CHARS
    ) {
      last++
      text += ' ' + ss[last]
    }
    const weights: number[] = []
    for (let k = i; k <= last; k++) weights.push(Math.max(1, ss[k].length))
    return { first: i, last, text, pad: ps[last] || 0, weights }
  }

  // Generated audio for upcoming segments, keyed by voice + chapter + first sentence.
  const cacheRef = useRef(new Map<string, Generation>())
  const wasPlayingRef = useRef(false)
  const keyOf = (seg: Segment) => `${voiceRef.current}|${chapterIndexRef.current}|${seg.first}|${seg.last}`

  const audioFor = (seg: Segment): Generation => {
    const key = keyOf(seg)
    let g = cacheRef.current.get(key)
    if (!g) {
      g = generate(seg.text, voiceRef.current, { padMs: seg.pad })
      cacheRef.current.set(key, g)
    }
    return g
  }

  /** Keep about AHEAD_SECONDS of audio queued past the current segment; cancel everything else. */
  const plan = (from: Segment, ahead = true) => {
    const keep = new Set<string>([keyOf(from)])
    audioFor(from)
    if (ahead) {
      let secs = 0
      let next = from.last + 1
      const aheadSecs = readAheadSeconds()
      while (next < sentences.current.length && secs < aheadSecs && keep.size < 24) {
        const seg = segmentAt(next)
        keep.add(keyOf(seg))
        audioFor(seg)
        secs += seg.text.length / CHARS_PER_SECOND + seg.pad / 1000
        next = seg.last + 1
      }
    }
    for (const [key, g] of cacheRef.current) {
      if (!keep.has(key)) { g.cancel(); cacheRef.current.delete(key) }
    }
  }

  const clearCache = () => {
    for (const g of cacheRef.current.values()) g.cancel()
    cacheRef.current.clear()
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
    setSpeechLoading(false)
    haltAudio()
    clearCache()
    scheduleRelease(10 * 60e3)
    saveProgress(book.id, chapterIndexRef.current, idxRef.current)
  }

  // Never race through the book on errors: stay on the sentence and let the user tap Play again.
  const failuresRef = useRef(0)
  const prebufferRef = useRef(false)
  const failed = (seg: Segment, run: number, e: any) => {
    if (run !== runRef.current) return
    const blocked = e?.name === 'NotAllowedError'
    failuresRef.current++
    if (!blocked && failuresRef.current < 2 && seg.last + 1 < sentences.current.length) {
      // one unreadable segment: skip it once
      speak(seg.last + 1, run)
      return
    }
    failuresRef.current = 0
    playingRef.current = false
    setPlaying(false)
    setSpeechLoading(false)
    haltAudio()
    setIdx(seg.first); idxRef.current = seg.first
    setError(blocked ? 'Playback paused by the browser. Tap Play to continue.' : `Couldn't play this sentence (${e?.message || 'voice error'}). Tap Play to retry.`)
    saveProgress(book.id, chapterIndexRef.current, seg.first)
  }

  const speak = async (i: number, run: number) => {
    if (run !== runRef.current || !playingRef.current) return
    if (i >= sentences.current.length) { stop(); return }
    const seg = segmentAt(i)
    setIdx(i); idxRef.current = i
    plan(seg)
    // let the dial spin and the status line explain the wait while audio is being made
    setSpeechLoading(true)
    try {
      const blob = await audioFor(seg).promise
      if (run !== runRef.current || !playingRef.current) return
      if (prebufferRef.current) {
        // slow device: have the next segment ready too before the first one starts
        prebufferRef.current = false
        if (seg.last + 1 < sentences.current.length) {
          try { await audioFor(segmentAt(seg.last + 1)).promise } catch {}
          if (run !== runRef.current || !playingRef.current) return
        }
      }
      setKokoroLoading(false)
      setSpeechLoading(false)
      const a = player()
      const url = URL.createObjectURL(blob)
      const old = a.src
      a.src = url
      if (old.startsWith('blob:')) URL.revokeObjectURL(old)
      a.playbackRate = speedRef.current
      audioRef.current = a
      // move the highlight through the merged sentences in proportion to their length
      a.ontimeupdate = seg.last > seg.first ? () => {
        const speech = Math.max(0.1, a.duration - seg.pad / 1000)
        const target = Math.min(1, a.currentTime / speech) * seg.weights.reduce((x, y) => x + y, 0)
        let k = 0, acc = seg.weights[0]
        while (acc < target && k < seg.weights.length - 1) acc += seg.weights[++k]
        const at = seg.first + k
        if (at !== idxRef.current) { idxRef.current = at; setIdx(at) }
      } : null
      // the pause after the segment is already part of the audio, so chain immediately
      a.onended = () => {
        if (audioRef.current === a) audioRef.current = null
        if (run !== runRef.current || !playingRef.current) return
        speak(seg.last + 1, run)
      }
      a.onerror = () => { if (run === runRef.current) failed(seg, run, new Error('Audio could not be played')) }
      await a.play()
      failuresRef.current = 0
    } catch (e: any) {
      if (run !== runRef.current || e instanceof CancelledError) return
      failed(seg, run, e)
    }
  }

  // speed is applied at playback, so changing it never needs regeneration
  useEffect(() => {
    speedRef.current = speed
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  // Loading status: the model loads on demand inside the worker (only when audio isn't saved yet)
  useEffect(() => onKokoroProgress(p => {
    if (p.status === 'ready' || p.status === 'done') return
    setKokoroLoading(true)
    setKokoroProgress(p.progress != null ? `${Math.round(p.progress)}%` : '')
  }), [])

  const IDLE_RELEASE_MS = 10 * 60e3

  const play = async () => {
    cancelRelease()
    // resume if paused mid-sentence
    if (audioRef.current && audioRef.current.paused && idxRef.current === idx) {
      const a = audioRef.current
      // don't let a stalled media element swallow the tap: fall through and rebuild if it doesn't start
      const started = await Promise.race([
        a.play().then(() => true, () => false),
        new Promise<boolean>(r => setTimeout(() => r(false), 1500)),
      ])
      if (started) { playingRef.current = true; setPlaying(true); return }
    }
    haltAudio()
    // Start the shared player inside the tap so mobile browsers let later sentences play.
    const a = player()
    a.onended = null
    a.onerror = null
    a.ontimeupdate = null
    a.src = SILENT_WAV
    a.play().catch(() => {})
    failuresRef.current = 0
    prebufferRef.current = needsPrebuffer()
    const run = runRef.current
    playingRef.current = true
    setPlaying(true)
    setError(null)
    speak(idxRef.current, run)
  }

  const pause = () => {
    playingRef.current = false
    setPlaying(false)
    setSpeechLoading(false)
    audioRef.current?.pause()
    // don't keep the GPU busy preparing audio nobody is listening to
    plan(segmentAt(idxRef.current), false)
    scheduleRelease(IDLE_RELEASE_MS)
    saveProgress(book.id, chapterIndex, idxRef.current)
  }

  const jump = (i: number) => {
    stop()
    const v = Math.max(0, Math.min(total - 1, i))
    setIdx(v); idxRef.current = v
  }

  // stable callback so memoised sentences don't re-render on every highlight move
  const jumpRef = useRef(jump)
  jumpRef.current = jump
  const jumpStable = useCallback((i: number) => jumpRef.current(i), [])

  // ── seeking with the dial needle ───────────────────────────────
  const scaleRef = useRef<HTMLDivElement | null>(null)
  const [seek, setSeek] = useState<number | null>(null)
  const fracAt = (clientX: number) => {
    const r = scaleRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  const seekToIndex = (i: number) => {
    const target = Math.min(total - 1, Math.max(0, i))
    const resume = playingRef.current
    jump(target)
    if (resume) play()
  }
  const seekTo = (frac: number) => {
    setSeek(null)
    if (total) seekToIndex(Math.floor(frac * total))
  }

  const selectChapter = (i: number) => {
    stop()
    if (i === chapterIndex) return
    clearCache()
    pendingIdxRef.current = null
    chapterChangedRef.current = true
    setChapterIndex(i)
  }

  const changeVoice = async (id: string): Promise<boolean> => {
    if (id === voiceRef.current) return true
    setVoiceLoading(true)
    try {
      await ensureVoice(id)
    } catch (e: any) {
      setVoiceLoading(false)
      setError(`Couldn't load that voice (${e?.message || 'missing file'}). Tap Play to retry.`)
      return false
    }
    haltAudio()
    playingRef.current = false
    setPlaying(false)
    voiceRef.current = id
    setVoice(id)
    localStorage.setItem(VOICE_KEY, id)
    clearCache()
    setVoiceLoading(false)
    saveProgress(book.id, chapterIndexRef.current, idxRef.current)
    return true
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
  }

  // leaving the reader: drop queued work and free the model shortly after
  useEffect(() => () => { clearCache(); scheduleRelease(60e3) }, [])

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

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as any
    w.__play = play
    w.__pause = pause
    w.__changeVoice = changeVoice
    w.__state = () => ({ playing: playingRef.current, idx: idxRef.current, voice: voiceRef.current, run: runRef.current, error })
    return () => { delete w.__play; delete w.__pause; delete w.__changeVoice; delete w.__state }
  }, [play, pause, changeVoice, error])

  useEffect(() => {
    let alive = true
    loadKokoro().then(() => {
      if (!alive) return
      setKokoroLoading(false)
      if (!playingRef.current) scheduleRelease(10 * 60e3)
    }, () => {})
    return () => { alive = false }
  }, [])

  const chapterTitle = chapters[chapterIndex]?.title || book.name
  const progress = total ? ((idx + 0.5) / total) * 100 : 0
  const seekIndex = seek != null ? Math.min(total - 1, Math.max(0, Math.floor(seek * total))) : idx
  const needleAt = seek != null ? ((seekIndex + 0.5) / total) * 100 : progress
  const statusText = error
    ? error
    : playing && kokoroLoading
      ? `Warming up the valves… ${kokoroProgress}`
      : playing && speechLoading
        ? 'Preparing speech…'
        : `Sentence ${Math.min(idx + 1, total)} of ${total}`
  // spinner around the voice porthole while the engine downloads or speech is made
  const portholeBusy = !error && playing && (kokoroLoading || speechLoading)

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
          <div className="dial-window flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="px-5 pt-1">
              {/* drag the needle (or tap the scale) to seek within the chapter */}
              <div
                ref={scaleRef}
                role="slider"
                tabIndex={0}
                aria-label="Position in chapter"
                aria-valuemin={1}
                aria-valuemax={total}
                aria-valuenow={Math.min(idx + 1, total)}
                aria-valuetext={`Sentence ${Math.min(idx + 1, total)} of ${total}`}
                className={`tuning-hit ${seek != null ? 'dragging' : ''}`}
                onPointerDown={e => {
                  if (!total) return
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setSeek(fracAt(e.clientX))
                }}
                onPointerMove={e => { if (seek != null) setSeek(fracAt(e.clientX)) }}
                onPointerUp={e => { if (seek != null) seekTo(fracAt(e.clientX)) }}
                onPointerCancel={() => setSeek(null)}
                onKeyDown={e => {
                  const step = e.shiftKey ? 10 : 1
                  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); seekToIndex(idx + step) }
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); seekToIndex(idx - step) }
                  if (e.key === 'Home') { e.preventDefault(); seekToIndex(0) }
                  if (e.key === 'End') { e.preventDefault(); seekToIndex(total - 1) }
                }}
              >
                <div className="tuning">
                  <div className={`needle ${seek != null ? 'live' : ''}`} style={{ left: 0, transform: `translateX(${needleAt}cqw)` }} />
                </div>
              </div>
              <div className="flex justify-between gap-3 stamp text-[9px] tracking-[.2em] mt-0.5 text-[rgba(246,220,166,.45)]" aria-hidden="true">
                {seek != null ? (
                  <span className="min-w-0 truncate normal-case tracking-[.06em] text-[var(--amber-text)]">
                    Sentence {seekIndex + 1} · {sentences.current[seekIndex]?.slice(0, 60)}
                  </span>
                ) : (
                  <span>{chapters.length > 1 ? `Band ${chapterIndex + 1}` : 'Band 1'}</span>
                )}
                <span className="shrink-0">{Math.round(needleAt)}%</span>
              </div>
            </div>
            <div ref={containerRef} className="reading flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-6" aria-label="Reading text">
              {total > 160 && start > 0 && (
                <p className="stamp text-[10px] text-[rgba(246,220,166,.4)] mb-2">
                  …{start} sentences above ·{' '}
                  <button type="button" className="underline" onClick={() => jump(0)}>back to start</button>
                </p>
              )}
              {sentences.current.slice(start, end).map((text, offset) => {
                const i = start + offset
                return <Sentence key={i} i={i} text={text} active={i === idx} onJump={jumpStable} />
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
              data-click className="panel flex-1 min-w-0 min-h-[44px] px-4 text-left"
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
            <button type="button" className={`key dark ${playing ? 'latched' : ''}`} onClick={() => { if (!playing) play() }} aria-label="Play" aria-pressed={playing}>
              <Icon name="play" />
            </button>
            <button type="button" className="key" onClick={pause} aria-label="Pause"><Icon name="pause" /></button>
            <button type="button" className="key" onClick={() => jump(idx + 1)} aria-label="Next sentence"><Icon name="next" /></button>
            <button type="button" className="key red" onClick={stop} aria-label="Stop playback"><Icon name="stop" /></button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 w-full md:max-w-2xl md:mx-auto">
          <div className="flex flex-col items-center gap-1 w-[120px]">
            <span className={`relative inline-block ${voiceLoading || portholeBusy ? `voice-loading${voiceLoading ? ' locked' : ''}` : ''}`}>
              <button
                ref={voiceButtonRef}
                type="button"
                onClick={openDial}
                disabled={voiceLoading}
                aria-busy={voiceLoading}
                aria-haspopup="dialog"
                aria-label={`Voice: ${character.name}. Change voice`}
                className="porthole"
              >
                <span className="glass block">
                  <VoiceAvatar voice={character} size={68} talking={playing && !kokoroLoading && !speechLoading} />
                </span>
              </button>
            </span>
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
          <Case rivets={false} className="w-full max-w-md rounded-[22px] p-5 pt-7 max-h-[80dvh] flex flex-col">
            <p className="stamp text-xs engraved text-center mb-3">Select band</p>
            <ul className="panel p-2 overflow-y-auto">
              {chapters.map((c, i) => (
                <li key={i}>
                  <button
                    type="button"
                    autoFocus={i === chapterIndex}
                    onClick={() => { selectChapter(i); setBandOpen(false) }}
                    data-click className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-black/15"
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
