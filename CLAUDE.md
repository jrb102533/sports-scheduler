# First Whistle — Development Context

## Product

First Whistle is a youth sports scheduling and team management platform. Target users: coaches, league managers, parents, and players. Core value prop: schedule games, track rosters, manage leagues — all in one place.

**Current stage**: Soft launch with 1 team. Priority is parent-facing features and email communications.

**Full PRD**: `docs/PRD.md` (screens, data model, API reference, mobile architecture)

## Architecture

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Zustand (state)
- **Backend**: Firebase (Auth, Firestore, Cloud Functions, Storage)
- **Hosting**: Firebase Hosting (`first-whistle-e76f4.web.app`)
- **Email**: SMTP via Cloud Functions with branded HTML templates (`functions/src/emailTemplate.ts`)
- **RSVP**: One-tap email RSVP via HTTP endpoint with HMAC-signed links (no login required)

## Critical Patterns

### Zustand Store Safety (PREVENTS React Error #185)

**NEVER** do this — it causes infinite re-render loops:
```tsx
// BAD: no-selector subscribes to ENTIRE store, re-renders on any change
const { fetchSeasons } = useSeasonStore();
useEffect(() => { fetchSeasons(id); }, [id, fetchSeasons]); // infinite loop!
```

**ALWAYS** do this instead:
```tsx
// GOOD: select only the data you need
const seasons = useSeasonStore(s => s.seasons);

// GOOD: use getState() for actions inside effects
useEffect(() => {
  return useSeasonStore.getState().fetchSeasons(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [id]);
```

Rules:
1. **Data selectors**: `useStore(s => s.field)` — returns stable reference for primitives
2. **Actions in effects**: `useStore.getState().action()` — never put actions in deps array
3. **Auth store**: Never select `s => s.user` (Firebase User object changes reference). Use `s => s.user?.uid` or `s => Boolean(s.user)`
4. **eslint-disable**: Add `// eslint-disable-next-line react-hooks/exhaustive-deps` when intentionally omitting getState() actions from deps

### Email Templates

All emails use `buildEmail()` from `functions/src/emailTemplate.ts` with the branded HTML template at `functions/email-templates/base-template.html`. RSVP emails use `rsvpButtonsHtml()` for one-tap buttons.

### Firestore Security Rules

- `firestore.rules` — role-based access control
- Admin can do anything; coaches manage their teams; parents/players read-only on team data
- Sensitive player data (PII) in restricted subcollections

## 12-factor config

Follow 12-factor app methodology for all development:

- **Config**: Store all config in environment variables, never hardcode
- **Dependencies**: Explicitly declare all dependencies (package.json, requirements.txt, etc.)
- **Backing services**: Treat databases, queues, and APIs as attached resources via env vars
- **Build/run separation**: Keep build, release, and run stages distinct
- **Processes**: App is stateless — no sticky sessions, no local file storage
- **Port binding**: Export services via port binding, not web server injection
- **Logs**: Treat logs as event streams (stdout/stderr only, never write to files)
- **Dev/prod parity**: Keep environments as similar as possible

## Key Files

| File | Purpose |
|------|---------|
| `docs/PRD.md` | Full product requirements + mobile architecture |
| `src/store/useAuthStore.ts` | Auth state, profile, role helpers, team access |
| `src/layouts/MainLayout.tsx` | Root layout, all Firestore subscriptions |
| `src/router/index.tsx` | All routes/screens |
| `src/types/index.ts` | Full data model |
| `functions/src/index.ts` | All Cloud Functions (email, RSVP, scheduling) |
| `functions/src/emailTemplate.ts` | Branded email template builder |
| `functions/src/scheduleAlgorithm.ts` | Schedule generation algorithm |
| `firestore.rules` | Security rules |

## Deployment Policy

### Hard rule: merge before deploy

**No production deploys without a merged PR.** This applies to all targets: `hosting`, `functions`, `firestore:rules`, `firestore:indexes`.

Enforcement layers:
1. **GitHub Actions `environment: production` gate** — the deploy workflow requires a reviewer approval before any prod job runs (primary enforcement)
2. **Branch protection on `main`** — PRs required before merging
3. **This policy** — all agents must follow it

### Hotfix exception (active outage or data breach only)

If production is down or actively leaking data:
1. Push the fix branch to remote
2. Open a PR and get it **approved** (not just opened) before deploying
3. Deploy from the branch
4. Merge the PR to `main` within 24 hours post-incident
5. Note the bypass reason in the PR body

"We want to test in prod" or "review will take too long" are not valid exceptions.

### Firestore rules changes

`firestore.rules` changes have the highest blast radius — a permissive rule takes effect instantly and fails silently (no app-layer error, no trace unless Firestore audit logging is enabled). **All PRs touching `firestore.rules` require the security-engineer agent review before merge.**

## Backlog

- #202 — Schedule wizard draft resume
- #203 — Incomplete game generation + no draft view
- #204 — Simplify empty Seasons tab
- #205 — TopBar user name/login
- #206 — Bulk delete draft schedule games (delete selected games or entire draft; SeasonDashboard + league schedule view)
