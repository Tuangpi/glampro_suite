# Historical preview evidence contract

CP-003 investigation checkpoint — October 27, 2026; scope split approved October
28, 2026. This contract gates CP-003A, not configuration-only CP-003 acceptance.
The authoritative adapter and impact preview described under "Implemented
integration (November 3, 2026)" now exist; CP-003A remains IN PROGRESS because the
evidence families and browser acceptance below are not fully accepted.

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

Still open for CP-003A: the contradictory/missing-evidence matrix beyond the current
refusals, refunds/reversal and fractional fixed-unit money cases, explicit
authoritative-zero versus missing-input coverage, outlet-scoped preview semantics,
and authenticated browser acceptance of the monetary states.

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
  **Status: partially covered** — a plan change (version 2 draft) and the
  frozen-close reload are asserted; disabled/departed staff, refunds, fractional
  fixed units, negative balances and outlet-scoped preview are not.
- Each missing evidence family and incomplete/contradictory coverage fails closed;
  explicit authoritative zero inputs are tested separately from missing inputs.
  **Status: partially covered** — each current loader refusal becomes a visible
  blocker with `UNAVAILABLE`/`impact: null`; the full family matrix and explicit
  authoritative-zero case remain open.
- Revision/context/permission changes and request failures cannot display a stale
  monetary result. Browser authorization acceptance is a separate remaining gate.
  **Status: revision and permission covered** by the CP-003 acceptance/browser
  tests; stale-money and monetary browser acceptance remain open.

Money is therefore available only for a month whose complete authoritative inputs
and configuration evidence load without a gap. Missing or contradictory evidence
still returns `UNAVAILABLE`/`null`; the preview does not backfill history. Under the
October 28, 2026 approval, CP-003 configuration is reviewed separately; CP-003A
builds on CP-004 source capture and CP-005 frozen statements/carry and remains
required before CP-007 release acceptance. No historical backfill, CP-004
implementation or earnings activation is authorized by this document.
