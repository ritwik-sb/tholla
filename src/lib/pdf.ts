import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Chapter } from '../types'
import { HEADING_RE } from './pdf-headings'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Bump when extraction changes so previously imported books get re-parsed.
export const PARSER_VERSION = 2

export interface Extracted {
  text: string
  chapters: Chapter[]
}

type Item = { str: string; x: number; y: number; w: number; size: number }
type Line = { y: number; x0: number; x1: number; size: number; text: string }

// Front/back matter that shouldn't be read aloud as a chapter.
const SKIP_TITLE_RE = /^(cover|title page|half title|welcome|contents|table of contents|copyright|dedication|epigraph|also by|other books|praise for|newsletters?|notes|endnotes|bibliography|references|index|acknowledg|about the (author|publisher)|preface|foreword|isbn)\b/i
const TERMINAL_RE = /[.!?:;]["”’')\]]*$/

function normalizeSpacedCapitals(s: string): string {
  // "H A V E" / "T E A P O T S ." -> "HAVE" / "TEAPOTS."
  return s.replace(/(?:\b[A-Z]\s){2,}[A-Z]\.?/g, m => m.replace(/\s+/g, ''))
}

function isHeadingText(t: string): boolean {
  const s = t.trim()
  if (!s || s.length > 80 || /^[a-z]/.test(s)) return false
  const m = s.match(HEADING_RE)
  // "Chapter One" / "Part 2: The Rules" — but not prose like "Rule #4 for more details"
  if (m) return /^\s*([:.\-–—]|$)/.test(s.slice(m[0].length))
  if (/^\d{1,3}\.\s+[A-Z][^.!?]*$/.test(s)) return true
  if (/^[IVXLC]+\.\s+[A-Z][^.!?]*$/.test(s)) return true
  return false
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const mode = (xs: number[]) => {
  const counts = new Map<number, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  let best = xs[0] ?? 0, n = 0
  for (const [x, c] of counts) if (c > n) { best = x; n = c }
  return best
}

function buildLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x))
  const groups: { y: number; items: Item[] }[] = []
  for (const it of sorted) {
    const last = groups[groups.length - 1]
    const tol = last ? Math.max(6, (last.items[0]?.size || it.size || 12) * 0.55) : 0
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it)
    else groups.push({ y: it.y, items: [it] })
  }
  return groups.map(g => {
    g.items.sort((a, b) => a.x - b.x)
    const out: string[] = []
    let prevEnd: number | null = null
    let x1 = 0
    for (const it of g.items) {
      const size = it.size || 12
      const estW = it.w > 0 ? it.w : Math.max(4, it.str.length * size * 0.5)
      if (prevEnd !== null && it.x - prevEnd > Math.max(2, size * 0.22)) out.push(' ')
      out.push(it.str)
      prevEnd = it.x + estW
      x1 = Math.max(x1, prevEnd)
    }
    const nonEmpty = g.items.filter(i => i.str.trim())
    return {
      y: g.y,
      x0: Math.min(...(nonEmpty.length ? nonEmpty : g.items).map(i => i.x)),
      x1,
      size: Math.max(...g.items.map(i => i.size || 12)),
      text: out.join('').replace(/\s{2,}/g, ' ').trim(),
    }
  }).filter(l => l.text)
}

/** Groups a page's lines into paragraphs and reports whether the page starts/ends on a paragraph boundary. */
function pageParagraphs(lines: Line[], bodySize: number): { paras: string[]; startsParagraph: boolean; endsParagraph: boolean } {
  if (!lines.length) return { paras: [], startsParagraph: true, endsParagraph: true }
  const margin = mode(lines.filter(l => l.text.length > 20).map(l => Math.round(l.x0))) || Math.round(Math.min(...lines.map(l => l.x0)))
  const right = Math.max(...lines.map(l => l.x1))
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter(g => g > 0)
  const lineGap = median(gaps) || bodySize * 1.2
  const offSize = (a: number, b: number) => Math.abs(a - b) > Math.max(a, b) * 0.15
  const indented = (l: Line) => l.x0 - margin > 6
  const short = (l: Line) => right - l.x1 > l.size * 3

  const paras: string[][] = []
  lines.forEach((l, i) => {
    const prev = lines[i - 1]
    const brk = !prev ||
      prev.y - l.y > lineGap * 1.6 ||
      offSize(l.size, prev.size) ||
      isHeadingText(l.text) || isHeadingText(prev.text) ||
      (TERMINAL_RE.test(prev.text) && (indented(l) || short(prev)))
    if (brk) paras.push([l.text])
    else paras[paras.length - 1].push(l.text)
  })
  const first = lines[0]
  const last = lines[lines.length - 1]
  return {
    paras: paras.map(joinLines),
    startsParagraph: indented(first) || offSize(first.size, bodySize) || isHeadingText(first.text),
    endsParagraph: offSize(last.size, bodySize) || isHeadingText(last.text) || (TERMINAL_RE.test(last.text) && short(last)),
  }
}

function joinLines(lines: string[]): string {
  let out = ''
  for (const line of lines) {
    if (!out) out = line
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line
    else out += ' ' + line
  }
  return normalizeSpacedCapitals(out.replace(/\s{2,}/g, ' ').trim())
}

function joinPage(full: string, next: string, paragraphBreak: boolean): string {
  if (!full) return next
  if (!next) return full
  if (paragraphBreak) return full + '\n\n' + next
  if (/[A-Za-z]-$/.test(full) && /^[a-z]/.test(next)) return full.slice(0, -1) + next
  return full + ' ' + next
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export type ExtractProgress = { phase: 'opening' | 'pages' | 'chapters'; done: number; total: number }

export async function extractPdf(file: File, onProgress?: (p: ExtractProgress) => void): Promise<Extracted> {
  onProgress?.({ phase: 'opening', done: 0, total: 0 })
  const buf = await file.arrayBuffer()
  const doc = await (pdfjsLib as any).getDocument({ data: buf }).promise
  const numPages: number = doc.numPages

  const pages: Item[][] = []
  for (let p = 1; p <= numPages; p++) {
    onProgress?.({ phase: 'pages', done: p - 1, total: numPages })
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push(
      (content.items as any[])
        .filter(i => typeof i.str === 'string' && i.str.length)
        .map(i => ({
          str: i.str,
          x: i.transform[4],
          y: i.transform[5],
          w: i.width ?? 0,
          size: Math.abs(i.transform[0]) || Math.abs(i.transform[3]) || 12,
        }))
    )
  }

  const pageLines = pages.map(buildLines)

  // Drop running headers/footers: page numbers and lines repeated on many pages.
  const lineCounts = new Map<string, number>()
  for (const lines of pageLines) {
    for (const t of new Set(lines.map(l => l.text))) {
      if (t.length > 3) lineCounts.set(t, (lineCounts.get(t) ?? 0) + 1)
    }
  }
  const repeatLimit = Math.max(2, Math.floor(numPages / 2))
  const cleaned = pageLines.map(lines =>
    lines.filter(l => !/^\d+$/.test(l.text) && (lineCounts.get(l.text) ?? 0) <= repeatLimit)
  )

  const bodySize = median(cleaned.flat().filter(l => l.text.length > 40).map(l => Math.round(l.size * 2) / 2)) || 12

  // Build the full text, remembering where each page begins.
  let full = ''
  let prevEnded = true
  const pageStart: number[] = []
  for (const lines of cleaned) {
    const { paras, startsParagraph, endsParagraph } = pageParagraphs(lines, bodySize)
    const pageText = paras.join('\n\n')
    const before = full
    full = joinPage(full, pageText, startsParagraph || prevEnded)
    if (pageText) prevEnded = endsParagraph
    pageStart.push(pageText ? full.length - pageText.length : before.length)
  }
  full = full.replace(/\n{3,}/g, '\n\n').trim()

  onProgress?.({ phase: 'chapters', done: numPages, total: numPages })
  const chapters = (await outlineChapters(doc, full, pageStart, numPages)) ?? headingChapters(full)
  return { text: full, chapters: chapters.length ? chapters.slice(0, 150) : [{ title: 'Full text', text: full }] }
}

async function outlineChapters(doc: any, full: string, pageStart: number[], numPages: number): Promise<Chapter[] | null> {
  let outline: any[] | null = null
  try { outline = await doc.getOutline() } catch { return null }
  if (!outline?.length) return null

  type Entry = { title: string; page: number; leaf: boolean; depth: number }
  const entries: Entry[] = []
  const walk = async (items: any[], depth: number) => {
    for (const it of items || []) {
      let page = -1
      try {
        const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
        if (Array.isArray(dest) && dest[0] != null) {
          page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0])
        }
      } catch {}
      const title = normalizeSpacedCapitals(String(it.title || '').replace(/\s+/g, ' ').trim())
      if (page >= 0 && page < numPages && title) entries.push({ title, page, leaf: !it.items?.length, depth })
      await walk(it.items, depth + 1)
    }
  }
  await walk(outline, 0)
  if (entries.length < 2) return null

  // Locate each entry's heading on its page so chapters can start mid-page.
  const located = entries.map(e => {
    const from = pageStart[e.page] ?? 0
    const to = pageStart[e.page + 1] ?? full.length
    const pageText = squash(full.slice(from, to))
    const candidates = [e.title, e.title.split(/:\s*/).slice(1).join(' ')].map(squash).filter(c => c.length >= 4)
    let offset = from
    for (const c of candidates) {
      const at = pageText.indexOf(c)
      if (at >= 0) {
        // map the squashed position back approximately by searching the raw slice for the first word
        const firstWord = c.split(' ')[0]
        const raw = full.slice(from, to).toLowerCase()
        const rawAt = raw.indexOf(firstWord, Math.max(0, at - 20))
        offset = from + (rawAt >= 0 ? rawAt : 0)
        // keep a short lead-in like "Chapter One" that sits above the matched title
        if (offset - from < 80) offset = from
        break
      }
    }
    return { ...e, offset }
  })

  const boundaries = [...located].sort((a, b) => a.offset - b.offset || a.depth - b.depth)
  const chapters: Chapter[] = []
  for (let i = 0; i < boundaries.length; i++) {
    const cur = boundaries[i]
    if (!cur.leaf || SKIP_TITLE_RE.test(cur.title)) continue
    const end = boundaries.slice(i + 1).find(b => b.offset > cur.offset)?.offset ?? full.length
    const text = full.slice(cur.offset, end).trim()
    if (text.length < 200) continue
    chapters.push({ title: cur.title, text })
  }
  return chapters.length >= 2 ? chapters : null
}

function headingChapters(full: string): Chapter[] {
  const paras = full.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const chapters: Chapter[] = []
  let title = ''
  let body: string[] = []
  const flush = () => {
    const text = body.join('\n\n').trim()
    if (text && !SKIP_TITLE_RE.test(title)) {
      chapters.push({ title: title || 'Opening', text: [title, text].filter(Boolean).join('\n\n') })
    }
    body = []
  }
  for (const p of paras) {
    if (isHeadingText(p)) { flush(); title = p }
    else body.push(p)
  }
  flush()
  return chapters
}
