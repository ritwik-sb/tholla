import { HEADING_RE } from './pdf-headings'

export interface Reading {
  sentences: string[]
  pauseAfter: number[]
  startIndex: number
}

// Words that end in a period without ending the sentence.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'ft', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp',
  'no', 'vol', 'fig', 'pp', 'ed', 'eds', 'gen', 'col', 'lt', 'sgt', 'capt', 'rev', 'hon', 'jan', 'feb',
  'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'approx', 'dept', 'est',
])

function splitSentences(text: string): string[] {
  const parts: string[] = []
  // candidate boundary: terminal punctuation, optional closing quotes/brackets, then whitespace
  const re = /[.!?…]+["”’')\]]*(?=\s+)/g
  let start = 0
  for (const m of text.matchAll(re)) {
    const end = m.index! + m[0].length
    const before = text.slice(start, m.index!)
    const word = (before.match(/(\S+)$/)?.[1] ?? '').replace(/^["“‘'(\[]+/, '')
    const after = text.slice(end).trimStart()
    if (m[0].startsWith('.')) {
      // "St." "Dr." — abbreviations; "J.K." / "U.S." — initials; "a.m." — dotted lowercase
      if (ABBREVIATIONS.has(word.toLowerCase())) continue
      if (/^([A-Za-z]\.)*[A-Za-z]$/.test(word)) continue
    }
    // "e.g. the", "votes?” into", "without it… well" — a lowercase next word means the sentence goes on
    if (/^[a-z]/.test(after)) continue
    parts.push(text.slice(start, end))
    start = end
  }
  const tail = text.slice(start)
  if (tail.trim()) parts.push(tail)
  return parts.map(p => p.trim()).filter(Boolean)
}

const FRONT_MATTER_RE = /^(contents|table of contents|index|preface|foreword|acknowledg|copyright|isbn|dedication)\b/i

function isHeadingPara(p: string): boolean {
  const t = p.trim()
  if (!t || t.length > 80 || /^[a-z]/.test(t)) return false
  const m = t.match(HEADING_RE)
  if (m) return /^\s*([:.\-–—]|$)/.test(t.slice(m[0].length))
  return /^\d{1,2}\.\s+[A-Z][^.!?]*$/.test(t) || /^[IVXLC]+\.\s+[A-Z][^.!?]*$/.test(t)
}

export function buildReading(text: string): Reading {
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  const sentences: string[] = []
  const pauseAfter: number[] = []
  const paraStart: number[] = []
  for (const para of paras) {
    paraStart.push(sentences.length)
    if (FRONT_MATTER_RE.test(para)) continue
    const sents = splitSentences(para)
    const heading = isHeadingPara(para) || (para.length < 80 && !/[.!?]["”’')\]]*$/.test(para))
    sents.forEach((s, i) => {
      sentences.push(s)
      pauseAfter.push(i < sents.length - 1 ? 0 : heading ? 1200 : 700)
    })
  }

  // For a whole book read as one block, skip to the first real heading near the top.
  // Chapters split by the importer already start at their heading, so this usually stays 0.
  let startIndex = 0
  const searchLimit = Math.max(3, Math.floor(paras.length * 0.2))
  for (let pi = 1; pi < Math.min(paras.length, searchLimit); pi++) {
    if (!isHeadingPara(paras[pi])) continue
    const body = paras.slice(pi + 1, pi + 4).find(p => !isHeadingPara(p) && p.split(/\s+/).length >= 40)
    if (body) { startIndex = paraStart[pi]; break }
  }

  return { sentences, pauseAfter, startIndex }
}
