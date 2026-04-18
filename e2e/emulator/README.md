# Emulator E2E specs

Playwright specs that run against the local Firebase Emulator Suite instead of
staging. See `docs/TESTING.md` and issue #466 for the wider testing strategy.

## Naming

- File suffix: `*.emu.spec.ts`
- Tag every test with `@emu` and a domain tag: `test('@emu @auth logs in', ...)`
- Runs via `npm run test:e2e:emulator` — which targets the `emulator` Playwright project

## Local setup

```bash
# Terminal 1 — boot emulators with seeded state
npm run emulator

# Terminal 2 — dev server in emulator mode
npm run dev:emulator

# Terminal 3 — tests
npm run test:e2e:emulator
```

## CI

Single workflow: `.github/workflows/e2e-emulator.yml`. It:

1. Installs deps + Playwright
2. Installs Firebase CLI + Java (emulator requires JVM)
3. Boots emulators with `--import ./emulator-data`
4. Builds the app in emulator mode and serves the built output
5. Runs `npx playwright test --project=emulator`

## What belongs here (emulator layer)

- User flows that exercise UI + Firestore rules + CF business logic
- Role-based access checks
- Happy paths + edge cases that don't need real cold starts, SMTP, or real indexes

## What does NOT belong here

Belongs in `@staging-only` specs (e.g. `*.staging.spec.ts`):

- Real auth token refresh after real clock drift
- SMTP send verification
- Cloud Function real cold-start behavior
- Firestore composite-index existence
- Cloud Tasks / scheduled functions
