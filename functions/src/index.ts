import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as twilio from 'twilio';

admin.initializeApp();

const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const twilioFromNumber = defineSecret('TWILIO_FROM_NUMBER');

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

    // Verify caller is admin, coach, or team creator via Firestore
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
