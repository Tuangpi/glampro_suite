# Glampro Suite — tasks

Use TODO / IN PROGRESS / BLOCKED / DONE. Do not infer completion from old tests,
start archived tasks automatically, or treat code completion as operational approval.

## Commission and payroll

[Authoritative checklist](docs/commission_payroll/TASKS.md) ·
[Feature index](docs/commission_payroll/README.md)

Milestone status and remaining operational gates are maintained only in the
feature checklist above. Local acceptance is not production or payout authorization.

## Other recorded follow-ups

| Item                                        | Status                   | Next step / source                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OA-07 owner assistant operational readiness | BLOCKED                  | Resolve target/operator, retention/security, provider and recovery evidence in the [readiness guide](docs/assistant/owner-release-readiness.md)                                                                  |
| TK2610-0026 vendor listing application      | BLOCKED                  | Supply company/solution eligibility evidence and submission acknowledgement; [preserved requirements](docs/archive/2026-11-07/TASKS.md#tk2610-0026--p2-05-psg-pre-approved-listing--prepare--submit-application) |
| TK2610-0003 P2 phase                        | IN PROGRESS              | Resolve child evidence gaps and explicit phase sign-off; [preserved checklist](docs/archive/2026-11-07/TASKS.md#tk2610-0003--phase-3--p2-vertical-differentiators--go-to-market)                                 |
| Test-tenant cleanup                         | Requires separate review | Database isolation is fixed; review retained receipt/payroll references before any approved cleanup. Do not reset the application database                                                                       |

These are recorded follow-ups, not newly authorized work. Historical owner
acceptance does not prove provider operations, migrations, or submissions happened.
Do not update external PDFs or tracking systems on the user's behalf.

## Incremental code refactoring

- **DONE — sales catalogue boundary:** extract read-only POS item search from
  `sale.service.ts`, preserve the public export, and share item/module policy with
  checkout. Financial write behavior and transaction boundaries stay unchanged.
- **TODO — assess the next bounded extraction:** `sale.service.ts` remains large;
  review receipt serialization or held-cart responsibilities with their tests.
  Separately assess the large Sale/Products pages and PayrollPlans component.
  These are candidates, not approval for a broad rewrite or financial-policy change.

## Historical backlog

The [full previous task tracker](docs/archive/2026-11-07/TASKS.md) retains every
original TK2610, maintenance, owner-assistant, and completion-check entry. Consult
it for a specific task, not as a second active queue. New bounded work belongs
here or in the existing feature checklist, never in both.
