# Historical preview evidence contract

CP-003 investigation checkpoint — October 27, 2026; scope split approved October
28, 2026. This contract gates CP-003A, not configuration-only CP-003 acceptance.
The authoritative adapter, impact preview and the evidence/money acceptance described
below now exist, so CP-003A is DONE for the local supported scope (November 3, 2026);
release and earnings activation remain separate gates.

## Implemented integration (November 3, 2026)

`payroll-close-loader.ts` loads the month's authoritative, rate-free inputs and
refuses with a 409 naming every gate it could not clear. `payroll-historical-preview.ts`
turns only that refusal into readiness blockers; any other failure surfaces. The
preview then computes money for the same snapshot:

- **Frozen close wins.** When the month already has a verified calculation, the
  preview reuses that stored input snapshot and its `inputHash`. A source reload
  could disagree with an approved statement, so it is never substituted.
- **Live months are hashed, not re-derived.** Without a frozen calculation the
  loader snapshot is hashed with `payrollInputHash`, so `impact.inputHash` is the
  exact hash the next calculation of that month would freeze. A test asserts the
  equality.
- **One calculator.** `@glampro_suite/shared` `commission-payroll/impact.ts` swaps
  only the plan definition over the _same_ authoritative input and reuses the
  statement/scope engine, so a preview row equals the posted statement for that
  staff. Component bases, carry and group metrics are never re-derived or defaulted
  by the preview.
- **Gaps and money never mix.** `readPayrollHistoricalPreview` returns money only
  when inputs, hash, latest version and every configuration/staff blocker are
  absent. Otherwise it returns `status: "UNAVAILABLE"`, `impact: null` and
  `inputSource: null`. Staff resolved to the plan without authoritative activity
  are named separately; no zero statement is invented.
- **Money is exact.** Amounts cross the wire as decimal strings, each row's
  `change` is rounded once from unrounded sums, and salon totals are summed before
  rounding.

## Evidence and money acceptance (November 3, 2026)

`payroll-historical-preview-evidence.acceptance.test.ts`
(`RUN_CP003A_PREVIEW_ACCEPTANCE=true`) closes the family matrix, the explicit-zero
distinction and the money cases; `payroll-preview-money-browser.acceptance.test.ts`
(`RUN_CP003A_BROWSER_ACCEPTANCE=true`) closes authenticated browser acceptance of the
monetary states.

- **Missing versus contradictory, per family.** A month that is `AVAILABLE` is made
  `UNAVAILABLE` by one injected capture, with `impact: null`, `inputSource: null` and
  exactly one blocker: `SOURCE_WORKFLOW_NOT_LOADED` (unknown capture family),
  `PREPAID_SETTLEMENT_MISSING` (refund capture whose settlement is absent) and
  `SOURCE_EVIDENCE_INVALID` (redemption capture whose evidence contradicts itself).
  Configuration blockers stay empty, so the refusal names the money family.
- **Authoritative zero is asserted, never inferred.** Two identical empty months
  differ only in their opening-carry authorization: the authorized month is
  `AVAILABLE` at `0.00`, the other refuses by name
  (`APPROVED_PREVIOUS_CLOSE_OR_PERSISTED_OPENING_REQUIRED`). A zero-rate plan returns
  `AVAILABLE` rows of `0.00` over real collection records and non-zero bases. The
  three states — evidence-backed zero, missing activity inside a complete month, and
  missing evidence — are therefore distinguishable and tested.
- **Money equals posted money.** Fractional units (`0.5000` of a two-dollar unit),
  same-month sale-plus-refund (`0.0000`), prior-month refund (`rawBase -100.0000`,
  `units -1.0000`, `amount 0.00`, carried forward), outlet pooling across two branches
  (`200.0000` base) and disabled/departed staff all deep-equal the posted statement,
  the row total, the salon sum and the close's `inputHash`. A negative balance is
  carried by base or units; the engine never pays negative money, so the preview shows
  the carry rather than a negative total.
- **Stale money is refused.** In authenticated Chrome the rendered `S$40.00` is
  asserted, then a revision change shows `Plan changed. Reload before previewing.`
  with no money left in the panel, permission loss and a blocked request both clear
  it, and a calculated month renders the frozen-close money source at the same posted
  total. Money is salon-wide: an outlet context is refused.

Still open beyond CP-003A, and not claimed here: historical backfill, CP-004
implementation, earnings activation, release acceptance and any performance budget
for the preview.

## Existing evidence and limits

- `apps/api/prisma/schema.prisma`: `CommissionCollection` records source identity,
  collection currency, gross cents and occurrence time. Those fields alone do not
  prove per-staff category/outlet bases, fixed awards or complete period coverage.
- `EmployeeCommission` is rate-bearing earnings evidence. Nullable `basis`,
  `snapshot` and source fields do not establish complete rate-free historical
  inputs. Do not reverse-engineer bases from amounts/rates or reprice paid rows.
- Current sale/catalogue relationships are not proof of source-time category,
  attribution, outlet or award settings. Do not fill missing evidence from them.
- `payroll-preview-inputs.ts` resolves effective assignment/version configuration
  and pre-close staff/salon settings. Assignment replacement audits contain the
  full effective timeline; this is not a frozen historical statement. Missing or
  invalid latest pre-close settings must block, not select an older valid audit
  or substitute current/default settings.
- Shared `commission-payroll/period.ts` accepts lines, carry and group metrics.
  Its optional-input defaults are calculator conveniences, not evidence that
  historical carry or metrics were zero. No persisted authoritative integration
  has been established by this investigation.

## Integration gate

An authorized server-side adapter must prove all of the following for the same
tenant, period, currency, salon timezone and consistent read snapshot:

1. **Complete source coverage:** stable source identifiers and revisions, explicit
   coverage boundaries and reconciliation to the authoritative source population.
   Counts alone, empty arrays and absence of rows do not prove zero activity.
   Late corrections, refunds/reversals and duplicated events must be accounted for
   exactly once with source lineage and the adopted occurrence-period policy.
2. **Rate-free lines:** validated `PayrollBaseLine` inputs with source-time staff
   attribution, outlet/category scope, credited units, mode and fixed-award evidence
   as required by the selected calculation path. Amounts retain exact decimal
   precision. Fallback rules require source-time resolved rate evidence; they are
   not permission to infer plan bases from legacy commission amounts.
3. **Frozen opening balances:** authoritative prior-period component base/unit
   carry and fallback commission debt, with explicit component mappings or audited
   write-offs when needed. An initial zero requires explicit opening-balance
   evidence. Missing prior statements never imply zero carry.
4. **Group metrics:** authoritative period/scope/outlet/rule-key metrics and complete
   contributing population. A metric not applicable to a rule is distinct from a
   missing applicable metric. Do not derive salon cash from commission totals or
   use only currently enabled staff as the historical population.
5. **Configuration identity:** record selected plan/version, assignment audit,
   pre-close settings audits and all input-source revisions. Fail closed on
   missing, invalid, inconsistent, mixed-tenant or mixed-scope evidence. A newer
   invalid settings audit cannot be bypassed by an older valid one.

The readiness endpoint must not accept arbitrary client-provided evidence as
authoritative. A future integration needs runtime validation and provenance checks,
not only TypeScript interfaces. Do not add a speculative storage schema or a
synthetic monetary adapter just to make a preview available.

## Required verification before monetary availability

- Same complete inputs through preview and the full staff-period engine produce
  equal component working lines, incentives, totals, carry and write-offs.
  **Status: verified per staff statement** by the opt-in CP-003A acceptance test
  (preview row `before` deep-equals the posted statement result; totals sum).
- Cover disabled/departed staff, outlet-scoped membership, fractional fixed units,
  refunds, negative balances, plan/component changes and exact-money boundaries.
  **Status: verified** — fractional units (`0.5000`), same-month refund (`0.0000`),
  prior-month refund carried as `-1.0000` units / `-100.0000` base, outlet pooling
  across two branches, a disabled staff member, a plan change (version 2 draft) and
  the frozen-close reload are all asserted against posted statements and totals.
  Departed-staff configuration evidence stays unit-covered by
  `payroll-preview-inputs.test.ts` (assignment timeline and pre-close staff audits).
- Each missing evidence family and incomplete/contradictory coverage fails closed;
  explicit authoritative zero inputs are tested separately from missing inputs.
  **Status: verified** — a payable month becomes `UNAVAILABLE`/`impact: null` with
  exactly one family blocker for an unknown capture family, a refund capture without
  its settlement and contradictory redemption evidence, while an authorized empty
  month is `AVAILABLE` at `0.00` and the identical month without opening evidence is
  refused by name.
- Revision/context/permission changes and request failures cannot display a stale
  monetary result. Browser authorization acceptance is a separate remaining gate.
  **Status: verified** — CP-003 covers revision/permission in the configuration
  suite, and `payroll-preview-money-browser.acceptance.test.ts` proves it for money in
  authenticated Chrome: the rendered total disappears on a revision bump, permission
  loss and a blocked request, and never reappears without a fresh check.

Money is therefore available only for a month whose complete authoritative inputs
and configuration evidence load without a gap. Missing or contradictory evidence
still returns `UNAVAILABLE`/`null`; the preview does not backfill history. Under the
October 28, 2026 approval, CP-003 configuration is reviewed separately; CP-003A
builds on CP-004 source capture and CP-005 frozen statements/carry and remains
required before CP-007 release acceptance. No historical backfill, CP-004
implementation or earnings activation is authorized by this document.
