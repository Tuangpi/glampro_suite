# Staff commission — progress

## Current State

- Current task: SC-006 — IN PROGRESS (opt-in checkout allocation capture implemented).
- Most recently completed: SC-004 — DONE (local commission administration verification,
  October 27, 2026).
- Approval: October 26, 2026; recommended policies accepted. Collection-based sale
  commission, existing exact-cent redemption value, separate tracking, payroll later.
- Implementation: attribution/evidence foundation plus all-kind rate administration,
  package overrides/previews, atomic bulk publication and staff matrix. Normal POS
  still posts no version-1 earnings; existing snapshots are unchanged.
- Verified for SC-004: focused API/database 69/69, legacy commission HTTP 1/1,
  SC-003 acceptance regression 5/5, shared 197/197, full web 830/830;
  workspace lint/typecheck/build. Local Chrome bulk publication and package override
  pass. ADMINISTRATION.md and VERIFICATION.md record scope and limitations.
- Remaining release gates: SC-006 collection/eligibility and SC-005 reporting/cutover.
  No earnings activation. Full API suite and human visual review not performed.
- No application database migration, production change or deployment authorized/performed.
- Recommended next task: Continue SC-006; do not start SC-005 or activate earnings.
- Continue using this folder, not the large root task history. Select one task and
  stop after its completion; do not automatically implement the whole project.

## Recent notes

### SC-006 — October 27, 2026 — IN PROGRESS, opt-in checkout capture

- Added optional strict shared collection contract: explicit SGD confirmation and
  tender-index/cart-position positive-cent allocations. Holds refuse collection
  evidence. Sale stores nullable confirmed collectionCurrency; no currency backfill.
  Migration 20261027130000_sale_collection_currency protects confirmed currency and
  refuses retrospective completed-sale currency assignment. Receipt API exposes it.
- PaymentDialog offers optional allocation entry with named cart lines, per-tender
  reconciliation and explicit SGD/collected-payment confirmation. Edits to tenders,
  allocations or voucher reset confirmation. Existing checkout requests remain valid.
  Cashier confirmation is recorded-money evidence, not independent PSP settlement.
- New sale/held completion persists explicit source allocations in the same locked
  transaction. Server pricing, line caps and per-tender totals are authoritative;
  invalid allocations roll back receipt/debt/evidence together. Capture currently
  refuses redemption tenders, gateway sessions and overpayment/change. Earnings
  remain PENDING_RELEASE; legacy commission/report behavior is unchanged.
- Verified: 91/91 focused API/database/POS regressions (no skips), shared 199/199,
  full web 831/831; workspace production build (API/web typechecks), lint, formatting
  and whitespace pass. New migration applied only on disposable PostgreSQL port
  55476, commission_collection_replay (57 migrations total). Initial fixture omitted
  member price and catalogue entitlement; fixed fixtures and reran acceptance.
- SC-006 still needs later-payment UI/API, source refund/void evidence, credit-lot
  integration, paid-session eligibility/manager overrides and broader HTTP/browser
  acceptance. No application database migration, activation, deployment or commit.
  Opt-in capture is intentionally not the final mandatory release prerequisite.

### SC-006 — October 27, 2026 — IN PROGRESS, internal persistence checkpoint

- Added tenant-scoped CommissionCollection and CommissionCollectionAllocation models
  and migration 20261027120000_commission_collections. Database guards enforce source
  payment/sale/customer/actor consistency, append-only rows, unique retry/source
  identity, exact cumulative stored-tax allocation, line bounds, currency consistency
  and deferred source/line-total reconciliation. No backfill or activation.
- Added captureCollectionEvidence internal transactional seam. Takes prepaid/POS then
  configuration locks, validates explicit source amounts and authoritative line state,
  snapshots original sellers/splits (including departed staff), contracted components
  and collection-time own-rate candidates. UNKNOWN attribution remains explicit.
  Does not post earnings, change outstanding balances or provide a public endpoint.
- Guarded disposable PostgreSQL acceptance verifies concurrent identical retries,
  competing allocations with one winner, source reuse conflicts, later receivable
  source with changed rates and original sellers, mixed packages, stored tax, tenant
  reads/actor refusal, disabled actor, unsupported gateway/credit tenders, rollback,
  direct incomplete/tax-invalid writes and immutable evidence. Initial fixture used
  the wrong actor field; initial deferred trigger referenced a field absent on one
  table. Both corrected and rerun successfully against a fresh migration replay.
- Verified: 34/34 focused API/database tests, no skips; API lint/typecheck/build and
  shared build pass. All 56 migrations replayed from empty on disposable PostgreSQL
  port 55476, database commission_collection_replay. Application database untouched.
- Remaining: normal POS confirmed allocations/currency/settlement evidence, later
  payment workflow, source refund/void integration, original credit lots, eligibility
  and audited overrides, broader HTTP/web and regression verification. COLLECTIONS.md
  records caller responsibilities and why this is not a completed SC-006 release.

### SC-006 — October 27, 2026 — IN PROGRESS, calculation checkpoint

- Added pure bigint helpers in apps/api/src/lib/commission-collection.ts for
  explicit receipt allocations, cumulative stored-tax/net collection deltas,
  source-lot refunds, ten-decimal source-earning clawbacks, exact session-prefix
  coverage, original credit ratios and disjoint service funding bases. Reuses
  existing package valuation ranges; no contracted value or historical data changes.
- Ten new tests cover mixed lines/packages, deposits, exhaustive small-value tax
  conservation, exact refunds/residuals, partial and refunded coverage, restored
  ordinals, known-zero/free ordinals versus UNKNOWN legacy, bonus credit, funding
  partition and invalid/large evidence. Focused tests 23/23, zero skips, including
  existing valuation 9/9 and commission precision 4/4. API typecheck and lint pass.
- COLLECTIONS.md records the implemented boundary and remaining persistence,
  POS/later-payment/refund/void, source snapshots, credit lots, manager override,
  lock/atomicity and disposable database acceptance work. These helpers have no
  production callers. SC-006 completion checks are NOT met; resume this task.
- No schema/application database changes, normal POS behavior changes, earnings
  activation, deployment, commit or push. Shared/web/full API suites and browser
  checks not run for this internal calculation-only checkpoint.

### SC-004 — October 27, 2026 — DONE, local administration

- Extended existing schemas, routes and publisher rather than adding a competing
  ledger. All seven kinds support company/staff rules; active service/product/FOC
  item and department rules and active package/value-package item/package overrides
  validate against the correct tenant catalogue. Package kinds have no department
  catalogue field, so administration rejects department scope for those kinds.
- Added searchable, paginated staff/type matrix and bounded bulk publish (1–100
  unique scopes), one effective instant/reason, tenant configuration lock, stale
  revision conflict and transactional rule/audit writes. Matrix shows configured
  zero, inheritance and legacy/unconfigured fallback separately. Existing attribution
  policy UI remains the company-policy control; no eligibility policy was invented.
- Single-rule and matrix drafts pin their observed revision; background refetch cannot
  silently rebase an edit. Explicit successful reload discards the draft. Failed
  publication/reload preserves inputs. Read-only/role/pending controls are tested.
- Added guarded disposable PostgreSQL HTTP acceptance: second-insert failure rolls
  back earlier rule/audit, concurrent publication permits one winner, tenant and
  role boundaries, revoked sessions, inactive targets, scheduling, pagination,
  preview precedence, audit actor and unchanged historical sale/earnings evidence.
- Approved FOC fallback is 5%; explicit zero wins. This does not classify zero-price
  services as FOC or activate a posting caller. No normal POS earnings cutover.
- Replayed 55 migrations on fresh disposable databases at ports 55465 and 55443.
  Focused API/database 69/69, legacy HTTP 1/1, prior SC-003 acceptance 5/5, no skips;
  shared 197/197 and full web 830/830. Workspace lint/typecheck/build pass.
- Local headless Chrome with real API/Vite verified matrix publication/readback,
  inheritance, FOC fallback and package override/catalogue-name history. Initial
  local CORS configuration blocked publication; corrected temporary API origin and
  reran successfully. No application CORS changes or human visual review claimed.
- Initial checks caught stale foundation gating assertions, missing Settings mock,
  fixture email/context mistakes and an unscoped test audit count. Corrected fixtures
  and assertions without weakening authorization or transactional guarantees.
- See ADMINISTRATION.md for commands and limits. No application migration, deployment,
  commit or push. SC-006 remains unstarted; stop after this task.
- Final scoped Prettier and git diff --check pass; Settings role/read-only assertions
  rerun 27/27 after the full web run. Temporary API/Vite/Chrome stopped. All three
  disposable PostgreSQL clusters stopped cleanly; ports 55465/55443/55464 report no
  response. Synthetic logs/harnesses remain under /tmp/sc004, outside the repository.

### SC-003 — October 27, 2026 — DONE, local verification closeout

- Preserved existing mixed-tender and HTTP acceptance tests and documentation changes.
  Removed only the unused sendTwoFactorCode import from platform-auth.service.ts;
  existing platform login behavior was not changed or endorsed by this task.
- Replayed all 55 migrations on a fresh disposable PostgreSQL 18 cluster at
  /tmp/sc003-close/pg, 127.0.0.1:55464/commission_redemption_test. Enabled all five
  SC-003 acceptance flags; focused API/acceptance passes 72/72, no skips, before and
  after the import cleanup. Shared passes 196/196; full web passes 820/820.
- Initial workspace lint/typecheck/build reproduced the existing unused-import
  blocker. After the one-import cleanup, all three workspace commands pass.
  No checks or assertions were disabled. Existing pg concurrency warning remains.
- Local headless Chrome with the real Vite/API/disposable database verified policy
  reason gating, publication/readback, invalid split refusal, valid 25/75 sellers,
  independent therapist, reload restoration, cash sale receipt and reasoned void.
  Database assertions verify retained attribution, separate cashier and zero earnings.
  Temporary browser harness selector/field mistakes were corrected and rerun.
- Concurrent shared builds/Prisma generation triggered Vite HMR useAuth errors;
  full reload restored the app. This is not claimed as a fixed application defect.
  No package-tender/correction UI walkthrough or human visual review is claimed;
  whole-set, transfer, family and financial correction paths use automated acceptance.
- VERIFICATION.md maps checks to task requirements and downstream gates. Collection
  allocation/eligibility stays SC-006; reporting/cutover stays SC-005. Normal POS
  remains evidence-only. No application database migration, deployment, activation,
  commit or push. SC-004 remains TODO; no next-task implementation started.
- Final scoped Prettier and git diff --check pass. Temporary API, Vite and Chrome
  processes stopped; PostgreSQL stopped cleanly and port 55464 reports no response.
  Logs and temporary harnesses are under /tmp/sc003-close, not durable release evidence.

### SC-003 — October 26, 2026 — IN PROGRESS, mixed-tender evidence checkpoint

- Added services/redemption-commission-mixed.acceptance.test.ts. No application code,
  schema, writer or activation changes. Preserved prior uncommitted HTTP test and notes.
- Synthetic sale: two one-session packages originally bought for 100 and 50 cover
  two distinct units of one three-unit service line currently priced at 70 per unit.
  Shared family credit pays 50 and cash pays 20. Two prepaid purchases each paid 20
  and granted 30; no collection-ratio claim is made from this bonus-credit fixture.
- Verified explicit tender performers versus inferred line splits, independent sellers,
  cashier actor, original ordinal bases 10000/5000 cents, own-rate candidate amounts,
  no duplicate coverage, and credit spending without fabricated session snapshots.
  Membership without explicit holding sharing rejects and rolls back earlier package
  draws, sales, ledger, snapshots and valuation movements. No earnings are created.
- After the credit owner leaves the family, void and retry restore both session
  holdings and both credit holdings once to their original owners without re-sharing.
- Focused API/PostgreSQL regressions: 72/72, no skips. Both new acceptance files pass
  ESLint. API typecheck reports only existing platform-auth sendTwoFactorCode TS6133;
  initial fixture typing and incorrect VOIDED expectation were fixed and rerun.
  Existing pg concurrent-query deprecation warning appeared in sale regressions.
  Shared/web tests were not rerun for this API-test-only change (prior 196/196 and
  46/46 remain prior-checkpoint evidence). No build or browser walkthrough claimed.
- Reused disposable /tmp/glampro-sc003r-pg on 55464; shutdown verification recorded in
  /tmp/sc003mixed-stop.log. Test fixture cleans its tenant. Logs:
  /tmp/sc003mixed-{regressions,types2,lint2,final-format,whitespace}.log.
- Next: continue SC-003 browser/release acceptance and document downstream eligibility/
  reporting integration gates. SC-004 is not started. No application migration,
  activation, deployment, commit or push.

### SC-003 — October 26, 2026 — IN PROGRESS, correction HTTP acceptance checkpoint

- Preserved all earlier uncommitted changes. Added routes/redemption-commission.acceptance.test.ts
  using a real HTTP server and the explicitly disposable PostgreSQL database. No production
  behavior, schema, activation or writer changes were needed.
- Purchased a paid three-session package, refused consumption by a customer sharing only
  a legacy family label (HOLDING_NOT_FOUND), explicitly transferred ownership, changed
  current service price from 10 to 70, then proved immutable first-ordinal value is 33.34.
  Internal synthetic posting remains the only initial version-1 writer in this test.
- Public correction/void requests verify anonymous/staff/platform/foreign-tenant/owner-2FA
  refusal, strict input and foreign credited-staff rejection, wrong-sale linkage, expired
  package entitlement, suspended tenant, disabled actor/performer, role change and revoked
  token. Denied requests preserve source state, session balance, evidence and money.
- Missing current open period rolls back correction and void even with a locked original
  earning. Concurrent identical correction requests produce one revision and one exact
  reversal/repost (3.3340000000 to 6.6680000000); stale/mismatched/different-actor retries
  fail. Concurrent owner-authorized voids net earnings to zero, restore sessions exactly
  once to the transferred owner and append one void revision. Correction response exposes
  metadata only; no internal rate or financial evidence fields.
- Verified shared 196/196, focused web 46/46, focused API/PostgreSQL 71/71 with no skips.
  Changed API lint passes. API typecheck still reports only the existing unused
  platform-auth sendTwoFactorCode import, left unchanged. No browser walkthrough, full
  API/web suite or production build in this test-only checkpoint.
- Reused/stopped /tmp/glampro-sc003r-pg, port 55464. Immutable financial fixtures remain
  only there. Logs: /tmp/sc003http-{final-api,shared,web,types,final-lint}.log.
  No application migration, activation, deployment, commit or push. SC-003 remains
  IN PROGRESS; next: mixed-funding/family-credit release acceptance, browser walkthrough,
  and eligibility/reporting cutover integration. SC-004 remains unstarted.

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
