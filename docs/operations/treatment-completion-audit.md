# Treatment completion audit — TK2610-0025

**Historical record: October 22–23, 2026.** Parent status then: **IN PROGRESS**.
Rollout was not performed. This is not current production verification, legal
sign-off, or authorization to erase records.

## Implemented scope

| Area           | Behavior                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Treatments     | Tenant/module/write checks, salon-local dates, paginated editing/list                                            |
| POS linkage    | One whole redemption; POS alone deducts; no historical deduction backfill                                        |
| Photos         | Private before/after links; original photos survive untagging/disposal                                           |
| Consent        | Versioned wording, grant/decline/withdrawal chains, corrections, configurable signatures                         |
| History        | Default 20 / maximum 200 events per page; latest-20 detail preview                                               |
| Status gate    | Current grant on active form required for IN_PROGRESS/COMPLETED and gated type changes                           |
| Retention      | Review reasons/dates, holds, protected archival, immutable forms/events                                          |
| Owner disposal | One completed/cancelled unheld treatment; signed preview, reason, typed confirmation, stale checks, atomic audit |

Disposal preserves the customer, original photos, forms, appointments, POS, and
balances. It does not erase bulk records, exports, or backups. Archive is not full
account deactivation. Expired redemption evidence can document historical care
without spending again. Prepaid sharing/transfers were verified separately
October 23; coordinated rollout remained pending.

## Dated evidence — not rerun by this document

| Run                           | Recorded result                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Prior implementation          | Acceptance 3/3; shared 150/150; web 576/576; typecheck, lint, build, diff checks passed |
| October 22 full API           | 505 total: 406 passed, 98 failed, 1 skipped; exit 1                                     |
| October 23 focused follow-up  | 110/110 passed, no skips                                                                |
| October 23 full API follow-up | 505 total: 504 passed, 0 failed, 1 SEC-01 SMTP skip; exit 0                             |

- Initial failures included 97 route failures from password-only helpers incompatible
  with owner 2FA, plus one messaging rebooking assertion.
- The test-only helper was repaired to receive an OTP through Nodemailer JSON
  transport and complete HTTP verification. Production authentication was not weakened.
- Messaging passed later without code changes; its earlier root cause remains
  unverified. Non-fatal PostgreSQL concurrent-query warnings appeared.
- Follow-up API typecheck, scoped ESLint, and changed-code Prettier passed.
  Prior web/shared/build checks and SEC-01 SMTP acceptance were not freshly rerun.
- Disposable target: `127.0.0.1:55440/package_expiry_test`, 36 applied migrations.
  Cleanup found zero fixture tenants/injected disposal triggers; the cluster stopped.
- No application database access, deployment, external mail, real erasure, agent
  browser walkthrough, or fresh production privacy/security audit occurred.

Historical logs: `/tmp/treatment-completion-*`, `/tmp/route-login-*` (may no longer
exist). Interrupted attempts were not counted as completed evidence.

## Remaining rollout work

Follow the [coordinated checklist](coordinated-rollout-checklist.md).

1. Obtain target-specific approval; inspect actual status and all pending migrations.
2. Verify backups/recovery. Do not rerun already-applied application migrations.
3. Review treatment POS linkage, retention, and consent-history migrations
   (`20261022160000`, `20261022190000`, `20261022200000`).
4. Deploy API/web together: consent history is a page envelope; the old API cannot
   safely write against the append-only schema.
5. Check health, entitlement, owner 2FA/SMTP, and isolated-fixture regressions.
   Do not activate paid messaging or test disposal on real records.
6. Record actual results before task closure. Prefer evidence-preserving forward
   fixes; destructive schema rollback needs separate recovery approval.

No automatic purge, fixed retention period, backup/export deletion, or continuation
into other P2 tasks is authorized by this audit.
