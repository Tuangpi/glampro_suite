# Commission & Payroll progress

## Current State

- Current task: None.
- Most recently completed: CP-001 — DONE, October 27, 2026.
- Priority: this project before unrelated backlog. New requirements govern policy;
  existing authentication, tenant safety and exact-money integrity remain mandatory.
- No application code, DB schema/data, dependencies, activation or deployment changed.
- No policy question currently blocks local work; decisions adopted under delegation
  are in DECISIONS.md, including explicit deviations from SRS proposed defaults.
- Next ready: CP-002 — Calculation engine and acceptance fixtures (not started).
- Existing unrelated sale UI work is preserved and is not accepted as CP completion.

## October 27, 2026 — CP-001 management initialization

- Created PROJECT, TASKS, DECISIONS, REQUIREMENTS and this handoff alongside the
  supplied sources. Root management pointers now select the CP workstream first.
- Moved seven former tracker files to the archive without changing their contents,
  including uncommitted documentation edits. Added an archive notice. Historical
  relative links inside the archive may be stale and are not active instructions.
- Extracted and inspected top-level SRS/developer instructions using standard-library
  DOCX XML reading. Top-level and bundled SRS hashes match. Mapped all functional
  requirement IDs, NFR-01–NFR-07 and TC-01–TC-25 to delivery tasks.
- Resolved open-point defaults, real Excel/PDF vs CSV gap, historical/new-policy
  fixture differences, tenant/transaction/retry issues, full statement freezing,
  departed staff and payout semantics. Embedded diagrams/demo browser visuals remain
  unverified; no supplied test-count or production-readiness claim is adopted.
- Verification: Prettier on all nine management/notice files and git diff whitespace
  check pass. Local Markdown links resolve. Coverage check finds all 87 functional
  IDs mapped; TC-01–TC-25 and NFR-01–NFR-07 are present. SHA-256 checks confirm
  all seven archived files, 73 delivered source files and 661 application TS/TSX
  files unchanged. Actual root diff reviewed: only top-level project pointers changed;
  existing history and unrelated sale UI changes remain intact.
- No runtime tests run: this task changes management documents and relocates the old
  tracker only. No engine/feature acceptance or application build is claimed.
- CP-001 is DONE; stop here. Next session may select CP-002; it is not started.
