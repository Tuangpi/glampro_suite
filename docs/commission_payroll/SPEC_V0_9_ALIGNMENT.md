# Spec v0.9 alignment review

## Review basis

November 6, 2026. This review compares the delivered commission/payroll
implementation with the client specification
[Glampro_Package_Commission_Spec_v0_9.docx](../Glampro_Package_Commission_Spec_v0_9.docx).
It is a **reading review of the code and the shared engine tests**, not an
acceptance run.

Inspected: `packages/shared/src/commission-payroll/*` and
`packages/shared/src/schemas/commission.ts`; the API close surface
(`payroll-close-*.ts`, `commission-ledger.ts`, `redemption-commission-posting.ts`,
`redemption-commission-evidence.ts`, `lib/commission-collection.ts`,
`commission-attribution-policy.ts`, `sale.service.ts` sale-completion and
attribution paths); `apps/api/prisma/schema.prisma` commission/payroll/payable
models; the web surface (`PayrollWorkspace`, `PayrollClose`, `PayrollReport`,
`CommissionMatrix`, `PackageFormDrawer`, `CommissionAttributionEditor`,
`SaleCollectionsPanel`, `PackagePayrollDetail`).

Citations use the specification's own numbering (sections 1–9, policy fields in
§8, screen elements N1–N14 in §9) because the source is a `.docx` with no line
numbers. Code citations are `path:line` and were re-read before writing.

Executed for this review:

```
cd packages/shared && node --import tsx --test "src/commission-payroll/*.test.ts"
→ tests 94 · suites 6 · pass 94 · fail 0
```

**Not claimed by this review:** the DB-backed `apps/api` close suites were not
run; `Sale.tsx`, `PaymentDialog` and `CartLine` were not read end to end, so the
N6–N8 verdicts rest on `CommissionAttributionEditor`, the server-side validation
in `sale.service.ts` and the POS acceptance tests. No screen was opened in a
browser. This document does not accept the module for release and does not
enable earnings.

## Verdict

**The money is aligned; the configuration and part of the UI are not.**

Everything the specification says the salon must be paid — the hybrid model
(package-sale commission to the seller plus redemption commission to the
performer, at a different rate per staff × type), the salary-sheet arithmetic,
the `(take-home + FWL levy) ÷ collection` ratio with its alert threshold, the
GST-exclusive collected basis, rate provenance frozen at sale, refund clawback,
the minimum package deposit and the block on redeeming unpaid sessions — is
implemented and pinned by tests.

What is missing is configurability: of the twelve `salon_commission_policy`
fields in §8, **none is stored as a policy switch of its own** — one is honoured
by a different setting, six are hard-coded to a single behaviour, two are
partially supported, one follows the spec's recommended option but cannot be
switched, and two do not exist at all. One commission kind
(`GC_SALE`) is declared with no producer, rule publication is percentage-only
(§8 `calc_method`), ten of the fourteen screen items are partial or absent, and
three of the five §12 reports do not exist.

One structural divergence is deliberate and documented below (§6, decision 1):
the specification's "one ledger line per commission event" exists as an
immutable, tested foundation but is not the reporting source; authoritative
payroll is derived at month-end close from verified source evidence.

## 1. Where the implementation matches the spec

- **Hybrid model (§2.3): a package-sale rate to the seller and a separate
  redemption rate to the performer, per staff × type.** Redemption
  (`PKG_RED`), service (`SVC`), product (`PRD`), package sale (`PKG_SALE`),
  `FOC` and value-package sale/spend (`VP_SALE`, `VP_SPEND`) are all first-class
  commission types — `packages/shared/src/commission-payroll/contracts.ts:18-27`.
  Rates are per-staff plan components over those types
  (`contracts.ts:47-61`), edited in a staff × type grid
  (`apps/web/src/components/settings/CommissionMatrix.tsx:123`), with the
  inherited default shown per cell (`CommissionMatrix.tsx:179`). This is the
  Alvin 8 %-sale/7 %-redemption versus Stella 7 %/10 % requirement.
- **Salary-sheet lines (§2.1–2.2).** Basic salary, fixed overtime, FWL levy and
  the payroll/sales alert percentage are effective-dated staff profile fields —
  `packages/shared/src/commission-payroll/settings.ts:53-58`. Unpaid leave,
  overtime, additions, deductions and commission adjustments are typed payroll
  adjustments with a mandatory reason — `statement.ts:9-21` — assembled into
  take-home at `statement.ts:52-65`.
- **Payroll/Sales ratio (§2.3).** Exactly the sheet's formula,
  `(takeHome + levy) ÷ collection × 100`, null when collection is zero, plus the
  above-threshold flag — `statement.ts:67-70` and `:87-88`, compared with
  `profile.salesAlertPct` (`settings.ts:57`). Emitted in the Excel workbook and
  payslip PDF (`apps/api/src/services/payroll-export-xlsx.ts:90,190-192`,
  `payroll-export-pdf.ts`).
- **Collection is real external cash, GST-exclusive, never a redemption or FOC
  base.** Resolved in `apps/api/src/services/payroll-close-cash.ts:43`; package
  collections are allocated to the sale line before completion
  (`sale.service.ts:2476-2479`). Asserted by
  `payroll-close-cash.test.ts:58` and `payroll-close-loader.test.ts:1399,1558`
  ("collection net cannot be fabricated by moving GST into cash").
- **Redemption commission is paid on session value, not on the service list
  price of the day.** Session value is computed at sale
  (`sale.service.ts:2466-2470`, `packagePurchaseValue`) and snapshotted on the
  holding (`sale.service.ts:2500`, `payrollPurchaseSnapshot`), then re-verified
  from evidence at close (`payroll-close-package-redemption.ts`).
- **Rate provenance is frozen at sale; a later rate change cannot rewrite
  history.** Snapshot capture at `sale.service.ts:2500`, verification at
  `apps/api/src/services/payroll-close-rate-provenance.ts:33`, and approved
  months are copied, never recalculated (`PayrollReport.tsx:68-71`).
- **Refund clawback (§5).** Prorated clawback units
  (`apps/api/src/lib/commission-collection.ts:129`), fixed-sale clawback in the
  prepaid settlement (`payroll-close-prepaid-settlement.ts:235`), refund and
  void loaders wired into the close (`payroll-close-loader.ts:37-39`), a
  configurable refund admin fee (`settings.ts:67`) and clawback buckets in the
  cutover inventory (`payroll-cutover-inventory.ts:41-42`).
- **Refusal to pay on missing evidence (§5).** The close fails closed rather
  than inferring: `payroll-close-loader.ts:57-59` (`unavailable()`), with
  dedicated verifiers for FOC economics (`:33`), package tender (`:35`), sale
  coverage (`:34`) and rate provenance (`:32`).
- **Minimum deposit (N9).** Enforced at completion with the documented error
  code `PACKAGE_MINIMUM_DEPOSIT` — `sale.service.ts:2475-2489` — and re-checked
  at close (`payroll-close-loader.ts:1133`,
  `payroll-close-redemption-loader.ts:312-317`).
- **Unpaid sessions cannot be redeemed by default (§13 d, the recommended
  option).** `drawPayrollPackageSessions` blocks the redemption once
  `used + quantity > paid`, with error code `PACKAGE_UNPAID_SESSIONS`, and only a
  manager PIN plus a reason and an audit entry can override it —
  `apps/api/src/services/payroll-package-session.ts:66-115`. `paid` is derived
  from confirmed collection allocations by `paidPayrollPackageSessions`
  (`packages/shared/src/commission-payroll/package-payment.ts:24`), and the
  remaining paid sessions are shown to the cashier and on the holding detail
  (`PaymentDialog.tsx:510`, `PackagePayrollDetail.tsx:96`).
- **Instalments and later collection (N9).** The balance due is carried and
  collected through the "Later payments" panel with per-line allocation and a
  confirmation checkbox — `apps/web/src/components/sale/SaleCollectionsPanel.tsx:188-191,272-314`.
- **Session usage log with corrective actions (N10).** Session value, balance
  due, base amount, voided state, "Performed by", "Void session" and "Correct
  session staff" — `apps/web/src/components/customers/PackagePayrollDetail.tsx:92,99,147,149,168,210`.
- **Approve-and-lock lifecycle with frozen artefacts (N11/N12).** Status and
  revision (`PayrollClose.tsx:147-150`), owner-only salary/take-home columns
  (`PayrollClose.tsx:156-165`), frozen period report with per-staff breakdown
  and source drill-down (`PayrollReport.tsx:94-107`), Excel, PDF and filtered
  CSV exports on approval.

## 2. Where it does not match the spec

### a) The commission ledger is not the source of truth (§5)

The specification's central architectural claim is one ledger line per commission
event, with every report a sum of that ledger. The foundation exists:
`EmployeeCommission` carries `ledgerVersion = 1`, `eventKey` and `eventHash`
(`apps/api/prisma/schema.prisma:1545-1557`), `postCommission` is idempotent
and hash-pinned (`apps/api/src/services/commission-ledger.ts:49-60`),
and redemption posting is implemented and tested
(`redemption-commission-posting.ts:113,233,271`, used by
`redemption-commission-evidence.ts:437-438,482`).

But that primitive is not the reporting path, and its own header says so:
_"No public route or POS integration is enabled by this foundation"_
(`commission-ledger.ts:46-48`). Sale completion still writes the legacy
percentage rows (`sale.service.ts:2236`), and authoritative money is produced by
the month-end close: the redemption, refund, void and purchase-void loaders read
the rules and rebuild each line from verified evidence, and
`payroll-close-rate-provenance.ts:33` compares those rules with the snapshot
taken at sale so that drift is reported rather than repriced. Behaviour is
equivalent and arguably better evidenced, but it is **not** what §5 describes.

### b) `salon_commission_policy`: six hard-coded behaviours, five absent or partial

See §3 for the field-by-field matrix. In short: one field is enforced through a
different setting (and its own toggle is dead), six behaviours are hard-coded,
two are partially supported, one follows the spec's recommended option without
being switchable, and two fields do not exist.

### c) `requireAttribution` is a toggle that does nothing

`payrollSettings.requireAttribution` exists (`settings.ts:68`), defaults to true
(`settings.ts:79`) and is rendered in Settings
(`PayrollSettingsForms.tsx:351`), but **no production code reads it**: the only
match for `requireAttribution` anywhere in `apps/api/src` is a test fixture
(`payroll-preview-browser.acceptance.test.ts:751`). The real enforcement is a
different mechanism, `CommissionAttributionPolicy`
(`sale.service.ts:57,1433-1440`). A salon can therefore change a switch that has
no effect, which is a live audit risk even though the underlying requirement
(§5 "require staff on commissionable lines") _is_ enforced.

### d) Gift-card commission is declared but cannot be paid

`GC_SALE` is a valid payroll commission type (`contracts.ts:26`) but has no
producer anywhere in `apps/api` — the only match for `GC_SALE` in `apps/api/src`
and `packages/shared/src` is that enum member. The rule kind list has no
gift-card member either (`packages/shared/src/schemas/commission.ts:3-11`). Gift
cards themselves exist (`schema.prisma:952`, `:2392`), so a plan can promise a
type that never accrues. §9.7/N14 asks for "Gift card sale" as a selectable item
type.

### e) Fixed dollar amounts cannot be published on a rule (§8 `calc_method`)

The staff × type grid publishes percentages only:
`publishCommissionRuleSchema` accepts `rate: 0–100` and nothing else
(`schemas/commission.ts:34`), and `CommissionRule` has no calc-method or
fixed-amount column (`schema.prisma:1781-1799`). Fixed currency is expressible
**only inside a payroll plan component**, as `FLAT` or `FIXED_PER_UNIT` with
`fixedAmount` (`contracts.ts:28-34`, `:57`, validated at `:75`) — those are
period and per-unit amounts, not the per-event `FIXED_AMOUNT` rate §8 describes.
N4's third option, a **Fixed $** amount, does exist on the package drawer for
both the sale and the redemption side (`PackageFormDrawer.tsx:413-452`); it is
the staff × type grid that offers percentages only.

### f) Screen items N4–N14 that are partial or absent

- **N4** — the package drawer covers both sides: `Follow plan | Exclude | Fixed
amount` for the package **sale** (`PackageFormDrawer.tsx:413-432`) and for
  **redemption** (`:433-452`), plus a reason and a minimum deposit %
  (`:453-466`). Missing against the spec: the **Override %** option, and an
  **effective-from** date — there is a reason but no effective date, and the
  panel states that explicit settings apply to new purchases only (`:408-412`).
- **N5** — no session-value or commission preview while editing a package. The
  value is only computed and stored at sale (`sale.service.ts:2466-2470`) and
  displayed afterwards (`PackagePayrollDetail.tsx:92`).
- **N6/N7** — attribution is a staff select plus a percentage row, labelled
  "Sellers" / "Performing therapists"
  (`CommissionAttributionEditor.tsx:38,64`), validated to total 100 % and gated
  by policy (`sale.service.ts:1433-1454`). Not staff chips, no default to the
  till operator, and no estimated commission shown.
- **N8** — no "customer's active packages" panel; redemptions are chosen inside
  the payment dialog, and there is no "Redeem 1" action or earliest-expiry
  ordering surfaced to the cashier.
- **N10** — the session log has no "customer signed" column
  (`PackagePayrollDetail.tsx`), although the schema can store a signature image
  (`schema.prisma:1356-1357`).
- **N11** — the payroll tables show commission, incentive, collection and
  take-home but **no per-type columns** (Service, Pkg sale, Pkg redemption,
  Product, FOC, VP, Adjustments) and **no Payroll/Sales % column**
  (`PayrollClose.tsx:156-165`, `PayrollReport.tsx:94-107`). The ratio is already
  in the close view payload (`payroll-close-view.test.ts`) and in both exports;
  only the on-screen column and its red alert state are missing.
- **N14** — the item-type list covers package sale, package redemption, value
  package sale/spend and FOC, but uses `STORED_CREDIT_*` naming for value
  packages and has no gift-card entry (§d above).

### g) Three of the five §12 reports do not exist

- **Commission detail (ledger) with filters and Excel export** — missing as a
  report. The closest surfaces are approved-month drill-down
  (`PayrollReport.tsx:106`) and the filtered CSV export produced at approval,
  neither of which is a query over all commission lines by staff, type, date,
  package or customer.
- **My commission** (staff self-service: month-to-date by type plus sessions
  performed) — missing; there is no match for "My commission" anywhere in
  `apps/web/src` or `apps/api/src`.
- **Package utilisation** (sold vs redeemed vs expired per package) — missing;
  remainder and expiry appear per holding (`PackageValuationPanel.tsx:114-119`)
  but not as a per-package comparison.
- **Package liability** — present as
  `PackageValuationPanel.tsx:34-145`, mounted in `Reports.tsx:467`, covering
  outstanding sessions × session value and unpaid purchases. It disclaims being
  a statutory deferred-revenue figure (`:145`), which matches the spec's
  "unearned revenue and future redemption commission exposure" framing.

## 3. `salon_commission_policy` field matrix (§8)

Twelve fields are specified. The shipped settings object is
`payrollSettingsSchema` (`packages/shared/src/commission-payroll/settings.ts:63-69`),
plus per-package overrides in `payrollPackageSettingsSchema`
(`package-settings.ts:10-22`).

| Spec field                                                  | Status                                                                       | Where the behaviour actually lives                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pkg_sale_basis` (collected \| full price at sale)          | **Hard-coded = collected** — the spec's _recommended_ option (Q13 a)         | `payroll-close-cash.ts:43`; completion requires the minimum deposit to be collected (`sale.service.ts:2476-2489`) and every later payment to be allocated to the sale line, so commission accrues on money actually received. The alternative, full package value at sale (the current Excel practice), is not selectable                                             |
| `redemption_basis` (session value \| list price \| fixed $) | **Partial**                                                                  | Session value by default (`sale.service.ts:2466-2470`); fixed amount per session per package (`PackageFormDrawer.tsx:433-452`, `package-settings.ts:5-8`); no list-price option                                                                                                                                                                                       |
| `vp_spend_basis` (ratio \| credit value)                    | **Hard-coded = ratio**                                                       | Value-spend allocation (`payroll-close-loader.ts:36`, `payroll-close-value-loader.ts`)                                                                                                                                                                                                                                                                                |
| `foc_basis` (% of list \| fixed $ \| none)                  | **Hard-coded = list price**                                                  | `packages/shared/src/commission-payroll/source-economics.ts:3`; `payroll-close-foc.ts`                                                                                                                                                                                                                                                                                |
| `clawback_mode` (prorated \| full within N days \| none)    | **Partial — prorated only**                                                  | `lib/commission-collection.ts:129`, `payroll-close-prepaid-settlement.ts:235`; no N-day window, no "none"                                                                                                                                                                                                                                                             |
| `clawback_days`                                             | **Missing**                                                                  | Not in the schema                                                                                                                                                                                                                                                                                                                                                     |
| `rounding`                                                  | **Hard-coded = half-up to 2 dp**                                             | Ledger primitive groups then rounds (`commission-ledger.ts:20-26`); statement components formatted to 2 dp (`statement.ts:52-54`). No rounding-mode switch                                                                                                                                                                                                            |
| `deduct_gst`                                                | **Hard-coded = yes**                                                         | GST-exclusive throughout (`payroll-close-loader.test.ts:1399,1558`)                                                                                                                                                                                                                                                                                                   |
| `deduct_discount`                                           | **Hard-coded = yes**                                                         | Voucher discount netted at `sale.service.ts:2466-2470`                                                                                                                                                                                                                                                                                                                |
| `period_start_day`                                          | **Missing**                                                                  | Period key is a calendar month, `^[1-9]\\d{3}-(0[1-9]\|1[0-2])$` (`contracts.ts:16`)                                                                                                                                                                                                                                                                                  |
| `require_staff_on_lines`                                    | **Enforced, but by a different setting**                                     | `CommissionAttributionPolicy` (`sale.service.ts:57,1433-1440`); `payrollSettings.requireAttribution` is stored and unread (`settings.ts:68`)                                                                                                                                                                                                                          |
| `allow_redeem_before_paid`                                  | **Implemented as the spec's _recommended_ option (a), but not configurable** | Redemption is blocked once `used + quantity > paid`, raising `PACKAGE_UNPAID_SESSIONS`; paid sessions come from `paidPayrollPackageSessions` over confirmed collections (`apps/api/src/services/payroll-package-session.ts:66-78`). A manager PIN with a reason and an audit record can override (`:79-115`). Options (b) "always" and (c) "never" are not selectable |

Three consequences worth stating plainly:

- The salon cannot turn GST, discount netting or the collected basis off, and
  should not want to without a decision on record: those three define the
  invariants the close verifies (`payroll-close-loader.test.ts:1399,1558`).
  Adding them as switches weakens what "the figures reconcile" currently
  guarantees.
- `period_start_day` and `clawback_days` are the only fields with no
  implementation at all; `period_start_day` is the one with a real operational
  effect (a salon closing on the 26th cannot be served today).
- `allow_redeem_before_paid` is stronger than the spec in one direction and
  weaker in another: unpaid redemption is blocked as recommended, but a manager
  can override it per redemption, which the spec does not describe and which the
  auditor should see as a documented exception, not a policy.

## 4. Screen-by-screen (§9, N1–N14)

Status key: **Match** = implemented as described; **Partial** = implemented with
named elements missing; **Missing** = not implemented.

| #   | Spec element                                                                                                                                 | Status                                 | Evidence and gaps                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Commission matrix grid: staff rows × type columns, empty cell = inherit, copy rates, Excel export, changed cells highlighted until published | **Partial**                            | Grid and per-cell inherited default `Default: x% · source` (`CommissionMatrix.tsx:123,179`). Missing: a "Company default" row inside the grid (defaults live in the rules tab), copy-rates, Excel export, and changed-cell highlighting                                               |
| N2  | Publish block: effective-from + required reason + "Publish N changes" + publication history                                                  | **Match**                              | `CommissionMatrix.tsx:56,193,217`; `bulkPublishCommissionRulesSchema` capped at 100 edited cells (`:83`); effective-dated rules with reason (`schemas/commission.ts:28-38`)                                                                                                           |
| N3  | Package commission policy tab (all twelve fields)                                                                                            | **Missing** as a twelve-field tab      | No such tab; the shipped payroll settings form covers five settings only — `joinAfterDay`, `negativeBase`, `minimumDepositPct`, `refundAdminFee`, `requireAttribution` (`settings.ts:63-69`, `PayrollSettingsForms.tsx`). The twelve fields themselves are handled as described in §3 |
| N4  | Package › Commission: staff rates \| override % \| fixed $, redemption rate, effective-from + reason                                         | **Partial**                            | Sale and redemption each offer `Follow plan \| Exclude \| Fixed amount` with a reason, plus a minimum deposit % (`PackageFormDrawer.tsx:402-470`). Missing: the **Override %** option and an **effective-from** date                                                                  |
| N5  | Read-only session-value / commission preview when editing a package                                                                          | **Missing**                            | No session-value computation in `PackageFormDrawer`; value is only produced at sale (`sale.service.ts:2466-2470`)                                                                                                                                                                     |
| N6  | "Sold by" staff chips with split %, default = staff on till, estimated commission                                                            | **Partial**                            | Sellers rows with percentages, 100 % validation, policy gate (`CommissionAttributionEditor.tsx:38,64`; `sale.service.ts:1433-1439`). No chips, no till default, no estimate                                                                                                           |
| N7  | "Performed by" with assistant split and session value × rate display                                                                         | **Partial**                            | "Performing therapists" rows, service-only restriction (`sale.service.ts:1454`). No commission preview                                                                                                                                                                                |
| N8  | Customer's active packages panel, "Redeem 1", earliest expiry first                                                                          | **Partial**                            | Redemption is chosen in the payment flow with qty-left and paid amount; no dedicated panel, no "Redeem 1" affordance, expiry ordering not surfaced                                                                                                                                    |
| N9  | Pay now ≥ minimum deposit %, balance due stored, later collection                                                                            | **Match**                              | `sale.service.ts:2475-2489` (`PACKAGE_MINIMUM_DEPOSIT`); balance due + "Later payments" with allocation (`SaleCollectionsPanel.tsx:188-191,272-314`)                                                                                                                                  |
| N10 | Session usage log: header totals, per-session rows, "Correct staff", "Void session", customer signature                                      | **Partial**                            | Header and rows with base amount/voided state (`PackagePayrollDetail.tsx:92,99,147`), "Void session" (`:168`), "Correct session staff" (`:210`). No "customer signed" column                                                                                                          |
| N11 | Commission & payroll tab: status, per-type columns, take-home, collection, Payroll/Sales % red above alert, exports, approve & lock          | **Partial**                            | Status/revision/approval/payout (`PayrollClose.tsx:147-150`), commission/incentive/collection, owner-only salary and take-home (`:156-165`); exports and approve/lock exist. Missing on screen: per-type columns and the Payroll/Sales % column with its red state                    |
| N12 | Staff statement replicating the salary sheet with drill-down                                                                                 | **Match**                              | `statement.ts:52-89`, `PayrollStatementLines.tsx`, source drill-down (`PayrollReport.tsx:106`). Salary and take-home are owner-only by design (`PayrollReport.tsx:10-12`)                                                                                                             |
| N13 | Payroll profile: basic, fixed OT, FWL levy, commission template, alert %                                                                     | **Match** (template = plan assignment) | `settings.ts:53-58`; plan assignment instead of copy-rates (`settings.ts:33-43`)                                                                                                                                                                                                      |
| N14 | Item-type list: package sale, package redemption, value package sale/spend, FOC, gift card sale                                              | **Partial**                            | All but gift card exist in the payroll contract (`contracts.ts:18-27`); `GC_SALE` has no producer; value packages are named `STORED_CREDIT_*` (`schemas/commission.ts:9-10`)                                                                                                          |

### §12 reports

| Report                                                                                                          | Status      | Evidence                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| Commission & payroll per period (per staff totals by type, take-home, collection, Payroll/Sales %, Excel & PDF) | **Partial** | Exports complete; per-type and Payroll/Sales % columns absent on screen (N11)     |
| Commission detail (ledger) with filters and Excel                                                               | **Missing** | No filterable commission-line report; drill-down only (`PayrollReport.tsx:106`)   |
| Package liability (outstanding sessions × session value)                                                        | **Match**   | `PackageValuationPanel.tsx:34-145`, `Reports.tsx:467`                             |
| My commission (staff self-service)                                                                              | **Missing** | No match for "My commission" in web or API                                        |
| Package utilisation (sold / redeemed / expired)                                                                 | **Missing** | Remainder and expiry shown per holding only (`PackageValuationPanel.tsx:114-119`) |

## 5. Effort and sequencing

Estimates are order-of-magnitude and include test work. The real cost driver is
that the close engine is invariant-heavy and pinned by **35
`payroll-close-*.test.ts` files** plus the gated acceptance suites; any change to
how a base or the collection is defined has to be re-proven across them.

| Item                                                                    | Difficulty                                           | Driver                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (c) dead `requireAttribution` toggle                                    | **Low — under a day**                                | Settings revision + form removal, or wire it into the existing attribution check                                                                                                                                                                                                                                                                                 |
| (d) gift-card commission                                                | **Low — 1–3 days**                                   | Gift-card tables already exist (`schema.prisma:952,2392`); needs a source loader and a rule kind, or removal of `GC_SALE` (an hour)                                                                                                                                                                                                                              |
| (f) screen items                                                        | **Low–medium — 1–2 weeks**                           | Mostly `apps/web`. The Payroll/Sales % is already in the close view payload and both exports, so the N11 column is frontend-only. N6/N7 chips, N8 panel and the session-value preview are real UI work                                                                                                                                                           |
| (g) §12 reports (commission detail, my commission, package utilisation) | **Low–medium — about a week and a half**             | The close already stores every line with its source, so the ledger-detail report is a query plus filters and an Excel sheet; "My commission" is a staff-scoped read of the same data; utilisation needs expiry-aware per-package aggregation                                                                                                                     |
| (e) fixed-amount rules                                                  | **Medium — about a week to a week and a half**       | A calc-method column plus amount on `CommissionRule` (`schema.prisma:1781-1799`), then every reader: `payroll-close-loader.ts:153`, `payroll-close-purchase-void-loader.ts:76`, `payroll-close-redemption-loader.ts:123`, `payroll-close-sale-refund-loader.ts:92`, `payroll-close-sale-void-loader.ts:116`, the provenance verifier, and the grid/API contracts |
| (b) policy fields                                                       | **High — 2–3 weeks, unevenly**                       | Cheap: `foc_basis`, `clawback_days`, `redemption_basis`, `rounding`, and `allow_redeem_before_paid` as a switch over the gate that already exists. Expensive: **`period_start_day`** (period key, locking, carry, snapshots, exports) and **`deduct_gst` / `deduct_discount` / full-price sale basis**, which change the definitions the verifiers reconcile     |
| (a) ledger as source of truth                                           | **Highest — 3–5 weeks, ongoing reconciliation risk** | POS posting for every event plus reports off the ledger, permanently reconciled against the close                                                                                                                                                                                                                                                                |

Recommended order: (c) and (d), then (f) and (g), then the cheap half of (b),
then (e). Roughly two to three weeks buys "every spec screen and report present,
every policy field either configurable or explicitly recorded as fixed"; literal
full alignment is closer to seven to nine weeks.

Do not silently adopt `deduct_gst = off`, `deduct_discount = off` or a
full-price sale basis. Each removes a reconciliation invariant that
`payroll-close-loader.test.ts:1399,1558` currently enforces, and that is a
business decision for the client, not an implementation detail.

## 6. Deliberate divergences to record as decisions

1. **Ledger foundation versus close-derived authority.** The specification makes
   the ledger the single source of truth; this build keeps `EmployeeCommission`
   v1 immutable and tested but derives authoritative payroll at close from
   verified source evidence. The outcome for the salon is the same and the
   evidence checks are stronger, but the architecture is not the one described.
   This belongs in `DECISIONS.md` and in `ARCHITECTURE.md` so it stops being
   re-reported as a defect.
2. **Collected, GST-exclusive, discount-netted bases.** These are fixed by
   design, not accidental omissions of `salon_commission_policy`. Recording them
   as invariants makes any future switch a conscious decision with a cost.
3. **Naming.** The specification's "Value package" is `STORED_CREDIT_SALE` /
   `STORED_CREDIT_SPEND` in rules and `VP_SALE` / `VP_SPEND` in payroll. Both
   meanings are identical; only labels differ, and a label mismatch will keep
   costing review time until one naming is chosen for the UI.

Beyond the specification, and worth keeping: tiered plan components
(`TIER_WHOLE`, `TIER_SLICE`, `TIER_MIXED`), effective-dated rule versions with a
mandatory reason, and the fail-closed evidence verifiers. None of these is asked
for in v0.9; all of them are the reason the figures can be defended, so they
should not be simplified away while closing the gaps above.

## 7. Questions for the client — answered November 6, 2026

These are the tick-boxes in the specification's §13, answered with what the build
currently does. Each one changes money or scope, so none was assumed.

**All thirteen were answered on November 6, 2026** and are recorded as agreed policy in
[REQUIREMENTS.md](REQUIREMENTS.md) §13. The short form is below; two answers carry a
caveat rather than a clean decision (Q4 needs the auditor, Q2 was not put).

What the answers change for planning: **four CP-008 items close by decision instead of
by code** — (a) ledger-as-source-of-truth (Q12), (b) `salon_commission_policy` fields
(Q3, Q4, Q8, and the fields that already matched), (d)'s gift-card build-half (Q9) and
(e) fixed-dollar grid rates (Q10). Only (f2) and (g) remain as work, and **nothing in
this section blocks either**.

1. **Package sale basis** (§13 a). Current: amount collected, including deposits
   and instalments — the spec's recommended option. **Answered: collected.** The
   alternative (full value at sale, current Excel practice) is not adopted, so the
   collected-base invariants in [DECISIONS.md](DECISIONS.md) stand unchanged.
2. **Redemption base** (§13 b). Current: session value (net ÷ sessions), with a
   per-package fixed dollar override. The service-list-price option is not
   available. **Open** — this one was not put to the client; take the current
   behaviour as standing until it is asked.
3. **Clawback on refund** (§13 c). Current: prorated on the refunded amount plus
   the `refundAdminFee` setting. **Answered: prorated, no window.** "Full reversal
   within N days" and "none" are not required, so `clawback_days` and a
   `clawback_mode` switch are not built.
4. **Redemption before the package is fully paid** (§13 d). Current: option (a),
   the recommended one — redemption is blocked once the sessions used exceed the
   sessions paid for, with an audited manager-PIN override. **Answered: keep (a)
   and keep the override**, accepted by the business. The override is not a
   specification feature, so it stays documented as a named exception, and the
   **auditor's confirmation is still pending**. Options (b) and (c) are not
   required per salon.
5. **FOC commission** (§13 e). Current: percentage of service list price.
   **Answered: confirmed.** The rate itself is a per-salon setting and is not
   recorded as a fixed number here.
6. **Seller and therapist the same person** (§13 f). Current: both accrue, because
   the sale and the redemption are separate events. **Answered: confirmed.**
7. **Payroll/Sales formula and alert threshold** (§13 g). Formula matches.
   **Answered: formula confirmed**; the threshold is a per-staff
   `salesAlertPct` value the salon sets, so no number is recorded here.
8. **Commission period** (§8 `period_start_day`). **Answered: no salon closes on a
   day other than the calendar month end** (client statement, November 6, 2026).
   This is the answer that removes the most expensive item in the field matrix:
   `period_start_day` is not required, so the period key, month locking and carry
   logic stay as they are.
9. **Gift cards** — should they earn commission, and at sale or redemption?
   **Answered: no gift-card commission.** The build-half described in §d is
   therefore cancelled rather than deferred: no gift-card source loader, no rule
   kind. `GC_SALE` remains declared vocabulary that the close never emits, which
   is why the plan editor stopped offering it.
10. **Fixed-dollar rates in the staff × type grid** (§9.1 N1 "cell = % or $").
    **Answered: percentages only is sufficient.** Fixed dollar stays where it
    already exists (the package drawer), and `publishCommissionRuleSchema` does not
    gain a calc-method.
11. **Tiered commission** (§13 h). Plans already support tiers (`TIER_WHOLE`,
    `TIER_SLICE`, `TIER_MIXED`, `contracts.ts:28-34`), the rules grid does not.
    **Answered: not required now** — the grid stays percentage-based.
12. **Real-time posting versus month-end close.** **Answered: the verified close is
    the authority**; till-time posting is declined. This closes §a: the ledger stays
    an immutable primitive and a reconciliation input, not the reporting path, which
    is what the code already does.
13. **Payroll/Sales % visibility** — managers, or owner-only like salary and
    take-home? **Answered: owner-only**, already shipped that way in CP-008 (f1).

## Appendix — verification log

Executed while writing this review:

| Check                                                                            | Result                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared`: `node --import tsx --test "src/commission-payroll/*.test.ts"` | 94 tests, 6 suites, 94 pass, 0 fail                                                                                                         |
| `grep -rn requireAttribution apps/api/src`                                       | one match, a test fixture at `payroll-preview-browser.acceptance.test.ts:751`; **no production reader**                                     |
| `grep -rn GC_SALE apps/api/src packages/shared/src`                              | one match, the contract enum (`contracts.ts:26`); no producer                                                                               |
| `grep -rln 'payrollSalesPct' apps/api/src apps/web/src packages/shared/src`      | statement, its test, close-view test, matrix acceptance test, xlsx and pdf exports — **no web component renders it**                        |
| `grep -rln -i 'my commission\|myCommission' apps/web/src apps/api/src`           | no matches (§12 "My commission" absent)                                                                                                     |
| `grep -rln -i 'liability\|unearned' apps/web/src`                                | `PackageValuationPanel.tsx`, `Reports.tsx` — liability panel present                                                                        |
| `grep -rln -i 'utilisation\|utilization' apps/web/src apps/api/src`              | no web matches; API hits are unrelated (`assistant-explanation`, `quiet-day`)                                                               |
| `sed -n '28,36p' contracts.ts`                                                   | `FLAT`, `TIER_WHOLE`, `TIER_SLICE`, `TIER_MIXED`, `FIXED_PER_UNIT` — no `FIXED_AMOUNT`                                                      |
| `grep -rn 'paidPayrollPackageSessions'`                                          | gate at `payroll-package-session.ts:72-78` (`PACKAGE_UNPAID_SESSIONS`); reused by the close (`payroll-close-package-redemption.ts:689,750`) |
| `grep -n 'saleMode' PackageFormDrawer.tsx`                                       | sale-side commission mode exists (`:114,179,413-432`) — both sides of N4 are configurable                                                   |
| `grep -c '^model' schema.prisma`                                                 | 88 models total; 16 of them are commission/payroll models, including `EmployeeCommission` (`:1545`) and `PayrollSourceEvent` (`:2537`)      |
| `ls apps/api/src/services \| grep -c 'payroll-close.*test.ts'`                   | 35 close test files                                                                                                                         |

Not run, and therefore not covered by any claim above: the DB-backed `apps/api`
close and acceptance suites, the mounted-browser POS flows, and any check that
the Excel/PDF artefacts open correctly in a spreadsheet or PDF reader.

## Where follow-up work belongs

This review is deliberately read-only. When the client answers §7:

- the two decisions that change architecture or invariants go to `DECISIONS.md`;
- the concrete fixes (a)–(g) become `TODO` items in `TASKS.md` in the existing
  `[ ]` style, each with its evidence line from this document;
- `REQUIREMENTS.md` gains the confirmed §13 answers, so the next review can be
  checked against agreed policy rather than a spreadsheet snapshot.

Until then, no claim in this document should be read as acceptance of the module
for live earnings, and the N11 columns, the §12 reports and the `GC_SALE`
producer should not be described to the client as delivered.
