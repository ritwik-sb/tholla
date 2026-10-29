// Repairs text layers that omit spaces between words ("immediatelyidentifiable").
// pdf.js gives us the characters but no way to know where the missing word breaks
// are, so long alphabetic tokens are segmented against a compact frequency list.
// Only pure-letter runs of 14+ characters are touched, and URL-ish tokens are
// skipped, so ordinary prose and names are left alone.
import { ENGLISH_WORDS } from './english-words'

let cache: Set<string> | null = null
function words(): Set<string> {
  if (!cache) {
    cache = new Set()
    for (const w of ENGLISH_WORDS.split(/\s+/)) if (w) cache.add(w)
  }
  return cache
}

const has = (w: string) => words().has(w)

// Real words under 3 letters. Any other short piece is a fragment of one long
// word the list doesn't know ("intern at io na lization"), so it is never a split.
const SHORT = new Set('a i an as at be by do go he if in is it me my no of on or so to up us we'.split(' '))

/** A dictionary word, or a regular inflection of one (plural, -ing, -ed, -able...). */
function known(word: string): boolean {
  if (has(word)) return true
  if (word.length < 2) return false
  const base = (b: string) => b.length >= 3 && has(b)
  if (word.endsWith('ies') && base(word.slice(0, -3) + 'y')) return true
  if (word.endsWith('es') && base(word.slice(0, -2))) return true
  if (word.endsWith('s') && base(word.slice(0, -1))) return true
  if (word.endsWith('ing')) {
    const b = word.slice(0, -3)
    if (base(b) || base(b + 'e')) return true
    if (b.length > 2 && b[b.length - 1] === b[b.length - 2] && base(b.slice(0, -1))) return true
  }
  if (word.endsWith('ed')) {
    const b = word.slice(0, -2)
    if (base(b) || base(b + 'e')) return true
    if (b.length > 2 && b[b.length - 1] === b[b.length - 2] && base(b.slice(0, -1))) return true
  }
  if (word.endsWith('ly') && base(word.slice(0, -2))) return true
  if (word.endsWith('able')) {
    const b = word.slice(0, -4)
    if (base(b) || base(b.replace(/i$/, 'y'))) return true
  }
  if (word.endsWith('ible')) {
    const b = word.slice(0, -4)
    if (base(b) || base(b.replace(/i$/, 'y'))) return true
  }
  for (const s of ['ment', 'ness', 'tion', 'sion', 'ity', 'ous', 'ive', 'ful', 'less', 'er', 'est', 'al']) {
    if (word.endsWith(s) && base(word.slice(0, -s.length))) return true
  }
  return false
}

/** Split a run of letters into the fewest dictionary words, or null. */
function segment(token: string): string[] | null {
  const t = token.toLowerCase()
  const n = t.length
  const best: (string[] | null)[] = new Array(n + 1).fill(null)
  best[0] = []
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 20); j < i; j++) {
      if (!best[j]) continue
      const part = t.slice(j, i)
      if (part.length < 3 && !SHORT.has(part)) continue
      if (!known(part)) continue
      const candidate = [...best[j]!, part]
      if (!best[i] || candidate.length < best[i]!.length) best[i] = candidate
    }
  }
  const parts = best[n]
  return parts && parts.length > 1 ? parts : null
}

function applyCase(original: string, parts: string[]): string {
  if (original === original.toUpperCase()) return parts.join(' ').toUpperCase()
  if (/^[A-Z]/.test(original)) return parts.map((p, i) => (i === 0 ? p[0].toUpperCase() + p.slice(1) : p)).join(' ')
  return parts.join(' ')
}

function camelParts(token: string): string[] | null {
  if (!/[a-z][A-Z]/.test(token)) return null
  const parts = token.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ')
  return parts.length > 1 ? parts : null
}

/** Don't touch domains, URLs, emails, or path segments. */
function urlLike(text: string, start: number, end: number): boolean {
  if (/(?:https?:\/\/|www\.)\S*$/i.test(text.slice(0, start))) return true
  const before = text[start - 1] ?? ''
  const after = text[end] ?? ''
  if (before === '@' || before === '/') return true
  if (before === '.' && /[a-z0-9]/i.test(text[start - 2] ?? '')) return true
  if (after === '.' && /[a-z0-9]/i.test(text[end + 1] ?? '')) return true
  return false
}

export function repairGluedWords(text: string): string {
  return text.replace(/[A-Za-z]{14,}/g, (token: string, offset: number, whole: string) => {
    if (urlLike(whole, offset, offset + token.length)) return token
    const camel = camelParts(token)
    if (camel) return camel.join(' ')
    if (has(token.toLowerCase())) return token
    const parts = segment(token)
    return parts ? applyCase(token, parts) : token
  })
}
