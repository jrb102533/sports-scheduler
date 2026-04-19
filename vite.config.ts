import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execFileSync } from 'child_process'

// ── Build metadata helpers ─────────────────────────────────────────────────────
// CI sets VITE_BUILD_* env vars (via GitHub Actions). For local CLI builds
// those vars are absent, so we fall back to live git values so the staging
// banner always shows a real branch name and commit SHA rather than 'local'.
// execFileSync (not execSync) — no shell spawned; all args are hardcoded constants.
function git(args: string[], fallback: string): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return fallback;
  }
}

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
      __BUILD_SHA__:    JSON.stringify(env.VITE_BUILD_SHA    ?? process.env.VITE_BUILD_SHA    ?? git(['rev-parse', 'HEAD'], 'unknown')),
      __BUILD_TIME__:   JSON.stringify(env.VITE_BUILD_TIME   ?? process.env.VITE_BUILD_TIME   ?? new Date().toISOString()),
      __BUILD_BRANCH__: JSON.stringify(env.VITE_BUILD_BRANCH ?? process.env.VITE_BUILD_BRANCH ?? git(['rev-parse', '--abbrev-ref', 'HEAD'], 'local')),
      __BUILD_PR__:     JSON.stringify(env.VITE_BUILD_PR     ?? process.env.VITE_BUILD_PR     ?? null),
      // .env.staging / .env.production explicitly set VITE_APP_ENV; dev falls back to 'development'.
      __APP_ENV__:      JSON.stringify(env.VITE_APP_ENV      ?? process.env.VITE_APP_ENV      ?? 'development'),
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
