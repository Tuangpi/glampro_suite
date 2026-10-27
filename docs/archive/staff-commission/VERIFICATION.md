# SC-003 — Local completion evidence

Verified October 27, 2026. This is attribution-only local completion, not a release,
earnings activation, production verification or authorization to migrate live data.

## Acceptance coverage

All paths below ran against a fresh disposable PostgreSQL 18 database. All 55
migrations replayed successfully. The focused run passed 72/72, with no skips.

| Requirement                                                | Evidence                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Independent sellers/performers, up to four, valid shares   | Shared attribution schema tests, sale service tests, editor tests; browser 25/75 sellers and separate therapist    |
| Required attribution and held-sale validation              | Sale service and redemption evidence acceptance; policy HTTP acceptance and Settings/card tests                    |
| Whole service sets, original exact-cent value, own rates   | Redemption evidence and financial posting acceptance                                                               |
| Ownership transfer, family sharing, mixed tender isolation | Correction HTTP and mixed-package/family-credit acceptance                                                         |
| Corrections, exact reversal/repost, current open period    | Financial posting and correction HTTP acceptance, including locked original periods                                |
| Concurrent retries, rollback and one-time restoration      | Financial posting, correction HTTP and mixed-tender acceptance                                                     |
| Roles, tenant isolation, revoked/disabled sessions         | Policy and correction HTTP acceptance; sale service tests                                                          |
| Unknown evidence and duplicate earning refusal             | Financial posting acceptance; normal POS asserts zero new earnings                                                 |
| Same person may sell and perform                           | Independent attribution groups permit overlapping staff; financial activation of sale-side earnings remains SC-006 |

Relevant files are under the repository's absolute root
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite`:

- `apps/api/src/services/sale.service.test.ts`
- `apps/api/src/services/commission-rules.test.ts`
- `apps/api/src/services/commission-ledger.test.ts`
- `apps/api/src/services/redemption-commission-evidence.test.ts`
- `apps/api/src/services/redemption-commission-evidence.acceptance.test.ts`
- `apps/api/src/services/redemption-commission-posting.acceptance.test.ts`
- `apps/api/src/services/redemption-commission-mixed.acceptance.test.ts`
- `apps/api/src/routes/commission-attribution-policy.acceptance.test.ts`
- `apps/api/src/routes/redemption-commission.acceptance.test.ts`

## Commands and results

From the absolute repository root above:

```sh
npm run test --workspace @glampro_suite/shared
npm run test --workspace @glampro_suite/web
npm run lint
npm run typecheck
npm run build
```

- Shared: 196/196; full web: 820/820 across 98 files.
- Workspace lint, typecheck and production build: pass after removing the unused
  platform-auth import. No authentication behavior changes.
- Full API suite was not run. Focused API includes existing sale regressions.

The focused API command is `node --import tsx --test --test-concurrency=1` followed
by the nine files above, relative to the absolute API workspace directory. Set
`NODE_ENV=test`, a synthetic `JWT_SECRET`, and the explicitly disposable
`DATABASE_URL=postgresql://tuangpi@127.0.0.1:55464/commission_redemption_test`.
Enable `SC003_REDEMPTION_TEST`, `SC003_FINANCIAL_TEST`, `SC003_POLICY_TEST`,
`SC003_CORRECTION_HTTP_TEST` and `SC003_MIXED_TEST` with value `1`. Tests assert
that database's exact loopback host, port and name. Never substitute an application
database or run the migration/fixtures against real customer data.

## Browser smoke

Local headless Google Chrome, driven through its local DevTools protocol without
new dependencies, used real Vite and API servers and a synthetic tenant in the
disposable database. A synthetic manager token initialized the browser session;
login/password/MFA flows were not tested.

Verified policy reason gating, real publication and API readback; invalid seller
totals refused; 25/75 seller split and independent 100% therapist saved; reload
preserves the cart attribution; cash payment produces a completed receipt; void
requires a reason and produces the stored voided receipt. Database assertions
confirm retained attribution, separate cashier, void reason and zero earnings.

No package-tender browser walkthrough, correction UI, human visual review, mobile
layout, hardware or live-provider check is claimed. Package/financial correctness
is covered by the enabled acceptance suites, not inferred from this cash smoke.
Concurrent generation/build activity caused development HMR context errors; full
reload restored the app. No fix to HMR behavior is claimed.

Temporary harnesses, screenshots, logs and exit statuses are in
`/tmp/sc003-close`; these are not durable release artifacts and contain synthetic
session material that must not be committed or copied into tracking documents.

## Downstream integration gates

- **SC-004:** publish/administer new commission kinds and package overrides with
  catalogue validation, effective dates, audit and concurrency safeguards.
- **SC-006:** immutable payment-to-line allocation, collections/refund deltas,
  paid-session eligibility, manager overrides and stored-credit ratios. Capture
  of seller/performer evidence is not collection evidence or earned commission.
- **SC-005:** reconciled staff/type/period reporting, locking and exports, plus an
  explicit tenant writer/report cutover preventing legacy/version-1 duplication.
- `postVerifiedRedemptionCommission` remains internal, without a normal POS/route
  caller. `PENDING_RELEASE` snapshots are evidence, not payable report totals.
  Current legacy report/writer filters remain intentional until downstream cutover.
- No first commission release or earnings activation until required downstream
  tasks are DONE. SC-007 payroll is later scope. Do not backfill unknown history.
