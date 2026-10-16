/// <reference lib="webworker" />
// PDF text extraction and layout analysis, off the main thread.
import 'pdfjs-dist/build/pdf.worker.min.mjs' // registers pdf.js's worker in this thread
import { extractPdfData } from './pdf'

self.onmessage = async (e: MessageEvent) => {
  const { id, data } = e.data
  try {
    const result = await extractPdfData(data, p => (self as any).postMessage({ id, type: 'progress', progress: p }))
    ;(self as any).postMessage({ id, type: 'done', result })
  } catch (err: any) {
    ;(self as any).postMessage({ id, type: 'error', message: err?.message || 'Failed to read PDF' })
  }
}
