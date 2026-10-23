# TK2610-0025 completion audit

Audit date: October 22, 2026. Parent status: **IN PROGRESS**.

Regression follow-up: October 23, 2026. Owner 2FA test-helper repair complete;
full API rerun passes with the intentional SEC-01 skip. Rollout remains unperformed.
For the coordinated treatment/prepaid operational handoff, see
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/coordinated-rollout-checklist.md`.

This records implementation evidence and rollout boundaries. It is not legal
sign-off, production verification, or permission to erase real records.

## Approved feature coverage

| Requirement                | Implementation and evidence                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Treatment records          | Customer-profile list and create/edit/delete drawers; tenant/module/write boundaries; salon-local date handling; server pagination.                                                                                                                                                                                                                               |
| Session tracking           | POS is the only deduction owner. Treatment links one whole redemption, validates customer/service/tenant, and reports reversal without changing balances. Historical unlinked quantities are not backfilled or treated as verified redemption evidence.                                                                                                           |
| Package expiry             | Purchase-time expiry snapshots and spend-time refusal belong to TK2610-0027's completed expiry slice. Existing expired redemption evidence can still document historical care; treatment linkage does not spend sessions again. Family sharing/transfer implementation was subsequently verified October 23; coordinated application rollout remains unperformed. |
| Before/after photos        | One before and one after link per treatment, authenticated private customer photos, customer/tenant checks, paginated gallery. Untagging and treatment disposal preserve original photos.                                                                                                                                                                         |
| Consent forms and evidence | Manager/owner version publication; staff grant/decline/withdrawal capture; append-only chains and manager correction annotations; configurable drawn signatures; exact form wording/version preserved.                                                                                                                                                            |
| History                    | Default 20, maximum 200 events per page; independent current chain state; latest-20 treatment-detail preview.                                                                                                                                                                                                                                                     |
| Status gate                | Current grant on active form required when entering IN_PROGRESS/COMPLETED or changing type while gated. Schedule first, then capture consent. Historical same-status edits and cancellation/withdrawal remain possible.                                                                                                                                           |
| Retention and archive      | Manual review reason/date and documented holds; protected customer archival; restricted parent deletion and immutable evidence/version updates. Archive is not complete booking/POS/mobile deactivation.                                                                                                                                                          |
| Owner disposal             | One completed/cancelled, unheld treatment; expiring owner/tenant/record-bound signed preview, reason, typed confirmation and stale checks. Atomic audit receipt plus deletion; customer/original photos/forms/appointments/POS/balances preserved. No bulk, backup or export erasure.                                                                             |

Relevant code is in the API treatment services/routes, customer service and photo
routes; web customer treatment list, consent/retention/disposal/photo components
and treatment hooks; shared customer schemas; and package/POS expiry paths.

## Verification evidence

The disposal implementation session recorded PostgreSQL consent/disposal/POS
acceptance 3/3, shared 150/150, web 576/576, workspace typecheck, root lint,
production build and diff checks passing. These are prior-session results, not a
claim that every check was rerun during this audit.

Initial full API regression ran sequentially against the approved disposable
`127.0.0.1:55440/package_expiry_test`: **505 tests, 406 passed, 98 failed,
1 skipped, 0 cancelled**, exit 1. Treatment consent/disposal/POS linkage and
package-expiry acceptance all passed. SEC-01's separately gated loopback SMTP
acceptance was intentionally skipped; its prior acceptance is unchanged.

Failure breakdown: appointments 11, catalogue 8, customers 7, packages 6,
reports 5, resources 2, sales 51, settings 7, and messaging service 1.
The 97 route failures are consistent with inspected owner login helpers that
expect an access token from password-only login, incompatible with mandatory
owner 2FA. They do not establish failures in all those business workflows, but
also do not verify them. Fix the test authentication workflow without weakening
production authentication, changing fixture roles simply to avoid 2FA, or
loosening assertions. The messaging rebooking test expected `ALREADY_REBOOKED`
and received null; its root cause remains unverified and needs separate triage.

Logs: `/tmp/treatment-completion-api-rerun.log` and matching `.exit`;
disposable migration inventory: `/tmp/treatment-completion-migrations.log`
(36 completed migrations). The first background attempt did not produce a final
result; only the completed detached rerun supplies the counts above. No application
database migration status was inspected. Fixture tenant count and injected disposal
trigger count were both zero after the run; the disposable cluster was stopped.
Documentation formatting and git diff checks passed.

Standing user-granted manual acceptance applies. There is no agent-executed
browser walkthrough or fresh production privacy/security audit.

### October 23 regression follow-up

Added a shared test-only owner login helper and updated appointments, catalogue,
customers, packages, reports, resources, sales and settings route suites. It captures
the delivered OTP in process through Nodemailer's JSON transport and completes the
actual HTTP verification endpoint. No production auth changes, database OTP lookup,
token minting, fixture-role bypass or weakened business assertions.

Prior focused verification passed **110/110**, with no skips. The latest completed
full sequential API run on the approved disposable database reports **505 tests,
504 passed, 0 failed, 1 skipped, 0 cancelled**, exit **0**. Treatment consent,
disposal, POS linkage and package-expiry acceptance passed. SEC-01 SMTP acceptance
was intentionally skipped; its earlier acceptance was not rerun. API typecheck,
scoped ESLint and changed-code Prettier passed. Web/shared/build results above
remain prior-session evidence, not fresh checks.

The messaging rebooking test now passes without messaging code changes. The earlier
`ALREADY_REBOOKED`/null failure is not reproducible in this run; its root cause is
still unverified. This is not a claim that a messaging defect was fixed. Non-fatal
pg concurrent-query deprecation warnings appeared in treatment acceptance tests.

At resumption the previous temporary cluster and logs were missing, so no final
result was inferred from the interrupted attempt. A fresh disposable cluster was
created at loopback port 55440, database `package_expiry_test`, with 36 completed
migrations. Logs: `/tmp/route-login-full.log`, `/tmp/route-login-full.exit`,
`/tmp/route-login-migrations.log`, `/tmp/route-login-cleanup.log`. Cleanup verified
zero fixture tenants and zero injected disposal triggers; the cluster was stopped.
No application database access, deployment, external mail or real erasure occurred.

## Rollout prerequisites — not executed by this audit

1. Obtain explicit authorization identifying the application database/environment
   and permitted migration/restart/deployment actions. A generic “next” does not
   override the standing prohibition on application migrations or production access.
2. Review actual migration status in that authorized environment. The recorded
   treatment-link application migration acceptance is user-reported; do not rerun
   it merely because this audit has not accessed the application database.
3. Back up the authorized database and verify a suitable recovery plan before
   applying pending migrations. Review all pending migrations, not only treatment
   migrations: `migrate deploy` applies the entire pending directory history.
4. Relevant migrations include `20261022160000_treatment_pos_redemption_link`,
   `20261022190000_treatment_retention_protection`, and
   `20261022200000_treatment_consent_history`. The latter adds event-chain fields,
   maps existing decisions to GRANT/DECLINE, changes indexes/foreign keys, and adds
   immutable UPDATE guards. Do not disable those guards or backfill clinical
   quantities into package deductions. Disposal itself adds no migration.
5. Coordinate API and web deployment: consent history changed from an array to a
   page envelope. Avoid mixed-version traffic during migration and activation.
   An old API cannot safely operate against the append-only history schema.
6. Do not roll back schema destructively after new evidence is captured. Plan an
   evidence-preserving forward fix or an explicitly authorized recovery procedure.
7. Check migration success, service health and treatment entitlement after rollout.
   Use disposable fixtures, not real clinical records, for destructive verification.
   Confirm owner 2FA/SMTP prerequisites separately; do not activate paid messaging.
8. Record actual checks and results before parent closure. Do not equate deploy,
   build success or user-granted browser acceptance with an unrun regression suite.

## Explicit exclusions

- No automatic purge or fixed retention period.
- No customer-wide/tenant-wide erasure or backup/export deletion.
- No application migration, deployment, real-record disposal, commit or push.
- No automatic continuation into TK2610-0027 or other P2 tasks.
