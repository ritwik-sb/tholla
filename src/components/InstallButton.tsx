import { useEffect, useState, type ReactNode } from 'react'
import { Case } from './radio'
import { installMode, iosBrowser, isInAppBrowser, onInstallChange, promptInstall, type InstallMode } from '../lib/install'

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" className="inline w-5 h-5 -mt-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M7 8l5-5 5 5" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
)
const AddIcon = () => (
  <svg viewBox="0 0 24 24" className="inline w-5 h-5 -mt-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
)
const MenuIcon = () => (
  <svg viewBox="0 0 24 24" className="inline w-5 h-5 -mt-1" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
  </svg>
)

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="brass stamp text-[11px] w-7 h-7 shrink-0 flex items-center justify-center rounded-full">{n}</span>
      <span className="stamp text-[12px] tracking-[.06em] normal-case engraved leading-6">{children}</span>
    </li>
  )
}

function IOSSteps() {
  const browser = iosBrowser()
  const shareWhere =
    browser === 'chrome' ? 'in the address bar (top right)'
    : browser === 'firefox' || browser === 'edge' ? 'in the menu'
    : 'at the bottom of the screen (top on iPad)'
  return (
    <ol className="flex flex-col gap-4">
      <Step n={1}>Tap the Share button <ShareIcon /> {shareWhere}.</Step>
      <Step n={2}>Scroll down and tap <b>Add to Home Screen</b> <AddIcon />.</Step>
      <Step n={3}>Tap <b>Add</b>. തൊള്ള appears on your home screen and works offline.</Step>
    </ol>
  )
}

function AndroidSteps() {
  return (
    <ol className="flex flex-col gap-4">
      <Step n={1}>Open the browser menu <MenuIcon /> (top right).</Step>
      <Step n={2}>Tap <b>Install app</b> or <b>Add to Home screen</b>.</Step>
      <Step n={3}>Confirm. തൊള്ള opens like a regular app and works offline.</Step>
    </ol>
  )
}

export default function InstallButton() {
  const [mode, setMode] = useState<InstallMode>(installMode)
  const [open, setOpen] = useState(false)

  useEffect(() => onInstallChange(() => setMode(installMode())), [])

  if (mode === 'installed' || mode === 'none') return null

  const onTap = async () => {
    if (mode === 'prompt') {
      await promptInstall()
      setMode(installMode())
    } else {
      setOpen(true)
    }
  }

  return (
    <>
      <button type="button" onClick={onTap} className="key dark gap-2 px-5" aria-haspopup={mode === 'prompt' ? undefined : 'dialog'}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
        </svg>
        <span>Install app</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end md:items-center justify-center p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Install തൊള്ള"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
        >
          <Case rivets={false} className="w-full max-w-md rounded-[22px] px-6 pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col gap-5">
            <p className="stamp text-sm engraved text-center">Install on your home screen</p>
            <div className="panel p-5">
              {isInAppBrowser()
                ? <p className="stamp text-[12px] normal-case engraved leading-6">
                    This app's built-in browser can't install apps. Open this page in {mode === 'ios' ? 'Safari' : 'Chrome'} (use “Open in browser” from the menu), then tap Install again.
                  </p>
                : mode === 'ios' ? <IOSSteps /> : <AndroidSteps />}
            </div>
            <button type="button" autoFocus className="key self-center" onClick={() => setOpen(false)}>Got it</button>
          </Case>
        </div>
      )}
    </>
  )
}
