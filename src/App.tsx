import { useEffect, useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'
import Setup, { SETUP_KEY } from './components/Setup'
import { loadKokoro } from './lib/kokoro'
import type { Book } from './types'

export default function App() {
  const [ready, setReady] = useState(() => !!localStorage.getItem(SETUP_KEY))
  const [book, setBook] = useState<Book | null>(null)

  // warm the voice engine from local storage so the first Play is instant
  useEffect(() => {
    if (ready) loadKokoro().catch(() => {})
  }, [ready])

  if (!ready) return <Setup onDone={() => setReady(true)} />
  if (book) {
    return <Reader book={book} onBack={() => setBook(null)} />
  }
  return <Library onOpen={setBook} />
}
