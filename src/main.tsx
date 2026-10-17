import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initInstall } from './lib/install'
import { initClicks } from './lib/clicks'
import '@fontsource/baloo-chettan-2/malayalam-800.css'
import '@fontsource/oswald/latin-500.css'
import '@fontsource/oswald/latin-600.css'
import '@fontsource/lora/latin-400.css'
import '@fontsource/lora/latin-400-italic.css'
import './index.css'
import './radio.css'

initInstall()
initClicks()
// visible in devtools/support: which build is actually running
document.documentElement.dataset.build = __BUILD_ID__

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
