# CP-005 monthly close acceptance checkpoint

## November 2, 2026 — M2 DONE: lifecycle posting separated from cash occurrence

CP-005 M1 and M2 are DONE; M3–M5 remain TODO. No API/UI mounting or earnings activation.
This checkpoint supersedes older M2/session-only remainder statements below.

- Extended approved-month selection to ordinary service/product voids and refunds,
  whole-sale session/credit restoration, package/value-package purchase voids with
  NO_MOVEMENT or full RETURNED cash, and package/value-package refunds.
- Deferred operations retain their original operational captures, restoration and
  settlement timestamps. Immutable captures carry posting evidence; independent
  lifecycle audits bind exact request/capture hashes and inspected historical close
  revisions. Missing/duplicate audits, moved/missing captures and altered evidence
  refuse. Future posting replays the operational family verifier and freezes its
  evidence; a capture is not enough to admit a correction.
- Monthly assembly uses a separate validated commission projection for earned lines
  and SUM_INDIVIDUAL. Existing operational inventories and cash reconciliation still
  use actual occurrence, so future commission posting never repeats money returns.
  Frozen approved statements are never recalculated or edited by source writers.
- Same-period formats and legacy first-receipt retries remain unchanged. Deferred
  whole-sale retries must match actor and request; prepaid refunds retain their
  existing request-key hash check. Locks remain prepaid then configuration/tenant.
- Final M2 acceptance **55/55**, zero skips/failures:
  `/tmp/m2-lifecycle-acceptance-verified.{log,exit}`. Includes 12 deferred-family
  cases (rollback plus six read-corruption variants each), 40 new lifecycle
  calculate/approve orderings with real PostgreSQL blocking, and retained session
  correction/void cases. Returned package and credit purchase races are explicit.
- Related four-file regression **128/128**, zero skips/failures:
  `/tmp/m2-lifecycle-regression-final.{log,exit}`. Expanded purchase race cases and
  final scope validation were subsequently verified in the final acceptance/unit runs.
- All payroll non-acceptance unit files **430/430**, zero skips/failures:
  `/tmp/m2-lifecycle-unit-final.{log,exit}`. Broader supported acceptance plus real
  sale service **121 tests, 115 passed, 0 failed, 6 separately gated skips**:
  `/tmp/m2-lifecycle-broad-final.{log,exit}`. Skips are separate lifecycle/browser
  gates, not enabled CP-005 acceptance. Authorizations plus sale-service rerun
  independently passed **59/59** (`/tmp/m2-lifecycle-http-sale.*`).
- API typecheck and shared/API build pass (`/tmp/m2-lifecycle-quality-verified.exit`,
  `/tmp/m2-lifecycle-{types,build}-verified.log`); affected ESLint, formatting and
  whitespace checks pass. Existing pg client concurrent-query deprecation warning
  remains; no warnings were suppressed.
- Initial mock fixtures lacked new posting inventory delegates; updated them without
  weakening assertions. Earlier broad run lacked JWT_SECRET in three test processes;
  final run uses a synthetic test-only secret and passes. One intermediate extra
  purchase-race run was cancelled by the terminal/event loop; all those cases pass
  in the final 55-case run. Earlier attempts remain as evidence, not passing claims.
- Only verified PostgreSQL 18.6/UTC disposable target
  `127.0.0.1:55485/payroll_close_test`, role `postgres`, data directory
  `/tmp/cp005-m1-14-n6d0gta5` was written. No application DB, schema/migration,
  dependency, provider payment, deployment, commit or push changes.

## November 2, 2026 — M1-19 final completion review

**M1-19 DONE; 19 DONE, 0 IN PROGRESS, 0 TODO; M1 DONE.** This checkpoint
supersedes earlier M1-open and unresolved sale-service cleanup statements below.
CP-005 remains IN PROGRESS: M2 is IN PROGRESS, M3–M5 TODO. Router/screens stay
unmounted; this is not browser release acceptance, deployment or earnings activation.

### Gate review and retained boundaries

- Reviewed M1-01–18 against the lifecycle matrix, real-writer acceptance and
  DECISIONS.md. Supported source inventories reconcile independently through
  calculate/approve, exact external cash and commission bases, corruption/stale
  refusal, transactional rollback and frozen approved history. The 31 M1-18 races
  and 24 expanded M1-17 sharing/expiry cases are included in the final run.
- Spent/transferred purchase voids retain their accepted writer refusal, including
  transfer-back/restored-after-transfer. Partial returned voids remain refused;
  fully prepaid restoration uses NO_MOVEMENT, never a fictitious zero payout.
- Legacy missing economics/funding remain unavailable. The approved prospective-only
  boundary requires owner authorization and complete later evidence; it does not
  backfill history. Purchase-only credit conversion keeps its explicit zero
  VP_SPEND exclusion while reconciling credit restoration and external money.
- No new policy exception or remaining required supported M1 path was identified.
  M2 other correction families, M3 carry/plan-switch acceptance, M4 mounting and
  M5 final/browser/performance acceptance remain separate, unaccepted gates.

### Sale-service failure reconciliation

Reproduced the old suite failure in `/tmp/m119-sale-before.{log,exit}`: its fixed
tenant purge attempts to delete protected original receipt economics, causing
setup/teardown failure rather than demonstrating incorrect sale processing.
`sale.service.test.ts` now allocates fresh tenant IDs per suite and unique extra
performer email, retaining immutable evidence on the disposable database instead
of deleting it. The broad email deletion is removed. A new regression attempts
receipt-line deletion, asserts the immutability error and verifies unchanged rows
and completed receipt. No trigger, production constraint or source writer changed.
Focused **58/58** passes; the same suite passes again inside the integrated run.
Retained fixtures accumulate only on the authorized disposable test target.

### Executed verification

| Check                                                                                                                                                       | Result                                                     | Evidence                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Integrated API: all payroll test files, prepaid acceptance files, prepaid refund HTTP and sale-service; `RUN_CP005_ACCEPTANCE=true`, `--test-concurrency=1` | **699 tests: 690 passed, 0 failed, 9 gated skips**, exit 0 | `/tmp/m119-integrated.{log,exit}`, `/tmp/m119-test-inventory.txt` (63 discovered files, plus refund HTTP and sale-service) |
| Shared                                                                                                                                                      | **305/305**, exit 0                                        | `/tmp/m119-shared.{log,exit}`                                                                                              |
| Full web, `--maxWorkers=1`                                                                                                                                  | **977/977**, 110 files, exit 0                             | `/tmp/m119-web-serial.{log,exit}`                                                                                          |
| Workspace lint and typechecks                                                                                                                               | Exit 0 each                                                | `/tmp/m119-{lint,types}.{log,exit}`                                                                                        |
| Full shared/API/web build                                                                                                                                   | Exit 0                                                     | `/tmp/m119-build.{log,exit}`                                                                                               |
| Full formatting                                                                                                                                             | Exit 0 after explicit reference-artifact exclusions        | `/tmp/m119-format-fixed.{log,exit}`                                                                                        |

The nine skips match M1-18: three separately gated prepaid HTTP acceptance suites,
two CP-003 lifecycle/concurrency suites, three CP-004 session/split/value SQL suites
and one CP-003 Chrome suite. No enabled CP-005 acceptance case skipped. These are
not claimed as newly accepted or run. The CP-004 collection-evidence suite is
outside this inventory and requires a different guarded disposable DB; it is not
silently counted as passed. Full API test-workspace execution is not claimed.

Initial default-parallel web run failed **9/977** (seven timeouts and two field
assertions amid overlapping build/DB load); the complete one-worker rerun passes
without changing tests, timeouts or production UI. That failed run is retained in
`/tmp/m119-web.{log,exit}`, not reported as passing. Initial full formatting found
52 supplied demo/reference artifact files; `.prettierignore` now explicitly retains
those delivered artifacts unchanged, following the existing reference-handoff
convention. No application-source formatting failure was suppressed. Existing
pg client-query deprecation warnings are non-fatal and not resolved by this review.

All DB writes used identity-checked PostgreSQL 18.6/UTC at
`127.0.0.1:55485/payroll_close_test`, data directory
`/tmp/cp005-m1-14-n6d0gta5`. Build client generation is not a migration. No
production code/schema/dependency changes, application DB operation, provider
payment, commit, push, deployment or activation.

## November 2, 2026 — M1-18 deterministic prepaid race acceptance

**M1-18 DONE; 18 DONE, 0 IN PROGRESS, 1 TODO (19); overall M1 OPEN.**
Final consolidated regression: **641 tests, 632 passed, 0 failed, 9 separately
gated skips**, exit 0 (`/tmp/m118-regression.{log,exit}`). Skips are three unrelated
prepaid route suites plus six CP-003/CP-004/browser suites; no enabled CP-005
acceptance skipped. Focused suite passed twice at **31/31**. API typecheck, full
API lint, affected formatting, shared/API build and diff checks pass. The older
sale-service cleanup issue was excluded, not rerun/resolved; review under M1-19.

`payroll-prepaid-races.acceptance.test.ts` adds **31 real-DB race cases**; focused
run **31 passed, 0 failed, 0 skipped**. Each ordering pauses the first transaction
after its real production advisory lock, starts an unwrapped contender and verifies
PostgreSQL blocking through `pg_blocking_pids` before releasing the winner. No
production lock, journal constraint or authorization is replaced.

| Race family                                                                                                  | Cases | Verified result                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Membership departure, consent revocation, usage void, purchase void versus calculate/approve; both orderings | 16    | Calculation sees exactly the winning committed inventory. Source-first approval refuses stale inputs without state/audit changes; close-first approval stays frozen after the later lifecycle write. Recalculation/approval succeeds where mutable. Exact holdings and 500.0000 original-month cash reconcile; later-month returns are not backdated. |
| Family spend versus membership departure or consent revocation; both orderings                               | 4     | Revocation-first spend rolls back without sale or SPEND journal. Spend-first membership departure succeeds; spend-first consent revocation refuses SHARING_STALE, preserves consent, then succeeds after reload. Exact remaining credit 420.00 or 510.00; monthly approval succeeds.                                                                  |
| Restoration versus purchase void; both orderings                                                             | 2     | Purchase-first refuses HOLDING_ALREADY_SPENT with unchanged purchase/no removal; retry after restoration succeeds. Restoration-first permits purchase void. One RESTORE/REMOVAL and exact full returned cash; monthly approval succeeds.                                                                                                              |
| Duplicate full-return purchase void                                                                          | 1     | Both requests finish idempotently; one removal and tenant-scoped purchase snapshot. Retry leaves authoritative inputs identical and monthly approval succeeds.                                                                                                                                                                                        |
| Competing stale membership/consent requests                                                                  | 2     | Exactly one writer succeeds; the loser refuses FAMILY_MEMBERSHIP_STALE/SHARING_STALE without duplicate journals or credit changes.                                                                                                                                                                                                                    |
| Invalid payout versus calculate/approve; both orderings                                                      | 4     | Wrong return rolls back sale, holding, balance journal and tenant audit exactly; close sees unchanged authoritative inputs and commits one transition.                                                                                                                                                                                                |
| Competing calculate/approve requests at the same revision                                                    | 2     | One transition commits; stale contender refuses without duplicate close events.                                                                                                                                                                                                                                                                       |

Verified target before writes: PostgreSQL 18.6, UTC,
`127.0.0.1:55485/payroll_close_test`, data directory
`/tmp/cp005-m1-14-n6d0gta5`. Evidence: `/tmp/m118-focused-complete.{log,exit}`;
API typecheck and full API ESLint pass. Consolidated regression/build completion
is recorded above. Existing M2 session-correction/close race
tests are rerun, not reclassified as new M1 work. No schema/dependency/production
code change, application database operation, activation or deployment.

Initial test runs exposed fixture expectations, not production defects: queued
consent after spend correctly refuses a stale timestamp; auditLog is not an
automatically tenant-filtered delegate, so the snapshot count now explicitly
filters tenantId. The intermediate TypeScript generic annotation was also fixed.
Only the corrected final passing run is acceptance evidence. M1-19 and overall M1
remain open; the older sale-service immutable-economics cleanup issue is unresolved.

## November 2, 2026 — M1-17 expanded lifecycle matrix

**M1-17 DONE; 17 DONE, 0 IN PROGRESS, 2 TODO (18/19); overall M1 OPEN.**
Final consolidated payroll/prepaid/HTTP regression: **610 tests, 601 passed,
0 failed, 9 separately gated skips**, exit 0, recorded in
`/tmp/m117-expanded-regression-complete.{log,exit}`. Skips are three unrelated
prepaid route suites and six CP-003/CP-004/browser suites; no enabled CP-005 case
skipped. Independent HTTP run **62/62**; API typecheck, affected ESLint/formatting,
shared/API build and diff checks pass. The pre-existing sale-service cleanup
failure was not included, rerun or resolved; retain it for M1-19 review.

The shared-original-spend matrix now covers 24 real-writer cases: owner/member ×
same/cross-month × active/expired-before-restoration/expired-after-restoration ×
NO_MOVEMENT/full money RETURNED purchase void. Focused verification: **24 passed,
0 failed, 0 skipped** (`/tmp/m117-expanded-focused-final.{log,exit}`).

Each case verifies restoration to 600.00, exact VP_SPEND bases (±75.0000 in the
same month; -75.0000 in the later month), independent reload, stale-draft refusal,
persisted recalculation/approval and frozen state after later membership departure.
Later-month cases also preserve the original approved month. Exact collection is
500.0000/0.0000 for same-month NO_MOVEMENT/RETURNED, or 0.0000/-500.0000 later.
There are **272 independent corrupted-read refusals** covering consent, membership,
family, spend, restoration and historical expiry; each preserves the prior draft.
Credit expiry is timestamp evidence in GRANT/RESTORE histories, not a session
valuation EXPIRE event. The initial test incorrectly assumed the latter; corrected
before the recorded passing focused run. No immutable journals were modified.

This checkpoint supersedes the matrix's former cross-month/expiry gap and stale
M1-16 status. M1-18 races and M1-19 final review remain separate; overall M1 is open.

## November 2, 2026 — M1-16 final purchase-conversion acceptance

- **M1-16 DONE; M1-17 IN PROGRESS; M1 overall OPEN.** Current checklist:
  **16 DONE, 1 IN PROGRESS (17), 2 TODO (18/19)**. This checkpoint supersedes
  the earlier same-day attribution blocker and IN PROGRESS status.
- Final payroll/prepaid/HTTP regression: **577 tests, 571 passed, 0 failed,
  6 separately gated skips**. Final focused M1-16 matrix/policy run: **19/19**.
  API typecheck, affected ESLint, formatting, shared/API build and diff checks pass.
  Evidence: `/tmp/m116-policy-{focused-final,regression-final,types-final,lint-final,build-final}.{log,exit}`.
- A separately executed regression including `sale.service.test.ts` failed in its
  pre-existing fixture cleanup: deleting frozen sale-line economics violates
  `Original payroll sale economics are immutable`. Reproduced, not resolved;
  no immutable-data protection was disabled. See `/tmp/m116-policy-regression.log`.
- Bounded acceptance is not a Cartesian product of sharing/expiry, transfer,
  partial returns or race combinations. M1-17/18 retain those separate gates.

- The user resolved the purchase-only attribution blocker: exclude credit
  conversions from VP_SPEND commission, while reconciling credit and cash.
  New checkout freezes explicit PURCHASE_CONVERSION_EXCLUDED/EXCLUDE zero-base
  audit lines. Original sellers identify those excluded lines; no commission is
  earned on converted credit. Legacy missing evidence still refuses.
- Eight additional real-writer cases: PACKAGE and VALUE_PACKAGE purchase-only
  receipts, fully credit-funded NO_MOVEMENT or credit-plus-30.00 RETURNED, each
  same/cross-month. Exact cash -27.5200 in the later month; same-month retained
  collection 591.7400; original funding holding restored to 600.00. Each case
  verifies missing restoration/tender/reversal evidence, plus collection/payout
  when cash exists; missing purchase snapshot and stripped exclusion policy also
  refuse. Stale drafts, persisted approval and original approved history are checked.
- Two session-plus-cash cases independently cover 90.00 returned and session
  restoration without value credit. Existing mixed purchase/service/product,
  zero-product/zero-tender and FOC companion acceptance remains in place.
- Focused usage/purchase/policy acceptance: **19/19**; final regression evidence
  is recorded above. No production operations,
  schema/dependency changes, history backfills, commit or deployment.
- M1-17 integrated sharing/expiry combinations, M1-18 races and M1-19 final review
  remain separate. Overall M1 stays open; this supersedes the earlier blocker.

## November 2, 2026 — M1-16 session/cash accepted; purchase attribution blocked

Verification: focused M1-16 usage/blocker tests **11/11**; full payroll/prepaid/HTTP
regression **569 tests, 563 passed, 0 failed, 6 gated skips**. API typecheck,
affected ESLint/formatting, shared/API build and diff checks pass. Logs and exit
markers: `/tmp/m116-complete-{focused,regression,types,lint,build}.{log,exit}`.
The older sale-service cleanup-hook failure was not rerun or resolved.

- Session-plus-cash without value credit now reconciles in same/cross-month
  RETURNED voids. Complete original tenders reserve session-covered quantities;
  independently allocated external receipts must exactly fund every uncovered
  gross cent. Restored sessions never create cash or synthetic credit funding.
- Two additional real-writer cases verify 90.00 returned, 5 sessions restored,
  same-month retained collection 591.7400, cross-month cash -82.5700, distinct
  seller/performer attribution, wrong-return rollback, missing tender/collection/
  reversal/attestation/session-restoration refusals, stale drafts, persisted
  approval and unchanged approved original history. Existing session-credit
  variants now also test missing session-restoration snapshots independently.
- A real purchase-only credit checkout exposes a business-policy blocker:
  `captureValueSpend` draws VP_SPEND performers only from SERVICE lines. A
  PACKAGE-only receipt has sellers but no service performers, so its immutable
  source is UNAVAILABLE with STAFF_ATTRIBUTION and no earnings lines. Voiding
  restores all 100.00 credit to the original holding (600.00 balance) but does
  not reconstruct the missing original earnings contract. Both monthly reads
  correctly refuse. This regression is safety evidence, NOT accepted scope.
- Finishing credit-funded purchases needs explicit policy: exclude purchase-only
  credit conversion from VP_SPEND earnings, attribute it to purchase sellers, or
  require a new explicit attribution contract. Do not pick an earnings policy
  silently, backfill immutable captures, or mark the item DONE from this refusal.
- **M1-16 remains IN PROGRESS, blocked on that decision; M1-17 and M1 stay open.**
  Broader lifecycle sharing/expiry acceptance remains explicit under M1-17, races
  under M1-18, and final review under M1-19. No production operations, migrations,
  dependencies, commits or deployment.

### November 2 M1-16 follow-up: FOC purchase companions

Four same/cross-month real-writer cases now cover a value-package purchase plus
a FOC service, with and without a zero external tender. Frozen operational list
price independently reconciles the original FOC commission base, without counting
that base as cash. Cases include incorrect-return rollback, 16 read-omission
refusals, four missing-FOC-economics refusals, stale drafts, persisted approval and
frozen original cross-month approvals. This supersedes the FOC-companion gap only
for these shapes; credit-funded purchases, session-plus-cash without value credit,
zero-valued prepaid purchases/tenders and broader sharing/expiry remain unaccepted.
**M1-16/17 remain IN PROGRESS; M1 remains open.**

Final verification: focused **47/47**; payroll/prepaid/HTTP regression **566 tests,
560 passed, 0 failed, 6 gated skips**. API types, affected lint/formatting and
shared/API build pass. Evidence: `/tmp/m116-foc-regression-final.{log,exit}` and
`/tmp/m116-foc-focused-final.{log,exit}`. The older sale-service cleanup-hook
failure is not rerun or resolved by these suites.

### November 2 M1-16 follow-up: zero-product and zero external tender

Six further same/cross-month real-writer acceptance cases cover a zero-priced
product, a zero external tender and both together on mixed purchase RETURNED
voids. Exact zero-money product source/reversal evidence survives; zero tenders
have no collection receipt. Incorrect return rollback, 24 additional read-omission
refusals, stale draft rejection, persisted approval and frozen prior approval pass.
Current regression: **528 tests, 522 passed, 0 failed, 6 gated skips**; focused
returned-purchase/helper suites **43/43**. API types, affected lint and shared/API
builds pass. Evidence: `/tmp/m116-next-{focused,regression,types,lint,build}.{log,exit}`.
This supersedes only the earlier zero-product/external-tender acceptance gap:
FOC services, zero-valued prepaid purchases/tenders, credit-funded purchases and
session-plus-cash without value credit are not accepted by this slice. M1-16/17
remain IN PROGRESS; overall M1 remains open. Prior dated gaps below are historical
unless explicitly superseded here.

## November 2, 2026 — M1-17 lifecycle/corruption matrix

**M1-17 remains IN PROGRESS; M1 remains open.** This matrix separates current
integrated evidence from helper checks and required paths that are not accepted.
It is not a Cartesian-product claim. File names below refer to
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/apps/api/src/services/`.
Prior dated checkpoints remain historical evidence, not overrides of this matrix.

### November 2 M1-16 bounded implementation evidence

User-approved policy is external-money-only return with original-holding prepaid
restoration, never prepaid cash-out. Twelve new real-writer cases pass: eight
credit/session-credit NO_MOVEMENT/RETURNED same/cross-month cases, and four mixed
purchase/service/product RETURNED same/cross-month cases. Forty-eight read omissions
refuse independently. Exact collection, stale-draft rejection, persisted approval,
different seller/performer attribution and immutable original approved history are
verified. Till test proves credit 60 + cash 30 returns only 30, not paidAmount 90.

Current status: **15 DONE; 16/17 IN PROGRESS; 18/19 TODO; M1 open**.
Credit-funded purchases, session-plus-cash without value credit, zero/FOC companions
and broader sharing/expiry combinations remain unaccepted, not excluded.
Final payroll/prepaid/HTTP regression: **522 tests, 516 passed, 0 failed, 6 gated skips**;
till **59/59**, API/web types, affected lint and shared/API/web builds pass.
The additional combined run with the older sale-service DB suite exits 1 in its
cleanup hook because original payroll sale economics are immutable. That run is
not reported as passed; no trigger was disabled to delete the protected evidence.
See `/tmp/m116-payroll-final.{log,exit}` and `/tmp/m116-regression-final.{log,exit}`.

The following matrix includes historical M1-17 evidence and the newer bounded
M1-16 slice; neither constitutes overall M1 acceptance.

| Lifecycle / boundary                                                                                           | Current evidence                                                                                                                                            | Acceptance and remaining scope                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary sales, collections, source identity and configuration                                                 | `payroll-close-loader.acceptance.test.ts`, `payroll-close-store.acceptance.test.ts`                                                                         | Real persisted calculate/approve, missing capture refusal, stale inputs and frozen history; exact original source/split reconciliation.                                                                                                                                                                                                                                                                                                                         |
| Private credit, ownership transfers and historical family sharing                                              | `payroll-close-value-loader.acceptance.test.ts`, `payroll-close-value-month.acceptance.test.ts`                                                             | Independent holding/balance/redemption/transfer/membership/consent replay; missing, duplicate, foreign and changed evidence refuses; cash excludes credit; persisted approval and frozen statements. Transferred purchase voids are not enabled.                                                                                                                                                                                                                |
| Mixed session/credit usage, partial-line coverage, wholly credit-funded lines and later instalment collections | `payroll-close-unsupported.acceptance.test.ts`                                                                                                              | Real checkout and monthly approval, exact line GST and cash/debt separation, immutable funding, corrupted/missing evidence and stale drafts. Does not accept mixed returned voids.                                                                                                                                                                                                                                                                              |
| Prepaid refunds                                                                                                | `prepaid-refund-settlement.acceptance.test.ts`, `prepaid-refund-month.acceptance.test.ts`, `payroll-close-prepaid-settlement.test.ts`                       | Real settlement journal/rollback and monthly calculate/approve with stale rejection and legacy capture refusal. The monthly fixture now independently runs PACKAGE and VALUE_PACKAGE writers, verifies exact retained cash, stale-draft refusal, persisted approval and frozen state after later missing-settlement refusal.                                                                                                                                    |
| Ordinary service/product/FOC refunds, zero-tender and cross-month combinations                                 | `payroll-close-sale-refunds.test.ts`, `payroll-close-refunds.test.ts`, four M1-17 ordinary-refund cases in `payroll-void-restored-spend.acceptance.test.ts` | Real service/product plus FOC and zero-value CARD tender, same/cross-month refund writers through calculate/approve; exact cent-rounded cash, five corrupted payout/reversal inventories per case, stale drafts and unchanged original approved month.                                                                                                                                                                                                          |
| Unused money-paid purchase voids, including active credit sharing                                              | `payroll-returned-purchase-void.acceptance.test.ts`                                                                                                         | NO_MOVEMENT/full money RETURNED, exact retained cash, frozen snapshots, independent consent/membership and corrupt attestation refusals, stale drafts and persisted approval.                                                                                                                                                                                                                                                                                   |
| Restored private credit, later-shared credit, expired credit                                                   | `payroll-void-restored-spend.acceptance.test.ts`                                                                                                            | Deleted-holding snapshot and independent GRANT/SPEND/RESTORE/REMOVAL replay; exact opposite spend bases and retained collection; missing journals/cash refuses; persisted approval. Scope follows individual test variants, not every expiry/return combination.                                                                                                                                                                                                |
| Credit shared **during original spend**, owner or family-member spender                                        | 24 `CP-005-M1-17 shared original ...` cases in `payroll-void-restored-spend.acceptance.test.ts`                                                             | Owner/member × same/cross-month × active/expired-before/expired-after restoration × NO_MOVEMENT/full money RETURNED. Exact credit/cash/bases, 272 corrupted-read refusals, stale rejection, persisted approval and frozen original/current history after membership departure. Races remain M1-18.                                                                                                                                                              |
| Session restoration followed by purchase void                                                                  | `payroll-void-restored-spend.acceptance.test.ts`                                                                                                            | Twelve session/whole-sale × active/expired-before/expired-after × NO_MOVEMENT/RETURNED cases plus four later-month cases; exact ordinals and values, corrupt inventories, stale rejection and immutable original approved month. Whole-sale usage here is fully session-covered.                                                                                                                                                                                |
| Spent or transferred purchases, including transfer-back/restored-after-transfer                                | `payroll-purchase-void-eligibility.acceptance.test.ts`                                                                                                      | Intentional writer refusal with unchanged sale/holding/journals/payroll/audit evidence, not a missing supported purchase-void workflow.                                                                                                                                                                                                                                                                                                                         |
| Legacy full-credit funding gaps                                                                                | `payroll-prospective-coverage.acceptance.test.ts`                                                                                                           | Approved prospective-only opening policy; historical gaps remain unavailable, missing prospective funding and later legacy-dependent activity refuse, coverage revisions invalidate drafts and approved history stays frozen.                                                                                                                                                                                                                                   |
| Mixed or credit-funded RETURNED voids                                                                          | M1-16, **DONE**; `payroll-close-unsupported.acceptance.test.ts`, `payroll-returned-purchase-void.acceptance.test.ts`                                        | User-approved external-money-only returns and original-holding restoration cover credit/session usage, session-plus-cash, mixed purchase/service/product and zero/FOC companions, and credit-funded purchase-only conversions with explicit VP_SPEND exclusion. Same/cross-month approval, independent corruption refusal, stale drafts and frozen history. Partial returns remain intentionally refused; no arbitrary Cartesian-product acceptance is claimed. |
| Membership/consent, void and close races                                                                       | M1-18, **DONE**; `payroll-prepaid-races.acceptance.test.ts`                                                                                                 | 31 deterministic PostgreSQL-blocked race cases: lifecycle versus calculate/approve both orders, spend/revocation, restoration/purchase void, duplicate void, stale lifecycle requests, failed payout rollback and competing close revisions. Exact money, unique journals, persisted approval and immutable approved history. Focused 31/31 twice; consolidated 632 passed, 0 failed, 9 separately gated skips.                                                 |

The new four cases use real family creation, explicit consent, optional member join,
the `family:<id>` checkout tender, usage void/restoration and money-funded purchase
void writers. The purchase is **not credit-funded**, so full RETURNED here does not
start or resolve M1-16. Retained monthly net collection is exactly `500.0000` for
NO_MOVEMENT or `0.0000` for RETURNED; original/restored VP_SPEND bases are exactly
`75.0000` and `-75.0000`. Read-only proxies independently omit consent, duplicate
spend, change spend family/value, omit/duplicate/foreign-scope membership history or
omit the family. All 32 injections refuse and preserve the persisted prior draft.
No append-only journal is edited to manufacture these corruptions.

Four additional ordinary-refund cases use real service/product plus FOC checkout,
a zero CARD tender, real refund payouts and same/later-month approval. Refunded net
is `82.5700` (cent-rounded net for 90.00 GST-inclusive gross); the independent
purchase retains `500.0000` in the same month, and a later refund month collects
`-82.5700`. Each refuses missing/wrong payout, missing/duplicate reversal and altered
reversal bases (20 total), preserves its prior draft and rejects stale approval.
Cross-month cases additionally preserve the original approved-state hash.

Current verification on the independently checked PostgreSQL 18.6 disposable
cluster `/tmp/cp005-m1-14-n6d0gta5`, `127.0.0.1:55485/payroll_close_test`, UTC:

- Focused new cases: **8 passed, 0 failed, 0 skipped**.
- Final consolidated payroll plus prepaid settlement/monthly/HTTP regression:
  **504 tests, 498 passed, 0 failed, 6 skipped**.
  Skips are separately gated CP-003 configuration/concurrency/browser and CP-004
  package/value/session-race suites; no enabled CP-005 acceptance case skipped.
- Additional prepaid settlement/monthly/HTTP regression: **17 passed, 0 failed,
  0 skipped**. HTTP coverage uses replaced persistence seams, not live HTTP-to-DB.
- API typecheck, affected-test ESLint and shared/API build passed.
- Logs and numeric exit markers: `/tmp/m117-{focused,regression-final,settlements,types,lint,build}.{log,exit}`.
- The run emits a pg client concurrent-query deprecation warning. It is not a test
  failure; future pg 9 compatibility is not claimed or changed by this test-only work.

Do not mark M1-17 DONE on these selected results. M1-16 has approved operational policy, but its still-unaccepted integrated combinations,
plus M1-18 races, stay explicit. No application-database
operations, migration, provider calls, dependency changes, mounting, activation,
browser acceptance, commit, push or deployment were performed.

## November 2, 2026 — M1-15 prospective-only coverage

Approved policy keeps legacy full-credit allocation gaps unavailable; it does not
repair historical funding. Owner-authorized first-close opening may now explicitly
declare `coverage: { policy: "PROSPECTIVE_ONLY", legacyHistory: "UNAVAILABLE",
inventoryReference }`. Existing opening authorization rules supply the salon-local
boundary, complete staff/debt inventory, authenticated actor and pre-boundary
approval. No schema migration or retroactive policy assignment is performed.

`payroll-prospective-coverage.acceptance.test.ts` uses real checkout purchases and
spends on disposable PostgreSQL, with a substituted read omitting only the immutable
legacy funding contract. It proves direct legacy refusal, pre-boundary refusal,
prospective zero-cash calculation/approval, missing covered funding refusal,
coverage-revision stale approval, immutable approved history and later legacy
restoration refusal. It does not claim an operational legacy writer or backfill.
Separate holdings avoid mixing mocked future POS time with the legacy holding's
database-timestamped restoration journal; no SQL-clock interception is used here.

Coverage is frozen into authoritative monthly inputs, not used to filter source
queries. Post-boundary activity that depends on unavailable legacy evidence still
blocks. Reference text remains owner attestation, not automated verification of an
external inventory document. Browser/mounted HTTP, production and race acceptance
are not claimed. M1-16 was not started.

Verification: **479 payroll service tests; 473 passed, 0 failed, 6 skipped**.
API typecheck, affected-file ESLint and shared/API build passed. Logs and exit
markers: `/tmp/m115-{regression,types,lint,build}.{log,exit}`.

```sh
cd /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/apps/api
DATABASE_URL=postgresql://postgres@127.0.0.1:55485/payroll_close_test \
  TZ=UTC RUN_CP005_ACCEPTANCE=true node --import tsx --test --test-concurrency=1 \
  src/services/payroll-*.test.ts
```

Target verified as PostgreSQL 18, UTC, disposable data directory
`/tmp/cp005-m1-14-n6d0gta5`; fixtures are synthetic and retained. This entry
supersedes earlier M1-15 TODO claims only under the approved prospective-only scope.

## November 2 completion — M1-14

M1-14's used/transferred scope is reconciled with the operational writers. Spent
and transferred purchases (including transfer-back/restored-after-transfer) stay
prohibited and leave evidence unchanged. Both session-specific and whole-sale
restoration now load deleted session purchase holdings through calculate/approve.
The whole-sale path retains the VOID sale and independently verifies its
NO_MOVEMENT cash attestation and exact sale-wide reversal, rather than pretending
that a manager session-void request exists.

`payroll-void-restored-spend.acceptance.test.ts` covers twelve same-month shapes:
session/whole-sale restoration × active/expired-before-restore/expired-after-restore
× NO_MOVEMENT/full money RETURNED. It verifies exact retained cash, preserved
capture snapshots, corruption refusal, stale-draft rejection and persisted approval.
Four later-month cases additionally freeze an approved original month and verify
unchanged history after restoring/voiding and approving the next month.
Expiry journals reconcile the available ordinal subset at expiry, independently
of sessions restored into the expired bucket later.

Scope remains explicit: whole-sale usage voids here are fully session-covered and
independently attested NO_MOVEMENT. Mixed usage-sale voids are not enabled, nor are
mixed/credit-funded returned purchase voids (M1-16). No historical funding is
invented and no writer eligibility is relaxed. M1-15 remains TODO; integrated
matrix/race/final gates M1-17–19 are not claimed complete.

Verification uses the identity-checked disposable PostgreSQL 18 database
`127.0.0.1:55485/payroll_close_test`, cluster directory
`/tmp/cp005-m1-14-n6d0gta5`, timezone UTC. The acceptance-only clock interception
keeps the valuation SQL clock aligned with mocked POS time, without modifying
production clock code or bypassing operational writes/constraints.

Final verification on November 2, 2026:

- Payroll and prepaid-refund-settlement regression, `RUN_CP005_ACCEPTANCE=true`,
  `TZ=UTC`, `node --import tsx --test --test-concurrency=2`: **481 tests,
  475 passed, 0 failed, 0 cancelled, 6 skipped**. Skips require separate browser
  or CP004 opt-ins and are not claimed verified. All 23 restored-spend tests pass.
- API typecheck, affected-file ESLint, shared/API build, affected-file Prettier
  (including these three milestone documents), and `git diff --check`: passed.
- Ephemeral logs: `/tmp/m114-final-regression.log`, `/tmp/m114-final-types.log`,
  `/tmp/m114-final-lint.log`, `/tmp/m114-build.log`, `/tmp/m114-final-format.log`.
  No mounted API/UI, browser, production or concurrency acceptance is claimed.

## November 2 continuation — M1-14 restored-session checkpoint

M1-14 is **not complete**. Verified restored-session purchase voids use the real
`voidPayrollSession` writer before voiding the purchase. Both NO_MOVEMENT and full
RETURNED reconcile the verified deleted holding and redemption/restoration/valuation
inventories through monthly calculation, stale-draft rejection and persisted approval.
Missing evidence, wrong ordinal/value evidence and duplicate draw inventories refuse.
Original capture evidence remains unchanged; post-approval cross-month lifecycle
mutation and expired restored-session combinations are not claimed by these cases.

Real writers still reject spent and any transferred credit/session purchase,
including transfer-back and restored-after-transfer, without changing evidence.
Whole-sale session restoration is a **different, permitted operation**, but its
monthly reversal reconciliation remains fail-closed and required under M1-14;
the added real-writer boundary test must not be read as acceptance of that path.

See `payroll-purchase-void-eligibility.acceptance.test.ts` and
`payroll-void-restored-spend.acceptance.test.ts` for executable scope. No eligibility
rules, production data, historical funding or policy were relaxed/backfilled.

Verification on November 2, 2026:

- Disposable PostgreSQL 18, UTC, freshly deployed migrations; no production DB used.
- `RUN_CP005_ACCEPTANCE=true`, `TZ=UTC`, `node --import tsx --test
--test-concurrency=2` over 56 payroll/prepaid-refund-settlement test files:
  **468 tests, 462 passed, 0 failed, 6 skipped**. The skipped suites require separate
  browser/CP004 acceptance opt-ins; they are not claimed as verified here.
- Separate payroll unit run: **424 passed, 0 failed, 0 skipped**.
- API typecheck, affected-file ESLint, shared/API build, affected-file Prettier
  check and `git diff --check`: successful. Regression log:
  `/tmp/cp005-m1-14-regression.log` (ephemeral, not a repository artifact).

## November 1 continuation — active-sharing credit purchase voids

The hash-verified pre-deletion credit snapshot now permits explicit `sharedFamilyId`
(legacy `familyId` remains refused). Purchase-void loading independently replays
consent and owner membership, matching both terminal removal family fields to that
state. Deleted holding revival preserves consent; restored-spend loading verifies
the same exact removal state rather than requiring private credit.

Real-writer acceptance added to `payroll-returned-purchase-void.acceptance.test.ts`:
unused shared credit supports NO_MOVEMENT (500.0000 retained net) and full RETURNED
(0.0000 retained net), with original/reversed purchase bases intact. Each path
refuses seven corrupt read inventories: missing consent, membership history, live
membership or family, foreign membership, and either removal family mismatch.
Pre-void drafts refuse approval; recalculation and approval pass. Later membership
departure does not rewrite the frozen approved state.

`payroll-void-restored-spend.acceptance.test.ts` additionally verifies a private
spend restored in full, then shared and purchase-voided with NO_MOVEMENT: deleted
holding revival, full independent history, exact spend/restoration bases and
persisted approval. Sharing during the original spend is not newly accepted here.

Verification: payroll service/regression selection **456 passed, 0 failed,
6 skipped** (462 tests); focused restored-spend acceptance **7/7**. API typecheck,
targeted ESLint, shared/API build, targeted Prettier and Git whitespace checks pass.
Logs: `/tmp/cp005-active-sharing-regression-final.log` and
`/tmp/cp005-active-sharing-restored.log`. All database checks used a newly created,
fully migrated disposable PostgreSQL cluster configured for UTC sessions.

No application database changes, legacy evidence backfill or live activation.
Remaining used/transferred shapes and full lifecycle/corruption/race coverage keep
M1 open; close API/UI stay unmounted. Browser and new concurrent race acceptance
are not claimed.

## November 1 continuation — returned-money purchase voids

A purchase that was paid in money can now be voided and handed back in one act, and
the close reads it instead of refusing or, worse, counting cash the salon no longer
holds. `POST /sales/:id/void` takes `cashDisposition: "RETURNED"` with
`returnedCash: { reference, payouts[] }`; the writer (`sale-void-cash.ts`) binds that
claim to `SalePayment` inventory it re-reads inside the void transaction, records a
version-2 `sale.void.cash-disposition` attestation beside the pre-deletion holding
snapshot, and refuses `VOID_RETURN_UNSUPPORTED_SALE` (not a purchase paid entirely in
money), `VOID_RETURN_AMOUNT_INVALID` (non-money or sub-cent payout) or
`VOID_RETURN_AMOUNT_MISMATCH` (payouts ≠ collected) before anything is reversed. No
partial return is representable.

Loading re-derives the returned gross from the surviving tenders, so an attestation
edited outside the writer fails `SALE_VOID_CASH_UNCONFIRMED`.
`payroll-close-purchase-void-loader.ts` builds one returned allocation per receipt
allocation — original `COLLECTION` event id, sale line, item type, net/GST/gross and
the historical seller shares — sums them to the record totals, and submits it through
`resolvePayrollCloseVoids` as `returnedCashSaleVoids`; `payroll-close-loader.ts`
passes that into the cash resolution, so the month subtracts the net once from salon
cash, from the seller and from the outlet. The month's own commission capture and its
reversal stay visible (a returned void removes cash, not sale history).

Acceptance `payroll-returned-purchase-void.acceptance.test.ts`, four cases on the
disposable cluster, real writers only:

1. A 545.00 value package (500.00 net / 45.00 GST) paid by cash, voided with a
   returned payout of 545.00 and a reference: `salonCash 0.0000`, seller collection
   `0.0000`, one `returnedCash` entry of net 50000 cents, `VP_SALE` 500.0000 and
   −500.0000 both present, identical input hash on reload, no `payroll_close` row
   before calculation, then `CALCULATED` and `APPROVED` with the draft's hash.
2. The same sale refused at 540.00 (`VOID_RETURN_AMOUNT_MISMATCH`), left `COMPLETED`
   with no attestation row, and accepted afterwards at the correct figure.
3. A cash-paid service sale refused `VOID_RETURN_UNSUPPORTED_SALE`, still `COMPLETED`
   — a service giving-back is a refund (ADR 0020 / R1), not a void.
4. An attestation edited to 645.00 refuses `SALE_VOID_CASH_UNCONFIRMED`, because the
   loader recomputes the total from the tenders.

The close's returned/refund payout enum widened from five codes to the shared
money-tender list (`MONEY_PAYMENT_METHODS`, keeping legacy `PAYNOW`), so a return
given back by PayNow, GrabPay or Atome is not forced into `CASH`; `voidSaleSchema`
and the void writer share that same tuple.

Verification: payroll/prepaid acceptance family **511 passed, 0 failed, 9 skipped**
(520 tests); shared `sales` **48/48**; void/inputs unit files **50/50**; web `Sale`
**58/58**; API and web typecheck, targeted ESLint, Prettier and `git diff --check`
clean. Logs `/tmp/cp005-returned-*.log`, `/tmp/cp005-payroll-family.log`,
`/tmp/cp005-acceptance-family.log`. Not claimed: mounted close API/UI, browser,
concurrency/race proofs for this path, or M1–M5 completion. M1 remains IN PROGRESS.

Known pre-existing full-suite noise on a shared acceptance database (reproduces
without this slice): `sale.service.test.ts` and `sales.routes.test.ts` pass their
tests but their `purge` hook is refused by `protect_sale_line_payroll_economics`, and
`requireModule.test.ts` can see `packages` seeded `isCore: true` by another file's
fixture. Running those files against a freshly migrated database, or in their own
database, is the current workaround.

## October 31 continuation — session-covered credit instalments

A session-covered receipt that is not paid in full now loads through close instead
of refusing. Checkout freezes version-2 `sessionCreditFunding` with verified
coverage, package tenders, credit gross and the uncollected gross; the uncollected
balance is validation-only tender inventory — never cash, never a payment row and
never a collection source. Later receipts append their own zero-unit
`ORDINARY_COLLECTION` sources, so session coverage, credit and debt stay
independently evidenced, and the sale-level session loader now admits those later
sources.

Acceptance "CP-005 session-covered credit instalments keep coverage, credit and
debt apart" drives the real writers through checkout on a session-covered line
plus a separate credit line, paid by a package tender and stored credit with the
balance left uncollected, then monthly calculation, stale-draft rejection, a later
partial collection, recalculation and persisted approval. It asserts the frozen
split (session gross with the covered units, credit as credit, remainder as debt),
that the later cash posts exactly once in its own collection month, and that no
checkout snapshot is rewritten. Plain credit instalments keep version-1
`instalmentCreditFunding`; lines with neither contract are still skipped by the
collection writer, and an instalment without provable funding or session coverage
without a session contract still refuses.

Verification after the change: full API suite 1153 tests, **1059 passed,
0 failed**, 57 cancelled and 37 gated skips (other modules' env-gated suites); the
payroll close family alone is **338 passed, 0 failed**. API typecheck, targeted
ESLint and Prettier are clean. Evidence: `/tmp/cp005-session-full-unit.log`,
`/tmp/cp005-session-full-accept.log` and companion
`/tmp/cp005-session-{typecheck,lint,prettier}.log`. No mounted API/UI, browser,
performance or production-database acceptance is claimed; M1 remains IN PROGRESS
and M2–M5 are not complete.

## October 31 continuation — prospective ordinary credit instalments

Checkout freezes explicit funding/debt evidence; later receipts append separate
zero-unit ORDINARY_COLLECTION sources. Complete independent payment, debt,
collection, allocation and rate evidence reconciles before loading. No legacy
backfill or synthetic cash is persisted. Same-key concurrent retries create one
payment/source. Stale drafts reject after collection. Real calculation/approval
freezes original history; the next month's final payment contributes only 27.53
after the first 27.52, retaining original line GST rounding.

Unused expired-credit purchase voids now replay expiry and exact terminal removal
from the preserved holding with explicit NO_MOVEMENT. Their real-writer monthly
calculation and persisted approval pass. Expiry alone is not a new spend.

Monetary correction persistence additionally verifies concurrent same-revision
corrections commit once with no original approved-state rewrite. Source corrections,
approval/source races, plan-switch integration, mounted API/UI, browser and performance
acceptance remain unaccepted. M1 remains IN PROGRESS; M2–M5 are not complete.

Final guarded payroll regression: **482 passed, 0 failed, 6 gated skips**;
shared **302 passed**. API build, targeted ESLint/Prettier and whitespace checks
passed. Evidence is in `/tmp/cp005-all-final-regression.log` and companion
`/tmp/cp005-all-{shared,build,lint,prettier}.log` files. No close browser or
performance results are claimed; no production/application database was used.

## October 31 continuation — partial lines and expired restored credit

Partial session/credit coverage now passes real checkout, monthly calculation,
stale-draft rejection, recalculation and persisted approval, with and without cash.
Prospective version-2 evidence binds exact coverage, package/credit tenders and
explicit external allocations; cash cannot consume session-covered gross cents.
Existing disjoint version-1 evidence is unchanged. Tests include external cash on
the partially covered line and preserve independent line-level GST rounding.

A wholly credit-funded ordinary line alongside an externally funded line no longer
receives a false missing-allocation marker. Its independent monthly regression
verifies zero ordinary base without treating credit as new cash.

Fully restored used-credit purchase voids after expiry now reconcile through the
surviving complete ledger and pre-deletion snapshot, then calculate and approve.
Historical expiry at spend/restore, exact REMOVAL and NO_MOVEMENT confirmation still
verify. Unused expired-credit voids remain a separate boundary. Focused funding and
monthly cases: 9/9; restored-credit database cases: 5/5; no skips in either run.

These results supersede partial-line and expired-restored-credit refusal claims
below, not the overall status. **M1 remains IN PROGRESS; M2–M5 remain TODO.**

## October 31 checkpoint — disjoint session/credit usage

Settled session-package/credit receipts now pass real-writer monthly calculation and
persisted approval when session coverage and credit/cash lines are disjoint. Complete
holding histories, package tender coverage and prospective frozen funding evidence
must reconcile independently. Credit/session tenders add no cash; only external
allocations contribute cash and the ordinary service base. Both credit-only residual
and allocated-cash variants pass stale-draft rejection, recalculation and immutable
approved-state acceptance. SQL immutability and loader-level missing-evidence refusal
are checked separately. Partial-line mixed usage refuses
`MIXED_SESSION_CREDIT_PARTIAL_LINE_NOT_SUPPORTED`; instalments still refuse
`VALUE_SALE_INSTALMENT_NOT_SUPPORTED`. Mixed corrections/voids and browser acceptance
remain open. M1 is IN PROGRESS, not DONE. Supersedes earlier blanket mixed-usage gates.

## Status — October 30, 2026

**IN PROGRESS, not accepted.** CP-004 remains latest completed. No CP-003A or
CP-006 work started. All results below describe actual local checks, not release
or production readiness.

The five remaining delivery gates are tracked as CP-005-M1–M5 in
[TASKS.md](TASKS.md). **M1 authoritative lifecycle loading is still open**, despite
passing monthly private-credit and private-transfer subsets. Sharing, restorations,
refunds/voids and the other required unsupported paths must be integrated and
verified, not merely rejected, before M1 is complete. Next-open corrections,
carry/plan-switch acceptance, mounted application workflows and final acceptance
remain separate milestones. The checkpoint results below do not complete them.

During implementation, run focused checks for fast feedback and consolidate
integrated regression at the milestone gate. Preserve all existing acceptance
requirements; faster cadence does not permit weaker assertions or omitted paths.

## Latest checkpoint — prepaid refund HTTP settlement workflow

- `POST /sales/package-holdings/:id/refund` and
  `POST /sales/value-package-holdings/:id/refund` already carried auth,
  sales/packages module, writable-tenant and manager/owner guards and already
  forwarded the optional `settlement` confirmation into the shared journal writer.
  That workflow now has HTTP-level acceptance instead of service-only coverage.
- New `apps/api/src/routes/prepaid-refund-settlement.http.test.ts` drives the real
  router, middleware, zod validation and refund service over HTTP with replaced
  persistence seams. One confirmed cancellation writes exactly one
  `prepaidRefundSettlement` row (salon tenant, source key, holding/sale/line, actor
  and role, reference, currency, zero net/tax/gross, 54500 cancelled gross, frozen
  request plus operational hash) next to one refund source event, inside the
  authenticated salon-wide scope.
- Retry with the identical body replays the stored event and writes no second
  settlement, journal row or holding update. A changed reference refuses 409, and a
  row whose reference or frozen money evidence was altered refuses 409
  `...unavailable`. An outlet-scoped session refuses 403 salon-wide, STAFF/CASHIER
  refuse 403 before any transaction, a disabled session 401s and a foreign outlet
  404s before persistence, and a malformed confirmation is refused 422 by the
  strict schema.
- A refused close names its cause, so an operator can tell a supported path from an
  unsupported one: `MIXED_SESSION_CREDIT_PARTIAL_LINE_NOT_SUPPORTED` (one line partly
  covered by sessions alongside stored credit) and `VALUE_SALE_INSTALMENT_NOT_SUPPORTED` (a
  part-paid credit spend). All read
  `409 Authoritative payroll inputs unavailable: <CODE>.` and write no close.
- A restored spend whose holding a later purchase void deleted is read, not refused:
  `loadPayrollValueSpendHistory` rebuilds the deleted row from the void's hash-verified
  pre-deletion snapshot, admits the `VOID` purchase it belonged to, accepts only the void
  writer's own one-per-capture collection reversal, verifies the terminal `REMOVAL`
  balance row that emptied the credit, and replays the spend/restore on the ledger that
  outlived the row (the removal is excluded from the replay and still frozen in evidence).
  Any snapshot that fails those checks keeps the generic
  `VALUE_SPEND_HISTORY_UNCONFIRMED`.
- Void gates are scoped by the writer, not by guesswork: a purchase whose credit is
  still spent cannot be voided (`HOLDING_ALREADY_SPENT`), so the loader's used and
  transferred gates defend against edited rows; undoing the spend and then voiding the
  purchase _is_ allowed and is now loadable, pinned by
  `payroll-void-restored-spend.acceptance.test.ts`. With writer-supported `NO_MOVEMENT`
  confirmations, full monthly loading, calculation and persisted approval pass: retained
  cash 500.0000, spend/restore bases 75.0000/-75.0000, stable input hash and unchanged
  approved calculation evidence. Missing SPEND, RESTORE or REMOVAL evidence refuses.
  The month still refuses `SALE_VOID_CASH_UNCONFIRMED` without confirmation. Real-writer
  probes pin expired restored credit at `PURCHASE_VOID_HISTORY_UNCONFIRMED` and prove
  unconfirmed returned-cash snapshots alone do not authorize close. Five acceptance
  cases pass; payroll regression 421 passed, 0 failed, 6 skipped (427 total).
- Every purchase void now writes the pre-deletion holding snapshot, not just the
  no-movement ones: a returned-cash void deletes the same credit rows, so restricting
  capture to `NO_MOVEMENT` left those credits with no evidence at all. Only the
  no-movement path additionally writes the cash confirmation that binds the hash. The
  capture proves salon scope and ties itself to the voider through the sale's own
  `voidedById`, because the void writer takes the actor as a parameter and a stricter
  session-actor check refused voids the writer accepts.
- A refund without confirmation still persists as a legacy capture with no journal
  row, and confirmation cannot be added afterwards (409), so the close loader keeps
  refusing that capture as `PREPAID_SETTLEMENT_MISSING` instead of accepting a
  retroactive claim.
- Refund suite **116/116 passed** over `payroll-value-package.http.test.ts`,
  `payroll-close.http.test.ts`, the new HTTP suite, `prepaid-refund-settlement.test.ts`
  and `payroll-value-package-refund.test.ts`, with zero skips; API typecheck, ESLint
  and Prettier clean. Logs `/tmp/cp005v-http-settlement.log`,
  `/tmp/cp005v-refund-suite.log`, `/tmp/cp005v-tsc2.log`, `/tmp/cp005v-eslint2.log`,
  `/tmp/cp005v-prettier3.log`.
- Deliberately not changed: confirmation stays optional, so a paid refund can still
  be captured without settlement evidence and then fail closed at close. Making it
  mandatory for every prepaid payout is an owner business decision, not a silent
  code change. Remaining M1 work: mixed session/credit usage, spend-sale instalments,
  full-credit paid lines without allocation evidence and the remaining void gates.

## Previous checkpoint — prepaid refund settlement inventory

- Prepaid package and value-package refunds are now inventoried from their own
  append-only settlement row, never from a capture event alone. Each settlement is
  validated against the pre-cancellation holding replay, the original sale-line
  allocations/outstanding debt and the frozen refund request, re-deriving payout,
  admin fee, net, tax and payout method instead of trusting them. Unbound, tampered
  or ambiguous evidence refuses as `PREPAID_REFUND_SETTLEMENT_UNCONFIRMED`.
- The monthly loader reads settlements before tenant and inventory work, so a
  settlement lands in exactly one payroll month — the salon-local month of its
  cancellation capture. Two settlements for one holding or one operation key refuse
  (`PREPAID_SETTLEMENT_DUPLICATE`); a stored row that disagrees with the replayed
  holding, a historical original capture moved between months, or a refund capture
  outside its settlement month refuse (`PREPAID_SETTLEMENT_INVENTORY_UNCONFIRMED`,
  `PREPAID_ORIGINAL_MONTH_CAPTURE_UNCONFIRMED`,
  `PREPAID_REFUND_MONTH_CAPTURE_UNCONFIRMED`); a month capture with no settlement
  refuses as `PREPAID_SETTLEMENT_MISSING` instead of being dropped.
- A settled refund is an external cash outflow from salon cash: it adds no sale or
  commission source, uses only the settlement's net cents, and freezes the buyer's
  original deposit, allocations and award lineage in `refundPayouts` so a later month
  cannot re-claim the same money or units.
- New opt-in DB acceptance `prepaid-refund-month.acceptance.test.ts` buys, refunds and
  loads one salon-local month: a single settlement/history, one 50000-cent payout and
  zero salon cash; a second cancellation then rejects the stale approval with
  `/inputs changed/`, recalculation shows two 50000-cent payouts netting 500.0000 of
  remaining sale cash, approval succeeds, and a synthetic legacy capture without its
  settlement refuses `PREPAID_SETTLEMENT_MISSING`. The loader unit matrix adds
  duplicate holding, duplicate operation key, orphan holding and missing settlement.
- Selected close API **332/332 passed, zero failures/skips**, five isolated DB suites
  included; the three directly touched suites **44/44**; API typecheck, ESLint and
  Prettier clean. Logs `/tmp/acc-all.log`, `/tmp/acc-two.log`, `/tmp/tsc.log`,
  `/tmp/lint.log`, `/tmp/prettier3.log`. No web checks, schema/migration change,
  earnings activation or deployment.
- Blockers unchanged: refund captures written before settlements now fail closed
  instead of loading, and prepaid refund HTTP workflows, close API/UI mounting,
  source-base corrections, plan-switch/performance and browser acceptance stay open.

## Previous checkpoint — private credit ownership transfers

- Private transfer history now replays complete GRANT/SPEND/TRANSFER states from
  the original buyer to current owner and remaining balance, independently matching
  every transfer audit by tenant/holding/from/to/amount/actor/reason/expiry and timing.
  Each spend uses its verified historical owner; purchase ratio/sellers never change.
- Transfer adds no commission source or external cash, but complete evidence changes
  the input hash and invalidates a stale draft. Real monthly acceptance covers original
  buyer spend, recipient spend, two transferred holdings of one package and return
  transfer after approval while stored calculation and statement hashes stay frozen.
- Eight missing/mismatched transfer audit/ledger corruption checks refuse without
  draft/audit mutation. Unit checks cover round trips, ambiguous chains and audit
  ordering. Ledger timestamps are transaction-start times; audit append may follow
  but must precede the next state transition. No timestamp equality assumption.
- Selected close API 298/298, zero failures/skips, five isolated DB suites; shared
  302/302; API typecheck/lint/build/format/whitespace pass. Logs
  `/tmp/cp005-transfer-*`. No web checks. Disposable PostgreSQL stopped; fixtures
  retained. No application DB/schema changes or earnings activation.
- Sharing/membership/consent replay, restoration/refund/void and expiry edits remain
  unavailable. Next sharing reconciliation, then refunds/voids. Close UI/router
  remain unmounted; performance and mounted app/browser acceptance still required.

## Previous checkpoint — private-credit monthly integration

- Authoritative monthly loader accepts only settled private-credit service/product/
  FOC receipts proven by the complete sale/holding reconciler. Independent month
  sales, payments, redemptions, captures and collections match exactly, including
  multiplicity and tenant identity. Payment/source-only candidates cannot disappear.
- Verified credit tenders are excluded from external payment operations. VP_SPEND
  retains original purchase ratio; ordinary activity matches external-net allocations;
  FOC retains frozen full list price. Complete sale/holding evidence is frozen with
  inputs, under the established prepaid-before-tenant transaction boundary.
- Two holdings of the same catalogue package on one receipt are distinguished by
  independently matching sibling operational redemptions, not catalogue ID alone.
  Missing/orphan sources continue to refuse.
- Real checkout/monthly acceptance verifies mixed lines, same-package two-holding
  split spends, 591.7400 then 1183.4800 external net cash including original package
  purchases (never credit tender face value), stable reload and 15 independent month
  omission/duplicate/foreign-row refusals without draft/audit changes. New activity
  refuses stale approval; approved history survives later catalogue edits/spends;
  following empty month has zero activity/cash and retains approved prior evidence.
- Selected close API 294/294, zero failures/skips, five isolated DB suites; shared
  302/302; API typecheck/lint/build pass. Logs `/tmp/cp005-month-*`. No web checks.
  Disposable PostgreSQL stopped; fixtures retained. No application DB/schema changes.
- This is narrow internal monthly support, not complete CP-005 acceptance or earnings
  activation. Transfers/sharing, refund/voids, mixed session-package usage, spend-sale
  instalments and full-credit paid lines lacking ordinary allocation still refuse.
  Router/screen remain unmounted; performance and full app/browser acceptance remain.

## Previous checkpoint — monthly prepaid lock prerequisite

- Calculate/approve acquire prepaid before tenant at the outer close transaction
  boundary, before actor/source reads. Direct authoritative input loading follows
  the same order; existing tenant-only non-loading actions/reads remain unchanged.
- New regression tests verify exact outer-boundary and direct-loader order. Real
  PostgreSQL barriers observe each action waiting for prepaid while the holding
  writer acquires tenant NOWAIT; nested re-entry completes and probe rollback
  preserves revision/audit counts. Existing stale approval/frozen checks still pass.
- Selected close API 293/293, zero failures/skips, all four isolated DB suites run;
  API typecheck/lint/build pass. Logs `/tmp/cp005-lock-*`. No web checks or application
  DB/schema changes. Disposable PostgreSQL stopped, synthetic fixtures retained.
- Monthly prepaid integration is NOT accepted. Next wire independent month
  inventories and frozen value-sale evidence with no-fresh-cash and stale-approval
  checks. Lifecycle, performance and mounted application/browser acceptance remain.

## Previous checkpoint — private value-credit sale allocation

- Added internal non-activating `loadPayrollValueSaleAllocation`: takes prepaid
  then tenant locks, authenticates manager/owner, inventories all receipt lines,
  payments, redemptions, sources, collections and refund/outstanding activity.
  Independently matches every spend to complete holding history and source evidence.
- Exact external allocations replay cumulative GST and original cash sellers.
  Ordinary bases/splits/units and frozen checkout economics must match. FOC uses
  immutable original list price. Cash resolver sees only external payments, never
  credit tenders as new money. No inferred allocation or assumed zero ordinary base.
- Expanded real checkout acceptance verifies mixed service/product/FOC ordinary
  bases 64.2200/27.5200/492.0000, 91.7400 external net cash and 41.6667 credit-spend
  ratio; second receipt reconciles two holdings with 45.8700 external net. Reload,
  catalogue edit and role/outlet/tenant checks pass. Fourteen read-only corruptions
  cover receipt balance, redemption/source/collection inventories, orphan sources,
  ordinary bases/duplicate staff, GST, sellers, tenders, foreign tenant, refund,
  instalments and frozen economics. Restoration and unavailable full-credit paid
  lines still refuse. No legacy earnings or close/audit writes occur.
- Selected API 377 passed, zero failures, one opt-in CP-004 SQL lifecycle suite
  skipped; four CP-005 isolated DB suites ran. Shared 302/302; API types/lint/build,
  formatting/whitespace pass. Logs `/tmp/cp005-value-sale-*`; no web checks this slice.
- Monthly prepaid gate remains closed. Next integrate month inventory and frozen
  evidence/no-cash reconciliation; first fix outer close lock order to prepaid
  BEFORE tenant lock. Transfers/sharing/refund/void loading, plan-switch/performance,
  mounting and full HTTP/browser acceptance remain. CP-005 is IN PROGRESS, not DONE.

## Previous checkpoint — private value-credit holding history

- Internal `loadPayrollValueSpendHistory` reads complete tenant-scoped operational
  purchase/collection/payment/redemption/balance/source/rate inventories under the
  same prepaid-then-tenant lock order as writers. Private untransferred credit only;
  legacy OPENING, sharing, transfers, refunds and restorations fail closed.
- Spend verifier recomputes cumulative paid/credit ratio and performer split/units,
  matches operational identity/timestamps and frozen purchase, and independently
  replays STORED_CREDIT_SPEND rates. Independent balance chain must start at GRANT,
  consume every operational spend exactly once and reach current remaining credit.
- Real checkout acceptance covers purchase, three spends (83.3333 + 83.3334 +
  83.3333 = 250.0000), stable reloads, later catalogue edits, missing and corrupted
  ledgers/captures/collections/redemptions/tenders/rates, orphan usage, role/outlet/
  tenant refusal and void-restoration refusal. No close/audit records are created;
  default monthly prepaid loading still refuses. Holding readiness is not proof
  of sale-wide ordinary/prepaid allocation or no-double-base reconciliation.
- Selected API: 377 passed, zero failures, one opt-in CP-004 SQL lifecycle suite
  skipped; four CP-005 isolated database suites ran. Shared 302/302; API types,
  lint/build pass. Logs `/tmp/cp005-value-*`. No web checks in this continuation.
- Next: authoritative sale-level allocation and monthly no-cash reconciliation;
  transfer/sharing and refund/void history; plan-switch/performance and application
  mounting/full browser acceptance. CP-005 remains IN PROGRESS and non-activating.

## Previous checkpoint — owner carry authorization and repair

- Added owner-only controls in the unmounted close screen for explicit opening
  inventory, component mapping/write-off and exact fallback debt write-off. All
  authorizations require evidence reference, reason and explicit review confirmation;
  edits/conflicts reset confirmation and reload authoritative revisions. Opening
  inventory is never auto-filled with assumed zero balances. Settlement replacement
  semantics and no-cash/non-activation behavior are disclosed.
- Fixed the owner read contract so missing opening and stale settlements can be
  repaired: complete staff inventory (including departed), opening eligibility,
  independent authorization revisions, exact balance hashes and stale flags. Only
  repair reads bypass settlement resolution; default calculation and approval still
  refuse unresolved evidence. Audit inconsistency continues to throw.
- Selected API 306/306 (three isolated PostgreSQL suites, zero skips), then expanded
  carry suite 1/1 with real HTTP/auth/DB persistence. Covers manager/outlet refusal,
  missing-opening inventory, changed-balance repair, stale revision, injected actor,
  server-owned approval identity and retry conflict. Selected web 40/40, shared
  302/302; API/web typecheck/lint/build pass. Logs `/tmp/cp005-carry-*`.
- CP-005 remains IN PROGRESS. Prepaid-credit spending/refund/void loading,
  app mounting and full browser/reconciliation/plan-switch/performance acceptance
  remain outstanding. No application DB/schema changes or earnings activation.

## Previous checkpoint — restored sessions, partial FOC and close groundwork

- Original grant/ordinal/quantity/ownership replay now includes restoration and redraw.
  Verified VOID snapshots link the latest attribution, exact source reversal and a
  historical manager/owner request audit (reason, revision, identity and request hash).
  Legacy-unbound evidence refuses; no backfill. Writer stamps audit time explicitly
  because PostgreSQL transaction-start time can precede restoration.
- Isolated real writer verifies a void after three corrections, idempotent retry,
  restored quantity, exact latest 5/5 reversal, zero collection and stable monthly
  reload. Five read-only audit corruptions preserve draft/audit. Approved September,
  October and February calculations remain unchanged. Restored ordinal one is redrawn
  in April at original 10.0000 value alongside a distinct 492.0000 uncovered FOC unit.
- Partial package FOC now independently matches checkout covered quantity to verified
  cross-holding coverage, applying list price only to uncovered units. Full coverage
  cannot create an ordinary FOC source. Tests reject changed price/identity/coverage.
- Close router groundwork includes manager reads/calculation/adjustments, owner approval,
  payout and carry authorization, and own frozen-statement reads. The management screen
  handles explicit months, stale revision reload, adjustments, frozen status and separate
  payout. **Neither is mounted into the application.** Opening/settlement UI is absent.
- Fresh selected API **306/306**, zero skips, including all three isolated PostgreSQL
  suites and seven real HTTP/auth tests with mocked persistence; shared **302/302**;
  selected payroll web **40/40**. API/web typecheck, lint and build pass. Logs and exit
  markers `/tmp/cp005-complete-*`. These are focused regressions, not full-workspace,
  browser or performance acceptance. No new migration or application database access.
  Disposable PostgreSQL stopped cleanly after checks; synthetic fixtures retained.
- Remaining: authoritative prepaid-credit spending/refund/void loading; opening/
  settlement UI and application mounting; live HTTP/browser permissions and workflows,
  remaining transactional/reconciliation/plan-switch/performance checks. Existing
  unsupported refund/sale-void gates remain. CP-005 is **IN PROGRESS, not DONE**.

## Previous checkpoint — monthly correction reconciliation

- Complete operational correction inventory and full verified holding chains now
  reconcile monthly revision-key operations, exact preceding-source reversals and
  independent no-cash evidence. Non-correction reversals and missing evidence refuse.
- Real writer: two same-month corrections, idempotent retry and stable DB reload;
  original 10.0000 reverses exactly and replacement splits move 4/6 then 2.5/7.5.
  A third following-month correction reverses only 2.5/7.5 and replaces with 5/5.
  Both months have zero collections; sessions/original purchase economics unchanged.
- Missing reversal, request, prior snapshot, altered base, omitted monthly replacement
  and omitted operational inventory refuse through stored-close calculation. Saved
  draft/audit unchanged; approved September/October/February calculations unchanged.
  January carry is an explicit synthetic boundary because prior fixture sales there
  are intentionally invalid; February/March inputs use the authoritative loader.
- Selected API **277/277**, three isolated DB suites, zero skips; shared **302/302**;
  API build/typecheck/lint pass. Logs `/tmp/cp005-monthly-*`. Existing isolated DB only;
  no application DB/schema changes, deployment, activation or browser walkthrough.
- CP-005 remains IN PROGRESS. Next: session-void restoration, prepaid-credit lifecycle,
  partial package FOC and close API/UI/full acceptance. CP-003A/CP-006 untouched.

## Previous checkpoint — redemption correction-chain holding history

- Complete holding snapshots/replacement sources/exact preceding-source reversals
  now reconcile contiguous revisions, request hash, actor/reason, previous snapshot,
  original ordinals/coverage/value and historical rate selection. New writer retains
  request ordering; legacy corrections without request evidence refuse, no backfill.
- Actual correction writer and persisted reload verify two corrections and retry:
  original 10.0000 session base splits 4/6 then 2.5/7.5 without consuming/restoring
  sessions. Four read-only corruptions refuse; approved September/October unchanged.
  Unit tests include 17 invalid chains and independent loader inventory checks.
- Selected API **276/276**, three isolated DB suites, zero skips; shared **302/302**;
  API typecheck/build/lint pass. Logs `/tmp/cp005-correction-*`. No application DB
  access/schema changes or browser walkthrough. Existing isolated CP-005 DB only.
- This does NOT enable monthly corrections: the monthly gate still refuses and
  writes no close. Next: correction operational inventory/no-cash monthly integration,
  session void restoration, credit lifecycle, partial FOC, close API/UI/full acceptance.
  CP-005 remains IN PROGRESS; CP-003A/CP-006 untouched.

## Previous checkpoint — manager-override reconciliation

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

**November 1 resume note.** The previous `/tmp` data directory was gone after a host
restart, so a fresh PostgreSQL 18 cluster was initialized at the path recorded in
`/tmp/cp005-disposable-cluster.path`, the role and database recreated
(`cp005_test` / `payroll_close_test`, loopback 55485) and the repository migrations
applied with `prisma migrate deploy`. `initdb` inherited the host zone
(`Asia/Yangon`), which made database-defaulted `now()` timestamps disagree with the
application's UTC `new Date()` by 6.5 hours and broke timestamp-ordering loaders;
`ALTER DATABASE payroll_close_test SET timezone TO 'UTC'` and
`ALTER ROLE cp005_test SET timezone TO 'UTC'` fixed it, and every command in this
checkpoint ran with `DOTENV_CONFIG_PATH=/dev/null` plus an explicit test URL.

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

October 31 source-correction slice: real session-attribution reverse/repost now
records occurrence separately from posting, skips approved months, reconciles
close revision/hash evidence and posts no new cash. Guarded acceptance includes
concurrent idempotent retries, stale-draft refusal, recalculation/approval, deferred
future posting, competing approval and invalid-performer rollback, retaining both
original and subsequently approved hashes. Expanded regression: 487 pass / 0 fail /
9 gated skips. This is partial M2 evidence, not acceptance of every correction
family. Follow-up deterministic session cases now cover both approval-first and
correction-first lock orderings: real PostgreSQL blocking is observed before the
first writer is released; stale approval leaves no approval audit or draft
mutation; both cases persist the exact next-month reverse/repost and preserve
prior approved hashes. Other correction/lifecycle combinations and M1 remain open.
Follow-up guarded regression: **489 passed, 0 failed, 9 gated skips** (498 total);
API typecheck/build, targeted lint/format and whitespace checks pass. Evidence:
`/tmp/cp005-ordered-regression.log` and companion quality-check logs/exit markers.

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
