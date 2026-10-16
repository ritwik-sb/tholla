import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // the app decides when to apply an update (never mid-playback)
      registerType: 'prompt',
      injectRegister: false,
      workbox: {
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        // take control on first install so the app works offline right away;
        // later versions still wait for the app to apply them
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
