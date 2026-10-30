# CP-005 monthly close acceptance checkpoint

## Status — October 30, 2026

**IN PROGRESS, not accepted.** CP-004 remains latest completed. No CP-003A or
CP-006 work started. All results below describe actual local checks, not release
or production readiness.

## Latest checkpoint — manager-override reconciliation

- New verified PIN audits bind usage sale/customer/tenant and historical manager
  role, actor, reason and paid/used/draw counters. Complete holding audit inventory
  independently matches unpaid draws exactly once and freezes with close inputs.
  Legacy-unbound, missing, duplicate, foreign and mismatched audits fail closed.
- Actual PIN writer authorizes a deposit-funded unpaid draw. Monthly draft/reload
  includes original 50.0000 session base, not deposit-prorated value; current cash
  is only 30.0000. Existing paid draws remain 10.0000 each. Six audit corruptions
  preserve saved draft/audit; September/October approved calculations unchanged.
  Unit coverage checks writer authorization failures/no PIN leakage, replay counters
  and authorization between POS usage time and explicit source append time.
- Fresh selected API **272/272**, three isolated DB suites and zero skips; shared
  **302/302**; API typecheck/build/lint pass. Logs `/tmp/cp005-override-*`.
  Prior temporary cluster/logs were missing on resumption; fresh isolated cluster
  recreated, repository migrations replayed with dotenv disabled. No existing
  application database or schema touched. No browser walkthrough in this checkpoint.
- Reversals/corrections, prepaid-credit spending/refunds/voids, partial package FOC
  and close API/UI/full acceptance remain open. CP-005 is not DONE.

## Previous checkpoint — session-package transfer reconciliation

- Complete append-only transfer and unreversed draw history replays original-buyer
  ownership, transfer remaining quantity/expiry and owner-at-draw. Final owner and
  quantity must match holding inventory. Missing/foreign/duplicate/ambiguous history
  never falls back to current owner. Original purchase value, sellers and ordinal
  economics remain unchanged; transfer history freezes with close evidence.
- Real transfer-service write moves the original paid holding to a new recipient.
  Recipient draws reconcile through persisted holding history and monthly reload.
  Original three 10.0000 draws, uncovered 109.0000 service and 100.0000 current cash
  remain unchanged. Missing/from-owner/quantity/expiry/tied-time/foreign transfer
  corruption refuses without changing saved draft/audit; approved September/October
  hashes remain unchanged. No immutable history was rewritten for negative tests.
- Selected API **269/269**, including three isolated DB suites, zero skips; shared
  **302/302**; API typecheck/build/lint pass. Unit tests also cover transfers both
  before and after draws and no-draw transfers. Logs `/tmp/cp005-transfer-*`.
- Manager overrides, reversals/corrections, prepaid-credit spending/refunds/voids,
  partial package FOC and close API/UI/full acceptance remain open. CP-005 not DONE.

## Previous checkpoint — package tender reconciliation

- Complete sale-level PACKAGE payment inventory matches verified draw count and
  covered service gross, using POS residual-cent allocation after voucher discount.
  SalePayment has no holding link; no individual payment-to-holding mapping is
  invented. Zero-price coverage still requires explicit zero tenders. Verified
  PACKAGE tenders are excluded from fresh external cash operations.
- Monthly payment records must exactly match complete sale payment inventory.
  Tender inventory is frozen with close evidence. Isolated DB draft/reload accepts
  three package tenders with current cash unchanged at 100.0000. Missing, altered,
  gateway-linked, cash-relabeled, credit-relabeled and month-omitted tenders refuse
  without modifying saved draft/audit. Prior approved September/October remain
  unchanged; December aggregate overclaim still writes no close/audit.
- Selected API **265/265**, including all three isolated DB suites, zero skips;
  shared **302/302**; API typecheck/build/lint pass. Logs `/tmp/cp005-tender-*`.
  Unit cases cover residual cents, mixed cash, zero tenders, duplicate/foreign/
  negative/fractional-cent payments and unsupported evidence. Existing authorized
  disposable cluster identity verified at port 55485/database payroll_close_test.
- Transfers, overrides, reversed/corrected histories, prepaid-credit spending,
  refunds/voids, partial package FOC and close API/UI/full acceptance remain open.
  This is not CP-005 completion or application activation.

## Previous checkpoint — monthly redemption integration

- Internal monthly loader now wires independently verified usage-sale coverage and
  full holding history for original-owner unreversed paid-session draws. Exact
  current-month operational/capture rows must match; no previous-month redemption
  bases or cash are added. Ordinary service bases and units use uncovered quantity;
  fully covered service lines must not have ordinary source captures.
- Isolated DB November draft/reload verifies three 10.0000 package draws, one
  uncovered 109.0000/1-unit service, and 100.0000 current cash. Read-only corruption
  tests reject omitted monthly redemption captures, full original-line economics,
  ordinary captures on fully covered lines and unsupported reversal sources.
- December aggregate overclaim still refuses with no close/audit rows. Approved
  September/October calculation hashes remain unchanged. The unrelated live checkout
  FOC shape fixture was moved to January 2027 outside these tested monthly inventories;
  missing-currency refusal was preserved, not relaxed.
- Selected API **260/260** (three isolated DB tests, zero skips), shared **302/302**;
  API types/build/lint passed. Logs `/tmp/cp005-monthly-*`. Prepaid tenders, transfers,
  overrides, corrections/reversals, credit spending/refunds/voids and partial package
  FOC remain blocked. Monthly redemption support is not full CP-005 acceptance.

## Previous checkpoint — multi-holding PostgreSQL acceptance

- Extended isolated acceptance using a second independent package purchase and real
  collection/draw/redemption capture writers. Two holdings cover two units of one
  three-unit service line; one remains uncovered. Both individual holding histories
  verify, but shared coverage of two against one is refused. Results agree after
  committed JSONB reload. Missing-capture states are checked before real capture;
  immutable evidence is never removed or rewritten to manufacture a negative test.
- Blocked November monthly close writes neither draft nor audit; approved September
  and October calculation hashes stay unchanged. Monthly integration is not enabled.
- Selected API **260/260**, including three isolated DB tests with zero skips; shared
  **302/302**; API types/build/lint passed. Logs `/tmp/cp005-multiholding-*`.
- Previous disposable data directory was absent on resume. Created a fresh isolated
  `/tmp/cp005-postgres-*` cluster and applied repository migrations with dotenv
  disabled and explicit test URL. No application database or schema was changed.

## Previous checkpoint — cross-holding sale coverage

- Added `apps/api/src/services/payroll-close-sale-coverage.ts`: salon-wide verified
  owner/manager only, shared tenant source lock, unpaged operational usage inventory,
  complete per-holding replay, matching source/usage records and cumulative covered/
  remaining service quantities. Unsupported kinds/lifecycle and omissions fail closed.
- Focused unit tests cover two independently valid holdings sharing one service line,
  aggregate overclaim refusal, missing/duplicate/foreign evidence, zero usage and
  authorization. Multi-holding real-writer DB acceptance is still pending.
- Isolated DB acceptance now verifies real draw/capture sale coverage and persisted
  reload; the existing monthly workflow gate and frozen September equality still pass.
- Selected API close/source/session tests **260/260**, including three isolated DB
  tests with zero skips; shared **302/302**; API types/build/lint passed. Logs:
  `/tmp/cp005-coverage-*`. Monthly wiring and supported uncovered-base reconciliation
  remain unfinished. This checkpoint does not enable redemption monthly close.

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

### Server-owned holding history — October 29

- Internal transaction loader independently queries original holding and purchase
  sale/line, all holding redemptions, collection/payment/outstanding-debt inventory,
  captures, historical rules, transfer/refund evidence. Reconciles original deposit,
  cumulative GST, payment identity/time/amount, original policies and session history.
  Salon-wide authenticated owner/manager and shared tenant lock required. No paging
  or client-supplied records. Current implementation blocks transfers, corrections,
  refunds/reversals, expired draws and unpaid manager-override histories.
- Actual PostgreSQL JSONB reads exposed unstable direct JSON serialization in the
  earlier verifier. Reads now reconstruct writer schema order including nested
  canonical purchase before checking the original hash; no history is rewritten.
  Dedicated reorder/tampering regression added. An outlet-less synthetic usage
  fixture was corrected to use the existing outlet context (the guard was preserved).
- Extended isolated acceptance uses real draw and capture writers: missing snapshot
  refusal, exact remaining ordinals, three-receipt history and persisted reload pass;
  previously approved September calculation remains unchanged after November usage.
  Default November close still rejects redemption workflow intentionally.
- Selected close/source/session tests 256/256, zero skips, including three isolated
  DB tests; shared 302/302; API types/build/lint pass. Logs `/tmp/cp005-history-*`.
  Disposable cluster stopped after verification, synthetic fixtures retained. No
  application database access, schema migration/backfill/activation/deployment.
- This is per-holding loading, not cross-holding sale coverage or monthly close
  integration. Monthly redemption gate remains; unsupported lifecycle paths,
  credit spending/refunds/voids, source corrections and close API/UI remain open.

### Supplied holding reconciliation — October 29

- Redemption verifier now requires original holding coverage rules (no current
  catalogue fallback) and exact initial capture key. Replays per-unit and whole-set
  coverage; rejects missing/duplicate requirements, invalid operational quantities
  and incomplete/excess service sets.
- Added supplied-inventory reconciliation for unreversed draws: historical paid
  limits use receipts strictly before each draw, original lowest-first ordinals
  reconcile to remaining quantity/ranges, and cumulative service coverage cannot
  exceed a sale line. Rejects duplicate/foreign/missing inventory, overcollection,
  ambiguous timestamps and later receipts used to justify earlier unpaid usage.
- Fourteen redemption tests cover original policies, exact residuals, multi-draw
  ordering, aggregate overflow and corruption assertions. Selected close/source/
  session tests: 249 passed, three DB-gated skips, zero failures. Shared 302/302;
  API typecheck/lint/build and whitespace checks pass. Logs `/tmp/cp005-inventory-*`.
- No database access or schema change. Caller must still independently establish
  complete inventory, payment/tax evidence and ownership authorization. Transfers,
  manager overrides and reversals/corrections are not accepted by these checks.
  Default redemption/coverage loader blocks remain. Credit spending/refunds/voids,
  source corrections, close API/UI and full acceptance remain unfinished.

### Redemption evidence foundation — October 29

- Added supplied-record original-session verifier, not enabled operational loading.
  Independently reconciled purchase is a caller prerequisite. Verifies canonical
  purchase/session economics and nonoverlapping original ordinals, session quantity,
  performer splits, tenant/sale/coverage identity, snapshot hash, original policy and
  per-session fixed awards. Source envelopes and historical PACKAGE_REDEMPTION rates
  replay without service/sale fallback. Returned evidence is detached.
- Four tests cover all policies, explicit tender performers, original outlet/seller
  independence, exact residuals, rule-kind separation and 27 corruption cases.
  Focused close/context/source/redemption tests: 248 passed, three DB-gated skips,
  zero failures; shared 302/302; API types/build/lint pass. Logs:
  `/tmp/cp005-redemption-{focused,shared,types,build,lint}.{log,exit}`.
- No DB access or schema change; retained disposable cluster not started. The
  verifier is not proof of complete inventory, paid-session or manager override
  authorization, transfer history, aggregate service coverage, unique ordinals across
  redemptions, or reversal/correction lineage. Default loader retains redemption and
  usage-coverage blocks. These gates and isolated DB acceptance are next, before
  redemption loading can be enabled. No activation/backfill/deployment/commit/push.
  CP-005 remains IN PROGRESS; API/UI/full acceptance still unfinished.

### Cross-month package history continuation — October 29

- Default loader verifies historical sale/outstanding payments and captures against
  original purchase/deposit, receipt ordering, tenant/customer/sale/debt identities,
  exact cumulative GST, source envelopes, historical rates and purchase policy.
  Prior records are frozen verification evidence only: not monthly payment operations,
  cash, base lines, units, fixed awards, group metrics or required staff. Missing,
  contradictory, duplicate or future receipt history fails closed, not reconstructed.
- Unit tests cover FOLLOW_PLAN/EXCLUDE/FIXED with sale-payment and outstanding
  balances, Singapore month boundary, historical payment/capture tampering and stale
  draft detection. DB fixture uses actual source writer with September deposit and
  outstanding receipt, approves September, then records October-boundary 21.80 gross:
  October includes exactly 20 net, one base, zero units and zero fixed award. Stale
  draft approval fails; recalculation and approval succeed; September stays unchanged.
  Explicit post-month test clock preserves the runtime month-end approval gate.
- Focused close plus tenant-context 245/245, zero skips (three isolated DB tests);
  selected source/rate/collection/loader regressions 49/49; shared 302/302; API types,
  build and lint passed. Logs: `/tmp/cp005-crossmonth-*.{log,exit}`. Selected suite
  scope differs from earlier checkpoint counts; no broader acceptance is implied.
- No schema/backfill/application DB access/activation/deployment/commit/push.
  Disposable DB stopped, synthetic fixtures retained. This is not cross-month
  payment route/UI/POS acceptance. Future receipt history remains blocked; usage,
  credit spending, refunds/voids, corrections and close API/UI/full acceptance remain.
  CP-005 remains IN PROGRESS.

### Same-month outstanding package continuation — October 29

- Package balance collections now accept independently inventoried same-month
  OUTSTANDING_PAYMENT receipts after original SALE_PAYMENT deposit. Outstanding
  payment, sale and debt tenant/customer/sale identities and outstanding ID must
  reconcile. Receipt source/amount/time/currency must match independent normalized
  payment inventory, never capture-asserted cash. Original minimum deposit,
  same-month history, ordering, GST replay, policy/rates and once-only award remain.
- DB fixture writes actual debt/outstanding-payment rows and invokes existing
  collection/source writer: 76.30 outstanding receipt contributes 70 net, zero units
  and zero repeated fixed award; stale deposit draft approval fails, recalculation
  and persisted approval pass. Catalogue edits cannot replace original settings.
  This is synthetic historical persistence acceptance, not end-to-end outstanding
  payment route/UI/POS acceptance or cross-month capture verification.
- Unit tests cover all sale modes, missing/foreign/mismatched debt/payment scope,
  source amount/time, missing capture, changed debt evidence and first-deposit/
  cross-month guards. Focused plus tenancy 271/271, zero skips (three isolated DB
  tests); related regressions including loader 133/133; shared 302/302; API types/
  build/lint passed. Logs: `/tmp/cp005-outstanding-*.{log,exit}`.
- No schema change/backfill/application DB access/activation/deployment/commit/push.
  Disposable DB stopped, evidence retained. Cross-month history, usage/credit
  spending/refund/void loading, corrections and close API/UI/full acceptance remain
  unfinished; CP-005 remains IN PROGRESS.

### Same-month package instalment continuation — October 29

- Supports original package deposits and additional settled SALE_PAYMENT receipts
  only when purchase and all package collection history are in the requested month.
  Independent monthly inventory must exactly match relevant receipt history;
  ambiguous creation times, backwards occurrence, foreign/currency/sale mismatch,
  missing payments/captures and unsupported historical/outstanding receipts block.
- First receipt must meet original minimum deposit rounded UP to a cent. This
  bounded slice deliberately refuses split deposits whose first receipt is below
  threshold, even if later receipts meet it. Each capture reconciles receipt net,
  original seller shares/policy and historical rates; units/fixed award appear only
  on first collection, subsequent fixed captures explicitly carry zero award.
- Synthetic DB fixture uses actual collection/source writer and immutable original
  holding: 32.70 deposit contributes 30 net and original 12.34 fixed award; 76.30
  later receipt contributes 70 net and zero repeated units/award. New receipt
  invalidates deposit draft approval; recalculation and persisted approval succeed
  despite current catalogue settings edits. Not end-to-end POS/outstanding/browser
  acceptance and not historical/cross-month payment verification.
- Focused plus tenancy 267/267, zero skips (three isolated DB tests); related
  regressions including loader 129/129; shared 302/302; API types/build/lint passed.
  Logs: `/tmp/cp005-instalment-*.{log,exit}`. Unit checks include upward rounding,
  all sale policies, missing/foreign/incomplete/ambiguous history, GST tampering,
  unsettled gateway payments and repeated units/award rejection.
- No schema change/backfill/application DB access/activation/deployment/commit/push.
  Disposable DB stopped with fixtures retained. Cross-month/outstanding package
  loading, usage/credit spending/refund/void, corrections and close API/UI/full
  acceptance remain unfinished; CP-005 remains IN PROGRESS.

### Full package-purchase continuation — October 29

- Default loader independently inventories package holdings and requires canonical
  immutable purchase snapshots. Original grant, sale/line/package/customer/outlet/
  date, tenant, net/tax/gross, session residuals, sellers and commission settings
  reconcile without current catalogue fallback. Only a fully collected single
  SALE_PAYMENT receipt is supported; partial/multiple/absent receipts remain blocked.
- Captured PKG_SALE seller bases/units, category, mode and fixed amounts reconcile
  against original FOLLOW_PLAN/EXCLUDE/FIXED policy. Fixed award is once per sale
  line, never multiplied by purchased quantity. Historical PACKAGE_SALE rules are
  replayed as of capture, excluding later-published rules and service fallbacks.
- Synthetic historical DB receipt uses actual collection/source writer plus
  original holding snapshot: missing-evidence rollback, immutable rewrite rejection,
  catalogue/settings-edit independence, net cash 100, fixed award 12.34, default
  calculation and persisted approval pass. This is not end-to-end package checkout,
  deposit/instalment or browser acceptance. Units and session grant are checked
  against original operational evidence, not reconstructed catalogue history.
- Unit coverage includes wrong/foreign/duplicate/missing holdings, changed grant,
  economics, policy, units, fixed amount and historical rate; exact seller residuals,
  fixed award once despite multiple units, stale approval, partial/multiple/absent
  collections and missing capture. Focused plus tenancy 265/265, zero skips (three
  isolated DB tests); related regressions including loader 127/127; shared 302/302;
  API types/build/lint passed. Logs: `/tmp/cp005-package-*.{log,exit}`.
- No schema change/backfill/application DB access/activation/deployment/commit/push.
  Authorized disposable DB stopped, fixtures retained. Package deposits/instalments,
  usage/credit spending/refund/void loading, corrections and API/UI/full acceptance
  remain unfinished. CP-005 remains IN PROGRESS.

### Value-purchase collection continuation — October 29

- Default loader inventories original immutable value holding purchase snapshots
  separately from payroll captures. Sale/line/item/tenant, paid net, credit amount
  and seller shares must reconcile. Captured VP_SALE bases use collected net cash,
  never granted bonus credit. First collection receives original units; subsequent
  external instalments receive zero units. Ambiguous creation-time ties fail closed.
- Replays independent historical STORED_CREDIT_SALE rules available at capture;
  service legacy rates cannot substitute. Per-seller bases/units, FOLLOW_PLAN mode,
  no fixed commission, null category and original snapshot evidence are checked and
  hashed. Missing snapshots are unavailable; no reconstruction/backfill is attempted.
- Synthetic historical DB fixture uses the actual collection/source writer and
  persisted holding snapshot: missing purchase evidence rolls back close, snapshot
  rewrite fails, catalogue edits leave 100 net activity/cash unchanged despite 150
  granted credit, and default calculation/approval succeeds. Existing ordinary/FOC
  checks remain. Unit coverage includes later instalments, wrong/foreign/duplicate
  holdings, changed economics/sellers/base/units/rate/mode, seller residuals and stale
  approval. This does not establish end-to-end value checkout, outstanding-payment
  creation, customer ownership history or complete browser acceptance.
- Checks: focused plus tenancy 260/260, zero skips (three isolated DB tests);
  related regressions including loader 122/122; shared 302/302; API types/build/lint,
  formatting and whitespace passed. Logs: `/tmp/cp005-value-*.{log,exit}`.
  Only authorized disposable DB used, stopped with data retained. No schema change,
  application DB access, activation, deployment, commit or push. Package purchases,
  usage/credit spending/refund/void loading, source corrections and API/UI remain
  unfinished; CP-005 remains IN PROGRESS.

### FOC operational-economics continuation — October 29

- Migration `20261029140000_sale_line_payroll_economics` adds nullable original
  checkout economics to sale lines. Database trigger prevents rewriting/removing
  populated evidence or moving its line/tenant/sale identity. Checkout writes it in
  the sale transaction, independently from the payroll source event. Legacy rows
  remain null; no current-catalogue reconstruction or backfill is authorized.
- Default loader supports wholly complimentary service lines using independent
  original nonmember list price, quantity, date/identity/category and performer
  shares. It checks zero tax and source FOC type/base/units plus historical FOC
  rule/default provenance. Two units at 492 yield 984 activity, 49.20 default
  commission and zero external cash. Zero-price products, mixed package/value usage,
  prepaid and unsupported reversal/refund workflows remain blocked.
- DB acceptance uses actual createSale to verify snapshot writing/immutability and
  catalogue-edit independence; a separate synthetic historical FOC receipt verifies
  default monthly loader missing-snapshot/capture rollback, calculation, stale
  approval, recalculation and approval. It does not claim end-to-end backdated POS
  checkout or full payroll/browser acceptance. Unit checks cover invalid identity,
  category/tax/rate/base/quantity, capture-only price assertions, multi-performer
  exact residuals and departed staff. Original list price remains checkout-attested,
  not independently reconstructed catalogue history.
- Focused plus tenancy **241/241**, zero skips, including three isolated DB tests;
  related regressions **78/78**; shared **302/302**. API types/build/lint/schema pass.
  Logs/exit markers `/tmp/cp005-foc-{combined,regression-focused,shared,types,build,lint,schema,migrate}.{log,exit}`.
  Broad sale.service suite was attempted against intentionally unreachable DB and
  failed DB setup/cleanup; it was not redirected to retained immutable fixtures.
  Earlier acceptance attempt rejected collection metadata without a positive tender;
  actual FOC checkout test now correctly omits collection metadata. Only authorized
  disposable DB migrated/used, then stopped; data retained. No activation/deployment.

### Ordinary rate-provenance continuation — October 29

- Operational source writer now retains evaluation time, item/category, legacy
  staff rate and selected fallback rate/source/rule identity for every credited
  staff line. Default ordinary loader loads the independent append-only rule
  inventory and replays rules with effective dates at occurrence and publication
  dates no later than capture. It verifies item/time/staff/category, rule identity,
  precedence and exact captured fallback. Missing evidence blocks older captures;
  no current staff/catalogue fallback, historical backfill or activation was added.
- Category and legacy staff rate remain immutable operational-writer attestations,
  not independent historical user/catalogue reconstruction. This boundary assumes
  server-owned transactional source creation; it does not authorize source uploads
  or repair historical evidence. Other workflow provenance remains unsupported.
- Tests cover absent/tampered provenance, rule identity and precedence, explicit
  zero, inheritance, department ties, foreign rules, future rules/publications,
  detached snapshots and operation/capture ordering. DB loader acceptance changes
  current staff rate and publishes a later backdated rule, then verifies the
  captured zero rate survives recalculation and approval unchanged.
- Focused plus tenant/schema checks **236/236**, zero skips, including three
  isolated DB acceptance tests; related rule/collection/refund regressions **78/78**;
  shared **302/302**. API typecheck/build/lint passed. Logs/exit markers:
  `/tmp/cp005-rates-{combined,regression,shared,types,build,lint}.{log,exit}`.
  No new migrations. Only authorized disposable DB used, then stopped; data retained.

### Persisted carry authorization continuation — October 29

- New migration `20261029130000_payroll_carry_authorizations` applied only to the
  authorized isolated DB. Immutable tenant-scoped owner approvals carry hashes and
  contiguous revisions; database insert guard verifies active, 2FA-enabled owner,
  tenant and approval timestamp. Initial migration attempt rolled back because users
  have no composite tenant/id unique key; fixed to the existing user primary-key FK
  plus explicit tenant/owner insert guard, resolved the isolated failed attempt and
  applied successfully. No application databases were accessed.
- Internal owner write boundary shares the tenant source/configuration lock with
  close calculation/approval. It rejects manager/staff/unverified owner, outlet,
  cross-tenant, non-writable tenant and approved-month writes; stamps approval
  identity/time/reason itself. All salon staff, including zero/departed balances,
  must appear explicitly in the first opening inventory. Opening approval cannot be
  backdated; it must precede the salon-local first-month boundary. Earlier history
  or a competing opening prevents cutover. This is authenticated owner attestation,
  not proof of reconstructed legacy debt completeness.
- Default loader now reads/reconciles persisted opening and exact carry settlements.
  Supports existing component remap/write-off and exact fallback debt write-off,
  not actual cash debt repayment. Changed balances block stale settlements;
  reasoned owner reauthorization replaces the current revision without deleting any
  earlier evidence. Changes freeze into input hashes and reject stale close approval.
- DB acceptance verifies write races, isolation/permissions, immutable rows, rollback,
  stale balances and repair, and actual default-loader future first-close calculation
  with departed debt from authenticated opening/write-off, without prior-close
  bootstrap. Future month approval remains prohibited until the month ends.
  Loader unit test covers debt/write-off money, stale approval, recalculation and
  approval with persisted-shaped audited records. This is not full first-close
  end-of-month acceptance or full authoritative payroll acceptance.
- Final focused checks: **223/223** plus tenant/schema checks **4/4**, total
  **227/227**, zero skips, including all three isolated DB tests; shared **302/302**.
  API types/build/lint pass; logs and zero exit markers:
  `/tmp/cp005-auth-{combined,shared,types,build,lint,migrate}.{log,exit}`.
  Cluster stopped cleanly after checks; data retained. No close routes/UI activated.

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
3. Complete opening/settlement API/UI and end-of-month acceptance on top of the
   internal authenticated persistence above; verify component plan-switch mapping
   and approved-month races. Cash debt repayment is unsupported and must fail closed.
4. Monthly-close API and UI with authenticated module/role/outlet boundaries,
   own-data frozen reads, adjustments, calculation/approval and separate payout.
5. Full money reconciliation and transactional acceptance using authoritative
   loaders, API/browser permission acceptance, plan switches, races/rollback,
   immutable approved history and documented performance evidence.

Do not activate the internal store, enable monetary preview or mark CP-005 DONE
solely on the persistence/engine tests above.
