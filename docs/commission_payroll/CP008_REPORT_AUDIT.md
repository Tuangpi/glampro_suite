# CP-008 §12 report audit — November 7, 2026

## Verdict

**CP-008 DONE locally after implementing the report gaps identified by this audit.**
The earlier audit findings below describe the pre-delivery baseline. The delivery
below supersedes their missing-feature statements, not their analysis or prior tests.
No financial policy, posting, activation or approved payroll is changed.

## Delivered after the audit

- Management-only `GET /api/reports/package-liability` and
  `PackageLiabilityPanel.tsx` expose each outstanding holding, current customer,
  package, expiry/active status, currency and original remaining net consideration.
  `package-liability.ts` validates original purchase identity and remaining ordinals;
  four-decimal residuals reconcile to the original commission basis without rounding
  a displayed session average or requiring valuation activation. Transferred ownership
  retains original economics. Missing/corrupt legacy evidence is unavailable, not zero.
- Conditional exposure uses the captured package redemption policy: FIXED × remaining
  sessions, EXCLUDE = explicit zero. FOLLOW_PLAN is explicitly unavailable because
  future performer, effective rules and pooled plan context are not known. This is
  not a payable commission forecast, and no arbitrary company percentage is invented.
  Expired-unused rows remain distinct; future splits/rounding and incentives are not
  promised. Exact plan-dependent projections require explicit scenario inputs and
  are not silently inferred by this report.
- Utilisation now adds `sessionsSold`, `knownSessionsSold` and
  `unavailableSoldLines` to existing pack/redeemed/current-expired counts. Original
  immutable valuation snapshots or validated payroll purchase snapshots provide the
  original grant. Missing evidence makes the total unavailable while preserving the
  known subtotal. Deleted holdings can still resolve from immutable snapshots.
  Completed-sale/refund treatment stays the expressly labelled existing operational
  scope; no net-sales or expiry-event ledger is introduced.
- Tests: `package-liability.test.ts`, updated utilisation tests,
  `PackageLiabilityPanel.test.tsx`, `CommissionReports.test.tsx`, reporting HTTP and
  mounted Chrome acceptance now exercise the new columns/rows. Real reads leave
  payroll/source/session evidence unchanged. Current totals and commands are in
  `PROGRESS.md`; gated skips alone never count as acceptance.

Basis: §12 of `../Glampro_Package_Commission_Spec_v0_9.docx`, the November 6 client
answers and November 7 decisions, and the implementation/test files below. Paths in
the table are relative to the repository root. Test presence is not execution evidence;
current execution results are recorded separately in `PROGRESS.md`.

## Five-report mapping — audit baseline before the delivery above

| Report                        | Implementation and evidence                                                                                                                                                                                                                                                                              | Finding                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commission & payroll (period) | `apps/web/src/components/settings/PayrollReport.tsx`; `apps/api/src/services/payroll-report.ts`, `payroll-export-data.ts`, `payroll-export-render.ts`; corresponding `.test.ts` files and `payroll-reports-browser.acceptance.test.ts`                                                                   | Implemented approved-period totals/components, collection, owner-only ratio, Excel and PDF payslips. Frozen month-end close is authoritative under Q12, not till-time ledger posting. Human spreadsheet opening/physical printing is not claimed.                                                                                                                                     |
| Commission detail             | `apps/web/src/components/reports/CommissionDetailPanel.tsx`; `apps/api/src/services/payroll-commission-detail.ts`, `payroll-detail-lineage.ts`; corresponding `.test.ts` files; `apps/api/src/routes/payroll-reporting.acceptance.test.ts`; `apps/web/src/components/reports/CommissionReports.test.tsx` | Implemented approved-only ranges up to 24 months, staff/type/date/customer/package filters, full filtered XLSX and recursive roots with missing/cycle/isolation guards. Reports frozen bases, not invented per-line pooled awards. The old cross-month/lineage TODOs are stale.                                                                                                       |
| Package liability             | `apps/web/src/components/reports/PackageValuationPanel.tsx`; `apps/api/src/services/package-valuation-report.service.ts`; `apps/web/src/pages/__tests__/Reports.test.tsx`; package valuation service/lifecycle tests                                                                                     | **Partial against literal §12.** Current response/UI aggregate remaining purchase value and sessions into active/expired buckets, disclose unvalued holdings and debt, and require valuation activation. They do not expose a per-holding liability breakdown or calculate future redemption commission exposure. Calling this a full match was too broad.                            |
| My commission                 | `apps/web/src/components/payroll/PayrollProgress.tsx`; `apps/api/src/services/payroll-progress.ts`, `payroll-own-sessions.ts`; corresponding tests and reporting HTTP/browser acceptance                                                                                                                 | Implemented own estimated MTD breakdown and recorded own package sessions. Estimates are not approved earnings; unknown legacy therapists are not inferred. Supported read scope is not all clinical attendance.                                                                                                                                                                      |
| Package utilisation           | `apps/web/src/components/reports/PackageUtilisationPanel.tsx`; `apps/api/src/services/package-utilisation.ts` and `.test.ts`; reporting HTTP acceptance and `CommissionReports.test.tsx`                                                                                                                 | Operational scope is implemented as recorded in `DECISIONS.md`: completed-sale **packs**, non-reverted redeemed **sessions**, current expired-unused **sessions**. Literal §12 says “sold vs redeemed vs expired sessions per package.” Sold sessions are not provided. This difference must remain explicit; operational acceptance does not prove literal session-based comparison. |

## Original remediation plan — completed by the delivery above

1. **Resolve liability scope.** Confirm whether the existing aggregate purchase-value
   report is accepted instead of per-holding liability/exposure. Otherwise implement
   an authorized per-holding read model and tests. Define future commission exposure
   before calculating it: staff-specific rules, future performer, effective dates and
   pooled plans mean remaining purchase value multiplied by an arbitrary rate is not
   a defensible forecast. Do not activate valuation or backfill legacy evidence merely
   to close the checklist.
2. **Resolve utilisation scope.** The existing operational decision remains in force;
   do not silently replace it. Record acceptance of its difference from literal §12,
   or specify an additional sold-session metric based on original purchase evidence,
   including unavailable legacy/deleted evidence and refund/void treatment. Current
   catalogue session count must not rewrite historical purchases. Net sales and an
   expiry-event ledger are not automatically required by the short §12 wording.
3. **Implement only the agreed gaps**, with authorization/isolation, exact-money,
   unavailable-evidence, empty/error and regression coverage. Rerun applicable
   disposable-DB HTTP and mounted browser acceptance for changed report contracts.
4. **Close `(g)` only after those scope outcomes and verification are recorded.**
   Cross-month detail and lineage must not be rebuilt; their code already exists.

## Separate gates

Q2 redemption-basis client confirmation, Q4 auditor confirmation, CP-007 release
gates, deployment and earnings activation remain separate. No new client approval,
policy waiver or release acceptance is established by this audit.
