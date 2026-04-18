import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    // *.integration.test.ts files require a running Firestore emulator (they
    // connect to 127.0.0.1:8080 via @firebase/rules-unit-testing). The default
    // `npm test` run does NOT boot an emulator, so these tests are excluded
    // from the default run. To execute them, start the emulator first:
    //   firebase emulators:exec --only=firestore,auth "npx vitest run --testNamePattern=integration"
    exclude: ['functions/**', 'node_modules/**', 'src/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/main.tsx', 'src/lib/firebase.ts'],
    },
  },
})
