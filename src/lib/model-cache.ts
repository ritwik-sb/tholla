/// <reference lib="webworker" />
// Stores model files in the Origin Private File System. The Cache API can fail on
// very large entries (the 326 MB WebGPU model), while OPFS handles them fine.
// Implements the `match`/`put` subset transformers.js needs for `env.customCache`.

const DIR = 'models'
const LEGACY_CACHE = 'transformers-cache'

const fileName = (key: string) => key.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_')

async function dir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(DIR, { create: true })
}

export const opfsAvailable = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory

export const modelCache = {
  async match(key: string): Promise<Response | undefined> {
    try {
      const handle = await (await dir()).getFileHandle(fileName(key))
      const file = await handle.getFile()
      if (file.size > 0) return new Response(file, { headers: { 'content-length': String(file.size) } })
    } catch {}
    // files cached by earlier versions of the app
    try {
      return (await (await caches.open(LEGACY_CACHE)).match(key)) ?? undefined
    } catch {
      return undefined
    }
  },

  async put(key: string, response: Response) {
    const data = new Uint8Array(await response.arrayBuffer())
    const d = await dir()
    const name = fileName(key)
    const tmp = await d.getFileHandle(name + '.partial', { create: true })
    // sync access handles work in workers on Chrome, Safari and Firefox
    const access = await (tmp as any).createSyncAccessHandle()
    try {
      access.truncate(0)
      access.write(data, { at: 0 })
      access.flush()
    } finally {
      access.close()
    }
    // write under a temp name first so an interrupted write is never mistaken for a full file
    if ((tmp as any).move) await (tmp as any).move(name)
    else {
      const final = await d.getFileHandle(name, { create: true })
      const a2 = await (final as any).createSyncAccessHandle()
      try { a2.truncate(0); a2.write(data, { at: 0 }); a2.flush() } finally { a2.close() }
      await d.removeEntry(name + '.partial')
    }
  },
}
