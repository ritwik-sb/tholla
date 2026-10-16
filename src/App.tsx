import { useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'
import Setup, { SETUP_KEY } from './components/Setup'
import type { Book } from './types'

export default function App() {
  const [ready, setReady] = useState(() => !!localStorage.getItem(SETUP_KEY))
  const [book, setBook] = useState<Book | null>(null)

  if (!ready) return <Setup onDone={() => setReady(true)} />
  if (book) {
    return <Reader book={book} onBack={() => setBook(null)} />
  }
  return <Library onOpen={setBook} />
}
