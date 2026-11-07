# November 6, 2026 — attribution and reporting continuation

## November 7 delivery status (supersedes the historical limitations below)

- N4 follows the approved read-only approach: current/scheduled company package
  percentage rules, dates and reasons; link to the existing audited Company rules
  publisher. No second write path or new package percentage mode.
- `POST /api/payroll-close/cart-preview` uses server catalogue/member prices,
  checkout discount rounding, GST, FOC, package policy, current effective rules and
  stored plan/category/outlet context. Ordinary staff receive only their own rows.
  Package purchases without an attached customer do not request an estimate.
  Query cache identity includes authenticated user and role.
- `POST /api/payroll-close/redemption-preview` accepts customer-owned `holdingId`,
  `customerId`, session `quantity` and explicit performer `shares`. It reads original
  purchase economics, residual-bearing next ordinals, paid-session funding and the
  monthly plan; fixed awards count sessions. No current service price or caller-owned
  base/rate enters the calculation. Legacy/unpaid/expired/refunded evidence is
  unavailable. Staff rows are SELF-only. Nothing is reserved, posted or activated.
  The package tender shows this estimate for explicit performers and positive
  coverage; a repeated tender on the same holding is unavailable rather than
  double-previewing the same next ordinals.
- Commission detail supports inclusive ranges up to 24 months. Every month must
  be approved; even one missing month is named and disables export. XLSX contains
  the entire filtered range. Frozen bases remain distinct from pooled awards.
- Existing recursive source resolution follows reversals to collection/refund/
  redemption-correction roots with cycle/missing-reference/tenant guards. No receipt
  neighbour is used to invent package/customer attribution.
- Own-session reads scan 250 redemptions at a time in a repeatable-read transaction,
  validate the latest evidence and retain only the requested 25-row SELF page.
  Unit coverage crosses 601 records; real DB acceptance crosses 501 same-date rows.
- The five §12 reports are present within their documented scope. Utilisation still
  means operational packs/redeemed sessions/current expired-unused sessions, not
  net sales or an expiry-movement ledger.
- **CP-008 is complete locally (November 7)** after the supported N6/N7 matrix and
  appointment-therapist default/preservation path passed. See `CP008_ACCEPTANCE.md`.
  Explicit booking load preserves each service's assigned therapist, refuses an
  occupied draft and never substitutes the cashier. Covered package tenders inherit
  only an unambiguous split. Chrome verifies hold/reload/cash completion and real
  package-redemption evidence with no approved-payroll or versioned earnings change.
  The cart preview remains hypothetical money-paid; credit-funded awards and
  incentives are not fabricated. CP-007 release gates remain separate.

Executed totals and local cleanup are recorded in the November 7 progress entry.
Earlier November 6 implementation/verification notes below remain historical evidence.

## Implemented boundaries

- New cart lines default **sellers only** from the current unexpired POS identity,
  otherwise the authenticated operator. Server eligibility validation remains authoritative.
  Quantity changes preserve edited/cleared attribution. Resumed drafts are unchanged.
- Named seller/performer split chips reuse the existing editor and its validation.
- `POST /api/payroll-close/till-preview` is management-only and non-posting. It runs
  before/after calculations on the stored monthly plan, not a rule-rate multiplication.
  The request is hypothetical fully money-paid activity. The UI refuses GST/package/credit
  estimates; category/outlet/fallback or missing snapshot evidence yields unavailable.
  It does not imply earnings activation, include incentives, or account for other cart lines.
- Customer holding sessions expose **Customer signed** from redemption evidence: recorded,
  known not recorded, or unavailable on an older response. No clinical consent signature
  is substituted; void/correction actions retain their original gates.
- `GET /api/payroll-close/commission-detail[.xlsx]` filters one approved monthly snapshot
  by staff, type, dates, customer and package. Spreadsheet strings are formula-neutralised.
  Export uses all matching rows, not the current page. No salary or per-line pooled award.
- My earnings reuses the existing SELF progress read, adds base/units by type, and reads
  `/api/payroll-close/my-sessions?period=YYYY-MM&page=1`. Session attribution is resolved
  server-side from the latest snapshot; no caller-supplied staff identity is accepted.
  My earnings explicitly opts into session history even with its compact progress layout;
  the compact till card does not fetch it. A salon-scoped progress response cannot mount it.
- `/api/reports/package-utilisation` is a company-wide management snapshot: completed-sale
  packs (including subsequently refunded sales), non-reverted redeemed sessions, current
  expired-unused holding sessions. These are different units, not a conservation equation.

## Remaining acceptance / limitations

- Full source-aware line estimates (GST, FOC, package/credit funding, fixed awards,
  category/outlet resolution, missing month snapshots and ordinary staff access).
- Cross-month detail and complete recursive reversal/refund source lineage. A missing
  customer/package reference is unavailable, never inferred from another line on a receipt.
- Utilisation is current operational history, not net sold packs or an expiry-movement
  ledger; deleted/legacy holdings may leave evidence gaps.
- My recorded sessions covers package redemptions with explicit evidence, not all clinical
  attendance or legacy sessions. Large-month reads currently resolve evidence before paging.
- No new schema migration, deployment, earnings activation, or production data mutation.

## November 6 acceptance continuation

- Real PostgreSQL and mounted HTTP acceptance now covers missing/draft/approved months,
  customer/package/staff/type/date filters, full filtered XLSX despite page selection,
  SELF-only sessions including voids, utilisation units, disabled privileges after token
  issue, tenant isolation and company-wide restrictions. Reporting reads leave close/audit,
  source, session and earnings inventories unchanged; no cutover or valuation activation.
- Existing calculated months now return the same explicit unavailable detail state as
  absent months. Draft XLSX remains a conflict, never an apparently approved empty export.
- Real Chrome acceptance covers the Reports → Customer balances panels, filtered frozen
  bases and XLSX bytes, My earnings session visibility, and the customer package drawer's
  Recorded / Not recorded signature column including voids. The older customer-history
  navigation now opens the actual Packages tab rather than waiting on the Overview tab.
- Fixtures use real completed purchase/collection writers and authoritative close approval.
  Session rows/snapshots are explicitly synthetic historical read evidence, installed only
  after close calculation, not end-to-end redemption/correction writer acceptance. The
  original loader correctly rejected those incomplete synthetic inputs when installed
  before calculation; no production verification guard was changed to accommodate them.
- Local-only PostgreSQL cluster: loopback port 55485, `payroll_close_test`, temporary
  `/tmp/cp005-ui-reporting-*` data directory, existing migrations applied without seed.
  Exact executed suite totals and quality results are recorded in PROGRESS.md.

### Repeat the local acceptance checks

Use a newly initialized disposable PostgreSQL cluster satisfying the existing
`payrollCloseFixture` checks: host `127.0.0.1`, port `55485`, database
`payroll_close_test`, UTC server timezone and data directory under `/tmp/cp005-*`.
Apply existing migrations only to that cluster. Set `DATABASE_URL` explicitly;
do not reuse a development or production connection. Set `NODE_ENV=test` and a
disposable `JWT_SECRET` before running these commands from the API workspace:

```sh
RUN_CP008_REPORTING_ACCEPTANCE=true node --import tsx --test src/routes/payroll-reporting.acceptance.test.ts
CORS_ORIGINS=http://127.0.0.1:55175 RUN_CP006_BROWSER_ACCEPTANCE=true node --import tsx --test src/services/payroll-reports-browser.acceptance.test.ts
```

Chrome defaults to `/usr/bin/google-chrome` (`CP003_CHROME` can override it).
Browser acceptance starts its own API and Vite at port 55175; run separately
from other browser acceptance jobs. Stop the temporary database after testing.
Without their opt-in flags these acceptance suites skip, so a green default
suite alone does not establish real-DB/browser acceptance.

## PayrollPlans investigation

Default parallelism reproduced slow exact-curve editor tests, including 5-second timeouts
and a pagination assertion racing a refetch. Submitted-value tests now use a single change
event where keystrokes are not the behaviour under test; readiness assertions wait for enabled
controls. Timeouts and global worker settings are unchanged. This is not yet a claim that
default-parallel execution is stable; record final executed results in PROGRESS.md.
