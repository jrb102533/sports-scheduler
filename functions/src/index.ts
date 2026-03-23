import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';

const APP_URL = 'https://first-whistle-e76f4.web.app';
const FUNCTIONS_BASE = 'https://us-central1-first-whistle-e76f4.cloudfunctions.net';

admin.initializeApp();

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

interface Recipient { name: string; email: string; }
interface SendEmailData {
  to: string[];
  subject: string;
  message: string;
  recipients?: Recipient[];
  senderName?: string;
  teamName?: string;
}
interface SendEmailResult { sent: number; failed: number; errors: string[]; }

export const sendEmail = onCall<SendEmailData, Promise<SendEmailResult>>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);

    const { to, subject, message, recipients, senderName, teamName } = request.data;
    if (!to?.length) throw new HttpsError('invalid-argument', 'No recipients provided.');
    if (!subject?.trim()) throw new HttpsError('invalid-argument', 'Subject cannot be empty.');
    if (!message?.trim()) throw new HttpsError('invalid-argument', 'Message cannot be empty.');
    if (to.length > 100) throw new HttpsError('invalid-argument', 'Maximum 100 recipients.');

    const fullSubject = `First Whistle Message: ${subject.trim()}`;
    const escapedMessage = message.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    console.log(`sendEmail: sending to ${to.length} recipient(s), subject="${fullSubject}"`);
    const transporter = createTransporter();

    const results = await Promise.allSettled(
      to.map((address: string, i: number) => {
        const recipient = recipients?.[i];
        const toHeader = recipient ? `${recipient.name} <${recipient.email}>` : address;
        const senderLine = senderName
          ? `<p style="color:#6b7280;font-size:13px;margin:0">From: <strong>${senderName}</strong>${teamName ? ` · ${teamName}` : ''}</p>`
          : '';
        const recipientLine = recipient
          ? `<p style="color:#6b7280;font-size:13px;margin:0 0 16px">To: ${recipient.name} &lt;${recipient.email}&gt;</p>`
          : '';

        return transporter.sendMail({
          from: emailFrom.value(),
          to: toHeader,
          subject: fullSubject,
          text: [
            senderName ? `From: ${senderName}${teamName ? ` · ${teamName}` : ''}` : '',
            recipient ? `To: ${recipient.name} <${recipient.email}>` : '',
            '',
            message.trim(),
            '',
            '---',
            'Sent via First Whistle',
          ].filter((l, idx) => idx > 1 || l).join('\n'),
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
              <div style="background:linear-gradient(135deg,#15803d,#0d9488);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
                ${teamName ? `<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${teamName}</p>` : ''}
              </div>
              ${senderLine}
              ${recipientLine}
              <p style="color:#111827;white-space:pre-wrap;line-height:1.6">${escapedMessage}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px">Sent via First Whistle</p>
            </div>
          `,
        });
      })
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

    const appUrl = 'https://first-whistle-e76f4.web.app';

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
      text: `Hi ${playerName},\n\nYou've been added to ${teamName} on First Whistle.\n\nSign up or log in to view your schedule, track attendance, and stay connected with your team:\n${appUrl}\n\nSee you on the field!`,
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
            <a href="${appUrl}" style="background:#15803d;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
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

// ─── RSVP handler (HTTP GET) ──────────────────────────────────────────────────
// Called by email links: ?e={eventId}&p={playerId}&r={yes|no|maybe}&n={name}

export const rsvpEvent = onRequest(async (req, res) => {
  const eventId = req.query['e'] as string | undefined;
  const playerId = req.query['p'] as string | undefined;
  const response = req.query['r'] as string | undefined;
  const name = req.query['n'] as string | undefined;

  if (!eventId || !playerId || !['yes', 'no', 'maybe'].includes(response ?? '')) {
    res.status(400).send('<p>Invalid RSVP link.</p>');
    return;
  }

  const label = response === 'yes' ? 'Attending' : response === 'no' ? 'Not Attending' : 'Maybe Attending';
  const color = response === 'yes' ? '#15803d' : response === 'no' ? '#dc2626' : '#d97706';

  try {
    const eventRef = admin.firestore().doc(`events/${eventId}`);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      res.status(404).send('<p>Event not found.</p>');
      return;
    }

    const eventData = eventSnap.data()!;
    const existing: any[] = eventData.rsvps ?? [];
    const filtered = existing.filter((r: any) => r.playerId !== playerId);
    filtered.push({ playerId, name: name ?? 'Guest', response, respondedAt: new Date().toISOString() });
    await eventRef.update({ rsvps: filtered, updatedAt: new Date().toISOString() });

    const eventTitle = eventData.title ?? 'Event';
    const eventDate = eventData.date ?? '';
    const eventTime = eventData.startTime ?? '';

    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RSVP Confirmed</title></head>
      <body style="margin:0;font-family:sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh">
        <div style="background:white;border-radius:16px;padding:40px 32px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
          <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:12px;padding:20px;margin-bottom:28px">
            <p style="color:white;font-weight:700;font-size:18px;margin:0">First Whistle</p>
          </div>
          <div style="width:56px;height:56px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
            <span style="color:white;font-size:28px">${response === 'yes' ? '✓' : response === 'no' ? '✕' : '~'}</span>
          </div>
          <h1 style="color:#111827;font-size:20px;margin:0 0 8px">${label}</h1>
          <p style="color:#6b7280;font-size:14px;margin:0 0 4px"><strong>${name ?? 'You'}</strong></p>
          <p style="color:#6b7280;font-size:14px;margin:0">${eventTitle}${eventDate ? ' · ' + eventDate : ''}${eventTime ? ' at ' + eventTime : ''}</p>
          <a href="${APP_URL}" style="display:inline-block;margin-top:28px;background:#1B3A6B;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open First Whistle</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('rsvpEvent error:', err);
    res.status(500).send('<p>Something went wrong. Please try again.</p>');
  }
});

// ─── Send event RSVP invites (callable) ───────────────────────────────────────

interface RsvpRecipient { playerId: string; name: string; email: string; }
interface SendEventInviteData {
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventLocation?: string;
  teamName: string;
  senderName: string;
  recipients: RsvpRecipient[];
}

export const sendEventInvite = onCall<SendEventInviteData>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);

    const { eventId, eventTitle, eventDate, eventTime, eventLocation, teamName, senderName, recipients } = request.data;
    if (!recipients?.length) throw new HttpsError('invalid-argument', 'No recipients provided.');
    if (recipients.length > 100) throw new HttpsError('invalid-argument', 'Maximum 100 recipients.');

    const transporter = createTransporter();

    const results = await Promise.allSettled(
      recipients.map((recipient) => {
        const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(recipient.playerId)}&n=${encodeURIComponent(recipient.name)}`;
        const yesUrl = `${base}&r=yes`;
        const noUrl = `${base}&r=no`;
        const maybeUrl = `${base}&r=maybe`;

        const btnStyle = (bg: string) =>
          `display:inline-block;padding:10px 22px;border-radius:8px;background:${bg};color:white;text-decoration:none;font-weight:600;font-size:14px;margin:0 6px`;

        return transporter.sendMail({
          from: emailFrom.value(),
          to: `${recipient.name} <${recipient.email}>`,
          subject: `First Whistle Message: RSVP – ${eventTitle}`,
          text: [
            `From: ${senderName} · ${teamName}`,
            `To: ${recipient.name} <${recipient.email}>`,
            '',
            `You're invited to: ${eventTitle}`,
            `Date: ${eventDate}`,
            `Time: ${eventTime}`,
            ...(eventLocation ? [`Location: ${eventLocation}`] : []),
            '',
            'Will you be there?',
            `Yes: ${yesUrl}`,
            `No: ${noUrl}`,
            `Maybe: ${maybeUrl}`,
            '',
            '---',
            'Sent via First Whistle',
          ].join('\n'),
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
              <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
                <p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${teamName}</p>
              </div>

              <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:20px">
                <tr><td style="padding:3px 8px 3px 0;width:60px">From</td><td style="color:#111827;font-weight:600">${senderName} · ${teamName}</td></tr>
                <tr><td style="padding:3px 8px 3px 0">To</td><td style="color:#111827">${recipient.name} &lt;${recipient.email}&gt;</td></tr>
                <tr><td style="padding:3px 8px 3px 0">Event</td><td style="color:#111827;font-weight:600">${eventTitle}</td></tr>
                <tr><td style="padding:3px 8px 3px 0">Date</td><td style="color:#111827">${eventDate}</td></tr>
                <tr><td style="padding:3px 8px 3px 0">Time</td><td style="color:#111827">${eventTime}</td></tr>
                ${eventLocation ? `<tr><td style="padding:3px 8px 3px 0">Location</td><td style="color:#111827">${eventLocation}</td></tr>` : ''}
              </table>

              <p style="color:#111827;font-size:15px;font-weight:600;text-align:center;margin:0 0 20px">Will you be there, ${recipient.name.split(' ')[0]}?</p>

              <div style="text-align:center;margin-bottom:24px">
                <a href="${yesUrl}" style="${btnStyle('#15803d')}">Yes, I'll be there</a>
                <a href="${maybeUrl}" style="${btnStyle('#d97706')}">Maybe</a>
                <a href="${noUrl}" style="${btnStyle('#dc2626')}">Can't make it</a>
              </div>

              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
            </div>
          `,
        });
      })
    );

    const errors: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push(`${recipients[i].email}: ${(result.reason as Error)?.message ?? 'Unknown error'}`);
      }
    });

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`sendEventInvite: sent=${sent}, failed=${errors.length}`, errors.length ? errors : '');
    return { sent, failed: errors.length, errors };
  }
);

// ─── Event created → notify team members ─────────────────────────────────────

export const onEventCreated = onDocumentCreated(
  {
    document: 'events/{eventId}',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom],
  },
  async (event) => {
    const ev = event.data?.data();
    if (!ev) return;

    const teamIds: string[] = ev.teamIds ?? [];
    if (!teamIds.length) return;

    // Collect all email addresses from players on the event's teams
    const playersSnap = await admin.firestore()
      .collection('players')
      .where('teamId', 'in', teamIds.slice(0, 10))
      .get();

    const emails: { name: string; address: string }[] = [];
    for (const p of playersSnap.docs) {
      const d = p.data();
      const name: string = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
      const addrs: string[] = [
        d.email,
        d.parentContact?.parentEmail,
        d.parentContact2?.parentEmail,
      ].filter((e: any): e is string => typeof e === 'string' && e.trim().length > 0);
      addrs.forEach(address => emails.push({ name, address }));
    }

    if (!emails.length) {
      console.log('onEventCreated: no email addresses found for teams', teamIds);
      return;
    }

    let teamName = '';
    if (teamIds[0]) {
      const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
      teamName = teamDoc.data()?.name ?? '';
    }

    const title: string = ev.title ?? 'New Event';
    const date: string = ev.date ?? '';
    const time: string = ev.startTime ?? '';
    const location: string = ev.location ?? '';
    const type: string = ev.type ?? 'event';

    const transporter = createTransporter();

    await Promise.allSettled(emails.map(({ name, address }) =>
      transporter.sendMail({
        from: emailFrom.value(),
        to: `${name} <${address}>`,
        subject: `First Whistle: New ${type} scheduled — ${title}`,
        text: [
          teamName ? `Team: ${teamName}` : '',
          `Event: ${title}`,
          `Date: ${date}`,
          `Time: ${time}`,
          location ? `Location: ${location}` : '',
          '',
          `View your schedule: ${APP_URL}`,
        ].filter(Boolean).join('\n'),
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
            <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
              <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
              ${teamName ? `<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${teamName}</p>` : ''}
            </div>
            <p style="color:#111827;font-size:15px;font-weight:600;margin:0 0 16px">A new ${type} has been scheduled</p>
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
    ));

    console.log(`onEventCreated: notified ${emails.length} address(es) for event "${title}"`);
  }
);
