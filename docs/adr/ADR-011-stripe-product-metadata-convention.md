# ADR-011 — Stripe Product Metadata Convention

**Status:** Accepted
**Date:** 2026-04-25
**Deciders:** PM + Systems Architect
**Jira:** FW-58 (epic), FW-61, FW-65

---

## Decision

Stripe products that grant a Firebase role MUST carry the metadata key `firebaseRole` on the **product** (not the price), with the value set to the `UserRole` string the subscription should grant.

| Product | `metadata.firebaseRole` |
|---|---|
| League Manager Pro | `league_manager` |
| (future tiers) | `<UserRole>` |

The application's product lookup in Firestore (mirrored by the `firestore-stripe-payments` extension) MUST query on this key:

```ts
where('metadata.firebaseRole', '==', 'league_manager')
```

Do **not** invent alternative metadata keys (`role`, `tier`, `subscriptionTier`, etc.) at the product level.

---

## Context

The `invertase/firestore-stripe-payments` Firebase Extension uses the `firebaseRole` metadata key as a documented convention to mirror Stripe products and prices into Firestore. When set, the extension can also use it to populate JWT custom claims on subscription events.

During FW-65 implementation, the frontend agent independently introduced a different key (`metadata.role == 'league_manager_pro'`) for the product lookup query. This did not match the actual metadata that had been configured in Stripe (`firebaseRole = 'league_manager'`), so the upgrade flow returned "Subscription product not found" with no clear root cause.

This ADR locks the convention so future agents and future tier additions follow the same pattern.

---

## Why this key, not another

1. **Extension convention** — `invertase/firestore-stripe-payments` documents `firebaseRole` as the canonical key. Future versions of the extension may use it directly to set custom claims, eliminating part of our `syncStripeSubscriptionToUser` function (FW-63).
2. **Single source of truth** — The metadata identifies *what role/tier this product grants* — that is a product-level fact, not a price-level fact. Monthly and annual prices for the same tier MUST grant the same role.
3. **Forward compatible** — When we add additional tiers (e.g. an Org/Multi-LM tier later), each new product gets one metadata key with one value. No code change needed in the lookup if we expand to multiple `firebaseRole` values.

---

## Why on the product, not the price

Both work technically. We pick the **product** for these reasons:

- The role granted is a property of the offering, not the billing cadence.
- Less duplication — set once on the product, not on each price.
- Querying products is the natural entry point for the upgrade page; we then load all active prices under that product.

---

## Consequences

- **Stripe dashboard hygiene**: every product in Stripe representing a paid tier MUST have `firebaseRole` set or it will not appear in the upgrade UI.
- **Test products** should NOT have `firebaseRole` set, so they don't accidentally appear as purchasable plans.
- The existing 3 stale "myproduct" Stripe products (no `firebaseRole`) are correctly invisible to the upgrade UI and can stay as-is or be deleted in Stripe at PM convenience.
- The lookup query in `src/hooks/useStripeProducts.ts` is updated to match this convention.

---

## Related

- FW-61: Install Stripe Extension
- FW-63: Sync Stripe subscription state → user doc + JWT claim
- FW-65: In-app upgrade flow
