import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';

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
              <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
              </div>
              <p style="color:#374151;white-space:pre-wrap">${message.trim().replace(/</g, '&lt;')}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
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
      to: `${playerName} <${to.trim()}>`,
      subject: `You've been added to ${teamName} on First Whistle`,
      text: `Hi ${playerName},\n\nYou've been added to ${teamName} on First Whistle.\n\nSign up or log in to view your schedule, track attendance, and stay connected with your team:\n${appUrl}\n\nSee you on the field!`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
          <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
            <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Game day starts here.</p>
          </div>
          <h2 style="color:#111827">Hi ${playerName},</h2>
          <p style="color:#374151">You've been added to <strong>${teamName}</strong> on First Whistle.</p>
          <p style="color:#374151">Sign up or log in to view your schedule, track attendance, and stay connected with your team.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${appUrl}" style="background:#1B3A6B;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
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
    const userName: string = userDoc.data()?.displayName || userEmail;

    const transporter = createTransporter();
    await transporter.sendMail({
      from: emailFrom.value(),
      to: `${userName} <${userEmail}>`,
      subject: notif.title,
      text: `Hi ${userName},\n\n${notif.message}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
          <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
            <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
          </div>
          <p style="color:#374151">Hi ${userName},</p>
          <h2 style="color:#111827">${notif.title}</h2>
          <p style="color:#374151">${notif.message}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
        </div>
      `,
    });
  }
);
