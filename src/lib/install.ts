// PWA install support.
// Chromium (Android, desktop) fires `beforeinstallprompt`, which we stash and replay on tap.
// iOS has no install API: users add the app via Share → Add to Home Screen, so we show steps.

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: PromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

export function initInstall() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferred = e as PromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    localStorage.setItem('tholla.installed', '1')
    notify()
  })
}

export const onInstallChange = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as any).standalone === true

const ua = () => navigator.userAgent

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const isAndroid = () => /Android/i.test(ua())

/** In-app browsers (Instagram, Facebook, WhatsApp…) can't install; the page must be opened in the real browser. */
export const isInAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|GSA\/|; wv\)/i.test(ua())

export const iosBrowser = (): 'safari' | 'chrome' | 'firefox' | 'edge' | 'other' => {
  const u = ua()
  if (/CriOS/.test(u)) return 'chrome'
  if (/FxiOS/.test(u)) return 'firefox'
  if (/EdgiOS/.test(u)) return 'edge'
  if (/Safari/.test(u) && !/(GSA|OPT|YaBrowser)/.test(u)) return 'safari'
  return 'other'
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'android-manual' | 'none'

export function installMode(): InstallMode {
  if (isStandalone()) return 'installed'
  if (deferred) return 'prompt'
  if (isIOS()) return 'ios'
  if (isAndroid()) return 'android-manual'
  return 'none'
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  deferred = null
  await e.prompt()
  const { outcome } = await e.userChoice
  notify()
  return outcome === 'accepted'
}
