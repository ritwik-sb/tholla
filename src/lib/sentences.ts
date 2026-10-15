export function splitSentences(text: string): string[] {
  // split on sentence-ending punctuation followed by space+capital or end
  const out: string[] = []
  const regex = /[^.!?]+[.!?]+(?:["')\]]*)?/g
  const matches = text.match(regex)
  if (!matches) {
    return text.trim() ? [text.trim()] : []
  }
  // Reconstruct to avoid dropping trailing text
  let idx = 0
  const parts: string[] = []
  for (const m of text.matchAll(regex)) {
    parts.push(m[0])
    idx = m.index! + m[0].length
  }
  const tail = text.slice(idx).trim()
  if (tail) parts.push(tail)
  for (const p of parts) {
    const t = p.trim()
    if (t) out.push(t)
  }
  return out
}
