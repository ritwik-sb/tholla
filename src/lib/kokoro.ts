import { KokoroTTS } from 'kokoro-js'

let instance: KokoroTTS | null = null
let loadingPromise: Promise<KokoroTTS> | null = null

export async function loadKokoro(
  onProgress?: (p: { status: string; progress?: number; file?: string }) => void
): Promise<KokoroTTS> {
  if (instance) return instance
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    const model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: onProgress as any,
    })
    instance = model
    return model
  })()
  try {
    return await loadingPromise
  } catch (e) {
    loadingPromise = null
    throw e
  }
}

export function isKokoroLoaded() {
  return instance !== null
}

export async function generateSentence(
  text: string,
  voice: string,
  speed: number
): Promise<Blob> {
  if (!instance) throw new Error('Kokoro not loaded')
  const raw = await (instance as any).generate(text, { voice, speed })
  return raw.toBlob()
}
