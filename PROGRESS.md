# Glampro Suite — progress

## Current state

- The extra salon tenants were automated test fixtures, not duplicate demo seeds.
  API tests now require a separate disposable `TEST_DATABASE_URL`.
- Commission/payroll status and operational gates live in the
  [feature checklist](docs/commission_payroll/TASKS.md), not this evidence log.
- Existing application tenants and immutable business records were not cleaned up.

## November 8, 2026 — documentation consolidation

- Grouped maintained guides into development, operations, features, assistant,
  and decisions; updated the documentation index and relocated-file links.
- Separated commission/payroll acceptance evidence, historical handoffs, and
  unchanged supplied references. Added a short current feature checklist and
  replaced competing root status summaries with links to it.
- Preserved detailed checklists, stable IDs, approved policy, and release gates.
  This is documentation maintenance, not fresh application acceptance or release.
- Verification: 216 local Markdown links, including section anchors, resolve;
  all 73 supplied commission assets match their Git originals byte-for-byte.
  Maintained Markdown formatting and `git diff --check` pass. No application
  tests or database operations were run for this documentation-only change.

## November 7, 2026 — first incremental code refactor

- Extracted read-only POS catalogue search from `sale.service.ts` into
  `sale-item-search.service.ts`; preserved its existing public export and all
  query/filter/order/schema behavior. Shared `sale-item-policy.ts` keeps search,
  checkout, and held-cart module mapping aligned.
- Sales service reduced from 3,795 to 3,443 lines. Financial transactions, routes,
  permissions, schemas, and business policy were not redesigned. Further large-file
  candidates are recorded in tasks, not silently included in this change.
- Added compatibility, entitlement, barcode normalization/deduplication, and
  inclusive low-stock regression tests. Focused search **10/10**; full API on a
  separately migrated disposable PostgreSQL **1,322 passed / 276 opt-in skips /
  0 failed**. API typecheck, lint, and build passed.
- Compared extracted code and financial section against the pre-refactor source;
  only policy naming and equivalent existing decimal formatting changed there.
  No application database operations or frontend changes.

## November 7, 2026 — documentation cleanup

- Added a root README, grouped docs index, and commission/payroll entry point.
- Replaced the 9,333-line root project/task/progress set with short current
  summaries; preserved the complete previous records in the
  [dated archive](docs/archive/2026-11-07/README.md), rebasing Markdown links.
- Kept feature specifications, accepted decisions, detailed acceptance evidence,
  supplied assets, and existing code changes intact. No database operations.
- Documentation validation results are recorded in the completion report; no
  application tests are implied by this documentation-only change.

## November 7, 2026 — test database isolation

- API test preload requires a safe local `TEST_DATABASE_URL`, distinct from the
  application database name. Prisma also guards direct test-runner imports.
- Mock suites preserve the selected connection. Setup and regression coverage
  are documented in the [seed/test guide](docs/development/demo-seeding.md).
- Executed on separate disposable PostgreSQL: full API **1,317 passed / 276
  opt-in skips / 0 failed**; final safety suite **8/8**. API typecheck, lint,
  build, touched-file formatting, and diff checks passed.
- Read-only verification confirmed the application still had the same 16 tenants.
  No application migration, seed, or cleanup was run. Test PostgreSQL was stopped.

## November 7, 2026 — departments

- Added manager/admin department management, safe delete/unassign preview,
  transactional recheck, and audit. Commission references block deletion;
  business history and other memberships survive. No migration.
- Recorded checks: API HTTP suite **14/14**, focused web/shared checks, builds,
  lint, formatting, and diff checks. Full-suite/browser UAT was not performed
  for this feature. See [department contract](docs/features/departments.md).

## November 7, 2026 — CP-008 reports

- Implemented per-holding residual value/conditional exposure and original
  sold-session counts, closing the earlier audit-only OPEN checkpoint.
- Recorded full verify: API **1,298 passed / 276 gated skips**, web **1,268/1,268**,
  shared **337/337**; PostgreSQL/HTTP **11/11**, mounted Chrome **17/17**; builds passed.
- These are historical executed results, not fresh verification for later changes.
  Scope and limitations: [report audit/delivery](docs/commission_payroll/acceptance/CP008_REPORT_AUDIT.md).
  No production activation, migration, or approved-payroll rewrite was authorized.

## Earlier history

- [Full root history before this cleanup](docs/archive/2026-11-07/PROGRESS.md).
- [Commission/payroll verification history](docs/commission_payroll/history/PROGRESS.md).

Keep only current state and a few recent handoffs here. Put detailed financial
acceptance evidence in the feature records, not another duplicated session diary.
