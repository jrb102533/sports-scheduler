# Go-Live Checklist

Items to complete before opening First Whistle to the general public.

## End-to-End Smoke Tests

These must be run manually against production — unit tests use mocks and cannot catch infrastructure, SMTP, or Firestore rules issues.

### Invite Flow
- [ ] Admin creates a team
- [ ] Admin adds a player with a parent email address
- [ ] Invite email arrives in inbox from `noreply@firstwhistlesports.com` (not spam)
- [ ] Email header shows "First Whistle" / "Sports Scheduling" (not "Youth Sports Scheduling")
- [ ] Email CTA links to `firstwhistlesports.com` (not staging URL)
- [ ] Parent clicks link → lands on signup page
- [ ] Parent creates account → auto-linked to player record
- [ ] Parent lands on parent home page and sees team schedule
- [ ] RSVP button appears on events and can be tapped
- [ ] Invite disappears from admin's Invites tab after parent accepts

### Auth & Session
- [ ] Login with valid credentials works
- [ ] Login with wrong password shows correct error message
- [ ] Session idle for 30 minutes → warning modal appears with 60-second countdown
- [ ] Clicking "Stay Signed In" dismisses modal and resets timer
- [ ] Countdown reaching zero logs user out
- [ ] Email verification enforced for non-invited signups (Option B implemented — verify end-to-end in smoke test)

### Admin
- [ ] Admin can create/edit/delete teams
- [ ] Admin can add/edit/remove players
- [ ] Admin can publish a schedule
- [ ] Admin can revoke a pending invite

### Environment
- [ ] Production banner is NOT visible on `firstwhistlesports.com`
- [ ] Staging banner IS visible on staging URL
- [ ] Firebase Console → Functions → all functions show ACTIVE state
- [ ] Check `firebase functions:log` for any ERROR entries after smoke test

---

## Release Process

- [ ] **Restore PM release approval** — GitHub Actions production environment gate is currently approved by Claude (architect). Transfer approval back to PM before go-live. Settings → Environments → production → Required reviewers.

## Signup & Access Control

- [ ] **Open signups** — Set `system/signupConfig.open = true` in Firestore (Firebase Console → Firestore → system → signupConfig). Currently `false` to restrict to invited testers only.
- [ ] **Review allowedEmails list** — Once open, the `allowedEmails` array in `signupConfig` is no longer needed. Can be cleared or left in place (it is ignored when `open: true`).

## Email Verification (Option B — required before go-live)

Email verification was removed (Option A) to reduce signup friction for invited users. Before go-live, implement Option B: auto-verify invited users via the Admin SDK so that email verification is still enforced for non-invited signups.

- [x] **Implement auto-verify in `sendInvite`** — After writing the invite document, call `admin.auth().updateUser(uid, { emailVerified: true })` for the invited email. If the user does not yet have a Firebase Auth account, store a flag on the invite document (`autoVerify: true`) and verify on first sign-in in `onAuthStateChanged` / a sign-in trigger.
- [x] **Re-enable `emailVerified` check in login** — Restore the `if (!user.emailVerified)` gate in `useAuthStore.login` once auto-verify is in place.
- [ ] **Test end-to-end**: invited parent signs up → no verification email → lands directly on parent home page. Non-invited signup → blocked by allowlist OR must verify email.

## Email

- [x] **Brevo sending limits** — Real-time quota tracking via Firestore counter in sendEmail CF. Warns at 240/day (console.error), blocks at 285/day. Weekly cleanup of old quota docs. See `cleanupEmailQuota` CF.
- [ ] **Monitor bounce/spam rates** in Brevo dashboard after go-live.

## Security

- [ ] **Cloud Run IAM** — Confirm all callable functions have `allUsers:run.invoker` set. `sendInvite` required a manual fix during soft launch due to failed initial deployment. Verify remaining functions are not affected.
- [ ] **API key restrictions** — Review Google Cloud API key HTTP referrer restrictions to ensure only production domains are listed.
- [ ] **Firestore security rules audit** — Run full security review before opening to general public.
- [x] **Rate limit `resetUserPassword`** — Add per-target cooldown (5 min) to prevent inbox flooding by a rogue admin. See issue #229.

## Infrastructure

- [ ] **Firebase Spark → Blaze plan** — Already on Blaze for prod. Confirm billing alerts are configured.
- [ ] **Set up Firebase Performance Monitoring** for production visibility.
- [ ] **Review Cloud Function concurrency/scaling limits** for expected load.

## Legal & Compliance

- [ ] **Terms of Service and Privacy Policy** — Confirm versions are current and consent flow is working.
- [ ] **COPPA compliance** — Review parental consent flow for minor players.

---

## Per-Release Real-Infra Verification (manual)

Per the emulator-first test strategy locked 2026-04-26 (`memory/project_test_strategy.md`), the emulator covers all golden-path UI flows and security rules at $0. The following are the only things that genuinely require real infrastructure and **must be re-verified manually for every production release** — they are not covered by any automated test.

### Auth providers
- [ ] **Email/password** login on production URL (uses real Firebase Auth, not emulator)
- [ ] **Apple Sign-In** end-to-end (only if/when enabled)
- [ ] **Google Sign-In** end-to-end (only if/when enabled)
- [ ] Authorized domains list in Firebase Console → Authentication → Settings still includes the production domain and any new staging/preview domains

### Stripe (when payment changes ship)
- [ ] Stripe **sandbox** webhook delivery to production CF: trigger a test event from Stripe CLI, confirm webhook function logs receipt and writes the expected Firestore record
- [ ] Subscription create + cancel + grace-period transitions exercised once in sandbox before a billing-related release
- [ ] Coupon redemptions cap + expiry are configured per `feedback_stripe_coupon_discipline.md`

### Email delivery (Brevo/SendGrid)
- [ ] Send a real invite email through production: arrives within 60s, not in spam, sender = `noreply@firstwhistlesports.com`
- [ ] Brevo daily quota counter (`emailQuota` collection) is below the 240/day soft warning threshold
- [ ] Bounce / spam rate in Brevo dashboard reviewed for prior 7 days

### Push / FCM (when push notifications ship)
- [ ] Real device token receives a test notification end-to-end
- [ ] FCM credentials in Firebase Console match the app bundle ID

### Hosting / CDN / SSL
- [ ] `https://firstwhistlesports.com` returns a valid SSL cert (no warning, no `cert.expired`)
- [ ] Response headers include the expected CSP and `X-Frame-Options` values
- [ ] Static asset URLs return 200 (no 403 from Firebase Hosting cache)

### Firestore composite indexes
- [ ] After deploy, Firebase Console → Firestore → Indexes shows all listed indexes in **Enabled** state (not Building)
- [ ] If any index shows Building > 30 minutes on a small dataset, escalate

### Rationale

Automated CI testing runs entirely against the Firebase Emulator (Layer 1–3 of the test strategy). Staging is humans-only — no automated tests fire against staging. Production gets a single daily synthetic probe (login → dashboard → logout) for liveness; that probe does not validate any of the above. Real-infra validation is therefore explicitly scoped to this checklist and run by the PM (or designated reviewer) before each production release.
