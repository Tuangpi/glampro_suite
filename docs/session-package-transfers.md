# Whole remaining session-package transfers

## Local scope

Owners and managers can transfer an entire remaining session-package holding from
one active customer to another in the same company. Customers and holdings remain
company-wide across outlets. This does not transfer money, charge a fee, create a
sale or change GST/revenue. Partial-session and cross-company transfers are excluded.

In a customer profile, open **Session-package ownership and transfers**, choose a
holding, find the receiving customer, enter a reason and confirm the entire remaining
session balance. The Packages entitlement is required. Staff/cashiers can read the
holding and transfer history but cannot transfer it. Read-only companies cannot write.

The holding ID, original purchase line, granted quantity, remaining quantity,
expiry and redemption-rule snapshot are preserved. Only ownership and its version
change. For service-set packages, a session is still the complete purchased service
set, not an independently transferable service. Catalogue edits do not rewrite
purchase-time rules. Legacy holdings keep their existing catalogue-based fallback.

Expired, exhausted, invalid-balance, archived-customer, wrong-owner and stale-version
requests are rejected. Ownership changes and append-only history commit atomically.
Transfers use the same transaction lock order as POS sales/reversals and a holding
row lock. Database permissions, account state and company write state are rechecked.

## Reversal rules

- A purchase cannot be voided after any recorded session transfer, including a
  transfer back to the original customer. Transfer history cannot be erased.
- Existing refund rules are unchanged: package purchases and package-funded sales
  are not refundable through the service/product money-refund workflow.
- Voiding a package redemption restores the exact same holding under its **current
  owner**. It does not return ownership to the customer on the old sale or renew expiry.
  A repeated void must not restore sessions twice.
- Past sales and clinical/treatment records retain their original customer. The old
  customer's POS redemption remains linkable to that customer's treatment, even
  after holding ownership changes. It is not exposed as the recipient's visit.
- A correction to ownership is another explicit, audited whole-holding transfer,
  subject to the same positive-balance, expiry and customer checks. There is no
  special history deletion or automatic transfer reversal.

The displayed history is transfer evidence, not a complete session-change ledger.
Existing session-count reporting remains operational; this feature does not define
monetary package-liability valuation or historical accounting allocations.

## Migration and verification

Migration: `20261024200000_session_package_transfer`. Apply before running the updated
API. It adds only the transfer-event table, indexes, constraints and append-only
trigger; it does not backfill transfers or change existing balances. Local verification
uses fresh disposable PostgreSQL only. Applying it to the application database is a
separate authorized rollout, not part of this task.

The gated acceptance test is
`apps/api/src/routes/session-transfer.acceptance.test.ts`. It requires
`SESSION_TRANSFER_ACCEPTANCE=1` and refuses any database except loopback
`127.0.0.1:55448/session_transfer_test`. Replay migrations on that disposable database
before running the test. Do not point it at application data.

Coverage includes HTTP authentication/entitlements/roles, tenant isolation, strict
input validation, stale/expired/empty holdings, archived customers, suspended-company
writes, owner/manager actions, paginated holdings/history, immutable evidence,
competing transfers/spending/purchase voids/redemption voids, snapshot preservation,
service-set redemption, exact-source restoration, treatment evidence, refund refusal,
operational report conservation and rollback after injected audit failure.

Automated UI checks cover confirmation, recipient search, role/read-only guards,
failed drafts, stale snapshots, expiry/empty holdings and transfer evidence. These
are component checks, not a claim of an interactive browser walkthrough.

### Recorded result — October 24, 2026

- Fresh replay: all 49 migrations on both disposable databases; server stopped.
- New session-transfer acceptance: 1/1, no skips.
- Existing package-set and treatment-session acceptance: 2/2, separately enabled.
- Full sequential API: 581 passed, 0 failed, 19 opt-in skips.
- Web: 716/716 across 90 files; focused transfer/profile: 17/17; shared: 183/183.
- Workspace build, typecheck, lint, formatting and diff checks passed.
- Logs: `/tmp/glampro-sess01-*`. The existing pg concurrent-query deprecation warning
  remains. No application migration, provider calls or deployment performed.

The normal API suite skips the three separately enabled tests above plus 16 other
opt-in checks: outlet foundation and outlet HTTP; assistant HTTP, OA-05 approval
and OA-06 facts; SEC-01 SMTP; commission acceptance; SaaS onboarding, lifecycle and
platform SMTP; package expiry; prepaid membership, sharing and transfer; treatment
consent and disposal. Those 16 were not newly enabled in this task. Their earlier
recorded evidence is neither revoked nor claimed as a fresh run.
