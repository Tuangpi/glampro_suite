# Staff commission — progress

## Current State

- Current task: None.
- Most recently completed: SC-002 — DONE (local foundation and collection design).
- Approval: October 26, 2026; recommended policies accepted. Collection-based sale
  commission, existing exact-cent redemption value, separate tracking, payroll later.
- Implementation: shared kinds, compatible resolver, versioned EmployeeCommission events,
  exact precision, idempotent posting/reversals and period guards. Integration contract
  is FOUNDATION.md. New posting is not enabled in POS or public APIs.
- Verification limitation: API lint/typecheck blocked by existing unused platform-auth
  sendTwoFactorCode import. Scoped lint, focused tests, shared and web checks pass.
- No application database migration, production change or deployment authorized/performed.
- Recommended next task: SC-003 — Seller and therapist attribution.
- Continue using this folder, not the large root task history. Select one task and
  stop after its completion; do not automatically implement the whole project.

## Recent notes

### SC-002 — October 26, 2026 — DONE

- Added foundation contract in FOUNDATION.md: explicit per-line collection allocation,
  cumulative stored-tax/refund deltas, original seller retention, exact ordinal paid-session
  eligibility, known-zero versus unknown legacy handling, credit-lot ratios, duplicate
  service/spend prevention, permission mapping and release cutover requirements.
- Extended existing EmployeeCommission rather than adding parallel monetary totals.
  Version-1 immutable snapshots/events have exact reversals, actor/source/period/currency,
  hash-checked retries and tenant-scoped unique keys. Legacy rows are not backfilled.
  POS void/refund writers and reports explicitly retain legacy-version semantics until
  downstream integration. Public rule settings still refuse unsupported new kinds.
- Precision proof: cent basis × two-decimal rate × basis-point split needs ten decimals
  (minimum 0.0000000001). Added exact integer calculation and half-up subtotal utility;
  database DECIMAL(24,10), immutable evidence/period and posting validation triggers.
- Verified fresh replay of 52 migrations on disposable PostgreSQL 18, port 55463,
  database commission_foundation_test. Enabled acceptance 1/1, no skips: concurrent
  identical retries, conflicting evidence, exact reversal after original period lock,
  duplicate reversal refusal, rollback, tenant isolation, immutable rows and half-open
  period refusal. Temporary cluster stopped after verification; fixtures retained there.
- Commands: npm run test --workspace @glampro_suite/shared (190/190);
  node --import tsx --test with commission-rules, commission-ledger and prisma tests
  (13/13); enabled commission-ledger.acceptance.test.ts (1/1). Shared build/lint,
  changed API ESLint, web typecheck and scoped formatting/whitespace pass.
- Full API lint/typecheck attempted: both fail solely on the pre-existing unused
  sendTwoFactorCode import in platform-auth.service.ts; left untouched. Full API/web
  suites, production build and browser walkthrough not run. No application migration,
  seed, activation, deployment, commit or push. SC-003 is next, not started.

### SC-001 — October 26, 2026 — DONE

- Created dedicated PROJECT.md, TASKS.md, and PROGRESS.md and short root pointers.
- Recorded user approval, source/test-company context, existing valuation compatibility,
  first-release gates, financial safeguards, and later payroll scope.
- Retained stable SC IDs; dependency order moves required SC-006 ahead of SC-005.
- Source document text and relevant existing commission/valuation code were inspected
  during planning. Embedded visuals and original salary transactions were not reviewed.
- Checks: file references, seven unique task IDs, dependency references, root pointers,
  and Current State under 200 words pass. Initial Prettier check identified wrapping;
  formatted the three new files. Final scoped Prettier and git diff --check pass;
  root pointer diff reviewed. No root-file-wide reformatting was performed.
- Application code/tests: unchanged/not run for this documentation-only task.
- Unrelated platform-auth working change and source DOCX are preserved.
