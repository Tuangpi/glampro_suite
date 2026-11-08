# Commission and payroll

## Current position

Start with the [current checklist](TASKS.md) for milestone status and remaining
operational gates. Local acceptance does **not** authorize production migration,
deployment, earnings activation, or payouts. For a specific change, read the
relevant requirements, accepted decision, and code/tests.

## Main references

| Document                                      | Use it for                                                      |
| --------------------------------------------- | --------------------------------------------------------------- |
| [Requirements](REQUIREMENTS.md)               | Normalized feature requirements                                 |
| [Decisions](DECISIONS.md)                     | Accepted policy and scope resolutions                           |
| [Current checklist](TASKS.md)                 | Milestone status and remaining operational gates                |
| [Spec v0.9 alignment](SPEC_V0_9_ALIGNMENT.md) | Specification-to-implementation mapping                         |
| [Cutover runbook](CUTOVER_RUNBOOK.md)         | Operator review, reconciliation, activation, and rollback gates |

## Acceptance evidence

- Configuration: [configuration acceptance](acceptance/CONFIGURATION_ACCEPTANCE.md).
- Monthly close: [lifecycle evidence](acceptance/CLOSE_ACCEPTANCE.md) and
  [application close acceptance](acceptance/APPLICATION_CLOSE_ACCEPTANCE.md).
- Reporting/UI: [browser acceptance](acceptance/BROWSER_ACCEPTANCE.md),
  [CP-008 acceptance](acceptance/CP008_ACCEPTANCE.md), and [report audit/delivery](acceptance/CP008_REPORT_AUDIT.md).
- Release: [local release acceptance and remaining operational gates](acceptance/RELEASE_ACCEPTANCE.md).

These records describe executed checks and their limitations. Re-run suitable
checks for new changes; do not copy historical pass counts as current evidence.

## Authority and integration

Source precedence: explicit user instructions and approved decisions, supplied SRS
and developer instructions reconciled by [Decisions](DECISIONS.md), supplied workflow
demos, supplied reference source, then compatible existing commission behavior.
Resolve discrepancies explicitly; the archived staff-commission tracker is not a
requirement source.

Follow the [project architecture and safety constraints](../../PROJECT.md).
Operational receipts, payments, holdings and redemptions remain authoritative; do
not create independently mutable mirrors or pay a source through both legacy and
plan earnings. Preserve exact decimal money, source transaction boundaries,
idempotency, tenant/outlet authorization, and immutable approval history. Months
use salon time, default Asia/Singapore; approval freezes inputs and outputs, and
actual payout remains separate.

[Historical preview inputs](HISTORICAL_INPUTS.md) is a maintained evidence contract,
not an archived handoff despite its filename.

## History — not an active queue

- [Original project and policy checkpoints](history/PROJECT.md).
- [Detailed milestone checklists and dated continuations](history/TASKS.md).
- [Executed verification history](history/PROGRESS.md).
- [Earlier UI/reporting continuation](history/UI_REPORTING_CONTINUATION.md).

These records retain stable IDs and detailed evidence. Their dated statuses and
commands may be superseded; use the current checklist and development setup first.

## Supplied references

- [SRS v1.2](reference/Glampro_SRS_Commission_Plans_v1.2_1.docx).
- [Developer instructions](reference/Glampro_Commission_Developer_Instructions.docx).
- [Standalone workflow demo](reference/Glampro_Commission_Demo_2.html).
- [Reference implementation](reference/glampro-commission-module_2/glampro-commission/README.md).

The `reference/` assets are retained unchanged, including their internal layout.
They are not application code or independent acceptance evidence.

Keep detailed financial policy and acceptance records in place. Prefer updating
the existing record and linking to it over adding another overlapping summary.
