# Owner assistant outcomes and release readiness — OA-07

Prepared October 24, 2026. **Local implementation is not release approval.**
All required acceptance, including owner UAT/sign-off and the disclosed scope and
limitations, was confirmed by the user October 24, 2026. Historical unchecked UAT
items below describe acceptance scope, not outstanding acceptance requests. This is
user-reported acceptance, not new agent verification or operational execution evidence.
Provider/operational checks and recording specific retention/security decisions remain
separate follow-ups. No application database access, migrations, provider activation,
outbound messages or deployment is authorized by this acceptance confirmation.

## Release decision and responsibility record

**Current decision: HOLD target activation.** Owner acceptance is complete. This
hold concerns unrecorded operational/policy evidence, not another acceptance request.

| Gate                                        | State          | Evidence or required record                                                                            |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| Outcome implementation and owner acceptance | Complete       | Local implementation; user confirmed all required acceptance October 24, 2026                          |
| Local regression/build checks               | Recorded below | Synthetic data only; opt-in suites and failures must be disclosed                                      |
| Local fixture backup/restore                | Rehearsed      | PostgreSQL 18 custom-format dump restored to a separate disposable database; details below             |
| Target rollout                              | Not executed   | Target, operator, revision/artifacts, maintenance window and migration inventory                       |
| Target recovery                             | Not verified   | Protected backup, isolated target-data restore, recovery objectives and writer/provider reconciliation |
| Real SMS provider/cost controls             | Not verified   | Scoped non-customer test, verified sender/callback/opt-out evidence and budget/alert owner             |
| Retention/security operating record         | Incomplete     | Named responsible owner, storage durations, access/export/hold/disposal process and backup/log policy  |

The salon data owner is responsible for retention/access decisions; the release
operator for migrations and recovery; the messaging operator for provider/cost
checks; and the go/no-go owner for activation. These are responsibilities, not
assigned people: no names, target or recovery objectives have been supplied.
Record those details in the private operational handoff, not credentials or personal
data in this repository. Existing acceptance does not supply missing policy values.

Until the operating record is completed, preserve the existing 30-day manual review,
append-only evidence and restricted deletion. Do not invent a retention duration,
enable automatic disposal, or activate production outreach. No new export/disposal
API or distributed quota is claimed. Keep provider activation separate from code rollout.

### Data-handling inventory for the operating record

| Record                        | Existing purpose and boundary                                                                                                     | Unresolved operating detail                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Draft and version snapshots   | Exact approved SMS evidence; customer/appointment references, destination, sender/body, actor/version; salon owner/manager access | Named reviewer, retained lifetime and authorized support access                     |
| Message jobs                  | Queue/provider state, dispatch eligibility and shared contact limits; no automatic resend of uncertain/accepted jobs              | Retained lifetime, provider reconciliation and incident owner                       |
| Consent and unsubscribe links | Current dispatch consent and opt-out; capability-bearing URL must remain private                                                  | Access/export/hold/disposal process and linked-record retention                     |
| Outcome response              | On-demand aggregate observations; no new stored outcome record, amounts or clinical notes; sales entitlement required             | Query-load monitoring and production response/log review                            |
| Application logs and backups  | Operational diagnosis and recovery; use sanitized identifiers, never copy draft bodies or capability links                        | Actual storage/access controls, redaction verification, retention and restore owner |

For an access/export or disposal request, route it to the named salon data owner
and authorized operator. Verify tenant and requester authority, preserve any
applicable hold, and use only a separately approved process. Do not disable audit
triggers, reset job state, delete linked records ad hoc or claim a self-service
export/disposal feature. The release remains held until the missing operating
details and any necessary implementation are recorded and verified.

### Local recovery rehearsal — October 24, 2026

Refreshed local release checks: full sequential API **576 passed, 0 failed, 18
opt-in skips**; web **693/693**; shared **179/179**; workspace production build and
lint passed on Node 24.21.0. The first API run against unreachable loopback failed
database-required suites; the complete rerun used a fresh disposable migrated DB
and passed. Logs: `/tmp/oa07-resume-api-isolated.log`,
`/tmp/oa07-resume-web.log`, `/tmp/oa07-resume-shared.log`,
`/tmp/oa07-resume-build.log` and `/tmp/oa07-resume-lint.log`.

All 47 migrations were replayed on a fresh loopback-only PostgreSQL 18 cluster,
port 55443. The existing OA-05 service/HTTP acceptance passed with an injected fake
sender, including OA-07 observations. The resulting synthetic fixture database was
dumped with `pg_dump -Fc` and restored with `pg_restore --exit-on-error` into a
separate database in that disposable cluster.

The source contained 21 drafts, 65 draft events, 20 jobs, 47 migration records,
10 non-internal triggers and 785 public-schema constraints. All table-content
hashes, these counts and trigger definitions matched after restore. The draft-event
append-only UPDATE guard refused changes in both databases. One existing
`appointment_series_rule_check` deparsed with different associative AND parentheses
after restore; its raw definition difference was reviewed and both constraints
remained validated. Constraint-definition hashes therefore were not identical.

This is a synthetic local restore, not a protected production backup, target-data
recovery rehearsal, measured recovery objective or real-provider reconciliation.
The first integrity query used Prisma model names instead of mapped SQL table names;
it was corrected and rerun. No application database or real provider was accessed.
The disposable cluster was stopped cleanly and port 55443 was no longer listening.
Sanitized local evidence: `/tmp/oa07-resume-http.log`,
`/tmp/oa07-resume-restore.log`, `/tmp/oa07-resume-baseline.txt`,
`/tmp/oa07-resume-restored.txt`, `/tmp/oa07-resume-data-diff.log` and
`/tmp/oa07-resume-restored-guards.log`. Temporary files are not durable release evidence;
retain approved sanitized results in the private release handoff before activation.

## Observations, not attributed conversions

Dashboard → Saved drafts and delivery review → Toggle observed outcomes loads a
read-only observation for one saved draft. Reload refreshes current records; failures
hide old observations instead of showing cached success or invented zeroes.

- Delivery uses the existing job's latest status. Only DELIVERED/READ is labelled
  provider-reported delivery, never proof of reading, booking or purchase. ACCEPTED,
  PENDING, RETRY, FAILED, SUPPRESSED and UNCERTAIN do not confirm delivery.
- Unqueued drafts have no observation window or counts, rather than fabricated zeroes.
- Window: `[queue createdAt, min(queue createdAt + 30 elapsed days, asOf))` in UTC.
  This is not 30 salon-local calendar days. Both endpoints and as-of are displayed.
  It deliberately does not infer a delivery timestamp from the mutable job updatedAt.
- Bookings: same customer's booking records created in that window, excluding
  currently cancelled bookings. Future bookings count; old bookings occurring during
  the window do not. No-shows may count. This is not completed visits or treatments.
- Sales: same customer's currently COMPLETED receipts with soldAt in the window.
  Requires the sales entitlement. No amounts, tenders, payment references, refund
  offsets or profitability are exposed. Refunded/voided/currently changed records
  can change observations. A missing sales entitlement hides counts, not zeroes them.
- Company-wide, not outlet-filtered. Overlapping draft windows can count the same
  activity: **do not sum across drafts**. Activity may precede dispatch, occur after
  failed/suppressed messages, or result from unrelated staff/customer actions.
- There is no click/campaign tracking, booking-to-sale relationship, causal model,
  conversion rate, uplift, incremental revenue or claim that outreach caused activity.
  This observational window is a display definition, not an attribution policy.

The authenticated endpoint is `/api/ai-assistant/drafts/:id/outcome`. Current
owner/manager, active tenant, dashboard/customers/appointments entitlements and
tenant-scoped draft lookup are required. Foreign/missing drafts return 404. Counts
include explicit tenant and customer predicates in addition to Prisma tenant scope.
Draft routes use `Cache-Control: no-store`. Outcome reads create no audit rows or
new records; they reuse persisted draft/version/actor evidence and job status.

## Usage and failure controls

| Surface              | Existing enforced control                                                                  | Important limit                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Assistant queue      | 20 entries/company/salon-local queue day, serialized tenant lock                           | Suppressed/failed/uncertain entries still consume quota; not delivery-day spend          |
| Customer outreach    | Shared automatic/manual contact history, consent, destination, booking and interval checks | Rechecked at dispatch; no independent assistant campaign queue                           |
| Q&A                  | 300 characters/question; 3,000/answer; 20 requests/company/user/15 minutes/API process     | In-memory, not a distributed account budget                                              |
| Quiet days           | Seven future local days; ten staff; 120 slot checks; one opening/day; 0% discount          | Preview, not reservation, utilisation or demand forecast                                 |
| Draft/outcome review | 20 drafts/page; one draft per requested outcome; at most 30 elapsed days                   | No persisted-draft storage cap, outcome-specific distributed rate quota or spend ceiling |

No language provider is configured; there is no model spending. SMS may incur
provider charges: queue limits do not guarantee cost limits. Before activation,
approve provider-side spend alerts/limits, recipient scope and observation thresholds.
Do not describe missing storage/distributed-rate controls as implemented.

After a request timeout, reload saved drafts and audit before any new action.
Queue is idempotent for the same draft/version. Edits invalidate approval. Definite
429 rejection follows existing bounded retry with eligibility rechecks. Ambiguous
submission/interrupted leases become UNCERTAIN; never blindly retry, clone a draft
to bypass suppression, or manually rewrite status. Reconcile through provider
evidence and an authorized incident procedure. Callback signature validation,
public origin/proxy configuration and delayed/out-of-order callbacks need separate
environment-specific verification. Provider acceptance is not inbox/delivery evidence.

## Security, audit and retention review

Local code review confirms existing role/module/tenant gates, exact approved SMS
payloads, dispatch-time authorization/consent checks and append-only draft events.
Outcome reads select only customer reference, job status/time and aggregate counts;
no names, phones, message bodies, credentials or clinical/payment data are returned.
The same author may approve: two-person approval is not implemented.

Saved draft bodies and audit snapshots contain personal destinations and a
capability-bearing unsubscribe URL. Authorized owners/managers see these in the
existing preview/audit UI. Do not copy them to analytics, AI context, tickets or
public logs. Use sanitized identifiers and restrict support/backup access.

The approved **30-day manual retention review** is not a deletion schedule. Due
drafts cannot approve/queue/dispatch; reasoned review records reviewer/time/next due
date and invalidates unqueued approvals. No automatic deletion or general assistant
export/disposal endpoint exists. Audit rows are database-enforced append-only and
tenant deletion is restricted. Do not disable triggers or reuse clinical disposal
tools for messaging evidence.

**Operational policy records still needed (acceptance already confirmed):**

- [ ] Record purpose, minimum retained fields, permitted readers/support access,
      retention duration and review responsibility for drafts, audit snapshots,
      message jobs, consent/public links, application logs and backups.
- [ ] Decide authorized export/access-request, legal-hold and eventual disposal
      procedures consistent with append-only evidence and restricted deletion.
      Implement and test any required controlled disposal before claiming readiness;
      no duration or legal compliance is invented by this task.
- [ ] Review protected backups, capability redaction, incident handling and access
      revocation. Verify multi-company denial with actual HTTP/database fixtures.
- [ ] Approve expected volume, provider cost controls and scaling plan for per-process
      Q&A limits and uncapped draft storage; monitor outcome-query load.

## Realistic owner UAT — acceptance confirmed by user

Acceptance of this scope is user-confirmed October 24, 2026. Individual scenario
results, tester and environment were not supplied, so the scenario boxes below
are not represented as new agent-observed tests or separate pending acceptance.

Use an explicitly authorized test salon and fake provider first. Record tester,
revision/environment, date, expected/actual result and sanitized evidence for each:

- [ ] Reconcile briefing and Q&A windows/decimals with source screens; clarify
      unsupported questions, source failure and stale/error recovery.
- [ ] Verify rebooking eligibility, service/company fallback, current destination,
      opt-out, upcoming booking suppression and quiet-day availability limitations.
- [ ] Save/edit/reload exact SMS preview; approve separately; edit invalidates
      approval; queue once and double-click/reload without a duplicate submission.
- [ ] Review accepted, delivered, failed, suppressed and uncertain job examples;
      uncertain has no resend shortcut. Reload after a simulated timeout/error.
- [ ] Create same-customer and other-customer bookings/receipts before/inside/after
      the observation window. Verify exclusions and cancellation/void/refund caveats,
      hidden sales entitlement, empty and unqueued states. Confirm that the owner
      understands these are observations, not caused conversions or revenue.
- [ ] Check role/module/disabled-account changes and foreign-company draft denial;
      inspect paginated version history and due retention review behavior.
- [x] Owner acceptance confirmed October 24, 2026; no new defect list supplied.

The later all-required-acceptance confirmation includes OA-07 and supersedes the
earlier briefing-only acceptance limitation.

## Authorized rollout and recovery checklist — STOP until approved

Repository root: `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite`.
Related implementation notes:
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/owner-draft-delivery.md`,
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/owner-explanations.md`.
Coordinate with
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/coordinated-rollout-checklist.md`;
that checklist's historical migration counts are not current release evidence.

- [ ] Name target environment/tenants, operator, data/recovery owner, go/no-go owner,
      matching revision/artifacts, maintenance window and accepted recovery objectives.
      Obtain explicit authorization for target access, backup/restore rehearsal,
      migrations, writer/worker suspension, deployment and scoped validation.
- [ ] Review current pending migrations, including service interval and draft
      approvals. OA-07 adds no migration. Rehearse the complete pending set on an
      authorized isolated restored baseline, with providers/workers disabled.
      Resolve/review existing prepaid/treatment schema drift separately; do not
      silently accept a schema diff or reset the application database.
- [ ] Verify protected backup plus actual isolated restore, audit triggers, constraints,
      recovery timing and integrity baseline. A migration replay from empty is not
      a production-data restore or rollback rehearsal.
- [ ] Record full API/web/shared checks, skips, lint/typechecks/build and owner UAT.
      Use matching artifacts and Node >=24. Define actual host/service commands in
      the private operational handoff; no deployment topology is assumed here.
- [ ] Keep outbound messaging disabled through migration/API/web checks. Coordinate
      all writers and workers; deploy schema before dependent code, then verify health,
      login/tenant isolation, no-store, exact preview/audit and read-only outcomes.
- [ ] Separately authorize scoped provider testing: verified sender, trusted HTTPS
      messaging origin, signed callback/proxy behavior, actual SMS payload and delivery
      callback, opt-out, definite rejection, uncertain incident process, spend limits.
      Record provider acceptance and delivery separately. Never use real customers
      without explicit scope and current consent.
- [ ] Approve retention/security gates above and an observation window with alert
      ownership for errors, quota rejections, uncertainty, callback failures, duplicate
      contacts, due reviews and provider costs before any tenant activation.

Abort on migration/schema/integrity failures, cross-tenant exposure, mismatched
payload/approval, duplicate sending, broken opt-out or missing callbacks. Stop new
queueing and pause workers through the actual authorized service/config mechanism;
already accepted provider submissions cannot be recalled by stopping the worker.
Preserve jobs, immutable audit and sanitized incident evidence. Do not drop tables,
disable triggers, delete jobs or reset uncertain statuses to retry.

Prefer an evidence-preserving forward fix. Old binaries are not automatically safe
against newer schema or assistant jobs. Database restore and artifact rollback need
separate approval, write reconciliation and explicit accepted data loss; a pre-release
backup is not lossless rollback after new activity. Reconcile external provider sends
against restored jobs **before** resuming to prevent duplicate outreach. Rehearse
this in an isolated environment with fake integrations, not production providers.

## Closure evidence

Store sanitized test results and remaining gaps in
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/TASKS.md` and
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/PROGRESS.md`.
Keep secrets, customer data and operational credentials private. Required acceptance
is user-confirmed; do not request it again. OA-07 is BLOCKED on recording
specific retention/security decisions and separate provider/operational readiness
evidence required by its completion check. Acceptance does not claim that these
operations were performed. Checklist preparation, mock callbacks or passing tests
alone do not authorize release.
