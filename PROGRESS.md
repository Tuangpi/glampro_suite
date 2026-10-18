# Glampro Suite — progress

## Current State

- Current task: TK2610-0005 / P0-09 Security hardening — DONE
- Most recent product work: TK2610-0008 / P0-05 remains Ready for UAT, as recorded before this consolidation. Its source/test changes are uncommitted; preserve them.
- SETUP-05 — Reported database rename: NOT assessed. Database IS running (PostgreSQL 18 on localhost:5432, `glampro_suite` database present, `.env` has DATABASE_URL). However API integration tests fail at seed with `time_zone column does not exist` — a pre-existing schema/database mismatch, not caused by P0-09 changes. Database rename verification still needs environment/backup confirmation; no reset/reseed per PROJECT.md constraints.
- P0-09 / TK2610-0005 security hardening implemented and marked DONE on manual code review:
  - Token replay: replaying a revoked refresh token now rejects with SESSION_INVALIDATED without revoking the user's other sessions (aligns with ADR 0007: logout revokes one token, not all sessions)
  - Password change: tokenVersion bump + refresh revocation wrapped in a single `prisma.$transaction` so both succeed or neither
  - Platform forced sign-out: new `POST /api/auth/force-sign-out` (SUPER_ADMIN only) bumps tokenVersion and revokes all refresh tokens atomically
  - Owner 2FA (email codes): `twoFactorEnabled`/`twoFactorCode`/`twoFactorCodeExpiresAt` added to User schema; `enableTwoFactor`, `confirmTwoFactor`, `disableTwoFactor`, `verifyTwoFactorForLogin` service functions; login gates on 2FA (sends code by email, returns empty tokens until verified); five new auth routes; dev/test email service logs codes to console
  - Test accounts retained per user decision (no removal)
- Verification: API typecheck passes, API lint passes, shared 87/87 tests pass. API integration tests blocked by pre-existing `time_zone` column mismatch (SETUP-05 concern).
- Earlier records report P0-07, P0-08, P0-03 and P1-09 Done. This consolidation does not independently revalidate their product behavior.

## Unresolved decisions and carried-forward findings

These are historical code-review findings, not fresh runtime reproductions. Verify
against current code when starting the related task. No policy is changed here.
Full decision context and evidence qualifications now live in `PROJECT.md`,
Architecture decisions (ADR 0002–0018), and Design integration (Design 1–7).

- ADR 0002: legacy-ID importer and repeat-run fixture verification are not implemented;
  do not infer migration readiness from schema support or seed-generated IDs.
- ADR 0003 / P1-05: customer email normalization is missing; blank input rejects
  rather than normalizes to NULL. Review case-fold collisions before data changes.
- ADR 0004: platform console is an unscheduled architecture direction, not an
  implemented app or an authorization to add a privileged surface.
- ADR 0008: old centered-card review conflicts with the documented October 8 split
  layout. Preserve later composition; inspect Login before claiming fidelity.
- ADR 0014 / P1-02: status-only cancelled reactivation bypasses clash checks;
  cancelled targets may be wrongly refused. Add regression checks for both paths.

| Related task          | Finding / decision needed                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SETUP-05              | Verify actual database name/environment, backups and connection configuration without revealing secrets or resetting data. Repository rename does not prove database rename.                                                                                                                                                                                                                                                 |
| P0-09; ADR 0007       | Logged-out token replay may revoke other sessions; password update/revocation are separate writes; platform forced sign-out is absent. Decide replay behavior, owner 2FA/recovery and safe account-removal scope.                                                                                                                                                                                                            |
| P0-06; ADR 0010       | ADR requires stored tenant threshold for row low-stock flags even with a filter override; code uses the resolved override for both. Choose semantics and test row flags, not only result counts.                                                                                                                                                                                                                             |
| P0-02; ADR 0011       | Legacy unnumbered completed receipts have no established backfill guarantee. Held sales also have null numbers; a completed receipt's “number pending” copy must not promise an unsupported future allocation.                                                                                                                                                                                                               |
| P1-07; ADR 0017       | ADR says discounts reduce loyalty points; code/test award catalogue points × quantity. Resolve policy first. Performance totals are not cash collected or commission. Receipt disclosure can omit a positive rate rounded to zero money.                                                                                                                                                                                     |
| P1-07; ADR 0015       | Held-sale review found incomplete listing, stale/current-price mismatch, double-discount preview, lost hold identity after reload, cart replacement and duplicate drafts on uncertain-response retries without idempotency keys.                                                                                                                                                                                             |
| P1-07; ADR 0016       | Void reverses ledger state but does not refund payment. Concurrent replay, missing-product stock restoration, cascading receipt deletion, voided outstanding balances and stale report/customer caches need review; prior tests did not prove every ledger case.                                                                                                                                                             |
| P1-02; ADRs 0013/0014 | Decide duration snapshots versus catalogue refresh on every patch. Service-only and catalogue-driven resizing can bypass clash checks gated on startsAt/staffId. Department eligibility is rechecked, but server lookups do not enforce picker active-status filters; mismatches lack field detail. Till department narrowing is advisory. Review concurrent overlap enforcement; prior tests did not establish race safety. |
| P1-01; ADR 0018       | Day/week/month views exist. Review salon-zone boundaries against newer P0-08 changes; old browser-local findings may be superseded. Week drag/drop, crossing-midnight display and first-page truncation remain scope to assess; read-only presentation is not proof of edit authorization.                                                                                                                                   |
| P0-04 / P1-03 / P1-04 | Clarify payment integration versus manual recording, deposit/no-show policy, messaging provider, consent and provider onboarding before implementation.                                                                                                                                                                                                                                                                      |

Detailed rationale and evidence limits are preserved in `PROJECT.md`. Documentation
audits marked Done did not resolve these product decisions or defects.

## External completion notices

Inform only; never edit the PDF or external task system. Based on preserved Done
evidence (not new product verification in this documentation task), these IDs were
already recorded complete and can be marked done externally if not already marked:

- TK2610-0004 / P0-07 — developer-copy cleanup.
- TK2610-0006 / P0-08 — localisation.
- TK2610-0007 / P0-03 — business hours.
- TK2610-0014 / P1-09 — performer-picker cleanup.

TK2610-0008 / P0-05 remains Ready for UAT; seed inspection does not establish live
demo grants/data. Do not newly declare it complete without confirming its full check.
No phase or readiness milestone is signed off by this documentation task.

## Recent handoffs

### October 17, 2026 — DOCS-01 three-document migration (DONE)

- Corrected the initial partial consolidation to the clarified scope: only
  PROJECT/TASKS/PROGRESS are maintained project documents. No extra rule file or
  separate decision/design docs. Delivered design assets/README remain unchanged.
- Consolidated ADR 0002–0018 policies, rationale, tradeoffs, code references and
  evidence limits into PROJECT; Design 1–7 retains frame/token/icon/route/checklist
  and primitive-delta details. Workflow is in PROJECT; external notices restored.
- Added missing email, migration, login-layout and cancelled-booking findings.
  Product statuses stay unchanged. Source changes are reference comments only;
  verify token equivalence and preservation of existing uncommitted work.
- Verification: 29 PDF IDs, 24 exact DOCX task requirements and 37 prior statuses
  preserved. All 17 decision IDs and seven design sections have stable destinations;
  retired links removed and active PROJECT links/anchors resolve. Removed 20
  superseded files; docs now contains only DOCX/PDF. Delivered design README stays
  unchanged as an asset, not an additional maintained project document.
- All 66 edited source/schema files have equivalent non-comment contents (TS/TSX
  parse/printed AST comparison, CSS/Prisma comment-stripped comparison). All 287
  other snapshot files are unchanged, including original documents, design assets,
  existing Prisma tenant-scope fix and Products test changes.
- Checks run: web Login/Products/Card/navigation — 4 files, 56/56 tests passed;
  shared catalogue/sales — 53/53 tests passed; scoped Prettier and git diff --check
  passed. No full build/typecheck/API tests or database commands: application edits
  in this task are comments only. No commit/push. Test scripts and safety snapshots
  are outside the repository, not new management documents.

### October 17, 2026 — TK2610-0008 / P0-05 (historical)

- Recorded audit: package/gift-card CRUD, entitlement guards, demo seed grants and
  templates exist. Web Add button now hides for unentitled add-on tabs; read-only
  behavior remains disabled rather than hidden.
- Changed `apps/web/src/pages/Products.tsx` and its test file (still uncommitted).
- Recorded results: web 383/383 tests, web typecheck/lint/build passed. API 308/308
  and shared 87/87 were reused from the earlier baseline, not rerun in this slice.
- Status remains Ready for UAT; live demo entitlement/data verification is not
  established by reading the seed configuration alone.

### October 17, 2026 — SETUP-02 baseline (historical)

- Recorded isolated disposable PostgreSQL 18 migration deploys; no seed/reset or
  existing database use. Temporary cluster stopped after checks.
- Recorded API 308/308, web 381/381, shared 87/87, workspace lint/typecheck passing.
- Added `TenantOperatingHours` to tenant-scoped Prisma models; change remains in
  `apps/api/src/lib/prisma.ts` and is outside this documentation task.
- Full root verify was NOT clean: seven pre-existing formatting failures were
  reported. The old tracker overstated aggregate success. Individual passing
  checks above do not establish a successful `npm run verify`.

### October 17, 2026 — SETUP-06/07/08 decision reviews (historical)

- Recorded evidence reviews for ADRs 0002/0003/0006/0008 in commit `257eead`.
  Decision context is now consolidated in PROJECT. Open findings remain unresolved.

### October 15–16, 2026 — earlier completed product work (historical)

- Tracker records P0-07 copy cleanup, P0-08 localisation, P0-03 business hours and
  P1-09 performer-picker cleanup Done; evidence summaries remain with those tasks.
- Branding was accepted on desktop/mobile October 15; repository rename recorded
  complete for this clone. Neither establishes database rename or trademark checks.
- These results are preserved historical reports, not tests run for DOCS-01.
