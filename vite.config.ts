import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo>/ — change BASE if the repository name changes.
const BASE = process.env.BASE_PATH ?? '/biblebetter/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,json,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: BASE + 'index.html',
      },
      manifest: {
        name: 'BibleBetter',
        short_name: 'BibleBetter',
        description: 'Bible reading, study, prayer and growth',
        theme_color: '#c8bef0',
        background_color: '#fbf8f3',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Today', url: BASE + '?open=today', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Bible', url: BASE + '?open=bible', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
        ],
      },
    }),
  ],
});
