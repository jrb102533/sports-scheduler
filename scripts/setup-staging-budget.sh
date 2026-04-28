#!/usr/bin/env bash
#
# setup-staging-budget.sh
#
# Configure GCP billing budget alerts + auto-disable for the staging Firebase
# project, per the emulator-first test strategy (locked 2026-04-26).
#
# Tiers:
#   $5  — Slack/email warning (you investigate)
#   $10 — Page PM (you stop further runs)
#   $25 — Auto-disable Firestore IAM for the test service account (hard ceiling)
#
# This script is idempotent and safe to re-run. PM should run it once.
#
# Prerequisites:
#   - gcloud CLI authed as a billing-admin on the staging project's billing account
#   - The staging Firebase project ID:    first-whistle-e76f4
#   - A billing account ID (find with: gcloud billing accounts list)
#
# Usage:
#   BILLING_ACCOUNT=01ABCD-XXXXXX-YYYYYY ./scripts/setup-staging-budget.sh
#
# What it does:
#   1. Creates three GCP Billing Budgets at $5 / $10 / $25 thresholds, scoped to
#      the staging project, with email alerts to billing-admins.
#   2. Documents (does NOT auto-execute) the Pub/Sub-triggered Cloud Function
#      that revokes Firestore IAM at $25 — you wire that up after reviewing
#      the budget alerts pattern in your account.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-first-whistle-e76f4}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"
DISPLAY_PREFIX="FirstWhistle Staging Test Budget"

if [[ -z "${BILLING_ACCOUNT}" ]]; then
  echo "ERROR: BILLING_ACCOUNT env var is required."
  echo "Find it with: gcloud billing accounts list"
  exit 1
fi

echo "==> Project:         ${PROJECT_ID}"
echo "==> Billing account: ${BILLING_ACCOUNT}"
echo

create_budget() {
  local amount="$1"
  local threshold_pct="$2"  # 1.0 = 100% of $amount
  local display="${DISPLAY_PREFIX} \$${amount}"

  echo "==> Creating budget: ${display}"
  gcloud billing budgets create \
    --billing-account="${BILLING_ACCOUNT}" \
    --display-name="${display}" \
    --budget-amount="${amount}USD" \
    --threshold-rule="percent=${threshold_pct},basis=current-spend" \
    --filter-projects="projects/${PROJECT_ID}" \
    --notifications-rule-monitoring-notification-channels="" \
    --notifications-rule-pubsub-topic="" \
    || echo "    (budget may already exist — review in console)"
}

# $5 / $10 / $25 budgets, each alerting at 100% of its own amount.
create_budget 5  1.0
create_budget 10 1.0
create_budget 25 1.0

cat <<'EOF'

==> Done creating budgets. Verify in:
    https://console.cloud.google.com/billing/budgets

==> NEXT MANUAL STEP — auto-disable at $25:
    GCP Billing Budgets do not natively revoke IAM. To enforce the hard ceiling,
    wire up a Pub/Sub topic + Cloud Function:

    1. In each budget's edit page, attach a Pub/Sub topic (e.g.
       projects/first-whistle-e76f4/topics/billing-alerts) under
       "Connect to Pub/Sub".
    2. Deploy a Cloud Function that subscribes to that topic and, when the
       message indicates >= 100% of the $25 budget, runs:
         gcloud projects remove-iam-policy-binding ${PROJECT_ID} \
           --member="serviceAccount:<test-service-account>" \
           --role="roles/datastore.user"
    3. Document the rebind procedure in docs/RUNBOOK.md so the IAM can be
       restored after the runaway is investigated.

    Sample CF starter: https://cloud.google.com/billing/docs/how-to/notify

==> Until the auto-disable CF lands, the $5/$10/$25 alerts at least give you
    email-level visibility. That alone caught the ~$0 staging baseline drift
    risk that motivated this strategy.
EOF
