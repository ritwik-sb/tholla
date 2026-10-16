import { useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'
import Setup, { SETUP_KEY } from './components/Setup'
import Updater from './components/Updater'
import type { Book } from './types'

export default function App() {
  const [ready, setReady] = useState(() => !!localStorage.getItem(SETUP_KEY))
  const [book, setBook] = useState<Book | null>(null)
  const [importing, setImporting] = useState(false)

  // safe to reload only on the bookshelf, with nothing being imported or downloaded
  const idle = ready && !book && !importing

  return (
    <>
      <Updater idle={idle} />
      {!ready
        ? <Setup onDone={() => setReady(true)} />
        : book
          ? <Reader book={book} onBack={() => setBook(null)} />
          : <Library onOpen={setBook} onBusyChange={setImporting} />}
    </>
  )
}
