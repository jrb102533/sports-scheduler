#!/usr/bin/env bash
# purge-test-data.sh
#
# Deletes all non-user data from the test Firebase project (first-whistle-e76f4).
# The `users` collection is preserved. Everything else is wiped.
#
# Prerequisites:
#   firebase login   (must be authenticated with Firebase CLI)
#
# Usage:
#   bash scripts/purge-test-data.sh

set -euo pipefail

PROJECT="first-whistle-e76f4"

COLLECTIONS=(
  "events"
  "teams"
  "players"
  "leagues"
  "opponents"
  "invites"
)

echo ""
echo "⚠️  This will permanently delete the following collections from project: $PROJECT"
echo ""
for col in "${COLLECTIONS[@]}"; do
  echo "   • $col (including all subcollections)"
done
echo ""
echo "   The 'users' collection will NOT be touched."
echo ""
read -r -p "Type YES to confirm: " confirm

if [ "$confirm" != "YES" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
for col in "${COLLECTIONS[@]}"; do
  echo "Deleting /$col ..."
  firebase firestore:delete "/$col" --recursive --project "$PROJECT" --force
done

echo ""
echo "Done. All non-user data has been purged from $PROJECT."
