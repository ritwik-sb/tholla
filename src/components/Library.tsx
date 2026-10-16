import { useEffect, useState } from 'react'
import { listBooks, deleteBook, saveBook, saveFile, getFile, getProgress, saveProgress, resetProgress } from '../lib/storage'
import { extractPdf, PARSER_VERSION } from '../lib/pdf'
import type { Book } from '../types'

interface Props {
  onOpen: (book: Book) => void
}

export default function Library({ onOpen }: Props) {
  const [books, setBooks] = useState<Book[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const refresh = async () => {
    const list = await listBooks()
    setBooks(list)
    return list
  }

  useEffect(() => {
    // Re-process books imported with an older parser, when we still have their PDF.
    refresh().then(async list => {
      let changed = false
      for (const b of list) {
        if ((b.parserVersion ?? 1) >= PARSER_VERSION) continue
        const pdf = await getFile(b.id)
        if (!pdf) continue
        try {
          await reimport(b, pdf)
          changed = true
        } catch {}
      }
      if (changed) refresh()
    })
  }, [])

  const reimport = async (existing: Book | undefined, file: Blob, name?: string) => {
    const { text, chapters } = await extractPdf(file as File)
    const book: Book = {
      id: existing?.id ?? crypto.randomUUID(),
      name: existing?.name ?? (name ?? 'Untitled').replace(/\.pdf$/i, ''),
      text,
      chapters,
      createdAt: existing?.createdAt ?? Date.now(),
      parserVersion: PARSER_VERSION,
    }
    if (existing) {
      // chapters changed: keep the reader on the same chapter title if it still exists
      const p = await getProgress(existing.id)
      const title = existing.chapters?.[p.chapterIndex]?.title
      const idx = title ? chapters.findIndex(c => c.title === title) : -1
      if (idx > 0) await saveProgress(existing.id, idx, 0)
      else await resetProgress(existing.id)
    }
    await saveBook(book)
    await saveFile(book.id, file)
    return book
  }

  const handleFiles = async (files: FileList | null, target?: Book) => {
    if (!files || !files.length) return
    setBusy(true)
    setError(null)
    const errs: string[] = []
    try {
      for (const file of Array.from(files)) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          errs.push(`${file.name}: not a PDF`)
          continue
        }
        try {
          const name = file.name.replace(/\.pdf$/i, '')
          const existing = target ?? books.find(b => b.name === name)
          await reimport(existing, file, file.name)
        } catch (e: any) {
          errs.push(`${file.name}: ${e?.message || 'failed to import'}`)
        }
      }
      if (errs.length) setError(errs.join(' · '))
      await refresh()
    } finally {
      setBusy(false)
      setDragging(false)
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-2">തൊള്ള</h1>
      <p className="text-slate-400 mb-6">Upload a PDF to listen to it like an audiobook. Everything stays in your browser.</p>

      <label
        className={`block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition ${dragging ? 'border-indigo-400 bg-slate-800' : 'border-slate-600 hover:border-slate-400'} ${busy ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={e => { if (!busy) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { if (!busy) { e.preventDefault(); handleFiles(e.dataTransfer.files) } }}
      >
        <input
          type="file"
          accept="application/pdf"
          multiple
          className="sr-only"
          disabled={busy}
          aria-label="Choose PDF files to import"
          onChange={e => handleFiles(e.target.files)}
        />
        <div className="text-lg">{busy ? 'Extracting text…' : (dragging ? 'Drop PDFs here' : 'Click or drop PDFs here')}</div>
        <div className="text-sm text-slate-400 mt-1">Works offline after first load · PDF only</div>
      </label>

      {error && <div className="mt-4 text-red-400">{error}</div>}

      <div className="mt-8 grid gap-3">
        {books.length === 0 && (
          <div className="text-center py-10">
            <p className="text-base font-medium text-slate-200">No books yet</p>
            <p className="text-sm text-slate-400 mt-1">Choose a PDF above to start listening.</p>
          </div>
        )}
        {books.map(b => (
          <div key={b.id} className="flex items-center gap-3 bg-slate-800 rounded-xl p-4 overflow-hidden">
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{b.name}</div>
              <div className="text-xs text-slate-300">
                ~{Math.ceil((b.text.split(/\s+/).filter(Boolean).length || 1) / 200)} min read · {(b.chapters?.length ?? 0)} chapters
              </div>
              {(b.parserVersion ?? 1) < PARSER_VERSION && (
                <label className="mt-1 inline-flex items-center gap-1 text-xs text-amber-300 cursor-pointer underline">
                  Chapters may be wrong — re-add this PDF to fix
                  <input
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    disabled={busy}
                    aria-label={`Re-add PDF for ${b.name} to fix chapters`}
                    onChange={e => handleFiles(e.target.files, b)}
                  />
                </label>
              )}
            </div>
            <button
              className="min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
              onClick={() => onOpen(b)}
            >
              Open
            </button>
            {confirmDelete === b.id ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-300">Delete?</span>
                <button
                  className="min-h-[44px] px-3 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-red-400"
                  onClick={async () => { await deleteBook(b.id); setConfirmDelete(null); await refresh() }}
                >
                  Yes
                </button>
                <button
                  className="min-h-[44px] px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="min-h-[44px] px-3 py-2 text-slate-300 hover:text-red-400 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
                aria-label={`Delete ${b.name}`}
                onClick={() => setConfirmDelete(b.id)}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-10 text-xs text-slate-500">
        Tip: Install this app (browser menu → "Install") to use it like a native app and listen offline.
      </div>
    </main>
  )
}
