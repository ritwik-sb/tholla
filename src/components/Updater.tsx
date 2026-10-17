import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const CHECK_EVERY_MS = 5 * 60e3
const RELOAD_FALLBACK_MS = 5000
const RELOAD_KEY = 'tholla.reloadedFor'

/** Drop the service worker and its app-shell cache, then load from the network. */
async function hardReload() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    await Promise.all((regs ?? []).map(r => r.unregister()))
    const keys = await caches.keys()
    // keep the model/voice cache; only the app shell can be stale
    await Promise.all(keys.filter(k => k.includes('workbox')).map(k => caches.delete(k)))
  } catch {}
  window.location.reload()
}

/**
 * Keeps installed and cached copies up to date.
 *
 * A new service worker activates immediately (skipWaiting), but this component
 * decides when to reload: straight away on the bookshelf, or via a "Restart"
 * plate if a book is open. A /version.json check catches clients whose service
 * worker update check was skipped (common in installed PWAs); if the worker
 * never takes over, it falls back to unregistering it and loading from network.
 */
export default function Updater({ idle }: { idle: boolean }) {
  const regRef = useRef<ServiceWorkerRegistration | null>(null)
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [tried, setTried] = useState(false)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return
      regRef.current = reg
      setInterval(() => {
        if (navigator.onLine) reg.update().catch(() => {})
      }, CHECK_EVERY_MS)
    },
  })

  const checkVersion = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      const url = new URL(`${import.meta.env.BASE_URL}version.json`, window.location.href)
      url.searchParams.set('ts', String(Date.now()))
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (data?.version && data.version !== __BUILD_ID__) setRemoteVersion(String(data.version))
    } catch {}
  }, [])

  // ask the server on launch, when the app returns to the foreground, and when online
  useEffect(() => { void checkVersion() }, [checkVersion])
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      void checkVersion()
      regRef.current?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    window.addEventListener('pageshow', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      window.removeEventListener('pageshow', check)
    }
  }, [checkVersion])

  // The new worker has taken control. Do not reload yet if a book is open.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let hadController = !!navigator.serviceWorker.controller
    const onChange = () => {
      if (fallbackRef.current != null) {
        clearTimeout(fallbackRef.current)
        fallbackRef.current = null
      }
      if (hadController) setUpdateReady(true)
      hadController = true
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [])

  // Nothing is playing and no import is running: pick up the new build quietly.
  useEffect(() => {
    if (updateReady && idle) window.location.reload()
  }, [updateReady, idle])

  const apply = () => {
    setTried(true)
    if (updateReady) {
      window.location.reload()
      return
    }
    if (remoteVersion) {
      // the server has a build this page has never run; the old worker would
      // keep serving its cached shell, so drop it and load from the network
      void hardReload()
      return
    }
    if (needRefresh) {
      updateServiceWorker(true)
    } else {
      regRef.current?.update().catch(() => {})
    }
    if (fallbackRef.current != null) clearTimeout(fallbackRef.current)
    fallbackRef.current = setTimeout(() => { void hardReload() }, RELOAD_FALLBACK_MS)
  }
  const applyRef = useRef(apply)
  applyRef.current = apply

  const available = updateReady || needRefresh || remoteVersion != null

  useEffect(() => {
    if (!available || !idle || tried || updateReady) return
    // if we already forced a reload for this exact version, don't loop; show the plate
    if (remoteVersion && sessionStorage.getItem(RELOAD_KEY) === remoteVersion) {
      setTried(true)
      return
    }
    if (remoteVersion) sessionStorage.setItem(RELOAD_KEY, remoteVersion)
    applyRef.current()
  }, [available, idle, tried, updateReady, remoteVersion])

  useEffect(() => () => {
    if (fallbackRef.current != null) clearTimeout(fallbackRef.current)
  }, [])

  if (!available) return null
  if (idle && !tried) return null
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex justify-center pt-[max(.5rem,env(safe-area-inset-top))] px-3 pointer-events-none">
      <div className="brass pointer-events-auto flex items-center gap-3 pl-4 pr-1.5 py-1.5 shadow-lg" role="status">
        <span className="lamp lamp-sm on blink" aria-hidden="true" />
        <span className="stamp text-[11px]">New version ready</span>
        <button type="button" className="key small dark" onClick={apply}>Restart</button>
      </div>
    </div>
  )
}
