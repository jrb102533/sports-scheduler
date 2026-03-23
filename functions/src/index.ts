import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';

admin.initializeApp();

const APP_URL = 'https://first-whistle-e76f4.web.app';
const FUNCTIONS_BASE = 'https://us-central1-first-whistle-e76f4.cloudfunctions.net';

// ─── Secrets ────────────────────────────────────────────────────────────────

// Twilio secrets defined here when SMS is re-enabled (TD-002)

const smtpHost = defineSecret('SMTP_HOST');
const smtpPort = defineSecret('SMTP_PORT');
const smtpUser = defineSecret('SMTP_USER');
const smtpPass = defineSecret('SMTP_PASS');
const emailFrom = defineSecret('EMAIL_FROM');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTransporter() {
  return nodemailer.createTransport({
    host: smtpHost.value(),
    port: parseInt(smtpPort.value(), 10),
    secure: parseInt(smtpPort.value(), 10) === 465,
    auth: { user: smtpUser.value(), pass: smtpPass.value() },
  });
}

async function assertAdminOrCoach(uid: string) {
  const doc = await admin.firestore().doc(`users/${uid}`).get();
  const role = doc.data()?.role;
  console.log(`assertAdminOrCoach: uid=${uid}, role=${role}`);
  if (!['admin', 'coach', 'league_manager'].includes(role)) {
    throw new HttpsError('permission-denied', 'Only admins, coaches, and league managers can perform this action.');
  }
}

// ─── SMS (TD-002 — disabled until Twilio account is set up) ──────────────────
// Uncomment and restore Twilio secrets above to re-enable.
// export const sendSms = ...

// ─── Email messaging (callable) ───────────────────────────────────────────────

interface SendEmailData { to: string[]; subject: string; message: string; }
interface SendEmailResult { sent: number; failed: number; errors: string[]; }

export const sendEmail = onCall<SendEmailData, Promise<SendEmailResult>>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);

    const { to, subject, message } = request.data;
    if (!to?.length) throw new HttpsError('invalid-argument', 'No recipients provided.');
    if (!subject?.trim()) throw new HttpsError('invalid-argument', 'Subject cannot be empty.');
    if (!message?.trim()) throw new HttpsError('invalid-argument', 'Message cannot be empty.');
    if (to.length > 100) throw new HttpsError('invalid-argument', 'Maximum 100 recipients.');

    console.log(`sendEmail: sending to ${to.length} recipient(s), subject="${subject.trim()}"`);
    const transporter = createTransporter();
    const results = await Promise.allSettled(
      to.map((address: string) =>
        transporter.sendMail({
          from: emailFrom.value(),
          to: address,
          subject: subject.trim(),
          text: message.trim(),
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto">
              <p style="color:#374151;white-space:pre-wrap">${message.trim().replace(/</g, '&lt;')}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px">Sent via First Whistle</p>
            </div>
          `,
        })
      )
    );

    const errors: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push(`${to[i]}: ${(result.reason as Error)?.message ?? 'Unknown error'}`);
      }
    });

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`sendEmail: sent=${sent}, failed=${errors.length}`, errors.length ? errors : '');
    return { sent, failed: errors.length, errors };
  }
);

// ─── Player invite ─────────────────────────────────────────────────────────────
// Stores an invite record and sends a welcome email. The client checks
// invites/{email} on signup/login to auto-link the player record.

interface SendInviteData {
  to: string;
  playerName: string;
  teamName: string;
  playerId: string;
  teamId: string;
}

export const sendInvite = onCall<SendInviteData>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);

    const { to, playerName, teamName, playerId, teamId } = request.data;
    if (!to?.trim()) throw new HttpsError('invalid-argument', 'Email address is required.');

    // Store invite so auto-link can find it on signup/login
    await admin.firestore().doc(`invites/${to.toLowerCase().trim()}`).set({
      playerId,
      teamId,
      playerName,
      teamName,
      invitedAt: new Date().toISOString(),
    });

    const transporter = createTransporter();
    await transporter.sendMail({
      from: emailFrom.value(),
      to: to.trim(),
      subject: `You've been added to ${teamName} on First Whistle`,
      text: `Hi ${playerName},\n\nYou've been added to ${teamName} on First Whistle.\n\nSign up or log in to view your schedule, track attendance, and stay connected with your team:\n${APP_URL}\n\nSee you on the field!`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
          <div style="background:linear-gradient(135deg,#15803d,#0d9488);border-radius:12px;padding:24px;margin-bottom:24px;text-align:center">
            <h1 style="color:white;margin:0;font-size:22px">First Whistle</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Game day starts here.</p>
          </div>
          <h2 style="color:#111827">Hi ${playerName},</h2>
          <p style="color:#374151">You've been added to <strong>${teamName}</strong> on First Whistle.</p>
          <p style="color:#374151">Sign up or log in to view your schedule, track attendance, and stay connected with your team.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${APP_URL}" style="background:#15803d;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              View My Team
            </a>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px;text-align:center">
            You received this because a coach added you to their roster on First Whistle.
          </p>
        </div>
      `,
    });
  }
);

// ─── Email notifications (Firestore trigger) ──────────────────────────────────

export const onNotificationCreated = onDocumentCreated(
  {
    document: 'users/{uid}/notifications/{notifId}',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom],
  },
  async (event) => {
    const notif = event.data?.data();
    if (!notif) return;

    const uid = event.params.uid;
    const userDoc = await admin.firestore().doc(`users/${uid}`).get();
    const userEmail = userDoc.data()?.email as string | undefined;
    if (!userEmail) return;

    const transporter = createTransporter();
    await transporter.sendMail({
      from: emailFrom.value(),
      to: userEmail,
      subject: notif.title,
      text: notif.message,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
          <h2 style="color:#1d4ed8">${notif.title}</h2>
          <p style="color:#374151">${notif.message}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px">
            You received this because you have notifications enabled in First Whistle.
          </p>
        </div>
      `,
    });
  }
);

// ─── Scheduled: event reminders (daily 8 AM UTC) ─────────────────────────────
// Sends a 24-hour reminder to every player on teams with an event tomorrow.

export const sendEventReminders = onSchedule(
  {
    schedule: '0 8 * * *',
    timeZone: 'UTC',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom],
  },
  async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD

    const eventsSnap = await admin.firestore()
      .collection('events')
      .where('date', '==', tomorrowStr)
      .get();

    if (eventsSnap.empty) {
      console.log('sendEventReminders: no events tomorrow');
      return;
    }

    const transporter = createTransporter();
    let totalSent = 0;

    for (const eventDoc of eventsSnap.docs) {
      const ev = eventDoc.data();
      const teamIds: string[] = ev.teamIds ?? [];
      if (!teamIds.length) continue;

      const playersSnap = await admin.firestore()
        .collection('players')
        .where('teamId', 'in', teamIds.slice(0, 10))
        .get();

      const recipients: { name: string; address: string }[] = [];
      for (const p of playersSnap.docs) {
        const d = p.data();
        const name = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
        const addrs: string[] = [
          d.email,
          d.parentContact?.parentEmail,
          d.parentContact2?.parentEmail,
        ].filter((e: unknown): e is string => typeof e === 'string' && e.trim().length > 0);
        addrs.forEach(address => recipients.push({ name, address }));
      }

      if (!recipients.length) continue;

      const title: string = ev.title ?? 'Event';
      const date: string = ev.date ?? '';
      const time: string = ev.startTime ?? '';
      const location: string = ev.location ?? '';

      let teamName = '';
      if (teamIds[0]) {
        const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
        teamName = teamDoc.data()?.name ?? '';
      }

      const results = await Promise.allSettled(
        recipients.map(({ name, address }) =>
          transporter.sendMail({
            from: emailFrom.value(),
            to: `${name} <${address}>`,
            subject: `First Whistle Reminder: ${title} is tomorrow`,
            text: [
              `Hi ${name},`,
              '',
              `This is a reminder that ${title} is scheduled for tomorrow.`,
              `Date: ${date}`,
              `Time: ${time}`,
              location ? `Location: ${location}` : '',
              teamName ? `Team: ${teamName}` : '',
              '',
              `View your schedule: ${APP_URL}`,
              '',
              '---',
              'Sent via First Whistle',
            ].filter(Boolean).join('\n'),
            html: `
              <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
                <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                  <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
                  ${teamName ? `<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${teamName}</p>` : ''}
                </div>
                <p style="color:#111827;font-size:15px;font-weight:600;margin:0 0 4px">Hi ${name},</p>
                <p style="color:#374151;margin:0 0 20px">This is a reminder that <strong>${title}</strong> is scheduled for tomorrow.</p>
                <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:24px">
                  <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${title}</td></tr>
                  <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${date}</td></tr>
                  <tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${time}</td></tr>
                  ${location ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${location}</td></tr>` : ''}
                  ${teamName ? `<tr><td style="padding:4px 8px 4px 0">Team</td><td style="color:#111827">${teamName}</td></tr>` : ''}
                </table>
                <div style="text-align:center;margin-bottom:24px">
                  <a href="${APP_URL}" style="background:#1B3A6B;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View Schedule</a>
                </div>
                <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
                <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
              </div>
            `,
          })
        )
      );

      totalSent += results.filter(r => r.status === 'fulfilled').length;
    }

    console.log(`sendEventReminders: sent ${totalSent} reminder(s) for ${eventsSnap.size} event(s) on ${tomorrowStr}`);
  }
);

// ─── Scheduled: RSVP follow-ups (daily 10 AM UTC) ────────────────────────────
// Sends RSVP prompts to players who haven't responded to tomorrow's events.

export const sendRsvpFollowups = onSchedule(
  {
    schedule: '0 10 * * *',
    timeZone: 'UTC',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom],
  },
  async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const eventsSnap = await admin.firestore()
      .collection('events')
      .where('date', '==', tomorrowStr)
      .get();

    if (eventsSnap.empty) {
      console.log('sendRsvpFollowups: no events tomorrow');
      return;
    }

    const transporter = createTransporter();
    let totalSent = 0;

    for (const eventDoc of eventsSnap.docs) {
      const ev = eventDoc.data();
      const eventId = eventDoc.id;
      const teamIds: string[] = ev.teamIds ?? [];
      if (!teamIds.length) continue;

      const existingRsvps: { playerId: string }[] = ev.rsvps ?? [];
      const respondedIds = new Set(existingRsvps.map(r => r.playerId));

      const playersSnap = await admin.firestore()
        .collection('players')
        .where('teamId', 'in', teamIds.slice(0, 10))
        .get();

      const title: string = ev.title ?? 'Event';
      const date: string = ev.date ?? '';
      const time: string = ev.startTime ?? '';
      const location: string = ev.location ?? '';

      let teamName = '';
      if (teamIds[0]) {
        const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
        teamName = teamDoc.data()?.name ?? '';
      }

      const btnStyle = (bg: string) =>
        `display:inline-block;padding:10px 22px;border-radius:8px;background:${bg};color:white;text-decoration:none;font-weight:600;font-size:14px;margin:0 6px`;

      const results = await Promise.allSettled(
        playersSnap.docs
          .filter(p => !respondedIds.has(p.id))
          .flatMap(p => {
            const d = p.data();
            const playerId = p.id;
            const name = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
            const firstName = name.split(' ')[0];
            const addrs: string[] = [
              d.email,
              d.parentContact?.parentEmail,
              d.parentContact2?.parentEmail,
            ].filter((e: unknown): e is string => typeof e === 'string' && e.trim().length > 0);

            const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(playerId)}&n=${encodeURIComponent(name)}`;
            const yesUrl = `${base}&r=yes`;
            const noUrl  = `${base}&r=no`;
            const maybeUrl = `${base}&r=maybe`;

            return addrs.map(address =>
              transporter.sendMail({
                from: emailFrom.value(),
                to: `${name} <${address}>`,
                subject: `First Whistle: Don't forget to RSVP – ${title}`,
                text: [
                  `Hi ${name},`,
                  '',
                  `You haven't responded yet to tomorrow's event.`,
                  `Event: ${title}`,
                  `Date: ${date}`,
                  `Time: ${time}`,
                  location ? `Location: ${location}` : '',
                  '',
                  `Yes: ${yesUrl}`,
                  `Maybe: ${maybeUrl}`,
                  `No: ${noUrl}`,
                  '',
                  '---',
                  'Sent via First Whistle',
                ].filter(Boolean).join('\n'),
                html: `
                  <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
                    <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                      <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
                      ${teamName ? `<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${teamName}</p>` : ''}
                    </div>
                    <p style="color:#111827;font-size:15px;font-weight:600;margin:0 0 4px">Hi ${firstName},</p>
                    <p style="color:#374151;margin:0 0 20px">You haven't responded yet to tomorrow's event. Will you be there?</p>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:20px">
                      <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${title}</td></tr>
                      <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${date}</td></tr>
                      <tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${time}</td></tr>
                      ${location ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${location}</td></tr>` : ''}
                    </table>
                    <div style="text-align:center;margin-bottom:24px">
                      <a href="${yesUrl}" style="${btnStyle('#15803d')}">Yes, I'll be there</a>
                      <a href="${maybeUrl}" style="${btnStyle('#d97706')}">Maybe</a>
                      <a href="${noUrl}" style="${btnStyle('#dc2626')}">Can't make it</a>
                    </div>
                    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
                    <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
                  </div>
                `,
              })
            );
          })
      );

      totalSent += results.filter(r => r.status === 'fulfilled').length;
    }

    console.log(`sendRsvpFollowups: sent ${totalSent} follow-up(s) for events on ${tomorrowStr}`);
  }
);
