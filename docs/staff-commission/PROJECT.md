# Staff commission — project

## Status and authority

Approved direction: October 26, 2026. This is a commission-management extension,
with payroll as a later milestone, not a replacement payroll or accounting system.
The user approved the recommended answers and dedicated tracking structure.
Approval permits local implementation task by task, not deployment, live database
migrations, production changes, or invented historical backfills.

This folder is the authoritative tracker for this feature. Read this file,
`TASKS.md`, and the short `Current State` in `PROGRESS.md` when continuing.
The root trackers retain unrelated work and historical evidence. Their earlier
acceptance confirmations do not count as verification of this new feature.

## Sources and test-company context

- Source specification: `../Glampro_Package_Commission_Spec_v0_9.docx`, dated
  October 26, 2026, originally a draft for verification.
- Existing approved valuation policy: `../package-valuation-policy-draft.md`.
- Existing valuation implementation notes: `../package-valuation-implementation.md`.
- User approval in this session supersedes draft recommendations only as recorded
  below. Unselected alternatives are not approved requirements.

Eurosense, its staff names, salaries, package names, and example rates describe
the server test company. They are not hard-coded product behavior or evidence
that the current local code matches the server. Original salary sheets and full
September transactions were not supplied separately; exact historical replay is
not claimed. Use synthetic fixtures for worked examples. Document text and screen
descriptions were read; embedded screenshots/diagrams were not visually reviewed.
External competitor claims in the source have not been independently verified.

## Approved policies

1. **Package sale:** commission is earned on money actually collected, including
   deposits and later instalments, excluding stored tax. Explicit payment-to-line
   allocation is a release prerequisite for mixed sales. Do not infer package cash
   from a sale-wide payment or credit granted. Preserve allocation evidence and
   exact reversals. The allocation algorithm still needs code-informed design.
2. **Package redemption:** use the original discounted net purchase value assigned
   to the redeemed session/whole service set by the existing immutable exact-cent
   allocation. Preserve ordinal allocations and exact restoration. Do not add
   weighted service/list-price allocation or recalculate using current prices.
3. **Valuation stays separate:** contracted purchase value remains unchanged by
   collections. Receivables remain separate. Collection-based commission and
   redemption eligibility do not redefine remaining package purchase value, GST,
   revenue recognition, or existing tax reports.
4. **Rates:** separate rates per staff and commission type, effective-dated with
   event snapshots. Extend the existing resolver, including explicit zero versus
   inheritance. Proposed precedence: staff item override, package override, staff
   department override, staff default, company default, otherwise zero. Preserve
   existing service/product compatibility, including the legacy service fallback.
5. **Attribution:** record seller and performing therapist, independently of the
   cashier/account actor. Both sale and redemption commission may be earned by
   the same person. Support up to four credited staff per event; splits total 100%
   and each share uses that staff member's own rate. Make required attribution a
   configurable policy, not a silent assumption about historical records.
6. **Corrections/refunds:** prorate sale commission reversal on the refunded amount;
   valid completed-session commission remains earned. Voided redemptions reverse
   their commission and restore the exact session allocation. Wrong-staff fixes
   reverse and repost with a reason. Transfers/family sharing preserve purchase
   value and original seller credit; subsequent redemptions credit the performer.
   Unused expiry earns no redemption commission. Do not change customer refund
   amounts or add new refund rights through this feature.
7. **Part-paid redemption:** permit sessions covered by allocated payments, with an
   audited authorized-manager override. Exact-cent eligibility must use allocated
   session values rather than a rounded average. Define zero-value package and
   legacy-evidence behavior explicitly before implementation; do not divide by zero
   or silently block/approve unknown historical purchases.
8. **FOC:** configurable default commission of 5% of service list price for explicitly
   complimentary services. Do not automatically classify every zero-priced line
   or package redemption as FOC, or pay both FOC and redemption for one event.
9. **Stored credit:** extend value-package sale/spend using amount paid and the
   original paid-to-credit ratio, respectively. Payment-source evidence must
   prevent duplicate ordinary-service and stored-credit-spend commission. Ratio,
   promotional credit, mixed tenders, and refunds need code-informed design.
10. **Ledger/periods:** auditable earning, reversal, correction, and adjustment evidence;
    transactional posting and duplicate protection from the start. Preserve original
    entries; later corrections reference/reverse them rather than rewriting history.
    Locked periods receive corrections in the current open period. Approval,
    locking, and actual payment are distinct states. Do not mark earnings paid just
    because a report is approved. Use company business timezone and period rules;
    the source's calendar-month/Asia-Singapore examples are not universal constants.
11. **Rounding:** preserve exact-cent bases from package valuation; commission earning
    precision and reconciliation must support half-up rounding at each staff/type
    period subtotal, not premature per-line cent rounding. The source proposes four
    decimal ledger amounts; prove aggregate precision and split/refund reconciliation
    during foundation design before finalizing storage.
12. **Payroll later:** commission calculation/reporting first. Later payroll includes
    salary, OT, unpaid leave, incentives, company levy, and optional payslip export.
    Payroll/Sales formula: (take-home + company levy) / collection. Handle zero
    collection explicitly; do not present an infinite or misleading percentage.
    Alert threshold remains configurable/unconfirmed; 55% is only a document example.

## Scope and implementation order

- SC-001: approval, policies, and separate tracking (documentation only).
- SC-002: commission event/rate/ledger foundation and collection-allocation design.
- SC-003: seller/performer attribution, splits, redemption and correction integration.
- SC-004: commission matrix, bulk publication, company policy, package overrides.
- SC-006: actual collection allocation, subsequent payments, refunds, and paid-session
  eligibility. Implement before releasing package-sale commission under this policy.
- SC-005: reconciled commission reports, customer session log, Excel export, period close.
- SC-007: later payroll extension. Keep tiers deferred; gift-card sale commission,
  no-show commission, list-price/fixed/weighted alternatives, and new accounting
  liability reporting are outside the first release unless separately approved.

IDs retain the original proposed numbering; dependency order puts SC-006 before
SC-005. No first release is complete with unresolved collection allocation or
financial reversal/locking safeguards. Staff self-service can be scoped with the
later milestone; it is not authorization to expose all staff payroll data.

## Existing foundation and constraints

Inspected locally during planning (not a fresh test run): TypeScript npm workspaces,
Prisma API, shared Zod commission schemas, and the existing web application.
Reuse existing dependencies and UI conventions; inspect relevant web files before editing.

- `../../apps/api/src/services/commission-rules.ts`: effective-dated resolver.
- `../../apps/api/src/services/commission.service.ts`: publication and configuration.
- `../../packages/shared/src/schemas/commission.ts`: SERVICE/PRODUCT kinds today.
- `../../apps/api/prisma/schema.prisma`: CommissionRule, EmployeeCommission,
  sale-line commission snapshots, customer package holdings and valuation storage.
- `../../apps/api/src/services/package-valuation-ledger.ts`: existing valuation evidence.

Extend/reconcile existing EmployeeCommission and reporting paths rather than build
a competing source of truth. Tenant isolation, permissions, actor audit, atomicity,
retry behavior, and existing sale/void/transfer flows must be covered by tests.
Map document role names to existing company permissions: do not assume a platform
super-admin is a salon payroll approver. Explicitly label unknown legacy valuation
and attribution evidence; never silently fabricate, backfill, or treat it as zero.

## Verification and release gates

Each implementation task needs focused automated tests and applicable shared/API/web
typecheck, lint, and build checks. Use isolated disposable databases for acceptance
tests, never migrate/seed an application database merely to run checks. Record actual
commands/results and unperformed manual checks in PROGRESS.md.

Cover split rates, effective-date boundaries, exact-cent allocation, collection and
refund allocation, partial payment eligibility, duplicate/concurrent events, rollback,
staff corrections, locked-period adjustments, stored-credit double counting, tenant
and permission boundaries, legacy unknowns, and export/on-screen reconciliation.
The original salary-sheet totals are reference calculations, not proof of real
transaction reconciliation. Synthetic scenario tests must state their assumptions.
