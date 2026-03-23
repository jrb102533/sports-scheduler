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

---

## TD-003 — Email notifications on new notification doc (Firestore trigger)

**Current state:** `onNotificationCreated` Cloud Function is written but not deployed. No email is sent when a notification is created in Firestore.

**Desired state:** When a notification doc is written to Firestore, the function triggers and sends an HTML email via SMTP.

**Blocked by:** Firestore-triggered Cloud Functions require the Blaze plan (same as TD-001).

**To resolve:**
1. Resolve TD-001 first (Blaze upgrade + SMTP secrets)
2. Deploy functions: `firebase deploy --only functions --project test`

**Files:** `functions/src/index.ts`

---

## TD-005 — Stray backslash/whitespace artifact (`\ `) in UI (origin unresolved)

**Symptom:** Users see stray `\ ` (backslash + space) characters in the rendered UI.

**Investigation (2026-03-23):** Searched all `.tsx` and `.ts` files under `src/` for:
- Literal backslash-space bytes (`\\ ` and `\<space>` via grep/Perl regex)
- Template literals or string concatenations producing backslash output
- `.filter(Boolean).join(...)` calls that could render `\n` as text (found in `MessagingPage.tsx`, `ComposeMessageModal.tsx`, `LeagueDetailPage.tsx` — all use safe separators like ` · ` or `, `, not `\n`)
- Dynamic text rendering in `EventCard`, `EventDetailPanel`, `AttendanceTracker`, `EventChip`
- `dateUtils.ts` formatting functions

No source-code cause was found. The artifact may originate from **data stored in Firestore** (e.g. an event title, location, or notes field containing a literal backslash), or from a browser extension / copy-paste artefact in demo data (`src/lib/demoData.ts`).

**Next steps to resolve:**
1. Check `src/lib/demoData.ts` for any string values containing `\ `
2. Inspect Firestore documents directly for backslash characters in `title`, `location`, `notes`, `ownerName`, `coachName` fields
3. If found in demoData, sanitize the string; if from Firestore, add an input sanitization step in the relevant form `onSubmit` handler

**Files investigated:** `src/components/events/EventCard.tsx`, `src/components/events/EventDetailPanel.tsx`, `src/components/attendance/AttendanceTracker.tsx`, `src/pages/MessagingPage.tsx`, `src/components/messaging/ComposeMessageModal.tsx`, `src/pages/LeagueDetailPage.tsx`, `src/lib/dateUtils.ts`

---

## TD-004 — Lazy-load xlsx (SheetJS) to reduce bundle size and hosting bandwidth

**Current state:** The `xlsx` library (~800 kB unminified) is bundled into the main JS chunk, inflating it to 1.1 MB (352 kB gzipped). On Spark plan, Firebase Hosting allows 360 MB/day transfer — large bundles reduce headroom.

**Desired state:** `ImportEventsModal` is lazy-loaded via `React.lazy` + `Suspense` so xlsx is only fetched when the user clicks "Import".

**Blocked by:** Nothing — purely a code change, no plan upgrade required.

**To resolve:**
1. In `EventsPage.tsx`, replace static import of `ImportEventsModal` with `const ImportEventsModal = React.lazy(() => import('@/components/events/ImportEventsModal'))`
2. Wrap the modal in `<Suspense fallback={null}>`

**Files:** `src/pages/EventsPage.tsx`, `src/components/events/ImportEventsModal.tsx`
