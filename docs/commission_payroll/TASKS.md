# Commission and payroll — current checklist

This is the current feature status and open-work record. Detailed completed
checklists and stable task IDs remain in [history](history/TASKS.md); dated
continuations there do not create a second active queue.

## Recorded local acceptance

Status as of November 7, 2026; this cleanup did not rerun application acceptance.

| Milestone                             | Recorded status                                    | Detailed checklist / evidence                                                                                     |
| ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| CP-001 — requirements reconciliation  | DONE locally                                       | [Checklist](history/TASKS.md#cp-001--establish-management-and-reconcile-requirements)                             |
| CP-002 — calculation engine           | DONE locally                                       | [Checklist](history/TASKS.md#cp-002--calculation-engine-and-acceptance-fixtures)                                  |
| CP-003 — configuration                | DONE locally                                       | [Acceptance](acceptance/CONFIGURATION_ACCEPTANCE.md)                                                              |
| CP-003A — historical monetary preview | DONE for supported local scope                     | [Evidence contract](HISTORICAL_INPUTS.md)                                                                         |
| CP-004 — transactional capture        | DONE locally                                       | [Checklist](history/TASKS.md#cp-004--transactional-capture-and-package-workflows)                                 |
| CP-005 — monthly close                | DONE locally                                       | [Lifecycle](acceptance/CLOSE_ACCEPTANCE.md), [application acceptance](acceptance/APPLICATION_CLOSE_ACCEPTANCE.md) |
| CP-006 — reports and staff workflows  | DONE locally                                       | [Browser acceptance](acceptance/BROWSER_ACCEPTANCE.md)                                                            |
| CP-007 — cutover capability           | DONE for local release acceptance                  | [Release acceptance and limitations](acceptance/RELEASE_ACCEPTANCE.md)                                            |
| CP-008 — spec v0.9 alignment          | DONE locally, including November 7 report delivery | [Acceptance](acceptance/CP008_ACCEPTANCE.md), [five-report mapping](acceptance/CP008_REPORT_AUDIT.md)             |

DONE means accepted only within the linked record's scope. Preserve Q2/Q4 scope
qualifications and explicitly unavailable follow-plan future exposure; this table
does not broaden policy, erase evidence gaps, or authorize operational changes.

## Remaining operational gates

- **BLOCKED — real-month reconciliation:** requires the salon's exported payroll
  and owner review; synthetic local evidence cannot close it.
- **TODO before activation — target-host performance:** rerun documented budgets
  on the intended host; local measurements include a power-throttling caveat.
- **Requires explicit authorization — production migration, deployment, earnings
  activation, and payouts:** follow the [cutover runbook](CUTOVER_RUNBOOK.md) with
  a named owner and reviewed target. Local completion is not authorization.
- **Deferred decision — SEC-01 test teardown:** retain the recorded boundary and
  immutable-ledger protections; see the
  [deferred finding](history/PROGRESS.md#november-4-2026--cp-007-re-verified-local-debug-hack-reverted-sec-01-teardown-defect-recorded).
- Retain the release record's disclosed limitations, including human spreadsheet
  and PDF review, stale opt-in fixtures, and environment-specific test constraints.

Use the [release acceptance record](acceptance/RELEASE_ACCEPTANCE.md) and runbook
for detailed evidence and gates. New feature work belongs here; cross-project work
belongs in the [root tracker](../../TASKS.md), not both.
