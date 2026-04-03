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
- [ ] Email verification enforced for non-invited signups (deferred — requires Option B auto-verify implementation; see "Email Verification" section below)

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

## Signup & Access Control

- [ ] **Open signups** — Set `system/signupConfig.open = true` in Firestore (Firebase Console → Firestore → system → signupConfig). Currently `false` to restrict to invited testers only.
- [ ] **Review allowedEmails list** — Once open, the `allowedEmails` array in `signupConfig` is no longer needed. Can be cleared or left in place (it is ignored when `open: true`).

## Email Verification (Option B — required before go-live)

Email verification was removed (Option A) to reduce signup friction for invited users. Before go-live, implement Option B: auto-verify invited users via the Admin SDK so that email verification is still enforced for non-invited signups.

- [ ] **Implement auto-verify in `sendInvite`** — After writing the invite document, call `admin.auth().updateUser(uid, { emailVerified: true })` for the invited email. If the user does not yet have a Firebase Auth account, store a flag on the invite document (`autoVerify: true`) and verify on first sign-in in `onAuthStateChanged` / a sign-in trigger.
- [ ] **Re-enable `emailVerified` check in login** — Restore the `if (!user.emailVerified)` gate in `useAuthStore.login` once auto-verify is in place.
- [ ] **Test end-to-end**: invited parent signs up → no verification email → lands directly on parent home page. Non-invited signup → blocked by allowlist OR must verify email.

## Email

- [ ] **Brevo sending limits** — Verify Brevo free tier (300 emails/day) is sufficient or upgrade to a paid plan before launch.
- [ ] **Monitor bounce/spam rates** in Brevo dashboard after go-live.

## Security

- [ ] **Cloud Run IAM** — Confirm all callable functions have `allUsers:run.invoker` set. `sendInvite` required a manual fix during soft launch due to failed initial deployment. Verify remaining functions are not affected.
- [ ] **API key restrictions** — Review Google Cloud API key HTTP referrer restrictions to ensure only production domains are listed.
- [ ] **Firestore security rules audit** — Run full security review before opening to general public.

## Infrastructure

- [ ] **Firebase Spark → Blaze plan** — Already on Blaze for prod. Confirm billing alerts are configured.
- [ ] **Set up Firebase Performance Monitoring** for production visibility.
- [ ] **Review Cloud Function concurrency/scaling limits** for expected load.

## Legal & Compliance

- [ ] **Terms of Service and Privacy Policy** — Confirm versions are current and consent flow is working.
- [ ] **COPPA compliance** — Review parental consent flow for minor players.
