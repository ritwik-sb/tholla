import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Changes on every deploy; the app compares it with /version.json.
const BUILD_ID = (process.env.CF_PAGES_COMMIT_SHA ?? Date.now().toString(36)).slice(0, 12)

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // updates activate immediately; the app reloads when it is safe to do so
      registerType: 'prompt',
      injectRegister: false,
      workbox: {
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        // a new build takes over at once so an installed app can never get stuck
        // on an old version; Updater decides when to reload (never mid-playback)
        skipWaiting: true,
        clientsClaim: true,
        // the ONNX runtime .wasm and pdf.js .mjs worker must be cached for offline use
        globPatterns: ['**/*.{js,mjs,css,html,wasm,png,svg,webp,webmanifest,woff2}'],
      },
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'തൊള്ള',
        short_name: 'തൊള്ള',
        description: 'PDFs as audiobooks — read aloud offline.',
        theme_color: '#1b130d',
        background_color: '#1b130d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
    {
      name: 'tholla-build-version',
      apply: 'build',
      closeBundle() {
        // Not part of the precache (globPatterns has no json), so the app can
        // always fetch the deployed version from the network.
        try {
          const out = path.resolve('dist')
          fs.mkdirSync(out, { recursive: true })
          fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ version: BUILD_ID }))
        } catch {}
      },
    },
  ],
  worker: { format: 'es' },
  // cross-origin isolation lets the voice model use multiple CPU threads
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  preview: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
})
