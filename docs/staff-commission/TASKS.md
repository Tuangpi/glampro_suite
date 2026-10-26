# Staff commission — tasks

## How to continue

Read PROJECT.md and PROGRESS.md in this folder first. This tracker owns the new
staff-commission work; root task history is not implementation evidence for it.
Use TODO / IN PROGRESS / BLOCKED / DONE, preserve IDs, and complete one selected
task per session. Record actual verification before marking DONE. Do not start
the next task automatically. The user approved the policies on October 26, 2026.

Implementation order: **SC-002 → SC-003 → SC-004 → SC-006 → SC-005 → SC-007**.
SC-006 is a launch dependency, not an optional advanced feature.

## SC-001 — Approved scope and dedicated tracking

- Status: DONE.
- Dependencies: source review and user approval (received October 26, 2026).
- Expected result: dedicated project/tasks/progress files, approved policies separated
  from draft options and test-company examples, and short root pointers.
- Completion check: review files and links; verify task dependencies, approval scope,
  format, and whitespace; preserve unrelated changes. No application code changes.
- Evidence: documentation references, seven unique task IDs, dependency references,
  root pointers, and compact Current State validated; final formatting and diff
  verification recorded in PROGRESS.md.

## SC-002 — Commission foundation and collection design

- Status: TODO.
- Dependencies: SC-001.
- Expected result: code-informed design and implemented shared/API commission kinds,
  compatible rate resolution, snapshots, auditable event/reversal ledger, precision,
  idempotency, and period boundaries. Reconcile existing EmployeeCommission consumers
  rather than introduce parallel totals. Specify explicit payment-to-line allocation,
  refund allocation, attribution retention, paid-session eligibility, zero-value and
  legacy behavior, stored-credit ratio handling, and permission mapping for integration.
- Completion check: focused resolver/schema/ledger tests for inheritance/zero, legacy
  service behavior, precedence, effective dates, duplicate protection, exact reversals,
  precision, atomic rollback, tenancy, and period rules. Run applicable lint/typecheck;
  verify schema changes only on disposable databases. Document integration contracts
  and any unresolved blocker before downstream implementation.

## SC-003 — Seller and therapist attribution

- Status: TODO.
- Dependencies: SC-002.
- Expected result: POS seller/performer attribution, up to four staff with validated
  splits, purchase/redemption commission integration, original-value preservation,
  staff correction and session-void reversals. Preserve cashier versus credited staff
  distinction. Keep financial postings transactional and retry-safe.
- Completion check: API/web tests for required attribution, own-rate splits, same-person
  dual commission, coverage/service sets, transfers/family sharing, staff corrections,
  voids, concurrent retries, failure rollback, and permission/tenant isolation.
  Existing sale/redemption flows and typechecks remain passing. No collection-based
  sale commission release before SC-006 and SC-005.

## SC-004 — Commission administration

- Status: TODO.
- Dependencies: SC-002, SC-003.
- Expected result: staff/type matrix, bulk publish, company policy, package override
  and previews using existing UI/rule conventions. Effective dates, reasons, explicit
  zero/inheritance, concurrency control, permissions, and audit are preserved.
- Completion check: API/web tests for bulk atomicity, stale edits, effective dates,
  rule precedence, inactive staff/items, policy validation, snapshot stability,
  tenant isolation, and unauthorized actions; applicable lint/typecheck/build pass.

## SC-006 — Collection-based commission and eligibility

- Status: TODO.
- Dependencies: SC-002, SC-003, SC-004.
- Expected result: explicit payment-to-line/package allocation, deposits and later
  collections, stored-tax exclusion, source-linked refunds/clawbacks, immutable seller
  allocation evidence, and paid-session eligibility with audited manager override.
  Preserve contracted valuation and separately tracked receivables. Implement agreed
  stored-credit sale/spend bases without duplicate commission. Legacy evidence and
  zero-value cases follow the foundation design, not guessed cash allocation.
- Completion check: isolated acceptance tests reconcile mixed-item/multiple-package
  payments, partial/full collection, tax/discounts, split staff and rate changes,
  refund/void paths, zero-value and unknown historical cases, mixed tender/bonus credit,
  concurrent retries and rollback. Assert no duplicate service/stored-credit earnings
  and no package-valuation regression. Applicable lint/typecheck/tests pass.

## SC-005 — Commission reports and period close

- Status: TODO.
- Dependencies: SC-002, SC-003, SC-004, SC-006.
- Expected result: per-staff/type commission summary, detail drill-down, customer
  session log, Excel export, auditable adjustments and approval/locking. Actual payment
  status is independent. Corrections to locked periods post to the current open period.
  No salary field or payroll-total claim is needed for this commission-only milestone.
- Completion check: ledger/on-screen/export totals reconcile to the cent at approved
  subtotal rounding; test filters/pagination, timezone/period boundaries, lock races,
  post-lock reversals, own/all-staff permissions and tenant isolation. Synthetic worked
  examples state assumptions. Run relevant tests/typecheck/lint/build and record manual
  UI checks actually performed. First-release gate requires all SC-002–SC-006 tasks DONE.

## SC-007 — Later payroll extension

- Status: TODO (later milestone; not part of first commission release).
- Dependencies: SC-005, SC-006.
- Expected result: effective-dated salary profile, OT, unpaid leave, incentives,
  company levy, staff statements, configurable payroll/collection ratio alert, and
  optional payslip export. Define zero-collection display and payroll permissions.
  Tiers remain deferred. No claim of full statutory payroll/tax compliance.
- Completion check: component and statement calculation tests, effective-date and
  period-close tests, access controls, ratio/zero denominator tests, and export totals;
  applicable lint/typecheck/build. Confirm optional payslip/self-service scope before
  implementation, without reopening already approved core commission policies.
