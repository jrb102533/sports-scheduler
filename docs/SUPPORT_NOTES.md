# Support Notes

Operational edge cases that have no in-app UI. Admin must handle these directly in the Firebase Console or via admin scripts.

---

## Parent / Family Features

### Removing a parent from a player's linked accounts

**When it comes up:** custody disputes, incorrect invite, parent account reassignment.

**What to do:**

1. Go to Firebase Console → Firestore → `users/{parentUid}`
2. Edit the `linkedPlayerIds` array — remove the target `playerUid`
3. Save

The parent will lose schedule visibility for that player on their next app load (store hydration picks up the updated profile).

**If the parent should also lose team access entirely** (i.e., they were a `parent` role member of the team):

1. Also remove their entry from `teamMemberships` where `userId == parentUid && teamId == affectedTeamId`
2. If Firestore rules restrict that team's data to `teamMemberships`, access is revoked immediately

No Cloud Function or script needed — direct Firestore edits are sufficient. Log the action in the relevant Jira issue or support ticket for audit trail.

---
