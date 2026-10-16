import { useEffect, useState } from 'react'
import { listBooks, deleteBook, saveBook, saveFile, getFile, getProgress, saveProgress, resetProgress } from '../lib/storage'
import { extractPdf, PARSER_VERSION, type ExtractProgress } from '../lib/pdf'
import type { Book } from '../types'
import { Case, Grille, Icon, SerialPlate, Wordmark } from './radio'

interface Props {
  onOpen: (book: Book) => void
}

export default function Library({ onOpen }: Props) {
  const [books, setBooks] = useState<Book[]>([])
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<(ExtractProgress & { name: string; index: number; count: number }) | null>(null)
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

  const reimport = async (existing: Book | undefined, file: Blob, name?: string, onProgress?: (p: ExtractProgress) => void) => {
    const { text, chapters } = await extractPdf(file as File, onProgress)
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
      const list = Array.from(files)
      for (const [index, file] of list.entries()) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          errs.push(`${file.name}: not a PDF`)
          continue
        }
        try {
          const name = file.name.replace(/\.pdf$/i, '')
          const existing = target ?? books.find(b => b.name === name)
          await reimport(existing, file, file.name, p => setJob({ ...p, name, index, count: list.length }))
        } catch (e: any) {
          errs.push(`${file.name}: ${e?.message || 'failed to import'}`)
        }
      }
      if (errs.length) setError(errs.join(' · '))
      await refresh()
    } finally {
      setBusy(false)
      setJob(null)
      setDragging(false)
    }
  }

  const minutes = (b: Book) => Math.ceil((b.text.split(/\s+/).filter(Boolean).length || 1) / 200)
  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

  return (
    <main className="min-h-dvh flex justify-center md:p-6">
      <Case className="w-full max-w-3xl md:rounded-[30px] px-5 pt-8 pb-10 md:px-10 flex flex-col gap-6">
        <header className="flex flex-col items-center gap-2 pt-2">
          <Wordmark heading size="text-6xl md:text-7xl" />
          <p className="stamp text-[10px] engraved-dark text-center">Book receiver · Model 82M · Made for listening</p>
        </header>

        <div className="relative">
          <Grille rows={7} />
          <span className="brass stamp text-[10px] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1 whitespace-nowrap flex items-center gap-2">
            {busy && <span className="lamp lamp-sm on blink" aria-hidden="true" />}
            {busy ? 'Receiving' : 'High fidelity'}
          </span>
        </div>

        <label
          className={`panel block px-5 py-5 text-center cursor-pointer transition ${dragging ? 'ring-2 ring-[var(--amber)]' : ''} ${busy ? 'pointer-events-none' : ''}`}
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
          {/* the slot a book is "inserted" into; it lights up and scans while a PDF is read */}
          <span className={`book-slot ${busy ? 'scanning' : ''}`} aria-hidden="true" />
          {busy ? (
            <span className="block mt-4" role="status" aria-live="polite">
              <span className="flex justify-center gap-3" aria-hidden="true">
                {[0, 1, 2, 3, 4].map(i => (
                  <span key={i} className="lamp lamp-sm on flicker" style={{ animationDelay: `${i * -0.37}s`, animationDuration: `${0.9 + (i % 3) * 0.35}s` }} />
                ))}
              </span>
              <span className="dial-window block mt-4 mx-auto max-w-[320px] px-4 pt-2 pb-3">
                <span className="tuning block">
                  <span
                    className={`needle ${job?.phase === 'pages' ? '' : 'sweep'}`}
                    style={job?.phase === 'pages' && job.total ? { left: `${(job.done / job.total) * 100}%` } : undefined}
                  />
                </span>
                <span className="block mt-2 stamp text-[11px] text-[var(--amber-text)] tabular-nums">
                  {!job || job.phase === 'opening' ? 'Opening the book…'
                    : job.phase === 'pages' ? `Reading page ${job.done + 1} of ${job.total}`
                    : 'Finding the chapters…'}
                </span>
              </span>
              {job && (
                <span className="block mt-2 stamp text-[10px] engraved-dark truncate">
                  {job.count > 1 ? `${job.index + 1} of ${job.count} · ` : ''}{job.name}
                </span>
              )}
            </span>
          ) : (
            <>
              <span className="block mt-3 stamp text-sm engraved">{dragging ? 'Release to insert' : 'Insert a PDF'}</span>
              <span className="block mt-1 stamp text-[10px] engraved-dark">Tap to choose · or drop it here</span>
            </>
          )}
        </label>

        {error && <p className="stamp text-xs text-red-300 text-center">{error}</p>}

        <section aria-label="Bookshelf" className="flex flex-col gap-3">
          <h2 className="stamp text-[11px] engraved text-center">Bookshelf</h2>
          {books.length === 0 && (
            <div className="panel px-5 py-8 text-center">
              <p className="stamp text-sm engraved">No books yet</p>
              <p className="stamp text-[10px] engraved-dark mt-1">Insert a PDF to start listening</p>
            </div>
          )}
          {books.map(b => (
            <div key={b.id} className="panel flex items-center gap-3 p-3 pl-4">
              <div className="flex-1 min-w-0">
                <div className="brass px-3 py-1.5">
                  <div className="stamp text-[12px] tracking-[.1em] truncate">{b.name}</div>
                </div>
                <div className="stamp text-[10px] engraved-dark mt-1.5 px-1">
                  {hours(minutes(b))} · {b.chapters?.length ?? 0} bands
                </div>
                {(b.parserVersion ?? 1) < PARSER_VERSION && (
                  <label className="mt-1 px-1 inline-flex stamp text-[10px] text-amber-200 underline cursor-pointer">
                    Chapters may be off — re-insert this PDF
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
              {confirmDelete === b.id ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="key small red"
                    onClick={async () => { await deleteBook(b.id); setConfirmDelete(null); await refresh() }}
                  >
                    Eject
                  </button>
                  <button type="button" className="key small" onClick={() => setConfirmDelete(null)}>Keep</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button type="button" className="key dark" onClick={() => onOpen(b)} aria-label={`Play ${b.name}`}>
                    <Icon name="play" />
                  </button>
                  <button type="button" className="key small" aria-label={`Remove ${b.name}`} onClick={() => setConfirmDelete(b.id)}>
                    <Icon name="eject" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>

        <div className="mt-auto pt-4 flex flex-col items-center gap-3">
          <SerialPlate />
          <p className="stamp text-[9px] engraved-dark text-center">
            Books and voices stay on this device · Install from the browser menu to use offline
          </p>
        </div>
      </Case>
    </main>
  )
}
