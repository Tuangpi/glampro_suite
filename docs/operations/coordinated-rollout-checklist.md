# Coordinated rollout — TK2610-0025 and TK2610-0027

**Prepared October 23, 2026: planning complete; rollout NOT authorized or executed.**
Scope: treatment retention/consent and prepaid service sets, transfers, families,
sharing, and balances. Parent tasks remain open. Unchecked boxes require real evidence.

Use [CI/CD](CI_CD.md) for the current host/deployment procedure. This checklist does
not authorize database access, migrations, deployment, erasure, paid messaging,
vendor submission, commit, or push. Keep secrets and clinical data out of shared records.

## 1. Before rollout — approval required

- [ ] Record target/database identifier, tenants, exact revision/artifact, window,
      timezone, downtime, operator, recovery operator, and go/no-go owner.
- [ ] Obtain explicit approval for access, backups/restore rehearsal, migration,
      write suspension, service shutdown/restart, deployment, and verification.
- [ ] Identify actual services, proxy, uploads, monitoring, and every database writer.
      Record environment-specific commands privately; do not invent them.
- [ ] Agree on recovery point, acceptable data loss/recovery time, and abort criteria.
- [ ] Build matching API/web/shared from one reviewed revision and lockfile.
      Run `npm ci`, `npm run typecheck`, `npm run lint`, and `npm run build`
      from the repository root in an isolated build environment (Node >=24).
- [ ] Review database/JWT/refresh secrets, CORS, durable uploads, proxy API path,
      SMTP, and owner mailbox. Never expose secrets through `VITE_` settings.
- [ ] Keep messaging disabled. Owner login must complete email 2FA; no bypass/demo accounts.
- [ ] Back up database, private uploads/photos, and deployment configuration consistently.
      Record time, protected location, retention, and recovery ownership privately.
- [ ] Restore on an authorized isolated host with outbound integrations disabled.
      A successful backup command alone is not restore evidence.
- [ ] Rehearse every pending migration on the restored baseline; record duration,
      locks, disk needs, errors, and integrity comparisons. Do not run acceptance
      suites against clinical-data clones.

## 2. Review migrations and compatibility

- [ ] After target-access approval, run `npm run db:migrate:status` with the target
      securely injected. Record actual applied/pending/failed state.
- [ ] Review every pending SQL/checksum and drift/failure. Do not edit applied SQL,
      reset, or mark resolved without investigation. Confirm user-reported package
      expiry/treatment linkage acceptance rather than reapplying completed migrations.
- [ ] Capture baseline financial/prepaid balances, ownership, expiry, provenance,
      consent counts/chains, holds, and photos. Compare them after migration.

Relevant migrations from the October 23 inventory (40 directories then, not a
current target count). Review earlier/later pending migrations too:

| Migration                                       | Review focus                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `20261022120000_family_sharing_fields`          | Legacy grouping fields; not authority for explicit prepaid membership or sharing.                                                    |
| `20261022120000_package_validity_days`          | Purchase-time validity; application acceptance previously user-reported. No historical expiry backfill.                              |
| `20261022160000_treatment_pos_redemption_link`  | Unique whole-POS-redemption evidence; application acceptance previously user-reported. No treatment-led deductions.                  |
| `20261022190000_treatment_retention_protection` | Archive/review/hold columns, restrictive consent parent relationships and held-record deletion guard.                                |
| `20261022200000_treatment_consent_history`      | Existing decisions mapped to GRANT/DECLINE; chain fields/indexes and immutable event/form update guards.                             |
| `20261023120000_prepaid_transfer_history`       | Append-only transfer evidence. Original ownership/expiry/value and purchase provenance must remain intact.                           |
| `20261023130000_package_service_sets`           | Catalogue redemption mode/set and holding snapshots; legacy holdings retain per-unit behavior.                                       |
| `20261023180000_prepaid_family_membership`      | Explicit same-tenant family/member models and append-only membership events; legacy IDs do not enroll anyone.                        |
| `20261023200000_prepaid_sharing_balance_ledger` | Explicit holding sharing, balance triggers and OPENING snapshots for all existing prepaid holdings. Review row count/time/disk cost. |

`npm run db:migrate` applies **all pending migrations**, not just these entries.
Build generates Prisma code but does not migrate. Consent history changed from
an array to a page envelope; old API writes are unsafe against append-only history.
Deploy API/web together and review previous-release compatibility before activation.

## 3. Execute the approved maintenance window

- [ ] Reconfirm authorization and backup/recovery readiness.
- [ ] Suspend traffic/writes and stop all API/worker/other writers as approved.
      Keep paid messaging disabled.
- [ ] Apply the exact reviewed pending set using the approved migration procedure
      in [CI/CD](CI_CD.md#approved-migrations). Stop on any unexpected result.
- [ ] Verify migration status, constraints/triggers, row counts, balances, consent
      chains, holds, and opening ledger snapshots against baseline.
- [ ] Activate matching API/web artifacts; check health, uploads, proxy, and owner 2FA.
- [ ] Restore traffic only after approved checks pass; observe errors and integrity.

## 4. Verify and record evidence

- [ ] Check tenant/module/role boundaries, pagination, date handling, and owner SMTP.
- [ ] On authorized disposable fixtures, verify treatment consent/history/holds/disposal;
      originals, customer, POS, and balances must remain after scoped disposal.
- [ ] Verify service sets, explicit family/sharing, expiry allocation, exact-source
      void restores, transfer restrictions, ownership/value conservation, concurrency,
      audit rollback, and immutability.
- [ ] Record API/web/shared tests, skips, typecheck/lint/build, deployed smoke checks,
      observation results, incidents, and go/no-go decision separately.

Acceptance switches (set to `1` only on the guarded isolated loopback fixture DB):
`PACKAGE_EXPIRY_ACCEPTANCE`, `PACKAGE_SET_ACCEPTANCE`, `PREPAID_TRANSFER_ACCEPTANCE`,
`PREPAID_FAMILY_ACCEPTANCE`, `PREPAID_SHARING_ACCEPTANCE`,
`TREATMENT_SESSION_ACCEPTANCE`, `TREATMENT_CONSENT_ACCEPTANCE`,
`TREATMENT_DISPOSAL_ACCEPTANCE`, `AI_ASSISTANT_ACCEPTANCE`, `SEC01_ACCEPTANCE`.
Inspect each suite's database guards. Use sequential API execution when reproducing
prior runs. Skipped acceptance is not passing; never point tests at production.

Historical October 23 evidence, **not rerun here**:

- TK2610-0027: API 509 pass / 0 fail / 1 SEC-01 SMTP skip, eight related acceptance
  checks enabled; web 597/597, shared 157/157; typecheck/lint/build passed.
- TK2610-0029 follow-up: API 509 pass / 0 fail / 9 unrelated opt-in skips;
  assistant 8/8, web 597/597, shared 157/157; typecheck/lint/build passed.
  This does not replace the enabled prepaid/treatment acceptance evidence.
- The 40 applied migrations were on the disposable DB only, not application rollout evidence.

## 5. Abort, recover, and close

Stop for failed migrations, unexpected baseline changes, missing triggers, broken
owner login, incompatible artifacts, or failed integrity checks. Keep writers
suspended; preserve sanitized logs and failed state. Never disable evidence guards,
delete audits, reset the DB, or run unreviewed migration-resolution commands.

Prefer an evidence-preserving forward fix. Do not assume restarting the old API
is safe. Backup restore needs separate approval, write-loss accounting, financial/
clinical reconciliation, matching uploads/artifacts, and accepted recovery impact.
A pre-release backup is not lossless rollback after new activity.

Record target/revision, approvals, times, backup/restore evidence, migration lists,
integrity comparisons, checks/skips, recovery, and final decision. Update project
tracking with sanitized actual results before proposing parent closure.
TK2610-0026 remains blocked on official route/business evidence/submission;
P2 acceptance is not established by this checklist.
