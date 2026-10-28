# Historical preview evidence contract

CP-003 investigation checkpoint — October 27, 2026; scope split approved October
28, 2026. This contract now gates CP-003A, not configuration-only CP-003 acceptance.
It defines minimum evidence before integration, not an implemented persistence
format or approval to begin CP-004. Historical readiness remains `UNAVAILABLE` with
`impact: null`. No authoritative complete monetary-input source is established.

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
- Cover disabled/departed staff, outlet-scoped membership, fractional fixed units,
  refunds, negative balances, plan/component changes and exact-money boundaries.
- Each missing evidence family and incomplete/contradictory coverage fails closed;
  explicit authoritative zero inputs are tested separately from missing inputs.
- Revision/context/permission changes and request failures cannot display a stale
  monetary result. Browser authorization acceptance is a separate remaining gate.

Until an authoritative source satisfies this contract, historical monetary
calculation and full-run equality remain unavailable. Under the October 28, 2026
approval, CP-003 configuration is reviewed separately; CP-003A follows CP-004 source
capture and CP-005 frozen statements/carry and remains required before CP-007 release
acceptance. No historical backfill, CP-004 implementation or earnings activation is
authorized by this document.
