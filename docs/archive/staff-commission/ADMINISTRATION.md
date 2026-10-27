# SC-004 — Commission administration verification

Local completion: October 27, 2026. This is configuration administration, **not
earnings activation**. SC-006 collection/eligibility and SC-005 reporting/cutover
remain release prerequisites. No application database migration was needed.

## Implemented contract

- Existing commission settings and staff editor now expose all seven kinds.
  Service/product compatibility and legacy service fallback are preserved.
- Staff item → package → department → staff → company → default resolution never
  stacks. Package and stored-credit kinds resolve against their respective active
  package/value-package catalogue; they do not expose a fabricated department.
- Explicit 0% stops resolution; null inherits. Unconfigured kinds resolve to zero,
  except explicitly classified FOC events, whose approved fallback is 5% of the
  eventual FOC event basis. Classification/posting is not enabled by this editor.
- Matrix displays active staff in searchable 20-row pages and seven type columns.
  It edits staff defaults, not item-specific effective rates; preview uses the
  existing staff editor with a selected catalogue item. Blank is unconfigured and
  cannot be submitted as an edited rate; enter `inherit` explicitly.
- Bulk publication accepts 1–100 distinct scopes, one revision, reason and effective
  instant. Tenant lock serializes publication with sale/evidence snapshots. All
  rule events and actor-bearing audit records commit or roll back together.
- Immediate publication uses one server timestamp; future dates are accepted and
  backdating is rejected. An immediate change does not cancel future publications.
  Replace a scheduled rule by publishing the same scope and effective time.
- UI drafts pin their starting revision. Refetch detects stale data, never silently
  rebases a draft. Reload/discard is explicit; failed reload or publication retains
  inputs. Read-only users cannot mutate. API requires staff module, current tenant
  manager/owner authorization and writable tenant; platform tokens are not accepted.
- Existing required-attribution policy editor and its revision/reason/audit controls
  remain the company-policy control. Collection eligibility is deliberately SC-006.

## Automated evidence

- Shared: 197/197, including strict schemas, kind/scope validation, duplicate/bounded
  batches, explicit zero/inheritance and refusal of `activateEarnings` fields.
- Focused API/database: 69/69, no skips. Includes new real HTTP administration
  acceptance plus existing resolver, ledger, redemption evidence and sale service
  tests. Injected second-insert database failure proves first rule/audit rollback;
  concurrent bulk requests produce one success and one revision conflict.
- Legacy commission HTTP acceptance: 1/1, no skips, on fresh disposable PostgreSQL.
  Existing service/product permissions, effective dates, snapshots and refunds pass.
- SC-003 database/HTTP regression: 5/5, no skips, including mixed package/credit/cash,
  attribution policy, correction, locked-period financial links and exact void.
- Full web: 830/830 across 99 files. Matrix tests cover zero/inheritance, pinned
  revisions, failure preservation, pending duplicate-submission protection, read-only
  state, invalid rates, pagination and load errors. Rule tests cover package overrides
  and stale drafts. Settings checks verify role visibility/read-only propagation.
- Workspace `npm run lint`, `npm run typecheck`, `npm run build` pass. Scoped
  Prettier and `git diff --check` are part of final closeout.

## Reproduction

Repository root: `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite`.
Use only disposable PostgreSQL, never migrate an application database for tests.
Fresh PostgreSQL 18 replayed all 55 existing migrations; no new migration was added.

```sh
# From the repository root, after building shared and generating Prisma:
npm run test --workspace @glampro_suite/shared
npm run test --workspace @glampro_suite/web
npm run lint
npm run typecheck
npm run build

# From the API workspace, with an isolated migrated database:
DATABASE_URL=postgresql://tuangpi@127.0.0.1:55465/commission_admin_test \
SC004_ADMIN_TEST=1 NODE_ENV=test \
node --import tsx --test --test-concurrency=1 \
  src/routes/commission-administration.acceptance.test.ts \
  src/services/sale.service.test.ts \
  src/services/commission-rules.test.ts \
  src/services/commission-ledger.test.ts \
  src/services/redemption-commission-evidence.test.ts
```

New acceptance is guarded to localhost port 55465/database `commission_admin_test`.
It creates synthetic tenants, catalogue and sale evidence; it briefly adds a test-only
trigger to fail a second insert, removes it in `finally`, and verifies rollback.
Run it exclusively on that disposable database. The previous legacy HTTP test retains
its own guard at port 55443/database `commission_test`. SC-003 reproduction remains
in VERIFICATION.md. Temporary logs/harnesses under `/tmp/sc004` include synthetic
sessions and must not be committed.

## Browser evidence and limits

Local headless Chrome against real API/Vite/disposable PostgreSQL rendered the
matrix, published two staff defaults atomically, read back 12.50% and explicit
inheritance, observed the FOC 5% fallback, and published a package redemption
override with the correct package name in history. Temporary CORS-origin setup was
corrected before successful publication; no application CORS policy changed.

Human visual/accessibility review, full API suite and a manual correction/package-
tender browser walkthrough were not performed. Existing automated acceptance covers
the latter financial paths, not a claim of full release readiness. No deployment,
live migration, historical backfill, commit, push or earnings activation occurred.
