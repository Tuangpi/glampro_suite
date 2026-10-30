# Commission & Payroll

## Approved prepaid refund settlement extension — October 30, 2026

Owner approved a prospective manager-confirmed actual payout/cancellation workflow,
with a new append-only tenant-scoped settlement journal and migration applied only
to a newly created disposable database. The operation records actual external
payout reference and exact net/GST/debt cancellation; it never sends funds. No
application database migration/repair, provider payments, legacy evidence backfill
or earnings activation authorized. Monthly refund loading still requires complete
independent reconciliation and persisted calculate/approve acceptance. Legacy
helper captures without settlement stay unavailable to authoritative cash loading.

Latest M1 increment (October 30, 2026): prospective mixed cash/credit ordinary
checkout freezes complete funding inventory, allowing independently reconciled
zero external bases for fully credit-funded lines without legacy inference.
Credit is never new cash. Existing lifecycle eligibility blocks remain unchanged.
Helper/source-base and four full September monthly/pure approval-state in-memory
variants pass, including prior-month purchase/current-month spend. Repository tests
plus persisted approval and real-writer DB/browser acceptance remain
deferred. CP-005-M1 IN PROGRESS; M2 untouched.

## Authority and priority

Approved October 27, 2026. This is the active, first-priority feature project.
The user delegated open policy decisions to the agent's recommendations. Resolve
discrepancies explicitly in [DECISIONS.md](DECISIONS.md), not by silently following
current behavior or the supplied reference implementation.

Source precedence:

1. Explicit user instructions and recorded approved decisions.
2. Supplied SRS v1.2 and developer instructions, reconciled by DECISIONS.md.
3. Supplied demos for intended user workflows.
4. Supplied reference source and tests as implementation guidance.
5. Current commission behavior where compatible.

The former staff-commission tracker is [archived](../archive/staff-commission/README.md).
It is not a requirement source. Its SC tasks are not dependencies or acceptance
evidence for this project. Existing application work may be reused after inspection.
New requirements outrank incompatible old commission policy, not authentication,
tenant isolation, exact-money handling, historical integrity, or transaction safety.

## Delivery cadence — October 30, 2026

Full upfront money-funded ordinary refunds now support free-of-charge service lines
alongside paid service/products. Frozen checkout list-price economics independently
verify original FOC bases/units and exact reversals; free lines carry zero cash and
paid lines retain complete original collection attribution. This supersedes blanket
FOC refund gates below, not prepaid/instalment funding restrictions or zero-total
refund eligibility. M1 acceptance and new repository tests remain deferred.

Previously shared unused credit purchase NO_MOVEMENT voids now reconcile independent
consent and complete owner family-membership history, requiring private ownership
again before removal. Membership evidence is frozen for stale-approval detection.
Active sharing, expired credit, used/transferred purchases and later-payment funding
stay gated. This broadens verified history only; writer eligibility is unchanged.
M1 remains open; new repository tests and real-writer DB/browser acceptance are deferred.

Unused/untransferred credit purchase NO_MOVEMENT voids now reconcile independent
GRANT/EXPIRY_CHANGE histories before exact REMOVAL. Final expiry must match the
preserved holding and remain valid at void time; no expiry edit creates cash or
changes purchase economics. Expired credit, used/transferred purchases and later
payments stay gated. This broadens journal history only, not writer eligibility or
M1 acceptance. Real-writer acceptance and new repository tests remain deferred.

Expired unused/untransferred session purchase NO_MOVEMENT voids now load only with
an exact independently valued expiry bucket-transfer pair between grant and void.
Original expiry, complete session ordinals/values, actors, chronology and final
expired/voided state reconcile; no cash is created. Upfront funding/policy and
payroll reversal checks remain. This supersedes unexpired-only session limitations
below, not expired credit gates, writer restrictions or M1 acceptance requirements.

Partial upfront external funding is now supported for the same unused/untransferred/
unexpired NO_MOVEMENT purchase-void path. Checkout paid/total/status must match
surviving tenders and exact collection allocations; captured package minimum deposit
and all original/reversal inventories still verify. No later-payment reconstruction:
OUTSTANDING_PAYMENT collections remain gated and writer restrictions are unchanged.
This supersedes full-upfront-only limitations below, not M1 acceptance gates.

Mixed ordinary service/product/FOC plus purchase NO_MOVEMENT voids now use shared
historical ordinary economics and independent package journals, complete upfront
cash collections and exact reversals. Both source inventories reconcile without
using commission performers as cash sellers. Same/cross-month monthly in-memory
smoke passes, including fixed/excluded package policies; real-writer acceptance and
other M1 lifecycle gaps remain open. Supersedes the purchase-only limitation below.

Narrow purchase-only, unused/untransferred/unexpired, full upfront NO_MOVEMENT voids
now load monthly only after independent credit GRANT/REMOVAL or session valuation
purchase/GRANT/PURCHASE_VOID reconciliation, complete tender/collection capture and
exact reversal verification. Cash remains in collection month. No deleted-holding
or VOID-status fallback. Broader purchase histories and real-writer acceptance remain
open; CP-005-M1 stays IN PROGRESS. Prior checkpoint below is superseded for this path.

Prospective confirmed purchase voids now preserve pre-deletion package/value holding
snapshots with a hash bound to transactional cash confirmation. Snapshot verification
is implemented, but independent journal/collection/reversal reconciliation and monthly
purchase-void loading remain unfinished. No historical backfill or eligibility fallback.

Ordinary service/product-only voids now load with explicit manager NO_MOVEMENT
confirmation, independent operational hashes and exact original/reversal evidence.
They retain collection-month cash without creating void-month cash. Prepaid/mixed/
purchase and returned-money voids remain gated; real-writer acceptance is deferred.

Ordinary full upfront money-funded refunds now load through monthly reconciliation
with complete payout, collection, line and reversal evidence. Cash follows verified
collection sellers independently of original service-performer commission shares,
preserving each collection allocation's split residual. FOC, prepaid and
instalment-funded refunds remain gated.
New-path transactional acceptance remains deferred; M1 is still IN PROGRESS.

Explicit expiry journal replay is implemented through holding loading, using
historical expiry for spends/restorations and retaining strict operational ordering.
No expiry-edit writer/UI or inferred history. Expiry-specific coverage and real-writer
acceptance remain deferred; this does not complete M1.

User-approved implementation-first pass: defer writing new tests until the connected
workflow is implemented. Use typecheck, lint and focused existing regressions for
feedback; consolidate broader checks at delivery boundaries. Record deferred test
coverage explicitly. This changes development order, not reconciliation, acceptance,
activation or release requirements; preserve existing tests and financial safeguards.

Execute CP-005 by the five milestone boundaries in [TASKS.md](TASKS.md), not by
individual helpers or test additions. Resume M1 authoritative lifecycle loading;
monthly private-credit integration and private transfers are completed slices,
not completion of M1. The user authorized continuous execution on October 30, 2026:
continue through related code, integration and acceptance work, then automatically
start the next unblocked milestone or task in this queue without routine permission
or per-slice handoffs. Use recommended defaults for routine decisions and make
focused, reviewed commits when appropriate. Stop only when the authorized queue is
complete, a genuine blocker needs user input, an action needs additional approval,
the user asks to stop, or a session limit requires a saved handoff. Record partial
results honestly. This authorization does not permit pushing or deployment.

Keep safety gates unchanged: independent evidence, exact money, fail-closed
unsupported paths, frozen approvals and no unauthorized activation/deployment.
Fail-closed coverage is necessary but does not complete a required operational path.
Use focused feedback while building and consolidated regression at delivery gates.
Read the short Current State and active milestone first; consult older history and
requirements only as needed. Do not reread the full checkpoint history each session.

## Sources

- `Glampro_SRS_Commission_Plans_v1.2_1.docx`: primary SRS, dated October 27, 2026.
- `Glampro_Commission_Developer_Instructions.docx`: integration guidance and defaults.
- `Glampro_Commission_Demo_2.html`: supplied standalone workflow reference.
- `glampro-commission-module_2/glampro-commission/`: reference engine, services,
  screens, tests, demo and bundled SRS. The bundled SRS is byte-identical to the
  top-level SRS at initialization.

Keep delivered sources unchanged. See [REQUIREMENTS.md](REQUIREMENTS.md) for
coverage and acceptance mapping. Source claims of passing tests are not local runs.

## Goal and scope

Replace manual commission calculation with versioned staff plans, monthly pooled
bases, explainable statements, controlled approval, and specified payroll exports.
Integrate into the existing application, not a parallel demo application.

Scope includes all SRS must-haves: base capture and attribution; package deposits,
balance collection, paid-session gates and package overrides; plans, versions,
stages and incentives; calculator, comparison and impact preview; month-end
calculation, carry-forward, corrections, refunds, payroll profiles and adjustments;
frozen approval, Excel workbooks, payslip PDFs, reporting and audit permissions.
Track should-haves explicitly: value-package bases, MTD/POS progress, staff
self-service and package-value reporting. Gift-card base capture is could-have and
excluded from seed plans; do not silently commission gift-card sales or spends.

Out of scope: statutory payroll (CPF, IR8A, GIRO), leave management beyond manual
deductions, online-booking prepayment commission, multi-currency, tips/gratuities.
Existing unrelated features remain intact. No production migration, activation,
backfill, deployment, commit, or push is authorized by management initialization.

## Architecture and integration constraints

- Existing workspace: React/TypeScript web, Express/TypeScript API, shared Zod
  contracts, Prisma/PostgreSQL. Follow installed versions and existing conventions;
  do not import the demo's workspace/dependency setup wholesale.
- Adapt the pure calculation engine into the existing shared package. Add plan
  persistence and monthly result snapshots through the existing tenant architecture.
- Current commission rules, EmployeeCommission, period primitives, collection
  evidence, attribution and package valuation are reusable candidates, not proof
  of completed CP requirements. Inspect their release gates and actual integrations.
- Operational users, receipts, payments, holdings and redemptions stay authoritative.
  Do not create independently mutable staff or holding mirrors.
- Rate-free commission base evidence is distinct from payable earnings. A source
  must not produce both legacy earnings and plan earnings. Define cutover and
  reconciliation before enabling the new path.
- Money remains exact decimal strings; commission bases use four decimals and
  component results two decimals, half-up. Preserve exact-cent purchase valuation
  separately from commission unit precision; reconcile residuals explicitly.
- All source writes, attribution, commission evidence and audit effects share the
  source database transaction with idempotency and consistent lock ordering.
- Use authenticated tenant/outlet context and module/role guards, never demo headers.
  Salon SUPER_ADMIN is not a platform administrator authorization shortcut.
- Calendar months use salon timezone, default Asia/Singapore, represented as
  half-open timestamp ranges. Approval freezes all statement inputs and outputs;
  actual payout is separate. New activity invalidates stale drafts before approval.
- CP-005 internal monthly private-credit support now reconciles settled service/
  product/FOC receipts against independent month inventories and full holding/sale
  evidence, with external-only cash and frozen purchase-ratio spend bases. This is
  not earnings activation: unsupported lifecycle, legacy full-credit paid lines lacking
  funding evidence and mixed session-package workflows refuse; close UI/router stay unmounted.
- Private credit ownership transfers replay independent balance and transfer audits
  to verify spend-time ownership without repricing purchases or creating fresh cash.
  Explicit family sharing now replays balance consent and independent membership
  history, resolving consuming customers without replacing holding ownership.
  Current membership is only a final-state check, not historical authorization.
  Prospective credit voids now require explicit operational NO_MOVEMENT confirmation
  and exact restoration/reversal evidence through sale/month loading. New full-credit
  ordinary checkout freezes funding evidence before accepting zero external bases.
  These new paths need transactional acceptance; refunds, other voids and remaining
  unsupported M1 lifecycle stay gated. No deployment or earnings activation.

## Delivery and completion

Approved scope split (October 28, 2026): CP-003 configuration may be accepted
independently of historical monetary preview only after its configuration and
safety checks pass. Historical readiness remains unavailable/null without complete
evidence; sample-input calculators are not historical payout estimates. CP-003A
retains authoritative monetary integration and full-run equality after CP-004
capture and CP-005 frozen statements/carry. It remains required before CP-007
release acceptance. This does not authorize earnings activation or production writes.

Use [TASKS.md](TASKS.md) and [PROGRESS.md](PROGRESS.md). One selected task per
session; stop after its implementation, verification, and handoff. No feature is
DONE solely because a demo, document, or prior tracker says it exists.

Go-live requires SRS must-haves, TC-01–TC-25, tenant/role isolation, transactional
rollback/retry/race coverage, exact reconciliation, frozen approvals and target
performance evidence. Calculation: 50 staff/month under 10 seconds; MTD estimate
under 500 ms in a documented test environment. Production readiness is separate.
