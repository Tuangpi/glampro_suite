# Commission & Payroll

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
