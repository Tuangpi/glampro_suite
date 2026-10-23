# Coordinated rollout checklist — TK2610-0025 and TK2610-0027

Prepared October 23, 2026. **Planning complete; rollout NOT authorized or executed.**

This is the operational handoff for treatment retention/consent history and prepaid
service sets, transfers, family membership, explicit sharing and balance evidence.
It does not authorize application database access, deployment, real-record erasure,
paid messaging, vendor submission, commit or push. Parent tasks remain open.

Repository root: `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite`.
All repository paths below are absolute. Checkboxes are intentionally unchecked:
they represent future operational evidence, not work performed by this document.

## 1. Release authorization and ownership — STOP until resolved

- [ ] Record the target environment, non-secret database identifier, affected tenants,
      release revision/artifact, maintenance window/timezone and expected downtime.
- [ ] Name the deployment operator, database/recovery operator and go/no-go owner.
- [ ] Obtain explicit authorization for target access, backup/restore rehearsal,
      migration, traffic/write suspension, service/worker shutdown and restart,
      coordinated API/web deployment, and scoped post-deployment checks. Approving
      this checklist alone is not approval to execute those actions.
- [ ] Identify the actual host/service manager, reverse proxy, static web hosting,
      upload storage, monitoring and all other database writers. Record exact
      environment-specific commands in the private operational handoff.
- [ ] Record an approved recovery point, acceptable data loss/recovery time, abort
      criteria and a named decision-maker before starting the window.

No Dockerfile, Compose file or deployment automation was found in the inspected
repository. References to Compose/nginx in the `.env.example` files are not proof
of an available deployment procedure. Do not invent host restart or backup commands.
Do not put credentials, private host details or clinical data into these records.

## 2. Artifact, configuration and recovery gates

- [ ] Build matching API/web/shared artifacts from one reviewed revision using the
      committed lockfile and Node.js >=24. Record exact revision and build results;
      do not build from an unexplained dirty checkout.
- [ ] Review production configuration through the approved secret-management path:
      `NODE_ENV`, `DATABASE_URL`, JWT/refresh secrets, CORS, durable `UPLOADS_DIR`,
      SMTP configuration and authorized sender. Keep secrets out of logs and web
      `VITE_` settings. Confirm the web API base path matches the actual proxy.
- [ ] Verify owner mailbox access and SMTP readiness before activation. Owner login
      requires an email code; do not bypass 2FA or seed replacement demo accounts.
- [ ] Preserve messaging's current approved disabled state. Do not activate
      WhatsApp/SMS, start a newly enabled delivery workflow or send test campaigns.
- [ ] Take a consistent database backup and protect the corresponding private
      photo/upload storage and deployment configuration. Record backup time,
      protected location, retention/access controls and recovery ownership privately.
- [ ] Verify restore into an explicitly authorized isolated environment, with
      outbound integrations disabled and clinical information protected. A successful
      backup command is not restore evidence. Prevent any clone from reaching live
      providers, users or workers.
- [ ] Rehearse the complete pending migration set against that restored baseline;
      record duration, locking/storage impact, errors and integrity comparisons.
      Do not connect the repository acceptance suites to a clinical-data clone:
      those suites are reserved for their guarded disposable fixture database.

Repository build/check commands, run from the repository root in an isolated
build/test environment, not as an application deployment procedure:

```sh
cd /home/tuangpi/Documents/Aridient/Glampros/glampro_suite
npm ci
npm run typecheck
npm run lint
npm run build
```

The root build generates Prisma client code; it does not deploy migrations.
Existing automated results are historical evidence below, not results of this
checklist. Do not run the root test command with an application database URL.

## 3. Migration inventory and compatibility review

- [ ] Only after target-access authorization, run `npm run db:migrate:status` from
      the repository root with the approved target securely injected. Record the
      actual applied/pending/failed state without exposing the connection string.
- [ ] Review **every pending migration**, checksums and any failed/drifted state.
      Stop on unexpected drift, partial failure or a migration outside the approved
      set. Do not edit applied SQL, mark migrations resolved without investigation,
      or assume a previous disposable database proves the application's state.
- [ ] Confirm user-reported application acceptance of package expiry and treatment
      linkage against actual status; do not rerun already applied migrations.

There are 40 migration directories in
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/apps/api/prisma/migrations`.
This is a repository inventory, **not** the target's applied count. Relevant later
entries are listed in directory order; the approved pending set may include earlier
entries too.

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

`npm run db:migrate` maps to `prisma migrate deploy` in the API workspace and
applies **all** pending migrations, not a selectable treatment/prepaid subset.
Never use `db:migrate:dev`, `db:reset`, seed scripts or migration-diff scratch
replay against the application database for this rollout.

Readiness at `GET /health/ready` or `GET /api/health` performs `SELECT 1` only.
It verifies connectivity, not migration completion, trigger installation, permissions
or feature correctness. `GET /health` is dependency-free liveness.

## 4. Maintenance-window execution — separately authorized only

1. Confirm all gates above and announce the approved write/traffic suspension.
2. Drain in-flight requests and stop old API instances and all writers/workers,
   including scheduled processes. Block direct API access as well as browser traffic;
   a maintenance page alone does not stop writes. Record the quiescent baseline:
   prepaid holding counts and exact decimal balance totals per tenant, ownership,
   expiry, consent/form counts and existing retention holds. Store evidence securely.
3. Confirm the final recovery point covers that baseline and required uploads.
   Keep old writers stopped throughout schema migration and activation.
4. With the approved revision and target securely selected, run
   `npm run db:migrate` from the repository root. Capture sanitized output/exit code.
   On failure, leave traffic suspended and follow section 6; do not retry blindly.
5. Run `npm run db:migrate:status`; confirm the approved history is applied with
   no failed/pending entries for this release. Verify expected constraints/triggers
   are installed and enabled using the database operator's approved read-only checks.
6. Compare post-migration data with the quiescent baseline. Balances, owners and
   expiries must be unchanged by the new sharing migration. Existing holdings must
   have one OPENING snapshot each, zero delta and equal before/after values; no
   fabricated historical actors. Confirm consent GRANT/DECLINE mapping and that
   existing retention holds remain intact. No legacy-family auto-enrollment.
7. Install/start the matching API and web artifacts while public traffic remains
   blocked. Consent history now uses a page envelope; old web/API combinations are
   not supported. An old API is unsafe against the new immutable history schema.
   Coordinate cache handling and require stale browser clients to reload.
8. Check liveness, database readiness, owner 2FA login and approved scoped functional
   checks below. Record all errors/skips. Resume approved existing workers only
   after compatibility/configuration checks; this is not permission to enable delivery.
9. Reopen traffic only after the go/no-go owner accepts migration/integrity/health
   evidence. Monitor errors, lock waits, latency, login failures and prepaid evidence
   write failures for an explicitly agreed observation period before handoff.

## 5. Post-deployment evidence and regression checks

These are technical deployment checks, **not another manual UAT approval round**.
Standing user-granted feature acceptance remains in effect. Do not dispose of real
clinical records, test destructive trigger behavior on real rows, or spend/void real
customer credit. Any synthetic write checks in the application require an explicit
approved fixture/cleanup plan; immutable evidence cannot simply be deleted afterward.
Prefer non-destructive application checks plus destructive checks in the isolated
fixture environment. Record checks not authorized/run rather than claiming success.

- [ ] Matching release active, migration status clean, health/readiness successful;
      owner login and expected tenant/module/role boundaries intact.
- [ ] Treatment list/details/history pagination and preserved wording/signature
      evidence render; status consent gates, hold visibility and POS reversal
      disclosure behave as approved. No package balance change from clinical actions.
- [ ] Customer prepaid membership/holding/history screens and role controls load;
      private holdings remain private and legacy grouping does not grant access.
- [ ] Isolated fixture evidence covers explicit sharing, earliest-expiry pooled
      allocation, exact-source void restores, transfer refusal while shared,
      ownership/expiry/liability conservation, stale/concurrent refusal and audit
      rollback/immutability. Session service-set coverage is regression-tested too.
- [ ] Isolated treatment fixture evidence covers consent/history/hold/disposal and
      unchanged original photos, customer, POS and balances after scoped disposal.
- [ ] Record the release's full API/web/shared test results, skips and build/lint/
      typecheck outcomes. Report SMTP acceptance separately from deployed SMTP access.

Opt-in API acceptance switches confirmed in the repository:
`PACKAGE_EXPIRY_ACCEPTANCE`, `PACKAGE_SET_ACCEPTANCE`, `PREPAID_TRANSFER_ACCEPTANCE`,
`PREPAID_FAMILY_ACCEPTANCE`, `PREPAID_SHARING_ACCEPTANCE`,
`TREATMENT_SESSION_ACCEPTANCE`, `TREATMENT_CONSENT_ACCEPTANCE`,
`TREATMENT_DISPOSAL_ACCEPTANCE`, `AI_ASSISTANT_ACCEPTANCE`, `SEC01_ACCEPTANCE`.
Enable a required suite with value `1`; do not confuse skipped acceptance with passing.
Inspect each suite's database guards before running; use only the designated isolated
loopback fixture database and sequential API execution when reproducing prior runs.
No database or test process is started by this checklist.

Historical evidence, **not rerun during checklist preparation**:

- TK2610-0027: API 509 pass / 0 fail / 1 SEC-01 SMTP skip, with the eight related
  package/prepaid/treatment acceptance checks enabled; web 597/597, shared 157/157;
  workspace typecheck/lint/build passed on October 23, 2026.
- TK2610-0029 follow-up: API 509 pass / 0 fail / 9 unrelated opt-in skips; focused
  assistant 8/8; web 597/597, shared 157/157; typecheck/lint/build passed. This later
  run does not replace the enabled prepaid/treatment acceptance evidence above.
- All 40 migrations were recorded applied only on the disposable database in that
  latest verification. Application migration/deployment remains unperformed here.

## 6. Abort and recovery

Stop activation on failed migrations, unexpected baseline differences, missing
triggers, inaccessible owner login, incompatible artifacts or failed integrity checks.
Keep traffic/writers suspended and preserve sanitized logs plus failed-migration
state for investigation. Do not disable evidence/retention guards, delete audit
events, reset the database or run an unreviewed migration resolution command.

Prefer an evidence-preserving forward fix after the migration has introduced new
schema/evidence. Do not restart the old API as an assumed rollback. Restoring a
backup is a separate authorized recovery action: explicitly account for all writes
since the recovery point, reconcile financial/clinical evidence, align uploads and
matching application artifacts, and accept the documented loss/recovery impact.
Never describe a pre-release backup as lossless rollback after new activity.

## 7. Closure record and next decision

The operator must supply target/revision, authorization reference, start/end times,
backup/restore evidence, pending/applied migration lists, integrity comparisons,
artifact/health checks, functional/regression results and skips, incidents/recovery,
observation outcome and the go/no-go decision. Store sensitive evidence privately;
put only sanitized summaries/references in project tracking.

Update `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/TASKS.md` and
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/PROGRESS.md` with actual
outcomes before proposing closure of TK2610-0025/TK2610-0027. Do not mark those
external IDs DONE from checklist preparation alone. TK2610-0026 remains blocked
on official route/business evidence/submission; P2 acceptance is not established.

**Next decision:** identify the target environment and operator, then explicitly
authorize the desired operational scope. Until then, stop at this planning handoff.
