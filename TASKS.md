# Glampro Suite — tasks

Use TODO / IN PROGRESS / BLOCKED / DONE. Do not infer completion from old tests,
start archived tasks automatically, or treat code completion as operational approval.

## Commission and payroll

[Authoritative checklist](docs/commission_payroll/TASKS.md) ·
[Feature index](docs/commission_payroll/README.md)

Milestone status and remaining operational gates are maintained only in the
feature checklist above. Local acceptance is not production or payout authorization.

## Other recorded follow-ups

- **DONE locally — Payroll navigation:** move management commission progress out
  of Team & commissions into Payroll alongside Monthly close. Preserve legacy
  bookmarks, same-month links, lazy loading, draft mounting and access guards.
  No earning policy or payroll state transitions changed.

- **DONE locally — commission progress clarity:** distinguish uncalculated,
  estimated and frozen results; connect progress and Payroll close by month;
  refresh progress caches after close actions. Database-backed end-to-end
  verification remains blocked by missing separate `TEST_DATABASE_URL`; real-month
  reconciliation and activation retain the feature checklist's operational gates.

- **DONE — focused pay-plan workflow:** compact list, stepped editor, action-local
  audit confirmation, separate assignment/policy/history/impact/tools views. Remove
  disconnected fields and duplicate staff payroll forms without deleting stored
  values. Preserve financial rules, permissions and activation boundaries.

- **DONE — pay-plan security guidance:** identify the owner two-factor requirement
  with a dedicated API code, link to account security, provide a verified return
  action, and reload plans when the refreshed account enables verification.

- **DONE — account-security enrollment feedback:** open email verification setup
  immediately, show sending/sent feedback, allow retry/resend, and ignore late
  send responses after cancellation. Verification stays off until confirmation.

- **DONE — staff commission configuration:** individual default rates now live in
  Staff → Commissions, with exceptions/history secondary. Settings opens Company
  rules and retains a read-only rate overview with explicit bulk editing. Existing
  audited publishers, permissions and financial policy remain unchanged.

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

- **DONE — cart item visibility correction:** remove fixed-height sale/cart
  squeezing and nested item scrolling; grow rows/editors naturally with page
  scrolling and compact the header/payment footer. Sale regression tests and
  headless Chrome component layout checks passed; full authenticated sale-page
  acceptance remains to be checked on the actual till screen. Supersedes the
  bounded desktop layout recorded below.

- **DONE — catalogue-first sale UX (A + B):** wider responsive catalogue with
  added quantities and sticky desktop browsing controls; compact cart with
  one-row editing and visible staff summaries/warnings. Financial behavior and
  server-bounded catalogue search remain unchanged. Authenticated viewport
  acceptance remains to be checked on the actual till screen.

- **DONE — focused sale workspace:** prioritize customer/cart/payment in a
  bounded desktop layout; move holdings and personal progress into drawers;
  preserve visible allocation summaries and existing financial behavior.
  Sale regression tests and web quality checks pass; authenticated viewport
  acceptance remains to be checked on the actual till screen.

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
