import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function isLikelyHeaderFooter(line: string, repeated: Map<string, number>, pages: number) {
  const t = line.trim()
  if (!t) return false
  if (/^\d+$/.test(t)) return true
  const count = repeated.get(t) ?? 0
  // remove if appears on more than half the pages
  return count > Math.max(2, Math.floor(pages / 2))
}

import type { Chapter } from '../types'

export interface Extracted {
  text: string
  chapters: Chapter[]
}

export async function extractPdf(file: File): Promise<Extracted> {
  const buf = await file.arrayBuffer()
  const doc = await (pdfjsLib as any).getDocument({ data: buf }).promise
  const numPages = doc.numPages

  // collect per-page text items with geometry
  type Item = { str: string; x: number; y: number; w: number; h: number; size: number }
  const pages: Item[][] = []
  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const items: Item[] = (content.items as any[])
      .filter(i => typeof i.str === 'string')
      .map(i => ({
        str: i.str,
        x: i.transform[4],
        y: i.transform[5],
        w: i.width ?? 0,
        h: i.height ?? Math.abs(i.transform[0]) ?? 12,
        size: Math.abs(i.transform[0]) || 12,
      }))
    pages.push(items)
  }

  // header/footer detection: identical trimmed strings appearing on many pages
  const lineCounts = new Map<string, number>()
  for (const items of pages) {
    const seen = new Set<string>()
    for (const it of items) {
      const t = it.str.trim()
      if (t.length > 3 && !seen.has(t)) {
        seen.add(t)
        lineCounts.set(t, (lineCounts.get(t) ?? 0) + 1)
      }
    }
  }

  const pageTexts: string[] = []
  const chapterSet = new Set<string>()
  let detectedChapters: string[] = []

  for (let p = 0; p < pages.length; p++) {
    const items = pages[p]
    // sort by y desc then x asc (pdf origin bottom-left)
    const sorted = [...items].sort((a, b) => {
      if (Math.abs(a.y - b.y) > 3) return b.y - a.y
      return a.x - b.x
    })
    // group into lines by y proximity
    const lines: { y: number; items: Item[] }[] = []
    for (const it of sorted) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.y - it.y) < 4) {
        last.items.push(it)
      } else {
        lines.push({ y: it.y, items: [it] })
      }
    }
    const lineStrings = lines.map(l => {
      l.items.sort((a, b) => a.x - b.x)
      return l.items.map(i => i.str).join('')
    })

    // dehyphenate across line breaks handled later
    const filtered = lineStrings.filter(ls => !isLikelyHeaderFooter(ls, lineCounts, numPages))

    // chapter detection: lines with larger font or starting with Chapter/Section/digits.
    for (const l of lines) {
      const text = l.items.map(i => i.str).join('').trim()
      if (!text || text.length > 80) continue
      const avgSize = l.items.reduce((s, i) => s + i.size, 0) / l.items.length
      const isHeading = avgSize >= 15 || /^(chapter|section|part)\b/i.test(text) || /^\d{1,2}\.\s+[A-Z]/.test(text) || /^[IVXLC]+\.\s/.test(text)
      if (isHeading && !chapterSet.has(text)) {
        chapterSet.add(text)
        detectedChapters.push(text)
      }
    }

    pageTexts.push(filtered.join('\n'))
  }

  // join pages; dehyphenate line wraps
  let raw = pageTexts.join('\n\n')
  // fix hyphenated line breaks: word-\nword
  raw = raw.replace(/(\w)-\n(\w)/g, '$1$2')
  // collapse single newlines within paragraphs but keep blank-line paragraph breaks
  raw = raw.replace(/([^\n])\n([^\n])/g, '$1 $2')
  // normalize whitespace
  raw = raw.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  // Group the cleaned text into chapters by detected headings.
  const FRONT_MATTER_RE = /^(contents|table of contents|index|preface|foreword|acknowledg|copyright|isbn|dedication|about the author)\b/i
  const isHeading = (para: string) => {
    const t = para.trim()
    if (!t || t.length > 120) return false
    if (/^(chapter|part|section|prologue|epilogue)\b/i.test(t)) return true
    if (/^\d{1,2}\.\s+[A-Z]/.test(t)) return true
    if (/^[IVXLC]+\.\s/.test(t)) return true
    return false
  }

  const paras = raw.split(/\n{2,}/).map(x => x.trim()).filter(Boolean)
  const chapters: { title: string; text: string }[] = []
  let curTitle = 'Start'
  let curBody: string[] = []
  const flush = () => {
    const body = curBody.join('\n\n').trim()
    if (FRONT_MATTER_RE.test(curTitle)) {
      curBody = []
      curTitle = 'Start'
      return
    }
    if (body.length > 0 || chapters.length === 0) {
      chapters.push({ title: curTitle, text: body || raw.slice(0, 500) })
    }
    curBody = []
    curTitle = 'Start'
  }
  for (const para of paras) {
    if (isHeading(para)) {
      flush()
      curTitle = para
    } else {
      if (curTitle === 'Start' && curBody.length === 0 && para.length < 200 && paras.length > 5) {
        // possibly leading front matter under implicit Start; keep it
      }
      curBody.push(para)
    }
  }
  flush()

  const filtered = chapters.filter(c => c.text.trim().length > 0)
  const finalChapters = filtered.length ? filtered : [{ title: 'Full text', text: raw }]

  return { text: raw, chapters: finalChapters.slice(0, 100) }
}
