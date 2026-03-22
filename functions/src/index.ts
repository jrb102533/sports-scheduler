import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as twilio from 'twilio';
import * as nodemailer from 'nodemailer';

admin.initializeApp();

// ─── Secrets ────────────────────────────────────────────────────────────────

const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const twilioFromNumber = defineSecret('TWILIO_FROM_NUMBER');

const smtpHost = defineSecret('SMTP_HOST');
const smtpPort = defineSecret('SMTP_PORT');
const smtpUser = defineSecret('SMTP_USER');
const smtpPass = defineSecret('SMTP_PASS');
const emailFrom = defineSecret('EMAIL_FROM');

// ─── SMS (feature-flagged off in app; kept here for when it's enabled) ──────

interface SendSmsData {
  to: string[];
  message: string;
}

interface SendSmsResult {
  sent: number;
  failed: number;
  errors: string[];
}

export const sendSms = onCall<SendSmsData, Promise<SendSmsResult>>(
  { secrets: [twilioAccountSid, twilioAuthToken, twilioFromNumber] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in to send messages.');
    }

    const callerDoc = await admin.firestore().doc(`users/${request.auth.uid}`).get();
    const callerRole = callerDoc.data()?.role;
    if (!['admin', 'coach'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Only admins and coaches can send SMS.');
    }

    const { to, message } = request.data;
    if (!to?.length) throw new HttpsError('invalid-argument', 'No recipients provided.');
    if (!message?.trim()) throw new HttpsError('invalid-argument', 'Message cannot be empty.');
    if (to.length > 100) throw new HttpsError('invalid-argument', 'Maximum 100 recipients per message.');

    const client = twilio.default(twilioAccountSid.value(), twilioAuthToken.value());

    const results = await Promise.allSettled(
      to.map((phone: string) =>
        client.messages.create({
          to: phone,
          from: twilioFromNumber.value(),
          body: message.trim(),
        })
      )
    );

    const errors: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push(`${to[i]}: ${result.reason?.message ?? 'Unknown error'}`);
      }
    });

    return {
      sent: results.filter(r => r.status === 'fulfilled').length,
      failed: errors.length,
      errors,
    };
  }
);

// ─── Email notifications ─────────────────────────────────────────────────────
// Triggered whenever a new notification doc is written to users/{uid}/notifications/{notifId}.
// Looks up the user's email and sends the notification via SMTP.

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

    const transporter = nodemailer.createTransport({
      host: smtpHost.value(),
      port: parseInt(smtpPort.value(), 10),
      secure: parseInt(smtpPort.value(), 10) === 465,
      auth: {
        user: smtpUser.value(),
        pass: smtpPass.value(),
      },
    });

    await transporter.sendMail({
      from: emailFrom.value(),
      to: userEmail,
      subject: notif.title,
      text: notif.message,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#1d4ed8">${notif.title}</h2>
          <p style="color:#374151">${notif.message}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px">
            You received this because you have notifications enabled in Sports Scheduler.
          </p>
        </div>
      `,
    });
  }
);
