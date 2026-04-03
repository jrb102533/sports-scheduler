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
- [ ] Unverified email signup blocked with correct message

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
