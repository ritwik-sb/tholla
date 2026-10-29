import { test, expect } from '@playwright/test'
import { repairGluedWords } from '../src/lib/word-repair'
import { buildReading } from '../src/lib/reading'

test.describe('glued-word repair', () => {
  test('splits words a PDF ran together', () => {
    expect(repairGluedWords('immediatelyidentifiable')).toBe('immediately identifiable')
    expect(repairGluedWords('itwasthebestoftimes')).toBe('it was the best of times')
    expect(repairGluedWords('Thequickbrownfoxjumps')).toBe('The quick brown fox jumps')
    expect(repairGluedWords('whenhewenttothemarket')).toBe('when he went to the market')
  })

  test('leaves real long words alone', () => {
    const words = [
      'internationalization', 'characteristically', 'uncharacteristically', 'telecommunications',
      'Constantinople', 'thermodynamics', 'responsibilities', 'Mediterranean', 'photosynthesis',
    ]
    for (const w of words) expect(repairGluedWords(w)).toBe(w)
    expect(repairGluedWords('The internationalization of trade.')).toBe('The internationalization of trade.')
  })

  test('leaves web addresses alone', () => {
    expect(repairGluedWords('Visit www.internationalbusiness.com today')).toBe('Visit www.internationalbusiness.com today')
  })
})

test.describe('sentence splitting', () => {
  test('abbreviations and initials do not end a sentence', () => {
    expect(buildReading('Mr. Smith went home. He slept.').sentences).toEqual(['Mr. Smith went home.', 'He slept.'])
    expect(buildReading('It cost 3.5 dollars. Then U.S. troops left.').sentences).toEqual(['It cost 3.5 dollars.', 'Then U.S. troops left.'])
  })

  test('a lowercase next word keeps the sentence going', () => {
    expect(buildReading('Bring tools, e.g. a hammer. Then stop.').sentences).toEqual(['Bring tools, e.g. a hammer.', 'Then stop.'])
  })

  test('headings get a longer pause than paragraphs', () => {
    const r = buildReading('Chapter One\n\nIt was a dark night. Nobody came.')
    expect(r.sentences).toEqual(['Chapter One', 'It was a dark night.', 'Nobody came.'])
    expect(r.pauseAfter).toEqual([1200, 0, 700])
  })
})
