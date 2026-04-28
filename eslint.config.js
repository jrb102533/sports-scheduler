import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import noUnscopedCollectionRead from './eslint-rules/no-unscoped-collection-read.js'

const firstWhistleRules = {
  rules: {
    'no-unscoped-collection-read': noUnscopedCollectionRead,
  },
}

export default defineConfig([
  globalIgnores(['dist', '.claude/worktrees']),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'first-whistle': firstWhistleRules,
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'first-whistle/no-unscoped-collection-read': 'error',
      // Downgraded to warn — widespread pre-existing debt, tracked for cleanup
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'react-refresh/only-export-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      // Promoted to error: missing deps can cause stale closures and render loops.
      // The recommended config sets this to warn; we override to error here.
      // rules-of-hooks is already error via recommended.
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  // Legacy exhaustive-deps debt — pre-existing violations in these files are
  // tracked for cleanup (GitHub issue #192). Downgraded back to warn so CI
  // does not block on debt that predates this rule change.
  {
    files: [
      'src/components/events/RsvpInviteModal.tsx',
      'src/components/teams/TeamForm.tsx',
      'src/pages/TeamDetailPage.tsx',
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Test files in functions use Function/any extensively in mock infrastructure
  {
    files: ['functions/src/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Playwright fixtures use `use` as a teardown callback name — this is the
  // Playwright fixture API, not React's `use` hook. The react-hooks rules have
  // no meaning in e2e/ and falsely flag legitimate fixture code.
  {
    files: ['e2e/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
])
