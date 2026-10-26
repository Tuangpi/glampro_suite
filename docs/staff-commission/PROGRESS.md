# Staff commission — progress

## Current State

- Current task: SC-003 — IN PROGRESS (seller and therapist attribution).
- Most recently completed: SC-002 — DONE (local foundation and collection design).
- Approval: October 26, 2026; recommended policies accepted. Collection-based sale
  commission, existing exact-cent redemption value, separate tracking, payroll later.
- Implementation: sale attribution plus configurable required-attribution API policy,
  immutable redemption coverage/original-value/own-rate evidence, explicit whole-set
  performer UI, internal exact financial posting seam and linked current-open-period
  financial correction/void integration. Normal POS still posts no version-1 earnings.
- Remaining: eligibility/cutover integration, broader family/correction-route/release
  acceptance and browser walkthrough. Required-attribution policy admin UI is implemented.
  No earnings activation.
- Verification limitation: API lint/typecheck blocked by existing unused platform-auth
  sendTwoFactorCode import. Scoped lint, focused tests, shared and web checks pass.
- No application database migration, production change or deployment authorized/performed.
- Recommended next task: Resume SC-003; do not start SC-004.
- Continue using this folder, not the large root task history. Select one task and
  stop after its completion; do not automatically implement the whole project.

## Recent notes

### SC-003 — October 26, 2026 — IN PROGRESS, policy administration checkpoint

- Preserved all uncommitted financial checkpoint changes. Added required-attribution card
  under Settings → Team & commissions for salon managers/admins; suspended salons get
  read-only controls. Three switches use the existing append-only policy API with a
  required reason and optimistic revision. No earnings or eligibility activation.
- First edit pins flags and revision together. Background updates preserve drafts and
  block stale publication; explicit reload discards only after a successful read. Failed
  writes/reloads retain edits, pending requests block duplicate submission, and load errors
  never masquerade as optional defaults. Shared policy-view type added, no migration.
- Added nine card tests and four Settings wiring checks. Real HTTP acceptance verifies
  anonymous/staff/platform denial, owner 2FA, disabled/revoked/changed-role sessions,
  tenant isolation, strict input, concurrent publication (one success/one conflict),
  actor/reason persistence and suspended-write refusal. Add-on expiry/missing-grant checks
  run explicitly by temporarily toggling only the disposable module fixture, then restoring it.
- Verified: shared 196/196; focused web 46/46; focused API/PostgreSQL 70/70, no skips.
  After making module-denial assertions unconditional, reran policy HTTP acceptance 1/1.
  Shared build/lint, web lint/typecheck/production build and changed API lint pass.
  Full API typecheck still reports only the existing unused sendTwoFactorCode import.
  A new cache-refresh test initially asserted before React Query notified its observer;
  changed it to wait for the rendered result, then reran the entire focused web suite.
- No browser walkthrough, full API/web suite, application migration, activation, deployment,
  commit or push. Reused/stopped /tmp/glampro-sc003r-pg, port 55464. Logs:
  /tmp/sc003ui-{final-api,final-web2,shared,web-build,policy-final,api-types}.log.
  SC-003 remains IN PROGRESS. Next: broader family/financial-correction route permissions
  and release acceptance, browser walkthrough, eligibility/reporting cutover integration.

### SC-003 — October 26, 2026 — IN PROGRESS, financial integration checkpoint

- Initial git status was clean; prior evidence work was already present in the checkout.
- Added internal transaction-only redemption posting seam. It validates original movement,
  currency, ordinals, service coverage, own rates/exact candidate amounts and revision links.
  Unknown attribution/value, stale snapshots, legacy sale earnings and mutually exclusive
  covered-line service/FOC/credit-spend earnings fail closed. No POS/route caller or activation.
- Extended immutable commission event JSON with optional redemption snapshot/source-time/
  correction link; existing primitive event hashes remain compatible. No migration needed.
- Corrections reverse every active linked earning and repost the new split with original
  service-time own rates/value, in the current server-time open period. Voids reverse exact
  values, including disabled original staff. Incompatible/unlinked entries still fail closed.
  Missing/locked periods roll back source, snapshot and financial effects together.
- Enabled disposable PostgreSQL acceptance covers concurrent posting/correction/void retries,
  injected posting rollback, locked-period corrections, missing-current-period rollback,
  later rate non-retroactivity, unknown attribution, legacy cutover refusal, staff/tenant
  rejection, disabled-staff reversal, exact final zero and one-time session restoration.
- Final verification: shared 196/196; focused API 69/69 (including sale 57/57 and both
  enabled PostgreSQL acceptance tests), no skips. Shared build/lint, changed API lint,
  web typecheck and scoped formatting/whitespace checks pass. Full API typecheck still
  reports only the existing unused platform-auth sendTwoFactorCode import, left unchanged.
  No full API/web suite, web production build or browser walkthrough in this checkpoint.
- Reused the existing disposable cluster /tmp/glampro-sc003r-pg (port 55464), then stopped
  it after verification; synthetic immutable financial fixtures remain only there.
  Logs: /tmp/sc003p-final-{shared,api,api-types,api-lint,web-types}.log.
  SC-003 remains IN PROGRESS; do not start SC-004. No application migration, deployment,
  activation, commit or push. Next: broader family/permission/concurrency release acceptance,
  required-attribution policy admin UI, and eligibility/reporting cutover integration.

### SC-003 — October 26, 2026 — IN PROGRESS, redemption evidence checkpoint

- Added append-only tenant-scoped required-attribution policies with manager-only
  read/publication routes, optimistic revisions and actor/reason audit. Defaults remain
  optional; completion (including held carts), not incomplete drafts, enforces sellers
  and service performers. Redemption policy rejects missing/ambiguous session splits.
- Added immutable package-redemption snapshots: covered line IDs/service quantities,
  original valuation movement/purchase/ordinals/currency/net cents, event-time own-rate
  decisions and exact ten-decimal candidate amounts. These are **pending-release evidence**,
  not EmployeeCommission earnings. Legacy unknown value stays null, never guessed zero.
- Whole service sets retain their original combined session value. Explicit tender
  performers override line inference; otherwise only identical covered-line splits
  resolve. Conflicting splits remain unknown, with no current-price weighting. POS
  payment dialog supports an explicit whole-session/set split without a seller group.
- Added manager-only linked correction endpoint with revision/hash-checked retries;
  void appends linked evidence without rewriting attribution. Both fail closed if
  version-1 redemption earnings exist, pending financial reversal/repost integration.
- Acceptance exposed old database SERVICE/PRODUCT-only rule constraints. Added a
  separate migration allowing foundation kinds/package scope internally; public rule
  publication still refuses these kinds. No earnings activation or backfill.
- Disposable cluster from the earlier session was unavailable after resumption; created
  /tmp/glampro-sc003r-pg, port 55464/database commission_redemption_test. All 55 migrations
  replayed from empty. API focused suite 68/68 (including sale 57/57 and enabled acceptance),
  including additional required-policy/held-cart/immutability coverage in the final run.
  Final consolidated checks: shared 195/195, focused API 68/68 (no skips), focused web
  77/77; shared build/lint, web lint/typecheck/production build, changed API lint and
  Prisma schema validation pass. Scoped formatting and whitespace checks pass.
- Verification caught optional seller UI type narrowing and a test actor-context error;
  both corrected. Web production build/typecheck, shared/web lint and changed API lint
  pass. API typecheck still reports only the existing unused sendTwoFactorCode import.
- Still incomplete: no financial earning/reversal/repost integration or current-open-period
  correction handling, no policy admin UI, no full route/family/concurrency release matrix,
  no browser walkthrough. Keep SC-003 IN PROGRESS; SC-004 is not started. No application
  migration, activation, deployment, commit or push.

### SC-003 — October 26, 2026 — IN PROGRESS, attribution capture checkpoint

- Added shared attribution schema: independent seller/performer groups, each 1–4
  distinct staff, integer basis-point shares totaling 10000. No cashier fallback,
  earnings claim, automatic historical attribution or rate/basis input from clients.
- Added POS editor, browser draft preservation, submission, held-cart resumption and
  receipt API serialization. Cart keys include explicit attribution so differently
  credited lines cannot merge silently. Existing single-staff behavior is unchanged.
- Sale writes recheck enabled tenant staff inside the transaction and validate performer
  service/department eligibility. Migration adds nullable SaleLine attribution and a
  trigger preventing completed-line attribution updates; corrections are not yet exposed.
- Fresh disposable PostgreSQL 18 on port 55464/database commission_attribution_test:
  all 53 migrations replay successfully. Entire sale.service.test.ts passes 57/57,
  no skips, including new hold/completion/foreign-credit rollback/immutability test.
  Initial new test used a nonexistent fixture helper; corrected it and reran successfully.
- Shared tests 193/193; focused web editor/cart/draft/Sale page 74/74. Shared build/lint,
  web lint/typecheck/production build and changed API ESLint pass. API typecheck still
  fails solely on existing unused sendTwoFactorCode import in platform-auth.service.ts;
  no new diagnostics. Scoped formatting and diff checks pass. No browser walkthrough.
- Remaining SC-003: configurable required-attribution policy; immutable redemption
  attribution/coverage and exact-value commission postings; event-time own-rate splits;
  linked wrong-staff corrections and session-void reversals, including current-open-period
  handling; synthetic service-set/transfer/family/concurrency/permission acceptance.
  Preserve collection-based sale commission release gate until SC-006 and SC-005.
- No application migration, seed, activation, deployment, commit or push. Disposable
  cluster stopped after checks. Task remains IN PROGRESS; resume before another SC task.

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
