# Pure Commission & Payroll engine

Public entry: `@glampro_suite/shared` (all new exports use Payroll/payroll names).
No database, clock, network, tenant lookup, activation or writes occur here.

## Calling contract

1. The service must authorize tenant/outlet records and capture immutable source
   evidence in the source transaction. This engine does not grant permissions.
2. Select the month's assignment/version with `resolvePayrollPlan`: last local
   calendar day governs the entire month. Pass salon-local posting dates, not UTC
   timestamp dates. Timestamp boundaries belong to the integration layer.
3. Pass staff-credited base amounts and units, already split, as decimal strings.
   External bases accept up to 12 integer digits and four decimals. Never pass JS
   monetary numbers. Use `allocatePayrollSplit` with existing basis-point shares;
   stable staff-ID ordering assigns residual four-decimal ticks. This does not
   replace operational purchase valuation's integer-cent allocations.
4. `FIXED` lines contain the already-credited award or signed clawback, including
   zero. They bypass every component. `EXCLUDE` lines bypass components. Both
   still count in configured incentive activity metrics; `REVERSED` lines do not.
   `PAID` describes history, not exclusion: the monthly service controls period
   eligibility and must never pay approved history again.
5. For no-plan staff, resolve each eligible line's fallback rate at source time
   using the existing hierarchy. Supply `fallbackRatePct`; missing evidence fails
   closed. Plan runs ignore fallback rates, preventing dual earnings in this engine.
6. Supply authoritative, same-period group metrics by rule, metric kind and scope.
   Salon cash is external net collections, not a sum of split commission bases.
   Outlet rules independently pool individual activity within each outlet.
7. Persist every returned carry balance. Component carry is adjusted four-decimal
   base (or fractional units for fixed-unit components), not commission dollars.
   Removed keys require reasoned mapping/write-off. Key reuse with changed base
   semantics must be reviewed by the service. A negative fallback balance retains
   exact source-rate commission debt at ten decimals (4dp base × 4dp rate / 100),
   avoiding future repricing. Switching such debt to a plan fails closed until
   separately settled. Write-off authorization and audit are service responsibilities.

### Outlet-scoped assignment boundary

Use the resolved assignment's snapshotted `outletIds` (absent on legacy rows means
all outlets). Pass the same scope on `PayrollStaffPeriodInput.plan.outletIds`.
`partitionPayrollOutletLines` separates eligible plan activity from fallback
activity without mutating inputs. Selected outlets form one combined component
pool, not independent tiers/caps per outlet. Scoped plan calculation refuses
unpartitioned out-of-scope activity and missing active-line outlet evidence.

This helper is not payroll orchestration: the service must authorize every input,
resolve source-time fallback evidence, maintain separate carry debt, supply
authoritative incentive metrics and persist a reconciled statement exactly once.
Never silently filter activity or treat a partial pool as a complete statement.
There is no tenant authorization or earnings activation in this pure helper.

## Precision and diagnostics

Bigint rational arithmetic avoids floating point without a new dependency.
Pool source bases, apply base percentage once, round adjusted pool half-up to
four decimals, then add already-adjusted carry. Calculate tiers exactly and round
the component once to two decimals. Sum rounded components for statement totals.
Working rows show rounded diagnostics, so individually rounded tier rows can differ
from the final once-rounded component. Fixed overrides are separate signed awards;
plan fixed-unit negative units carry rather than paying negative unit commission.

`gapToNext` uses the exclusive band's next four-decimal tick, not `+0.01`.
Missing join dates fail for staged plans; un-staged plans use standard rates.
Whole-tier jump warnings currently describe standard rates; stage overrides still
receive strict percentage/key validation. Preview and chart call the same engine.

Hair and TP exports are pure SRS examples, not persistence seeds or activation.
Historical sales-value and FOC-half-base fixtures are explicitly distinct from the
new cash-collected/full-list-price policy fixtures in the tests.

## Verification boundary

Engine tests cover TC-01–08, TC-13–15, TC-17 and TC-21–25 calculation semantics.
They do not accept API/POS capture, permissions, transactional posting, publishing,
approval, export, performance or live payroll. CP-003–CP-007 own those integrations.
