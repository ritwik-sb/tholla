import { useEffect, useState } from 'react'
import { listBooks, deleteBook, saveBook } from '../lib/storage'
import { extractPdf } from '../lib/pdf'
import type { Book } from '../types'

interface Props {
  onOpen: (book: Book) => void
}

export default function Library({ onOpen }: Props) {
  const [books, setBooks] = useState<Book[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => setBooks(await listBooks())
  useEffect(() => { refresh() }, [])

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) continue
        const { text, chapters } = await extractPdf(file)
        const book: Book = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.pdf$/i, ''),
          text,
          chapters,
          createdAt: Date.now(),
        }
        await saveBook(book)
      }
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to import PDF')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-2">PDF Audiobook</h1>
      <p className="text-slate-400 mb-6">Upload a PDF to listen to it like an audiobook. Everything stays in your browser.</p>

      <label className={`block border-2 border-dashed border-slate-600 rounded-2xl p-8 text-center cursor-pointer hover:border-slate-400 transition ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
        <input
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          disabled={busy}
          onChange={e => handleFiles(e.target.files)}
        />
        <div className="text-lg">{busy ? 'Extracting text…' : 'Click or drop PDFs here'}</div>
        <div className="text-sm text-slate-500 mt-1">Works offline after first load</div>
      </label>

      {error && <div className="mt-4 text-red-400">{error}</div>}

      <div className="mt-8 grid gap-3">
        {books.length === 0 && <div className="text-slate-500 text-center py-8">No books yet.</div>}
        {books.map(b => (
          <div key={b.id} className="flex items-center gap-3 bg-slate-800 rounded-xl p-4 overflow-hidden">
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{b.name}</div>
              <div className="text-xs text-slate-400">
                ~{Math.ceil(b.text.split(/\s+/).length / 200)} min read · {b.chapters.length} chapters
              </div>
            </div>
            <button
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium"
              onClick={() => onOpen(b)}
            >
              Open
            </button>
            <button
              className="px-3 py-2 text-slate-400 hover:text-red-400 rounded-lg text-sm"
              onClick={async () => { await deleteBook(b.id); await refresh() }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="mt-10 text-xs text-slate-500">
        Tip: Install this app (browser menu → "Install") to use it like a native app and listen offline.
      </div>
    </div>
  )
}
