/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js'
import { env } from '@huggingface/transformers'
import { modelCache, opfsAvailable } from './model-cache'

if (opfsAvailable()) {
  env.useCustomCache = true
  env.customCache = modelCache
}

type Job = { id: number; text: string; voice: string; speed: number; padMs: number }

let tts: KokoroTTS | null = null
let loading: Promise<KokoroTTS> | null = null
const queue: Job[] = []
let running = false

const post = (msg: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)

type LoadOpts = { dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'; device: 'wasm' | 'webgpu' }
let forced: LoadOpts | null = null
let device: LoadOpts['device'] = 'wasm'

const fromPretrained = (o: LoadOpts) =>
  KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: o.dtype,
    device: o.device,
    progress_callback: (p: any) => post({ type: 'progress', status: p.status, progress: p.progress, file: p.file, loaded: p.loaded, total: p.total }),
  })

export async function hasWebGPU() {
  try {
    return !!(await (navigator as any).gpu?.requestAdapter())
  } catch {
    return false
  }
}

// WebGPU (full precision) generates ~6x faster than real time; the CPU build is
// barely real time, so it's only a fallback.
async function pickAndLoad() {
  if (forced) { device = forced.device; return fromPretrained(forced) }
  if (await hasWebGPU()) {
    try {
      const m = await fromPretrained({ dtype: 'fp32', device: 'webgpu' })
      device = 'webgpu'
      return m
    } catch {}
  }
  device = 'wasm'
  return fromPretrained({ dtype: 'q8', device: 'wasm' })
}

function load() {
  if (tts) return Promise.resolve(tts)
  if (!loading) {
    loading = pickAndLoad().then(async m => {
      // one throwaway generation compiles the GPU shaders so the first real sentence is quick
      try { await m.generate('Ready.', { voice: 'af_heart' }) } catch {}
      return (tts = m)
    })
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

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      try {
        const model = await load()
        const text = forSpeech(job.text)
        if (!/[\p{L}\p{N}]/u.test(text)) {
          // nothing speakable: just a short silence so the rhythm continues
          post({ type: 'audio', id: job.id, blob: encodeWav(new Float32Array(0), 24000, job.padMs + 400) })
          continue
        }
        const audio = await model.generate(text, { voice: job.voice as any, speed: job.speed })
        post({ type: 'audio', id: job.id, blob: encodeWav(audio.audio as Float32Array, audio.sampling_rate, job.padMs) })
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
  if (m.type === 'load') {
    if (m.opts && !tts && !loading) forced = m.opts
    load().then(
      () => post({ type: 'ready', id: m.id, device }),
      (err: any) => post({ type: 'error', id: m.id, message: err?.message || 'Failed to load voice model' }),
    )
  } else if (m.type === 'generate') {
    const job: Job = { id: m.id, text: m.text, voice: m.voice, speed: m.speed, padMs: m.padMs ?? 0 }
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
