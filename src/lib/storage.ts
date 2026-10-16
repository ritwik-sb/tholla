import Dexie, { type Table } from 'dexie'
import type { Book } from '../types'

class AudiobookDB extends Dexie {
  books!: Table<Book, string>
  progress!: Table<{ bookId: string; chapterIndex: number; sentenceIndex: number; updatedAt: number }, string>
  bookmarks!: Table<{ id?: number; bookId: string; sentenceIndex: number; note: string; createdAt: number }, number>
  files!: Table<{ bookId: string; pdf: Blob }, string>

  constructor() {
    super('audiobook')
    this.version(3).stores({
      books: 'id, createdAt',
      progress: 'bookId',
      bookmarks: '++id, bookId, sentenceIndex',
    })
    this.version(4).stores({ files: 'bookId' })
  }
}

export const db = new AudiobookDB()

export async function saveBook(book: Book) {
  await db.books.put(book)
}

export async function listBooks() {
  return db.books.orderBy('createdAt').reverse().toArray()
}

export async function getBook(id: string) {
  return db.books.get(id)
}

export async function deleteBook(id: string) {
  await db.books.delete(id)
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
