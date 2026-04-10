import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
