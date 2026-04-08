import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Only inject service worker in production builds — dev stays fast
      devOptions: { enabled: false },
      manifest: {
        name: 'First Whistle',
        short_name: 'First Whistle',
        description: 'Youth sports scheduling and team management',
        theme_color: '#1e3a5f',
        background_color: '#1e3a5f',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache the app shell (HTML, JS, CSS) with StaleWhileRevalidate
        // Network calls (Firebase, Cloud Functions) always go to network
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/rsvpEvent/, /^\/api\//],
        runtimeCaching: [
          {
            // Firebase Storage — cache images
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-storage',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__:  JSON.stringify(process.env.VITE_APP_VERSION  ?? 'dev'),
    __BUILD_SHA__:    JSON.stringify(process.env.VITE_BUILD_SHA    ?? 'local'),
    __BUILD_TIME__:   JSON.stringify(process.env.VITE_BUILD_TIME   ?? new Date().toISOString()),
    __BUILD_BRANCH__: JSON.stringify(process.env.VITE_BUILD_BRANCH ?? 'local'),
    __BUILD_PR__:     JSON.stringify(process.env.VITE_BUILD_PR     ?? null),
    // Default to 'production' so an unset env var never shows the dev banner in prod.
    // Override to 'development' in .env.local and 'staging' in .env.staging.
    __APP_ENV__:      JSON.stringify(process.env.VITE_APP_ENV      ?? 'production'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/main.tsx', 'src/lib/firebase.ts'],
    },
  },
})
