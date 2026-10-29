# CP-005 monthly close acceptance checkpoint

## Status — October 29, 2026

**IN PROGRESS, not accepted.** CP-004 remains latest completed. No CP-003A or
CP-006 work started. All results below describe actual local checks, not release
or production readiness.

## Authorization and isolation

The user explicitly authorized a new isolated disposable database, including test
migrations and acceptance. Existing databases, production access, activation,
deployment, commits and pushes are not authorized.

A new PostgreSQL 18 cluster was initialized in a fresh `/tmp/cp005-postgres-*`
directory. The local path is recorded in `/tmp/cp005-disposable-cluster.path`.
Database: `payroll_close_test`, user `cp005_test`, loopback TCP port `55485`.
All commands disabled dotenv with `DOTENV_CONFIG_PATH=/dev/null` and explicitly
supplied this isolated database URL. No application `.env` was read or changed.
Only synthetic tenants/users were inserted. Immutable audit fixtures remain in
this disposable cluster; no production data was copied.
The cluster was stopped cleanly after verification; its data directory remains
available for the next CP-005 continuation. No server was left listening.

Applied the existing migrations, then three new migrations:

- `20261029120000_payroll_close_snapshots`: tenant-scoped close snapshots and
  append-only transition audits; immutable approved entitlement, separate payout.
- `20261029121000_payroll_close_audit_atomicity`: deferred matching state/audit
  constraints and previous-hash chain continuity.
- `20261029122000_payroll_close_audit_bounds`: reject orphan future audit entries,
  inconsistent audit scope/revision and unsupported transition kinds.

## Implemented and checked

### Authoritative input-loading continuation — October 29

- Internal calculation/approval now default to a server-owned transactional loader.
  Explicit loader injection remains an internal test seam, never HTTP input. There
  is still no public close route or earnings activation.
- First supported slice: ordinary non-FOC service/product operational sale lines,
  recorded non-gateway external payments, outstanding-payment identity checks,
  independent complete month inventories, historical configuration, audit-verified
  preceding approved carry and cross-close source exclusion. Exact-cent cumulative
  collection allocation is replayed against operational purchase tax, not bases.
  Ordinary base amounts, units/types/staff reconcile against sale-line attribution.
  Cash attribution requires historical allocation sellers matching the original line.
- Unsupported package purchase/collection, redemption/value spend, prepaid tenders,
  FOC and refund/void/correction workflows fail closed, including independent usage,
  refund and void inventory without captures. Missing persisted opening cannot become
  zero. This is **not the complete authoritative loader acceptance** in item 1 below;
  package refunds also still lack independent payout inventory, and fallback-rate/
  classification provenance needs expanded operational acceptance before activation.
- New isolated DB acceptance verifies the default loader's ordinary calculation,
  missing-capture rollback without close/audit insertion, historical-profile stale
  approval rejection, recalculation and approved snapshot immutability. It explicitly
  bootstraps a synthetic preceding close, not authenticated opening acceptance.
- API typecheck/build/lint passed. Final focused suite:
  **221/221 passed, zero skipped**, including both opt-in DB tests; shared **302/302**.
  Logs `/tmp/cp005-loader-{combined,shared,types,lint,build}.log`
  and matching exit markers. No schema changes/migrations, existing DB access,
  browser acceptance, activation or deployment in this continuation.

- Explicit supplied opening inventory supports first-close composition without a
  fabricated previous close. Missing evidence still fails closed. Frozen opening
  debt preserves departed staff, stable component keys and ten-decimal fallback
  amounts; no implicit zero or unaudited settlement.
- Supplied carry-settlement evidence validates exact prior balance hashes,
  component mapping/write-off and exact fallback write-off. Revisions and approval
  provenance are frozen. This validates supplied evidence, not owner authenticity
  or an actual cash repayment.
- Scoped statement composition partitions plan/fallback activity, retains separate
  fallback debt, limits plan incentives to assigned outlets, prevents duplicate
  sources and pools fixed awards before rounding once. Low-level plan calculation
  still rejects unpartitioned activity. Calculation version is now `cp-005-v2`;
  old versions fail replay rather than silently changing approved history.
- Approval replays draft statements and checks stored inputs/outputs as well as
  versioned input hash; approval cannot precede calculation.
- Internal store uses authenticated tenant context and tenant source/configuration
  lock, expected revisions, writable-salon and owner-verification checks. No HTTP
  caller can submit a loader or complete payroll inputs because no close write
  route is exposed. A server-owned loader is mandatory; there is no default.
- Database acceptance checks rollback, concurrent calculation conflicts, stale
  input rejection after a locked staff edit, preserved manual amounts, own-data
  reads, manager/owner/outlet/tenant isolation, approved immutability, atomic audits,
  orphan-audit rejection, duplicate payout races and unchanged frozen output after
  payout. It uses a deliberately synthetic loader, **not authoritative cash**.
- Internal owner-only monetary correction posts a linked reasoned adjustment into
  the next open salon-local month; rejects backdating and preserves the original
  approved close. This is not source-base correction capture or complete TC-19.

## Actual checks

- Combined focused API tests: **211/211 passed, zero skipped**, including the
  opt-in isolated database test. Log: `/tmp/cp005-final-combined.log`.
- Shared tests: **302/302 passed**. Log: `/tmp/cp005-final-shared.log`.
- Existing payroll configuration/preview/settings UI regression: **40/40 passed**.
  Log: `/tmp/cp005-final-web-tests.log`. No monthly-close UI exists yet.
- API typecheck/build/lint, shared lint, web typecheck passed. Logs use
  `/tmp/cp005-final-*.log`, with matching `.exit` markers.
- Prisma schema validation, Prettier and Git whitespace checks passed.

Acceptance command from the repository root:

```sh
DOTENV_CONFIG_PATH=/dev/null \
DATABASE_URL=postgresql://cp005_test@127.0.0.1:55485/payroll_close_test \
JWT_SECRET=cp005-test-only NODE_ENV=test RUN_CP005_ACCEPTANCE=true \
node --import tsx --test apps/api/src/services/payroll-close*.test.ts \
apps/api/src/services/payroll-preview-inputs.test.ts \
apps/api/src/services/payroll-correction-period.test.ts \
apps/api/src/services/payroll-package-void.test.ts
```

The DB test checks the exact loopback host, port and database before writing.
Do not point this command at an application database.

## Required before CP-005 DONE

1. Authoritative transactional loaders: independent complete operational inventory,
   settled payment/refund/void provenance/timing, historical allocations/attribution,
   prior/cross-workflow exclusivity, legacy payout exclusion, historical
   configuration, carry, first-close eligibility and authenticated settlements.
   Cancelled authorizations and partial/uncertain settlement remain unsupported.
2. Integrate next-open-period **source-base** correction posting into operational
   captures, with occurrence versus posting dates, idempotency and approval/source
   races. Internal monetary adjustments are not a substitute.
3. Persist and authenticate opening/settlement workflows and approval evidence.
4. Monthly-close API and UI with authenticated module/role/outlet boundaries,
   own-data frozen reads, adjustments, calculation/approval and separate payout.
5. Full money reconciliation and transactional acceptance using authoritative
   loaders, API/browser permission acceptance, plan switches, races/rollback,
   immutable approved history and documented performance evidence.

Do not activate the internal store, enable monetary preview or mark CP-005 DONE
solely on the persistence/engine tests above.
