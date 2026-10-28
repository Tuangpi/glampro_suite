# Commission & Payroll requirements and acceptance

## Review basis

October 27, 2026: inspected text extracted from the top-level SRS v1.2 and developer
instructions, the reference handoff and selected engine/services/repository/tests/UI.
The top-level and bundled SRS are byte-identical. Embedded Word diagrams and demo
screens have not received visual/browser acceptance. Reference test-count/build
claims are supplied claims, not independently reproduced results.

This matrix maps every FR ID by inclusive range and records ownership, not blanket
end-to-end acceptance. Except for the verified task portions below, implementation
remains **Needs verification / not accepted**. A reference function or existing app
table is not evidence. [DECISIONS.md](DECISIONS.md) resolves source conflicts.

CP-002 update (October 27, 2026): calculation-only portions of TC-01–TC-08,
TC-13–TC-15, TC-17 and TC-21–TC-25 now have passing shared-engine tests.
See PROGRESS.md for actual checks and boundaries. Matrix entries still require
their API/POS/UI integration and end-to-end acceptance in CP-003–CP-007.

## Functional coverage

CP-003 update (October 28, 2026): configuration-only completion checks accepted;
see [CONFIGURATION_ACCEPTANCE.md](CONFIGURATION_ACCEPTANCE.md) for evidence and
limits. This does not accept historical monetary preview, actual earnings,
monthly close or release-wide integration.

Approved October 28, 2026: CP-003 configuration acceptance is separate from
historical monetary preview. In the matrix, FR-SET-10–FR-SET-12 configuration,
comparison and publication remain CP-003; their historical monetary integration
and preview/full-run equality belong to CP-003A after CP-004/CP-005. Historical
TC-25 integration is not accepted by readiness or sample-calculator tests.
This must-have is deferred, not removed, and remains a CP-007 release gate.

| Requirement IDs (inclusive) | Expected capability                                                                                                                              | Owning tasks           | Reference / current integration seam                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------- |
| FR-BAS-01–FR-BAS-06         | Four-decimal staff base lines with source/outlet; net services/products; collected package cash; original-value redemptions; full-list-price FOC | CP-004                 | Reference ledgerService; existing sale, attribution, collection and redemption evidence             |
| FR-BAS-07                   | Value-package sale/spend paid-to-credit ratio (should-have)                                                                                      | CP-002, CP-004         | Reference package/period engine; existing value holdings and prepaid movements                      |
| FR-BAS-08–FR-BAS-09         | Negative refund bases, original sellers and traceable corrections                                                                                | CP-004, CP-005         | Reference ledgerService; existing refund/event ledger primitives                                    |
| FR-BAS-10                   | Gift-card sale base, excluded from seed plans (could-have)                                                                                       | CP-006                 | SRS requirement absent from reference commission type list; explicitly optional                     |
| FR-PLN-01–FR-PLN-02         | Plan lifecycle, outlet/position metadata, draft/published version lifecycle                                                                      | CP-003                 | Reference planService and settings UI; new tenant-safe persistence required                         |
| FR-PLN-03–FR-PLN-07         | Components, categories, base %, methods, caps, bands and validation                                                                              | CP-002, CP-003         | Reference types/tier/validate; strengthen invalid and overlap cases                                 |
| FR-PLN-08–FR-PLN-10         | Stage preview calculator (should), plan staff counts/version history (must), fixed-per-unit component (could)                                    | CP-003                 | Reference planService; verify full SRS contract and immutable history                               |
| FR-SET-01–FR-SET-06         | Settings dashboard/editor, configurable rules, validation and save workflow                                                                      | CP-003                 | Reference CommissionSettingsPage and plan schemas                                                   |
| FR-SET-07–FR-SET-09         | Test calculator, method comparison/chart, jump warnings                                                                                          | CP-002, CP-003         | Reference tier/validate and calculator; same engine as payroll                                      |
| FR-SET-10–FR-SET-12         | Impact preview and effective-dated version comparison/publication (must); plan JSON import/export (could)                                        | CP-003, CP-003A        | Configuration in CP-003; historical monetary integration and equality in CP-003A                    |
| FR-STG-01–FR-STG-05         | Join-date tenure, stage ranges/overrides and progression                                                                                         | CP-002, CP-003         | Reference stage engine; use existing user employment data                                           |
| FR-ASN-01–FR-ASN-06         | Joining assignment, plan changes/history, fallback and month-end selection                                                                       | CP-002, CP-003         | Reference assignments; existing commission-rules hierarchy for fallback                             |
| FR-POS-01–FR-POS-03         | Sold by/Performed by, split validation and required-attribution checkout gate                                                                    | CP-004                 | Existing attribution editor/policy; reference SplitEditor                                           |
| FR-POS-04–FR-POS-08         | Deposits, holding balance collection, snapshots, holding picker and paid-session PIN gate                                                        | CP-004                 | Existing sale/payment/holding and exact valuation; do not mirror holding state                      |
| FR-POS-09                   | Informational base and MTD band/gap display (should-have)                                                                                        | CP-004, CP-006         | Reference POS demo; shared read model required                                                      |
| FR-POS-10                   | Package FOLLOW_PLAN/EXCLUDE/FIXED sale/redemption and deposit settings                                                                           | CP-003, CP-004         | Reference holding modes; snapshot package settings on purchase                                      |
| FR-INC-01–FR-INC-05         | Highest qualifying incentive, configured types/group metrics and outlet/salon scope                                                              | CP-002, CP-003, CP-005 | Reference incentive engine/periodService; real collection metric cannot depend on exclusions/splits |
| FR-CAL-01–FR-CAL-10         | Re-runnable monthly engine, last-day plan/stage, pools/methods, carry, rounding, snapshots, fixed/excluded and flat fallback                     | CP-002, CP-005         | Reference period/tier engine; current EmployeeCommission is not a monthly base ledger               |
| FR-ADJ-01–FR-ADJ-04         | Package refunds, negative sale bases, void sessions, correct staff                                                                               | CP-004, CP-005         | Existing source refund/restoration plus immutable commission adjustments                            |
| FR-ADJ-05                   | Separate reasoned manual statement adjustments                                                                                                   | CP-005                 | Reference Adjustment types; authenticated persisted audit                                           |
| FR-ADJ-06–FR-ADJ-07         | Transfer/family attribution continuity; no expired-unused redemption bases                                                                       | CP-004                 | Existing transfers/family/expiry and original purchase ownership                                    |
| FR-PAY-01–FR-PAY-04         | Close states, effective salary profile, statement components and payroll/collection KPI                                                          | CP-003, CP-005         | Reference periodService; full frozen snapshots required                                             |
| FR-PAY-05                   | Excel summary + per-staff sheets and payslip PDF, not just CSV                                                                                   | CP-006                 | SRS wins over reference CSV-only implementation                                                     |
| FR-PAY-06                   | Locked-month changes posted to next open month                                                                                                   | CP-005                 | Existing period/event primitives; preserve occurrence date separately from posting period           |
| FR-RPT-01–FR-RPT-03         | Period summary, staff breakdown/source drill-down, filtered ledger and Excel export                                                              | CP-006                 | Reference report page; current tenant-scoped reports/receipts                                       |
| FR-RPT-04–FR-RPT-05         | MTD plan overview and own-data staff self-service (should-have)                                                                                  | CP-006                 | Reference overview/staff screens; estimates use same engine                                         |
| FR-RPT-06                   | Unused package value and unpaid balances (should-have)                                                                                           | CP-006                 | Existing valuation reporting; separate remaining value, receivable and expired-unused buckets       |

SRS section 4.11 is mandatory across tasks: salon SUPER_ADMIN creates/publishes
plans, edits salaries, approves and exports payroll; managers assign/override with
reason, refund/void/correct and calculate/adjust; staff see own commission only;
cashiers cannot see payroll. All mutations record actor, time, before/after and reason.

Optional scope is not omitted: FR-SET-12 plan JSON import/export is tracked under CP-003, disabled/deferred unless explicitly implemented and tested. Imports must validate definitions and strip foreign tenant IDs; they never copy staff or payroll data across tenants. Fixed-per-unit core is included in CP-002 despite its could-have priority.

## Acceptance cases

| Case  | Required result / distinguishing evidence                                                     | Tasks                   |
| ----- | --------------------------------------------------------------------------------------------- | ----------------------- |
| TC-01 | Hair standard base 6,830 → 546.40                                                             | CP-002, CP-007          |
| TC-02 | On course whole 8,985.50 → 628.99                                                             | CP-002, CP-007          |
| TC-03 | Same base by slice → 488.99                                                                   | CP-002, CP-007          |
| TC-04 | Bases 4,000 / 4,000.01 / 6,000 / 6,000.01 → 0 / 160 / 240 / 480                               | CP-002, CP-007          |
| TC-05 | Join September 10, October month 2; base 3,600 → 144                                          | CP-002, CP-003, CP-007  |
| TC-06 | Same staff December month 4; base 3,600 → 0                                                   | CP-002, CP-003, CP-007  |
| TC-07 | Historical TP package sales-value base 9,256.31 → 647.94; not new cash fixture                | CP-002, CP-007          |
| TC-08 | Individual metric 10,421.31 → incentive 50; 9,853 → 0                                         | CP-002, CP-007          |
| TC-09 | October deposit 2,000 split 50/50 → 1,000 each; November balance 3,000 → 1,500 each           | CP-004, CP-007          |
| TC-10 | Third 1,000 session blocked after paying 2,000; verified manager PIN exception audited        | CP-004, CP-007          |
| TC-11 | Catalogue edit leaves original holding/session economics unchanged                            | CP-004, CP-007          |
| TC-12 | Refund 2,900 → sale bases -1,450 each; redemption retained                                    | CP-004, CP-007          |
| TC-13 | Negative component base -500 → commission 0 and carry -500                                    | CP-002, CP-005, CP-007  |
| TC-14 | Version effective January 1, 2027 does not alter December 2026                                | CP-002, CP-003, CP-007  |
| TC-15 | Assignment changed November 15 applies to whole November under last-day rule                  | CP-002, CP-003, CP-007  |
| TC-16 | Transferred holding: performer earns original-value redemption; sellers retain sale base      | CP-004, CP-007          |
| TC-17 | Value package pays 500 for 600 credit: sale base 500, spend 100 base 83.3333 (83.33 display)  | CP-002, CP-004, CP-007  |
| TC-18 | Missing required Sold by blocks checkout                                                      | CP-004, CP-007          |
| TC-19 | Correct September session after approval: September unchanged; reverse/repost next open month | CP-005, CP-007          |
| TC-20 | Excel totals equal frozen on-screen statements to cent; also verify PDF                       | CP-006, CP-007          |
| TC-21 | Hair mixed base 12,000 → 1,000                                                                | CP-002, CP-007          |
| TC-22 | Cap 500 on computed 628.99 → 500 with explanation                                             | CP-002, CP-007          |
| TC-23 | On course switch effective January 2027; impact delta -140 for same Alvin inputs              | CP-002, CP-003, CP-007  |
| TC-24 | Decreasing band limits block publication                                                      | CP-002, CP-003, CP-007  |
| TC-25 | Impact preview equals full run with identical inputs and proposed rules                       | CP-002, CP-003A, CP-007 |

Additional policy fixtures: Alvin with FOC full list 492 → 1,187.69 total;
Stella with new collected-package base 8,688 → 1,931.84 commission, 0 incentive.
Do not label historical salary examples as new-policy reconciliation.

## Non-functional requirements

| ID     | Completion evidence                                                                           | Tasks                  |
| ------ | --------------------------------------------------------------------------------------------- | ---------------------- |
| NFR-01 | Decimal strings, four-decimal bases, two-decimal half-up component totals; no monetary floats | CP-002–CP-007          |
| NFR-02 | Asia/Singapore default local month; half-open boundaries and date-edge tests                  | CP-003–CP-007          |
| NFR-03 | Measured 50 staff/month <10 s and MTD <500 ms; document dataset/environment                   | CP-006, CP-007         |
| NFR-04 | Approved bases/results/audits and complete statements cannot mutate                           | CP-004, CP-005, CP-007 |
| NFR-05 | Tenant isolation; configurable outlet plan/group scope with cross-scope tests                 | CP-003–CP-007          |
| NFR-06 | Role guards, own-data reads, export/salary restrictions, verified PIN exceptions              | CP-003–CP-007          |
| NFR-07 | All TC cases covered at appropriate engine/API/UI layers, not only demo unit tests            | CP-002–CP-007          |

SRS screens C1–C7 and C17–C20 map to CP-003; C8–C13 and C16 to CP-004
and CP-006; C14–C15 to CP-005 and CP-006. Seed definitions and migration
requirements in SRS section 11 map to CP-003 and CP-007 respectively.

## Reference audit caveats

- Supplied SRS AS-IS descriptions predate some current code. Inspect real code;
  do not remove reusable attribution, collection or valuation work to match AS-IS.
- Demo headers, ID-only reads, workflow writes without a shared transaction,
  stale-result approval, active-only payroll and dynamic post-approval salary reads
  are not acceptable production integrations.
- Current candidate collection/redemption evidence includes release gates; it is
  not proof of live payable commission. Review before enabling any new posting.
- Supplied visual references guide workflows, not permission to replace the current
  application shell, dependency versions, authenticated API client or design system.
