import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
// Function form required so we can call loadEnv(mode) and inject .env.[mode]
// variables into the `define` block. process.env does NOT receive .env.[mode]
// values — only loadEnv() does. Without this, __APP_ENV__ always fell back to
// 'production', suppressing the staging/dev banner in all non-local builds.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__:  JSON.stringify(env.VITE_APP_VERSION  ?? process.env.VITE_APP_VERSION  ?? 'dev'),
    __BUILD_SHA__:    JSON.stringify(env.VITE_BUILD_SHA    ?? process.env.VITE_BUILD_SHA    ?? 'local'),
    __BUILD_TIME__:   JSON.stringify(env.VITE_BUILD_TIME   ?? process.env.VITE_BUILD_TIME   ?? new Date().toISOString()),
    __BUILD_BRANCH__: JSON.stringify(env.VITE_BUILD_BRANCH ?? process.env.VITE_BUILD_BRANCH ?? 'local'),
    __BUILD_PR__:     JSON.stringify(env.VITE_BUILD_PR     ?? process.env.VITE_BUILD_PR     ?? null),
    // Default to 'production' so an unset env var never shows the dev banner in prod.
    // Override to 'development' in .env.local and 'staging' in .env.staging.
    __APP_ENV__:      JSON.stringify(env.VITE_APP_ENV      ?? process.env.VITE_APP_ENV      ?? 'production'),
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
  };
})
