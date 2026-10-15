export interface Reading {
  sentences: string[]
  pauseAfter: number[]
  startIndex: number
}

function splitSentences(text: string): string[] {
  const regex = /[^.!?]+[.!?]+(?:["')\]]*)?/g
  const parts: string[] = []
  let idx = 0
  for (const m of text.matchAll(regex)) {
    parts.push(m[0])
    idx = m.index! + m[0].length
  }
  const tail = text.slice(idx).trim()
  if (tail) parts.push(tail)
  return parts.map(p => p.trim()).filter(Boolean)
}

const HEADING_RE = /^(chapter|part|section|prologue|epilogue)\b/i
const FRONT_MATTER_RE = /^(contents|table of contents|index|preface|foreword|acknowledg|copyright|isbn|dedication)\b/i

function isHeadingPara(p: string): boolean {
  const t = p.trim()
  if (!t || t.length > 120) return false
  if (HEADING_RE.test(t)) return true
  if (/^\d{1,2}\.\s+[A-Z]/.test(t)) return true
  if (/^[IVXLC]+\.\s/.test(t)) return true
  return false
}

export function buildReading(text: string): Reading {
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  const sentences: string[] = []
  const pauseAfter: number[] = []
  const paraStartIdx: number[] = [] // sentence index where each paragraph starts
  for (const para of paras) {
    paraStartIdx.push(sentences.length)
    const sents = splitSentences(para)
    if (!sents.length) continue
    const isHeading = isHeadingPara(para)
    const isFront = FRONT_MATTER_RE.test(para)
    if (isFront) continue // skip front-matter paragraphs entirely
    for (let i = 0; i < sents.length; i++) {
      sentences.push(sents[i])
      const isLast = i === sents.length - 1
      if (!isLast) { pauseAfter.push(0); continue }
      // pause length
      if (isHeading) pauseAfter.push(1200)
      else pauseAfter.push(700)
    }
  }

  // Decide where actual reading content starts.
  // Find a heading paragraph followed by a substantial body paragraph.
  let startIndex = 0
  for (let pi = 0; pi < paras.length; pi++) {
    const para = paras[pi].trim()
    if (!isHeadingPara(para)) continue
    // find next non-front-matter, non-heading paragraph with enough words
    let nextBodyWords = 0
    for (let q = pi + 1; q < Math.min(pi + 4, paras.length); q++) {
      const pp = paras[q].trim()
      if (!pp || isHeadingPara(pp) || FRONT_MATTER_RE.test(pp)) continue
      nextBodyWords = pp.split(/\s+/).length
      break
    }
    if (nextBodyWords >= 40) {
      // ensure valid index in filtered sentences mapping not exact due to skipped front matter; search instead
      const headingText = para.slice(0, 60)
      const found = sentences.findIndex(x => x.includes(headingText.slice(0, 30)))
      if (found >= 0) { startIndex = found; break }
    }
  }


  return { sentences, pauseAfter, startIndex }
}
