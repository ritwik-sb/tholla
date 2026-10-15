import { useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'
import type { Book } from './types'

export default function App() {
  const [book, setBook] = useState<Book | null>(null)
  if (book) {
    return <Reader book={book} onBack={() => setBook(null)} />
  }
  return <Library onOpen={setBook} />
}
