/**
 * Practice Slot Signup callable Cloud Functions — Issue #130
 *
 * All signup/cancel/blackout mutations go through these callables so that
 * FCFS capacity checks and waitlist promotion run atomically inside
 * Firestore transactions. Direct client writes to practiceSlotSignups are
 * blocked in security rules.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import type { PracticeSlotWindow, PracticeSlotSignup } from './types';

const db = () => admin.firestore();

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignUpData {
  leagueId: string;
  seasonId: string;
  windowId: string;
  occurrenceDate: string; // "YYYY-MM-DD"
  teamId: string;
  teamName: string;
}

interface CancelSignupData {
  leagueId: string;
  seasonId: string;
  signupId: string;
}

interface AddBlackoutData {
  leagueId: string;
  seasonId: string;
  windowId: string;
  date: string; // "YYYY-MM-DD"
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive the deterministic signup document ID. */
function signupDocId(windowId: string, occurrenceDate: string, teamId: string): string {
  return `${windowId}_${occurrenceDate}_${teamId}`;
}

/** Resolve the collection path for practiceSlotSignups under a season. */
function signupsCol(leagueId: string, seasonId: string) {
  return db().collection(
    `leagues/${leagueId}/seasons/${seasonId}/practiceSlotSignups`,
  );
}

function windowsCol(leagueId: string, seasonId: string) {
  return db().collection(
    `leagues/${leagueId}/seasons/${seasonId}/practiceSlotWindows`,
  );
}

/** Write a notification to a user's subcollection. */
async function writeNotification(
  tx: FirebaseFirestore.Transaction,
  userId: string,
  type: string,
  title: string,
  message: string,
  extras: Record<string, string> = {},
): Promise<void> {
  const ref = db().collection(`users/${userId}/notifications`).doc();
  tx.set(ref, {
    id: ref.id,
    type,
    title,
    message,
    isRead: false,
    createdAt: new Date().toISOString(),
    ...extras,
  });
}

/**
 * Verify the caller is a league manager (or admin) for the given league.
 * Returns the caller's effective role.
 */
async function assertLeagueManager(uid: string, leagueId: string): Promise<void> {
  const userDoc = await db().doc(`users/${uid}`).get();
  const data = userDoc.data();
  if (!data) throw new HttpsError('unauthenticated', 'User not found.');

  const role: string = data.role ?? '';
  const isAdmin = role === 'admin';
  const isLM = role === 'league_manager';

  if (!isAdmin && !isLM) {
    throw new HttpsError('permission-denied', 'Only league managers can perform this action.');
  }

  if (isLM) {
    const leagueRef = await db().doc(`leagues/${leagueId}`).get();
    const leagueData = leagueRef.data();
    const profileLeagueId: string = data.leagueId ?? '';
    const managedBy: string = leagueData?.managedBy ?? '';
    if (profileLeagueId !== leagueId && managedBy !== uid) {
      throw new HttpsError('permission-denied', 'You are not a manager of this league.');
    }
  }
}

/**
 * Verify the caller is a coach and owns/coaches the given team.
 */
async function assertCoachForTeam(uid: string, teamId: string): Promise<void> {
  const userDoc = await db().doc(`users/${uid}`).get();
  const data = userDoc.data();
  if (!data) throw new HttpsError('unauthenticated', 'User not found.');

  const role: string = data.role ?? '';
  if (role !== 'coach' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only coaches can sign up for practice slots.');
  }

  if (role !== 'admin') {
    const teamDoc = await db().doc(`teams/${teamId}`).get();
    const teamData = teamDoc.data();
    if (!teamData) throw new HttpsError('not-found', 'Team not found.');
    if (teamData.coachId !== uid && teamData.createdBy !== uid) {
      throw new HttpsError('permission-denied', 'You are not the coach of this team.');
    }
  }
}

// ─── practiceSlotSignUp ───────────────────────────────────────────────────────

/**
 * Sign a team up for a specific occurrence of a practice slot window.
 *
 * - If capacity is available: status = 'confirmed'; a ScheduledEvent is created.
 * - If capacity is full:      status = 'waitlisted'; no ScheduledEvent yet.
 *
 * Uses a Firestore transaction to atomically check capacity and write the
 * signup, preventing race-condition overbooking.
 */
export const practiceSlotSignUp = onCall<SignUpData>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');

  const { leagueId, seasonId, windowId, occurrenceDate, teamId, teamName } = request.data;
  if (!leagueId || !seasonId || !windowId || !occurrenceDate || !teamId) {
    throw new HttpsError('invalid-argument', 'Missing required fields.');
  }

  await assertCoachForTeam(uid, teamId);

  // Fetch the caller's display name for denormalization
  const userSnap = await db().doc(`users/${uid}`).get();
  const coachName: string = userSnap.data()?.displayName ?? 'Coach';

  const windowRef = windowsCol(leagueId, seasonId).doc(windowId);
  const signupRef = signupsCol(leagueId, seasonId).doc(
    signupDocId(windowId, occurrenceDate, teamId),
  );
  const eventsCol = db().collection('events');
  const now = new Date().toISOString();

  const result = await db().runTransaction(async (tx) => {
    const windowSnap = await tx.get(windowRef);
    if (!windowSnap.exists) throw new HttpsError('not-found', 'Practice slot window not found.');

    const window = windowSnap.data() as PracticeSlotWindow;
    if (window.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This practice slot is not currently accepting signups.');
    }
    if (window.blackoutDates.includes(occurrenceDate)) {
      throw new HttpsError('failed-precondition', 'This date has been blacked out by the league manager.');
    }

    // Prevent double-booking
    const existingSnap = await tx.get(signupRef);
    if (existingSnap.exists) {
      const existing = existingSnap.data() as PracticeSlotSignup;
      if (existing.status === 'confirmed' || existing.status === 'waitlisted') {
        throw new HttpsError('already-exists', 'Your team is already signed up for this slot.');
      }
    }

    // Count confirmed signups for this occurrence
    const confirmedQuery = signupsCol(leagueId, seasonId)
      .where('windowId', '==', windowId)
      .where('occurrenceDate', '==', occurrenceDate)
      .where('status', '==', 'confirmed');
    const confirmedSnap = await tx.get(confirmedQuery);
    const confirmedCount = confirmedSnap.size;

    const isConfirmed = confirmedCount < window.capacity;

    let eventId: string | null = null;

    if (isConfirmed) {
      // Create a ScheduledEvent for the confirmed booking
      const eventRef = eventsCol.doc();
      eventId = eventRef.id;
      tx.set(eventRef, {
        id: eventId,
        type: 'practice',
        teamIds: [teamId],
        seasonId,
        venueId: window.venueId,
        venueName: window.venueName,
        startTime: `${occurrenceDate}T${window.startTime}:00`,
        endTime: `${occurrenceDate}T${window.endTime}:00`,
        status: 'published',
        createdAt: now,
        updatedAt: now,
        practiceSlotWindowId: windowId,
        practiceSlotSignupId: signupRef.id,
      });
    }

    // Count waitlisted signups for position calculation
    let waitlistPosition: number | null = null;
    if (!isConfirmed) {
      const waitlistQuery = signupsCol(leagueId, seasonId)
        .where('windowId', '==', windowId)
        .where('occurrenceDate', '==', occurrenceDate)
        .where('status', '==', 'waitlisted');
      const waitlistSnap = await tx.get(waitlistQuery);
      waitlistPosition = waitlistSnap.size + 1;
    }

    const signupData: PracticeSlotSignup = {
      id: signupRef.id,
      windowId,
      occurrenceDate,
      teamId,
      teamName,
      coachUid: uid,
      coachName,
      status: isConfirmed ? 'confirmed' : 'waitlisted',
      waitlistPosition,
      eventId,
      signedUpAt: now,
      updatedAt: now,
      cancelledAt: null,
    };

    tx.set(signupRef, signupData);

    // Write notification to coach
    const notifType = isConfirmed ? 'practice_slot_confirmed' : 'practice_slot_waitlisted';
    const notifTitle = isConfirmed
      ? 'Practice slot confirmed'
      : 'Added to practice waitlist';
    const notifMessage = isConfirmed
      ? `${teamName} is confirmed for ${window.name} on ${occurrenceDate}.`
      : `${teamName} is on the waitlist (position ${waitlistPosition}) for ${window.name} on ${occurrenceDate}.`;

    await writeNotification(tx, uid, notifType, notifTitle, notifMessage, {
      relatedLeagueId: leagueId,
      ...(eventId ? { relatedEventId: eventId } : {}),
    });

    return { signupId: signupRef.id, status: signupData.status };
  });

  return result;
});

// ─── practiceSlotCancel ───────────────────────────────────────────────────────

/**
 * Cancel a team's signup for a practice slot occurrence.
 *
 * - Deletes the associated ScheduledEvent (if confirmed).
 * - Auto-promotes the next waitlisted team and creates their ScheduledEvent.
 * - Recalculates waitlist positions for remaining waitlisted signups.
 */
export const practiceSlotCancel = onCall<CancelSignupData>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');

  const { leagueId, seasonId, signupId } = request.data;
  if (!leagueId || !seasonId || !signupId) {
    throw new HttpsError('invalid-argument', 'Missing required fields.');
  }

  const signupRef = signupsCol(leagueId, seasonId).doc(signupId);
  const now = new Date().toISOString();

  await db().runTransaction(async (tx) => {
    const signupSnap = await tx.get(signupRef);
    if (!signupSnap.exists) throw new HttpsError('not-found', 'Signup not found.');

    const signup = signupSnap.data() as PracticeSlotSignup;

    // Only the coach who signed up or an LM/admin can cancel
    if (signup.coachUid !== uid) {
      await assertLeagueManager(uid, leagueId);
    }

    if (signup.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'This signup is already cancelled.');
    }

    const wasConfirmed = signup.status === 'confirmed';

    // Cancel the signup
    tx.update(signupRef, {
      status: 'cancelled',
      waitlistPosition: null,
      cancelledAt: now,
      updatedAt: now,
    });

    // Delete the ScheduledEvent if there was one
    if (wasConfirmed && signup.eventId) {
      tx.delete(db().doc(`events/${signup.eventId}`));
    }

    // If the cancelled signup was confirmed, promote the first waitlisted team
    if (wasConfirmed) {
      const windowRef = windowsCol(leagueId, seasonId).doc(signup.windowId);
      const windowSnap = await tx.get(windowRef);
      const window = windowSnap.data() as PracticeSlotWindow | undefined;

      const waitlistQuery = signupsCol(leagueId, seasonId)
        .where('windowId', '==', signup.windowId)
        .where('occurrenceDate', '==', signup.occurrenceDate)
        .where('status', '==', 'waitlisted')
        .orderBy('signedUpAt', 'asc')
        .limit(1);
      const waitlistSnap = await tx.get(waitlistQuery);

      if (!waitlistSnap.empty && window) {
        const promotedDoc = waitlistSnap.docs[0];
        const promoted = promotedDoc.data() as PracticeSlotSignup;

        // Create a ScheduledEvent for the newly promoted team
        const eventRef = db().collection('events').doc();
        const eventId = eventRef.id;
        tx.set(eventRef, {
          id: eventId,
          type: 'practice',
          teamIds: [promoted.teamId],
          seasonId,
          venueId: window.venueId,
          venueName: window.venueName,
          startTime: `${signup.occurrenceDate}T${window.startTime}:00`,
          endTime: `${signup.occurrenceDate}T${window.endTime}:00`,
          status: 'published',
          createdAt: now,
          updatedAt: now,
          practiceSlotWindowId: signup.windowId,
          practiceSlotSignupId: promotedDoc.id,
        });

        tx.update(promotedDoc.ref, {
          status: 'confirmed',
          waitlistPosition: null,
          eventId,
          updatedAt: now,
        });

        await writeNotification(
          tx,
          promoted.coachUid,
          'practice_slot_promoted',
          'Practice slot confirmed — you\'ve been promoted!',
          `${promoted.teamName} has been moved from the waitlist to confirmed for ${window.name} on ${signup.occurrenceDate}.`,
          { relatedLeagueId: leagueId, relatedEventId: eventId },
        );
      }

      // Recalculate waitlist positions for remaining waitlisted signups
      const remainingWaitlistQuery = signupsCol(leagueId, seasonId)
        .where('windowId', '==', signup.windowId)
        .where('occurrenceDate', '==', signup.occurrenceDate)
        .where('status', '==', 'waitlisted')
        .orderBy('signedUpAt', 'asc');
      const remainingSnap = await tx.get(remainingWaitlistQuery);
      remainingSnap.docs.forEach((doc, index) => {
        // Skip the first doc if we just promoted it (it's now confirmed)
        const alreadyPromoted = !waitlistSnap.empty && doc.id === waitlistSnap.docs[0].id;
        if (!alreadyPromoted) {
          tx.update(doc.ref, { waitlistPosition: index + 1, updatedAt: now });
        }
      });
    }
  });

  return { success: true };
});

// ─── practiceSlotAddBlackout ──────────────────────────────────────────────────

/**
 * Add a blackout date to a practice slot window.
 *
 * - Cancels all confirmed (and waitlisted) signups on the blacked-out date.
 * - Deletes the associated ScheduledEvent for each cancelled confirmed signup.
 * - Notifies each affected coach.
 *
 * Returns the list of affected team names so the caller can show a
 * confirmation summary in the UI before (or after) applying.
 */
export const practiceSlotAddBlackout = onCall<AddBlackoutData>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');

  const { leagueId, seasonId, windowId, date } = request.data;
  if (!leagueId || !seasonId || !windowId || !date) {
    throw new HttpsError('invalid-argument', 'Missing required fields.');
  }

  await assertLeagueManager(uid, leagueId);

  const windowRef = windowsCol(leagueId, seasonId).doc(windowId);
  const now = new Date().toISOString();

  const affectedTeams: string[] = [];

  await db().runTransaction(async (tx) => {
    const windowSnap = await tx.get(windowRef);
    if (!windowSnap.exists) throw new HttpsError('not-found', 'Practice slot window not found.');

    const window = windowSnap.data() as PracticeSlotWindow;

    if (window.blackoutDates.includes(date)) {
      throw new HttpsError('already-exists', 'This date is already blacked out.');
    }

    // Add the blackout date to the window
    tx.update(windowRef, {
      blackoutDates: admin.firestore.FieldValue.arrayUnion(date),
      updatedAt: now,
    });

    // Fetch all active (confirmed + waitlisted) signups for this date
    const activeSignupsQuery = signupsCol(leagueId, seasonId)
      .where('windowId', '==', windowId)
      .where('occurrenceDate', '==', date)
      .where('status', 'in', ['confirmed', 'waitlisted']);
    const activeSnap = await tx.get(activeSignupsQuery);

    for (const doc of activeSnap.docs) {
      const signup = doc.data() as PracticeSlotSignup;

      // Cancel the signup
      tx.update(doc.ref, {
        status: 'cancelled',
        waitlistPosition: null,
        cancelledAt: now,
        updatedAt: now,
      });

      // Delete the ScheduledEvent for confirmed signups
      if (signup.status === 'confirmed' && signup.eventId) {
        tx.delete(db().doc(`events/${signup.eventId}`));
      }

      affectedTeams.push(signup.teamName);

      // Notify each affected coach
      await writeNotification(
        tx,
        signup.coachUid,
        'practice_slot_blackout',
        'Practice slot cancelled — league blackout',
        `${window.name} on ${date} has been cancelled by the league manager. Your booking for ${signup.teamName} has been removed.`,
        { relatedLeagueId: leagueId },
      );
    }
  });

  return { affectedTeams };
});
