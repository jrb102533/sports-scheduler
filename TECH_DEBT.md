# Tech Debt

Items deferred for later. Each entry includes context and what "done" looks like.

---

## TD-001 — In-app email sending (messaging page)

**Current state:** Email messaging uses `mailto:` which opens the user's local email client.

**Desired state:** Emails sent directly from the app via the `sendEmail` Cloud Function (already written in `functions/src/index.ts`) using SMTP/nodemailer.

**Blocked by:** Firebase project needs to be upgraded to the Blaze (pay-as-you-go) plan before Cloud Functions can make outbound network calls.

**To resolve:**
1. Upgrade project `first-whistle-e76f4` to Blaze at https://console.firebase.google.com/project/first-whistle-e76f4/usage/details
2. Set SMTP secrets: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
3. Deploy functions: `firebase deploy --only functions --project test`
4. In `MessagingPage.tsx`, replace the `mailto:` anchor with a call to `sendEmailFn` (the httpsCallable is already imported and defined)

**Files:** `src/pages/MessagingPage.tsx`, `functions/src/index.ts`

---

## TD-002 — In-app SMS sending

**Current state:** SMS feature is disabled via `VITE_FEATURE_SMS=false` feature flag.

**Desired state:** Coaches and admins can send SMS directly from the messaging page via the `sendSms` Cloud Function (already written) using Twilio.

**Blocked by:** Same Blaze plan requirement as TD-001. Also requires a Twilio account.

**To resolve:**
1. Resolve TD-001 first (Blaze upgrade)
2. Get Twilio account — set secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
3. Deploy functions: `firebase deploy --only functions --project test`
4. Set `VITE_FEATURE_SMS=true` in `.env.test.local`

**Files:** `src/pages/MessagingPage.tsx`, `src/lib/features.ts`, `functions/src/index.ts`
