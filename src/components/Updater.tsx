import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const CHECK_EVERY_MS = 30 * 60e3

/**
 * Keeps installed copies up to date.
 * Checks on launch, when the app comes back to the foreground, and every 30 minutes.
 * When a new version is ready it applies itself straight away if `idle` (bookshelf, not
 * importing); otherwise it shows a plate so a reload never cuts off playback.
 */
export default function Updater({ idle }: { idle: boolean }) {
  const regRef = useRef<ServiceWorkerRegistration | null>(null)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return
      regRef.current = reg
      setInterval(() => { if (navigator.onLine) reg.update().catch(() => {}) }, CHECK_EVERY_MS)
    },
  })

  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) regRef.current?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
    }
  }, [])

  // Reload once the new version has taken over. Listening here directly (instead of relying
  // on the library's own listener) is more dependable, and covers updates applied in another tab.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let hadController = !!navigator.serviceWorker.controller
    const onChange = () => {
      if (hadController) window.location.reload()
      hadController = true
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [])

  const apply = () => {
    const waiting = regRef.current?.waiting
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' })
    else updateServiceWorker(true)
  }

  // nothing to lose on the bookshelf: update quietly
  useEffect(() => {
    if (needRefresh && idle) apply()
  }, [needRefresh, idle])

  if (!needRefresh || idle) return null
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
