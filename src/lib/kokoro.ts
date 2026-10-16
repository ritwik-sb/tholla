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

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') {
        progressListeners.forEach(l => l(m))
        return
      }
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.type === 'audio') p.resolve(m.blob)
      else if (m.type === 'ready') { device = m.device ?? null; p.resolve(undefined) }
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
export function generate(text: string, voice: string, opts: { priority?: boolean; speed?: number; padMs?: number } = {}): Generation {
  const id = nextId++
  const promise = new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ type: 'generate', id, text, voice, speed: opts.speed ?? 1, padMs: opts.padMs ?? 0, priority: !!opts.priority })
  })
  promise.catch(() => {})
  return { id, promise, cancel: () => getWorker().postMessage({ type: 'cancel', ids: [id] }) }
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
