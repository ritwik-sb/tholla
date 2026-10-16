import type { Extracted, ExtractProgress } from './pdf'

export type { ExtractProgress } from './pdf'
export { PARSER_VERSION } from './pdf-version'

let nextId = 1

/** Read a PDF in a background worker so the interface stays responsive. */
export async function extractPdf(file: Blob, onProgress?: (p: ExtractProgress) => void): Promise<Extracted> {
  const data = await file.arrayBuffer()
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
  const id = nextId++
  try {
    return await new Promise<Extracted>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data
        if (m.id !== id) return
        if (m.type === 'progress') onProgress?.(m.progress)
        else if (m.type === 'done') resolve(m.result)
        else reject(new Error(m.message))
      }
      worker.onerror = e => reject(new Error(e.message || 'Failed to read PDF'))
      worker.postMessage({ id, data }, [data])
    })
  } finally {
    worker.terminate()
  }
}
