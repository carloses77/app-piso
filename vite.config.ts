/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icono.svg', 'privacidad.html'],
      workbox: {
        // El OCR pesa varios MB: se descarga la primera vez que hace falta y luego funciona sin conexión.
        globIgnores: ['ocr/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/ocr/'),
          handler: 'CacheFirst',
          options: { cacheName: 'recursos-ocr', cacheableResponse: { statuses: [200] } },
        }],
      },
      manifest: {
        name: 'PisoCompartido',
        short_name: 'Piso',
        description: 'Gastos, limpieza y parking entre dos compañeros de piso',
        theme_color: '#6d5efc',
        background_color: '#f6f4ff',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'es',
        icons: [
          { src: 'icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  test: { environment: 'node', setupFiles: ['fake-indexeddb/auto'] },
})
