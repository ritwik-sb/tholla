import Dexie, { type Table } from 'dexie'
import type { Book } from '../types'

/** Lightweight bookshelf entry, so listing books never loads their full text. */
export interface ShelfItem {
  id: string
  name: string
  createdAt: number
  words: number
  chapters: number
  parserVersion: number
}

const wordCount = (t: string) => {
  let n = 0, inWord = false
  for (let i = 0; i < t.length; i++) {
    const space = t.charCodeAt(i) <= 32
    if (!space && !inWord) n++
    inWord = !space
  }
  return n
}

export const toShelf = (b: Book): ShelfItem => ({
  id: b.id, name: b.name, createdAt: b.createdAt, words: wordCount(b.text),
  chapters: b.chapters?.length ?? 0, parserVersion: b.parserVersion ?? 1,
})

class AudiobookDB extends Dexie {
  books!: Table<Book, string>
  progress!: Table<{ bookId: string; chapterIndex: number; sentenceIndex: number; updatedAt: number }, string>
  bookmarks!: Table<{ id?: number; bookId: string; sentenceIndex: number; note: string; createdAt: number }, number>
  files!: Table<{ bookId: string; pdf: Blob }, string>
  shelf!: Table<ShelfItem, string>

  constructor() {
    super('audiobook')
    this.version(3).stores({
      books: 'id, createdAt',
      progress: 'bookId',
      bookmarks: '++id, bookId, sentenceIndex',
    })
    this.version(4).stores({ files: 'bookId' })
    this.version(5).stores({ shelf: 'id, createdAt' }).upgrade(async tx => {
      await tx.table('books').each((b: Book) => tx.table('shelf').put(toShelf(b)))
    })
  }
}

export const db = new AudiobookDB()

export async function saveBook(book: Book) {
  await db.transaction('rw', db.books, db.shelf, async () => {
    await db.books.put(book)
    await db.shelf.put(toShelf(book))
  })
}

export async function listShelf() {
  return db.shelf.orderBy('createdAt').reverse().toArray()
}

export async function getBook(id: string) {
  return db.books.get(id)
}

export async function deleteBook(id: string) {
  await db.books.delete(id)
  await db.shelf.delete(id)
  await db.progress.delete(id)
  await db.bookmarks.where('bookId').equals(id).delete()
  await db.files.delete(id)
}

export async function saveFile(bookId: string, pdf: Blob) {
  await db.files.put({ bookId, pdf })
}

export async function getFile(bookId: string) {
  return (await db.files.get(bookId))?.pdf
}

export async function resetProgress(bookId: string) {
  await db.progress.delete(bookId)
}

export async function saveProgress(bookId: string, chapterIndex: number, sentenceIndex: number) {
  await db.progress.put({ bookId, chapterIndex, sentenceIndex, updatedAt: Date.now() })
}

export async function getProgress(bookId: string) {
  const p = await db.progress.get(bookId)
  return { chapterIndex: p?.chapterIndex ?? 0, sentenceIndex: p?.sentenceIndex ?? 0 }
}
