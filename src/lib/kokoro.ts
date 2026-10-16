// Main-thread client for the Kokoro worker. Generation runs off the UI thread so
// animations and scrolling stay smooth while speech is being synthesised.

export type LoadProgress = { status: string; progress?: number; file?: string; loaded?: number; total?: number }

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
const progressListeners = new Set<(p: LoadProgress) => void>()
let ready = false
let device: 'webgpu' | 'wasm' | null = null
let loadPromise: Promise<void> | null = null

export const kokoroDevice = () => device

// How long this device takes to generate one second of speech (1 = exactly real time).
// Measured from real sentences, smoothed, and remembered across sessions.
const RTF_KEY = 'tholla.rtf'
let rtf: number | null = Number(localStorage.getItem(RTF_KEY)) || null
export const speedFactor = () => rtf

/** Seconds of audio to keep prepared: little on fast devices, more on slow ones. */
export function readAheadSeconds() {
  const r = rtf ?? 0.5
  return r < 0.4 ? 25 : r < 0.8 ? 45 : 90
}
/** Slow devices should prepare a second segment before starting, to avoid an early gap. */
export const needsPrebuffer = () => (rtf ?? 0) > 0.85

// Remember the model variant picked on this device so it never switches (and re-downloads) later.
const CHOICE_KEY = 'tholla.model'
const savedChoice = () => { try { return JSON.parse(localStorage.getItem(CHOICE_KEY) || 'null') } catch { return null } }

// ── releasing the model when idle ───────────────────────────────
let releaseTimer: ReturnType<typeof setTimeout> | null = null

/** Terminate the worker, freeing the model's GPU/CPU memory. It reloads from disk (~1 s) when needed. */
export function releaseKokoro() {
  cancelRelease()
  if (!worker) return
  worker.terminate()
  worker = null
  ready = false
  loadPromise = null
  for (const p of pending.values()) p.reject(new CancelledError())
  pending.clear()
  samples.clear()
  pendingSamples.clear()
}

export function scheduleRelease(ms: number) {
  cancelRelease()
  releaseTimer = setTimeout(releaseKokoro, ms)
}

export function cancelRelease() {
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null }
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
    // tell the worker which variant this device uses, without loading it yet
    worker.postMessage({ type: 'config', opts: savedChoice() })
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') {
        progressListeners.forEach(l => l(m))
        return
      }
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.type === 'audio') {
        if (m.genMs && m.speechMs > 1500) {
          const r = m.genMs / m.speechMs
          rtf = rtf == null ? r : rtf * 0.7 + r * 0.3
          localStorage.setItem(RTF_KEY, rtf.toFixed(3))
        }
        p.resolve(m.blob)
      }
      else if (m.type === 'ready') {
        device = m.device ?? null
        localStorage.setItem(CHOICE_KEY, JSON.stringify({ device: m.device, dtype: m.dtype }))
        p.resolve(undefined)
      }
      else if (m.type === 'cancelled') p.reject(new CancelledError())
      else p.reject(new Error(m.message))
    }
  }
  return worker
}

export class CancelledError extends Error {
  constructor() { super('cancelled') }
}

export function onKokoroProgress(listener: (p: LoadProgress) => void) {
  progressListeners.add(listener)
  return () => { progressListeners.delete(listener) }
}

export function isKokoroLoaded() {
  return ready
}

export function loadKokoro(onProgress?: (p: LoadProgress) => void): Promise<void> {
  cancelRelease()
  const off = onProgress ? onKokoroProgress(onProgress) : null
  if (!loadPromise) {
    const id = nextId++
    loadPromise = new Promise<void>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      getWorker().postMessage({ type: 'load', id })
    }).then(
      () => { ready = true },
      e => { loadPromise = null; throw e },
    )
  }
  return loadPromise.finally(() => off?.())
}

export interface Generation {
  id: number
  promise: Promise<Blob>
  cancel: () => void
}

/** Queue a sentence for synthesis. Priority jobs (voice samples) jump the queue. */
export function generate(text: string, voice: string, opts: { priority?: boolean; speed?: number; padMs?: number; cache?: boolean } = {}): Generation {
  cancelRelease()
  const id = nextId++
  const w = getWorker()
  const promise = new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ type: 'generate', id, text, voice, speed: opts.speed ?? 1, padMs: opts.padMs ?? 0, priority: !!opts.priority, cache: opts.cache })
  })
  promise.catch(() => {})
  return { id, promise, cancel: () => worker?.postMessage({ type: 'cancel', ids: [id] }) }
}

// Voice samples are cached so going back to a voice in the dial is instant.
const samples = new Map<string, Promise<Blob>>()
const pendingSamples = new Map<string, Generation>()

/** Drop queued samples (e.g. when the dial closes) so book audio isn't stuck behind them. */
export function cancelPendingSamples() {
  for (const [voice, g] of pendingSamples) {
    g.cancel()
    samples.delete(voice)
  }
  pendingSamples.clear()
}

export function sampleText(name: string) {
  return `Hi, I'm ${name}. I'll read your book to you.`
}

export function getSample(voice: string, name: string): Promise<Blob> {
  let s = samples.get(voice)
  if (!s) {
    const g = generate(sampleText(name), voice, { priority: true })
    pendingSamples.set(voice, g)
    s = g.promise
    s.then(() => pendingSamples.delete(voice), () => { pendingSamples.delete(voice); samples.delete(voice) })
    samples.set(voice, s)
  }
  return s
}

const VOICE_URL = (id: string) =>
  `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${id}.bin`

/** Download every voice into the same cache kokoro-js reads from, so switching voices works offline. */
export async function prefetchVoices(ids: string[], onProgress?: (done: number) => void) {
  const cache = await caches.open('kokoro-voices')
  let done = 0
  const queue = [...ids]
  const workerCount = 4
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const id = queue.shift()!
      const url = VOICE_URL(id)
      if (!(await cache.match(url))) {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Couldn't download voice ${id}`)
        await cache.put(url, res)
      }
      onProgress?.(++done)
    }
  }))
}
