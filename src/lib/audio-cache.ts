/// <reference lib="webworker" />
// Generated speech is stored on-device (OPFS) so a sentence is only ever synthesised once
// per voice. Opus via WebCodecs when available (~16 kB/s), otherwise 16-bit PCM.
// Runs inside the TTS worker.

const DIR = 'speech'
const CAP_BYTES = 600e6
const MAGIC = 0x54414331 // "TAC1"
const PCM = 0, OPUS = 1
const OPUS_BITRATE = 32000

export type Clip = { samples: Float32Array; rate: number }

let dirPromise: Promise<FileSystemDirectoryHandle> | null = null
const dir = () => (dirPromise ??= navigator.storage.getDirectory().then(r => r.getDirectoryHandle(DIR, { create: true })))

export const cacheAvailable = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory

export async function cacheKey(voice: string, text: string) {
  const bytes = new TextEncoder().encode(`v1|${voice}|${text}`)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash.subarray(0, 16), b => b.toString(16).padStart(2, '0')).join('')
}

// ── Opus support detection ───────────────────────────────────────
let opusOk: Promise<boolean> | null = null
function opusSupported(rate: number) {
  return (opusOk ??= (async () => {
    try {
      const AE = (self as any).AudioEncoder, AD = (self as any).AudioDecoder
      if (!AE || !AD) return false
      const enc = await AE.isConfigSupported({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: OPUS_BITRATE })
      const dec = await AD.isConfigSupported({ codec: 'opus', sampleRate: rate, numberOfChannels: 1 })
      return !!(enc.supported && dec.supported)
    } catch {
      return false
    }
  })())
}

async function encodeOpus(samples: Float32Array, rate: number) {
  const chunks: Uint8Array[] = []
  let description: Uint8Array | null = null
  const AE = (self as any).AudioEncoder
  let failure: any = null
  const enc = new AE({
    output: (chunk: any, meta: any) => {
      const b = new Uint8Array(chunk.byteLength)
      chunk.copyTo(b)
      chunks.push(b)
      if (meta?.decoderConfig?.description && !description) {
        description = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer
          ? meta.decoderConfig.description
          : (meta.decoderConfig.description as ArrayBufferView).buffer.slice(0))
      }
    },
    error: (e: any) => { failure = e },
  })
  enc.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: OPUS_BITRATE })
  const FRAME = Math.round(rate * 0.02)
  for (let i = 0; i < samples.length; i += FRAME * 50) {
    const part = samples.subarray(i, Math.min(samples.length, i + FRAME * 50))
    const data = new (self as any).AudioData({
      format: 'f32-planar', sampleRate: rate, numberOfFrames: part.length, numberOfChannels: 1,
      timestamp: Math.round((i / rate) * 1e6), data: part.slice(),
    })
    enc.encode(data)
    data.close()
  }
  await enc.flush()
  enc.close()
  if (failure) throw failure
  return { chunks, description: description as Uint8Array | null }
}

async function decodeOpus(chunks: Uint8Array[], rate: number, description: Uint8Array | null, want: number): Promise<Clip> {
  const AD = (self as any).AudioDecoder
  const parts: Float32Array[] = []
  let outRate = rate
  let failure: any = null
  const dec = new AD({
    output: (d: any) => {
      outRate = d.sampleRate
      const f = new Float32Array(d.numberOfFrames)
      d.copyTo(f, { planeIndex: 0, format: 'f32-planar' })
      parts.push(f)
      d.close()
    },
    error: (e: any) => { failure = e },
  })
  dec.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, ...(description ? { description } : {}) })
  let ts = 0
  for (const c of chunks) {
    dec.decode(new (self as any).EncodedAudioChunk({ type: 'key', timestamp: ts, data: c }))
    ts += 20000
  }
  await dec.flush()
  dec.close()
  if (failure) throw failure
  let n = 0
  for (const p of parts) n += p.length
  const all = new Float32Array(n)
  let o = 0
  for (const p of parts) { all.set(p, o); o += p.length }
  // Opus adds a little padding at the end; trim back to the original length
  const target = Math.round(want * (outRate / rate))
  return { samples: all.length > target ? all.subarray(0, target) : all, rate: outRate }
}

// ── storage ──────────────────────────────────────────────────────
let sizes: Map<string, { size: number; time: number }> | null = null
async function index() {
  if (sizes) return sizes
  sizes = new Map()
  const d = await dir()
  for await (const [name, h] of (d as any).entries()) {
    if (h.kind !== 'file') continue
    try {
      const f = await (h as FileSystemFileHandle).getFile()
      sizes.set(name, { size: f.size, time: f.lastModified })
    } catch {}
  }
  return sizes
}

async function evict() {
  const idx = await index()
  let total = 0
  for (const v of idx.values()) total += v.size
  if (total <= CAP_BYTES) return
  const d = await dir()
  const oldest = [...idx.entries()].sort((a, b) => a[1].time - b[1].time)
  for (const [name, v] of oldest) {
    if (total <= CAP_BYTES * 0.8) break
    try { await d.removeEntry(name) } catch {}
    idx.delete(name)
    total -= v.size
  }
}

async function writeFile(name: string, data: Uint8Array<ArrayBuffer>) {
  const d = await dir()
  const h = await d.getFileHandle(name, { create: true })
  const a = await (h as any).createSyncAccessHandle()
  try { a.truncate(0); a.write(data, { at: 0 }); a.flush() } finally { a.close() }
  const idx = await index()
  idx.set(name, { size: data.byteLength, time: Date.now() })
}

export async function store(key: string, clip: Clip) {
  try {
    const n = clip.samples.length
    let body: Uint8Array
    let codec = PCM
    let desc: Uint8Array = new Uint8Array(0)
    if (await opusSupported(clip.rate)) {
      try {
        const { chunks, description } = await encodeOpus(clip.samples, clip.rate)
        codec = OPUS
        if (description) desc = description
        let len = 0
        for (const c of chunks) len += 4 + c.byteLength
        body = new Uint8Array(len)
        const v = new DataView(body.buffer)
        let o = 0
        for (const c of chunks) { v.setUint32(o, c.byteLength, true); body.set(c, o + 4); o += 4 + c.byteLength }
      } catch {
        codec = PCM
        body = pcm16(clip.samples)
      }
    } else {
      body = pcm16(clip.samples)
    }
    const head = new Uint8Array(20 + desc.byteLength)
    const hv = new DataView(head.buffer)
    hv.setUint32(0, MAGIC, true); hv.setUint32(4, codec, true); hv.setUint32(8, clip.rate, true)
    hv.setUint32(12, n, true); hv.setUint32(16, desc.byteLength, true)
    head.set(desc, 20)
    const file = new Uint8Array(head.byteLength + body.byteLength)
    file.set(head, 0); file.set(body, head.byteLength)
    await writeFile(key, file)
    await evict()
  } catch {
    // caching is best-effort
  }
}

export async function load(key: string): Promise<Clip | null> {
  try {
    const d = await dir()
    const h = await d.getFileHandle(key)
    const buf = new Uint8Array(await (await h.getFile()).arrayBuffer())
    const v = new DataView(buf.buffer)
    if (buf.byteLength < 20 || v.getUint32(0, true) !== MAGIC) return null
    const codec = v.getUint32(4, true), rate = v.getUint32(8, true), n = v.getUint32(12, true), dl = v.getUint32(16, true)
    const desc = dl ? buf.slice(20, 20 + dl) : null
    const body = buf.subarray(20 + dl)
    if (codec === PCM) {
      const s = new Int16Array(body.buffer.slice(body.byteOffset, body.byteOffset + n * 2))
      const f = new Float32Array(n)
      for (let i = 0; i < n; i++) f[i] = s[i] / 32768
      return { samples: f, rate }
    }
    const chunks: Uint8Array[] = []
    const bv = new DataView(body.buffer, body.byteOffset, body.byteLength)
    for (let o = 0; o + 4 <= body.byteLength;) {
      const len = bv.getUint32(o, true)
      chunks.push(body.subarray(o + 4, o + 4 + len))
      o += 4 + len
    }
    return await decodeOpus(chunks, rate, desc, n)
  } catch {
    return null
  }
}

function pcm16(samples: Float32Array) {
  const out = new Uint8Array(samples.length * 2)
  const v = new DataView(out.buffer)
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return out
}
