/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js'
import { env } from '@huggingface/transformers'
import { modelCache, opfsAvailable } from './model-cache'
import * as speechCache from './audio-cache'

if (opfsAvailable()) {
  env.useCustomCache = true
  env.customCache = modelCache
}
// CPU fallback: leave a core for the UI and the audio thread
const cores = navigator.hardwareConcurrency || 2
;(env.backends.onnx as any).wasm.numThreads = Math.max(1, Math.min(4, cores - 1))

type Job = { id: number; text: string; voice: string; speed: number; padMs: number; cacheable: boolean }

let tts: KokoroTTS | null = null
let loading: Promise<KokoroTTS> | null = null
const queue: Job[] = []
let running = false

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer)

type Dtype = 'fp32' | 'fp16' | 'q8'
type LoadOpts = { dtype: Dtype; device: 'wasm' | 'webgpu' }
let forced: LoadOpts | null = null
let chosen: LoadOpts = { dtype: 'q8', device: 'wasm' }

const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const MODEL_URL = (d: Dtype) =>
  `https://huggingface.co/${REPO}/resolve/main/onnx/model${d === 'fp32' ? '' : d === 'fp16' ? '_fp16' : '_quantized'}.onnx`

const fromPretrained = (o: LoadOpts) =>
  KokoroTTS.from_pretrained(REPO, {
    dtype: o.dtype,
    device: o.device,
    progress_callback: (p: any) => post({ type: 'progress', status: p.status, progress: p.progress, file: p.file, loaded: p.loaded, total: p.total }),
  })

async function gpuAdapter() {
  try { return await (navigator as any).gpu?.requestAdapter() } catch { return null }
}

/**
 * Lightest model that keeps up on this device:
 * - phones with WebGPU + f16 shaders: half precision (163 MB, half the memory and heat)
 * - other WebGPU devices: full precision (fastest and most robust)
 * - no WebGPU: 8-bit model on the CPU
 * A variant already on disk wins over downloading a "better" one.
 */
async function candidates(): Promise<LoadOpts[]> {
  const adapter = await gpuAdapter()
  const list: LoadOpts[] = []
  if (adapter) {
    // fp16 was tried for phones but produces garbled speech on some mobile GPUs
    list.push({ dtype: 'fp32', device: 'webgpu' })
  }
  list.push({ dtype: 'q8', device: 'wasm' })
  if (opfsAvailable()) {
    for (const c of list) {
      if (await modelCache.match(MODEL_URL(c.dtype))) return [c, ...list.filter(x => x !== c)]
    }
  }
  return list
}

// A broken GPU path (some mobile drivers with f16) returns NaN or silence: detect and fall back.
async function healthy(m: KokoroTTS) {
  const a = await m.generate('Ready.', { voice: 'af_heart' })
  const s = a.audio as Float32Array
  let peak = 0
  for (let i = 0; i < s.length; i++) {
    const x = s[i]
    if (Number.isNaN(x)) return false
    if (Math.abs(x) > peak) peak = Math.abs(x)
  }
  return peak > 0.01
}

async function pickAndLoad() {
  if (opfsAvailable()) modelCache.remove(MODEL_URL('fp16')) // no longer used; free 163 MB
  const auto = await candidates()
  const f = forced
  const list = f ? [f, ...auto.filter(c => c.dtype !== f.dtype || c.device !== f.device)] : auto
  let lastErr: unknown = null
  for (const c of list) {
    try {
      const m = await fromPretrained(c)
      // also compiles the GPU shaders so the first real sentence is quick
      if (!(await healthy(m)) && c !== list[list.length - 1]) { try { await (m as any).model?.dispose?.() } catch {} continue }
      chosen = c
      return m
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error('Failed to load voice model')
}

function load() {
  if (tts) return Promise.resolve(tts)
  if (!loading) {
    loading = pickAndLoad().then(m => (tts = m))
    loading.catch(() => { loading = null })
  }
  return loading
}

// 16-bit PCM WAV with trailing silence. Baking the pause between sentences into the
// audio keeps playback continuous, so it isn't throttled when the screen is off.
function encodeWav(samples: Float32Array, rate: number, padMs: number) {
  const pad = Math.round((rate * padMs) / 1000)
  const n = samples.length + pad
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

// Text the model can't voice ("…", "...", footnote marks) produces noise; turn it into pauses.
function forSpeech(text: string) {
  return text
    .replace(/[*†‡§¶]+/g, ' ')
    .replace(/(?:\.\s*){2,}|…+/g, ', ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/,\s*(?=[,.!?;:])/g, '')
    .replace(/,\s*(?=["”’')\]]*\s*$)/, '.')
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// The model silently drops anything past ~510 phonemes (~400 chars of English).
// Split long text at natural breaks so nothing is cut off.
const MAX_PIECE = 260
export function splitForModel(text: string): string[] {
  if (text.length <= MAX_PIECE) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > MAX_PIECE) {
    const window = rest.slice(0, MAX_PIECE)
    let cut = -1
    for (const re of [/[.!?;:][”"’')\]]*\s/g, /[,—–][”"’')\]]*\s/g, /\s(?:and|but|or|which|who|that|while|because)\s/g, /\s/g]) {
      let m: RegExpExecArray | null
      let last = -1
      re.lastIndex = 0
      while ((m = re.exec(window))) if (m.index > MAX_PIECE * 0.4) last = m.index + (re.source.startsWith('\\s') ? 0 : m[0].length - 1)
      if (last > 0) { cut = last; break }
    }
    if (cut <= 0) cut = MAX_PIECE
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out.filter(Boolean)
}

async function synthesize(model: KokoroTTS, text: string, voice: string, speed: number) {
  const pieces = splitForModel(text)
  const parts: Float32Array[] = []
  let rate = 24000
  for (const p of pieces) {
    const a = await model.generate(p, { voice: voice as any, speed })
    rate = a.sampling_rate
    parts.push(a.audio as Float32Array)
  }
  if (parts.length === 1) return { samples: parts[0], rate }
  const gap = Math.round(rate * 0.12)
  const n = parts.reduce((s, p) => s + p.length, 0) + gap * (parts.length - 1)
  const out = new Float32Array(n)
  let o = 0
  parts.forEach((p, i) => { out.set(p, o); o += p.length + (i < parts.length - 1 ? gap : 0) })
  return { samples: out, rate }
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      try {
        const text = forSpeech(job.text)
        if (!/[\p{L}\p{N}]/u.test(text)) {
          // nothing speakable: just a short silence so the rhythm continues
          post({ type: 'audio', id: job.id, blob: encodeWav(new Float32Array(0), 24000, job.padMs + 400), cached: true })
          continue
        }
        const model = await load()
        const useCache = job.cacheable && job.speed === 1 && speechCache.cacheAvailable()
        const key = useCache ? await speechCache.cacheKey(`${chosen.device}-${chosen.dtype}|${job.voice}`, text) : ''
        const hit = useCache ? await speechCache.load(key) : null
        if (hit) {
          post({ type: 'audio', id: job.id, blob: encodeWav(hit.samples, hit.rate, job.padMs), cached: true, speechMs: (hit.samples.length / hit.rate) * 1000 })
          continue
        }
        const clip = await synthesize(model, text, job.voice, job.speed)
        post({ type: 'audio', id: job.id, blob: encodeWav(clip.samples, clip.rate, job.padMs), cached: false, speechMs: (clip.samples.length / clip.rate) * 1000 })
        if (useCache) speechCache.store(key, clip)
      } catch (e: any) {
        post({ type: 'error', id: job.id, message: e?.message || 'TTS error' })
      }
    }
  } finally {
    running = false
  }
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'config') {
    if (m.opts?.device && m.opts?.dtype && m.opts.dtype !== 'fp16' && !tts && !loading) forced = m.opts
  } else if (m.type === 'load') {
    load().then(
      () => post({ type: 'ready', id: m.id, device: chosen.device, dtype: chosen.dtype }),
      (err: any) => post({ type: 'error', id: m.id, message: err?.message || 'Failed to load voice model' }),
    )
  } else if (m.type === 'generate') {
    const job: Job = { id: m.id, text: m.text, voice: m.voice, speed: m.speed ?? 1, padMs: m.padMs ?? 0, cacheable: m.cache !== false }
    if (m.priority) queue.unshift(job)
    else queue.push(job)
    pump()
  } else if (m.type === 'cancel') {
    const ids = new Set<number>(m.ids)
    for (let i = queue.length - 1; i >= 0; i--) {
      if (ids.has(queue[i].id)) {
        post({ type: 'cancelled', id: queue[i].id })
        queue.splice(i, 1)
      }
    }
  }
}
