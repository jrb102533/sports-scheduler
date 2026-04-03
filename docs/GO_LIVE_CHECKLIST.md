# Go-Live Checklist

Items to complete before opening First Whistle to the general public.

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
