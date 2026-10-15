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

function normalizeSpacedCapitals(s: string): string {
  // "H A V E" / "T E A P O T S ." -> "HAVE" / "TEAPOTS."
  return s.replace(/(?:\b[A-Z]\s){2,}[A-Z]\.?/g, m => m.replace(/\s+/g, ''))
}

function isHeadingPara(t: string): boolean {
  const s = t.trim()
  if (!s || s.length > 120) return false
  if (/^(chapter|part|section|prologue|epilogue|rule)\b/i.test(s)) return true
  if (/^\d{1,3}\.\s+[A-Z]/.test(s)) return true
  if (/^[IVXLC]+\.\s/.test(s)) return true
  return false
}

function isHeadingLine(t: string): boolean {
  const s = t.trim()
  if (!s || s.length > 90) return false
  return isHeadingPara(s)
}

export async function extractPdf(file: File): Promise<Extracted> {
  const buf = await file.arrayBuffer()
  const doc = await (pdfjsLib as any).getDocument({ data: buf }).promise
  const numPages = doc.numPages

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
  for (let p = 0; p < pages.length; p++) {
    const items = pages[p]
    const sorted = [...items].sort((a, b) => {
      if (Math.abs(a.y - b.y) > 3) return b.y - a.y
      return a.x - b.x
    })
    const lines: { y: number; items: Item[] }[] = []
    for (const it of sorted) {
      const last = lines[lines.length - 1]
      const tol = last ? Math.max(6, (last.items[0]?.size || it.size || 12) * 0.55) : 0
      if (last && Math.abs(last.y - it.y) <= tol) {
        last.items.push(it)
      } else {
        lines.push({ y: it.y, items: [it] })
      }
    }
    const lineStrings = lines.map(l => {
      l.items.sort((a, b) => a.x - b.x)
      const out: string[] = []
      let prevEnd: number | null = null
      for (const it of l.items) {
        const size = it.size || 12
        const estW = it.w && it.w > 0 ? it.w : Math.max(4, it.str.length * size * 0.5)
        if (prevEnd !== null && it.x - prevEnd > Math.max(2, size * 0.22)) {
          out.push(' ')
        }
        out.push(it.str)
        prevEnd = it.x + estW
      }
      const s = out.join('').replace(/\s{2,}/g, ' ').trim()
      return isHeadingLine(s) ? '\n' + s + '\n' : s
    })

    const filtered = lineStrings.filter(ls => !isLikelyHeaderFooter(ls, lineCounts, numPages))
    pageTexts.push(filtered.join('\n'))
  }

  let raw = pageTexts.join('\n\n')
  raw = raw.replace(/(\w)-\n(\w)/g, '$1$2')
  raw = raw.replace(/([^\n])\n([^\n])/g, '$1 $2')
  raw = raw.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  raw = normalizeSpacedCapitals(raw)

  const FRONT_MATTER_RE = /^(contents|table of contents|index|preface|foreword|acknowledg|copyright|isbn|dedication|about the author)\b/i

  // Try PDF outline (table of contents) first.
  let outlineChapters: { title: string; text: string }[] = []
  try {
    const outline = await doc.getOutline()
    const flat: { title: string; page: number; hasChildren: boolean }[] = []
    const walk = async (items: any[], depth = 0) => {
      for (const it of items || []) {
        let page = -1
        try {
          const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
          if (dest) page = await doc.getPageIndex(dest[0])
        } catch {}
        if (page >= 0) {
          flat.push({ title: normalizeSpacedCapitals(String(it.title || '').replace(/\s+/g, ' ').trim()), page, hasChildren: !!(it.items && it.items.length) })
        }
        await walk(it.items, depth + 1)
      }
    }
    await walk(outline || [])
    // prefer leaf nodes (actual chapters), fall back to all if none
    let candidates = flat.filter(c => !c.hasChildren)
    if (candidates.length < 3) candidates = flat.slice()
    // dedupe by page + title; sort by page
    const seen = new Set<string>()
    candidates = candidates
      .filter(c => c.title && !FRONT_MATTER_RE.test(c.title))
      .filter(c => {
        const k = c.page + '|' + c.title
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .sort((a, b) => a.page - b.page)

    for (let i = 0; i < candidates.length; i++) {
      const cur = candidates[i]
      const next = candidates[i + 1]
      const startPage = cur.page
      const endPage = (next ? next.page : numPages) - 1
      if (endPage < startPage) continue
      const text = pageTexts.slice(startPage, endPage + 1).join('\n\n').trim()
      if (text.length < 200) continue
      outlineChapters.push({ title: cur.title || `Chapter ${i + 1}`, text })
    }
  } catch {
    outlineChapters = []
  }

  if (outlineChapters.length >= 2) {
    return { text: raw, chapters: outlineChapters.slice(0, 100) }
  }

  // Fallback: group by detected headings
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
      const title = curTitle === 'Start' ? '' : curTitle
      const text = [title, body].filter(Boolean).join('\n\n') || raw.slice(0, 500)
      chapters.push({ title: curTitle, text })
    }
    curBody = []
    curTitle = 'Start'
  }
  for (const para of paras) {
    if (isHeadingPara(para)) {
      flush()
      curTitle = para
    } else {
      curBody.push(para)
    }
  }
  flush()

  const filtered = chapters.filter(c => c.text.trim().length > 0)
  const finalChapters = filtered.length ? filtered : [{ title: 'Full text', text: raw }]

  return { text: raw, chapters: finalChapters.slice(0, 100) }
}