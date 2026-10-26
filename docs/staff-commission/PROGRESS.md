# Staff commission — progress

## Current State

- Current task: None.
- Most recently completed: SC-001 — DONE (documentation and approval record).
- Approval: October 26, 2026; recommended policies accepted. Collection-based sale
  commission, existing exact-cent redemption value, separate tracking, payroll later.
- Implementation: not started. No application database migration or deployment authorized.
- Blockers: none for planning. Payment/refund allocation, exact paid-session eligibility,
  legacy/zero-value behavior, precision, stored-credit evidence and permission mapping
  require code-informed design in SC-002; these are not invented approved algorithms.
- Recommended next task: SC-002 — Commission foundation and collection design.
- Continue using this folder, not the large root task history. Select one task and
  stop after its completion; do not automatically implement the whole project.

## Recent notes

### SC-001 — October 26, 2026 — DONE

- Created dedicated PROJECT.md, TASKS.md, and PROGRESS.md and short root pointers.
- Recorded user approval, source/test-company context, existing valuation compatibility,
  first-release gates, financial safeguards, and later payroll scope.
- Retained stable SC IDs; dependency order moves required SC-006 ahead of SC-005.
- Source document text and relevant existing commission/valuation code were inspected
  during planning. Embedded visuals and original salary transactions were not reviewed.
- Checks: file references, seven unique task IDs, dependency references, root pointers,
  and Current State under 200 words pass. Initial Prettier check identified wrapping;
  formatted the three new files. Final scoped Prettier and git diff --check pass;
  root pointer diff reviewed. No root-file-wide reformatting was performed.
- Application code/tests: unchanged/not run for this documentation-only task.
- Unrelated platform-auth working change and source DOCX are preserved.
