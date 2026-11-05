# CP-003 readiness and plan lifecycle browser acceptance

## CP-006 mounted reports browser acceptance — November 4, 2026

The opt-in `apps/api/src/services/payroll-reports-browser.acceptance.test.ts` closes the CP-006
browser item. It uses the same extracted Chrome-pipe helper as CP-003/CP-005 with a real
`createApp`, a real Vite dev server and the disposable PostgreSQL cluster — no response mocks,
no fixture HTML. Enable `RUN_CP006_BROWSER_ACCEPTANCE=true`; port 55175 must be free and
`CORS_ORIGINS` must contain `http://127.0.0.1:55175`. Use only
`127.0.0.1:55485/payroll_close_test`, a verified `/tmp/cp005-*` UTC data directory,
`NODE_ENV=test` and a synthetic `JWT_SECRET` (the fixture asserts host, port, database name,
data-directory prefix and UTC before any write). From the repository root:

```sh
DOTENV_CONFIG_PATH=/dev/null \
DATABASE_URL=postgresql://postgres@127.0.0.1:55485/payroll_close_test \
JWT_SECRET=cp006-browser-test-only NODE_ENV=test \
CORS_ORIGINS=http://127.0.0.1:55175 RUN_CP006_BROWSER_ACCEPTANCE=true \
  node --import tsx --test \
  apps/api/src/services/payroll-reports-browser.acceptance.test.ts
```

Result: **10/10 passed, exit 0**, twice in a row, on a fresh PostgreSQL 18 cluster
(`/tmp/cp005-browser-KIweQd`, UTC, `payroll_close_test`) — `/tmp/cp006-browser.log`. The ten
subcases, all driven through the mounted React app:

1. Owner calculates and approves September through Settings → Payroll close; the state line
   reaches `2026-09: APPROVED`, the calculate control disappears and exactly one close exists.
2. Owner approves the carry month (`2026-10: APPROVED`) and then calculates the open month,
   which is stored as `CALCULATED` only — the refusal for a month whose predecessor is not
   approved is real behaviour the suite has to satisfy, not something the test bypasses.
3. Owner opens the period report: totals present, `Salary`/`Take home` present in the frozen
   statements table yet absent from the report section, `Base lines for Close Staff` opens the
   drill-down with its `Source` column and at least one frozen line.
4. All three frozen exports download from the UI (`Downloaded payroll-2026-09.xlsx.`,
   `…-payslips-2026-09.pdf.`, `…base-ledger-2026-09.csv.`) and the bytes are read back in the
   page: `PK\x03\x04` + spreadsheetml + >2 kB, `%PDF` + >1 kB, and a BOM + CRLF ledger with one
   row per frozen line for all four staff, plus a `?staffId=` ledger filtered to a single row.
5. Manager reads the same frozen report with no salary/take-home column, no owner controls and
   no export buttons, while `GET /:period/report` answers 200 and the export and approve
   requests answer 403.
6. Staff member's Settings → My earnings shows the own month-to-date card labelled an
   **estimate** for the open draft month (no salary column), lists only the two approved months
   `2026-10` and `2026-09`, opens the `2026-09` statement with its commission components, and
   receives exactly the eleven own-statement fields — no staff identity, no salary — while the
   management report and payslip export answer 403.
7. Cashier is told the panel is not theirs, no progress card mounts, and the statements read is 403.
8. The till shows the seller's own `Your commission progress` card for staff and no card for a
   cashier.
9. A customer profile renders the holding history of one real value-package purchase under the
   **Packages & credit** tab: the holding-totals list with unused session value, unused credit
   and source-sale receivables, and the purchase row priced from the source sale.
10. No stray processes or profile directories remain; the Chrome profile is removed with retries.

Boundaries: the session is the same synthetic signed access token the API issues, bootstrapped
into the real `/auth/me`, so this is authenticated browser/API acceptance — **not** login, 2FA,
token refresh or logout acceptance. Month-to-date figures are the last stored calculation rather
than a live recomputation, which is the CP-006 contract and leaves the CP-007 `<500 ms` budget
untested. No human opened the workbook in a spreadsheet application or printed the payslip PDF;
those two eyeball steps stay disclosed as the only manual remainder, and the artefact-level
evidence recorded in `TASKS.md` M1 remains the substitute for them.

## CP-005 mounted close browser acceptance — November 2, 2026

The additional opt-in `apps/api/src/services/payroll-close-browser.acceptance.test.ts`
uses the same extracted Chrome-pipe helper with real createApp/Vite/PostgreSQL.
Use only `127.0.0.1:55485/payroll_close_test`, verified `/tmp/cp005-*` UTC data
directory, `NODE_ENV=test`, synthetic JWT_SECRET and
`CORS_ORIGINS=http://127.0.0.1:55175`. Enable `RUN_CP005_BROWSER_ACCEPTANCE=true`;
port 55175 must be free. No schema migration or application DB access is performed.
Run the test with `node --import tsx --test` from the repository root.

M5 final run: **10/10** including nine subcases,
`/tmp/m5-final-browser.{log,exit}`. It covers manager draft calculate/adjust,
missing reason refusal, real added-receipt stale approval/rollback/recalculation,
owner approve/payout and immutable history, manager salary redaction and direct
owner-action refusal, failed read/retry, outlet scope refusal, staff/cashier denial,
and complete future opening/debt write-off/stale authorization repair.
Historical checkout/configuration setup uses a controlled Date; browser transitions
use the real clock. Future December 2026 opening authorization is exercised on
November 2, 2026, before its effective boundary. Synthetic signed access tokens bootstrap real
auth/me; this is not login/2FA/token-refresh acceptance. No response mocks.
Detailed acceptance and retained release boundaries: APPLICATION_CLOSE_ACCEPTANCE.md.

## CP-003A preview-money acceptance — November 3, 2026

`apps/api/src/services/payroll-historical-preview.acceptance.test.ts` is an opt-in,
non-browser acceptance that requires a migrated disposable database but no Chrome.
Use only `127.0.0.1:55485/payroll_close_test` with PostgreSQL 18, UTC and role
`postgres`, `NODE_ENV=test`, a synthetic `JWT_SECRET`, and
`RUN_CP003A_PREVIEW_ACCEPTANCE=true`. From the repository root:

```sh
RUN_CP003A_PREVIEW_ACCEPTANCE=true NODE_ENV=test LOG_LEVEL=error \
  JWT_SECRET=... DATABASE_URL=postgresql://postgres@127.0.0.1:55485/payroll_close_test \
  node --import tsx --test \
  apps/api/src/services/payroll-historical-preview.acceptance.test.ts
```

It builds a real month (2026-09 with the clock fixed at 2026-10-05), reads the
historical preview, then calculates and freezes the same month through the close,
and asserts that each preview row's `before` result deep-equals the posted
statement result for that staff, that the preview totals equal the posted sum, and
that the preview `inputHash` equals the frozen calculation's `inputHash`. It then
reloads the preview with the month frozen and requires `FROZEN_CLOSE` with identical
money, saves a version-2 draft with a reason and requires `afterTotal` to rise while
`before` stays exactly posted, and finally asserts the check was read-only (one
audit row for the reviewed draft, unchanged close revision and frozen hash).

This proves preview/posted money equality and the frozen-snapshot contract at the
service boundary. It is **not** authenticated browser acceptance: the monetary
states of the preview UI, stale-money refusal after revision/permission changes and
the missing-evidence matrix remain open under CP-003A. The web states that
acceptance must cover: the `AVAILABLE` summary with per-staff rows and salon totals,
the `UNAVAILABLE` blocker list with no money, and the rule version comparison, which
repeats the same money for the version it was calculated for and withholds it for a
different version, an unsaved draft or a bumped plan revision.

The opt-in test at
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/apps/api/src/services/payroll-preview-browser.acceptance.test.ts`
starts the real API and Vite web app and drives installed headless Chrome over its
local debugging pipe. It adds no dependencies and does not expose a debugger port.

## Safety and prerequisites

- Use only the migrated disposable `payroll_configuration_test` database on
  `127.0.0.1:55473` or `127.0.0.1:55474`. The test refuses other database URLs.
  Never use the application database. Schema migration is not part of this test.
- Build shared code and generate the Prisma client using the existing project
  setup before running. Chrome must be installed; `CP003_CHROME` can override
  `/usr/bin/google-chrome`. Keep Chrome sandboxing enabled.
- Port `55173` must be free. The API uses an ephemeral loopback port and Vite
  proxies requests to that API, not the configured application API.
- Supply `DATABASE_URL` and a disposable `JWT_SECRET` in the environment. Do not
  save credentials in this document or test output. Use `NODE_ENV=test` and set
  `CORS_ORIGINS=http://127.0.0.1:55173`; browser POST requests include this origin
  even though Vite proxies them to the API. The test checks this prerequisite.

From `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite`, run:

```sh
RUN_CP003_BROWSER_ACCEPTANCE=true NODE_ENV=test LOG_LEVEL=error \
  CORS_ORIGINS=http://127.0.0.1:55173 \
  node --import tsx --test \
  /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/apps/api/src/services/payroll-preview-browser.acceptance.test.ts
```

Without the opt-in flag, the normal API test run skips this test. Synthetic tenant,
users, outlet, plans, versions and reasoned configuration edits remain in the disposable
database. Immutable audit evidence is deliberately retained; do not disable
triggers or delete audit rows for cleanup. Chrome profile directories and child
processes are cleaned up after execution. Stop the disposable database separately.

## Coverage and limits

Seventeen browser cases verify:

1. Company owner sees on-demand unavailable readiness and inventory disclaimers.
2. A blocked network retry hides prior evidence; an unblocked retry recovers.
3. A real server-side metadata revision change rejects a stale check; reload
   discards the result and a new check succeeds.
4. Database role demotion refuses the next preview request and hides old evidence.
5. Manager UI hides readiness and a direct browser request is denied by the API.
6. Owner outlet UI hides readiness and a direct browser request is denied by the API.
7. Owner sample creation refuses a missing reason without writes, then persists
   the exact shared sample as a draft with the owner's reasoned audit event.
8. Unsaved rule edits cannot be published. Saving then publishing persists the
   revised definition; saving a subsequent future-dated draft leaves the published
   snapshot unchanged and creates version 2 with the expected audit count.
9. Duplication creates a separate draft from the latest source definition.
   Archiving the duplicate persists its revision/audit without changing the source.
10. Manager controls are read-only; a direct publish request is denied with no
    audit or earnings writes and the published snapshot remains unchanged.
11. Commission classification without plan coverage fails without changing the
    employment record or audit, and local join-date/classification edits remain.
12. Owner saves non-commission classification/join date, assigns the published
    company plan, then saves commission classification. Assignment scope, ongoing
    coverage, identity join date and audit revisions/actor/reason are checked.
13. Salon settings retain exact local decimal values after network failure, then
    persist the expected audited payload; explicit reload adopts saved values.
14. Manager assignment/classification/salon controls are disabled and direct API
    writes are refused without audit, collection or earnings writes.
15. Salary saves require a reason and persist exact decimals with owner audit.
    Concurrent salary changes do not silently rebase local edits; explicit reload
    adopts the saved value. Manager UI/API omit salary profiles and salary audit,
    and direct salary writes return 403.
16. Concurrent salon settings changes retain local edits and disable stale saves
    until explicit reload adopts the persisted settings.
17. Commission staff creation without a plan leaves no identity. A reasoned,
    published outlet-scoped initial assignment, classification, join date and
    department link then save atomically. Persisted scope and audit counts are
    checked; manager creation is hidden and direct POST returns 403.

The parent checks preview reads add no earnings, collection or payroll audit
records; only the intentional metadata edit increments payroll audit in that
phase. The lifecycle phase checks persisted versions/audits and verifies no
earnings or collection writes. Text fields use Chrome input; date and select
controls dispatch native DOM events through their normal React handlers.

Session bootstrap uses a locally signed synthetic access token and the real
`/auth/me` route. A bootstrap-only refresh marker is not a working refresh token.
This is authenticated browser/API acceptance, **not** login, 2FA, token refresh or
logout acceptance. No response mocks or demo authorization headers are used.
Permission loss is checked at the next request, not pushed into an idle page.

This does not prove exhaustive configuration UI acceptance (every invalid-definition
flow, staff lifecycle variation and stale-request timing remains unclaimed), complete historical
monetary inputs, full-run calculation equality, every request interleaving or
production readiness. Under the October 28, 2026 approved scope split, historical
monetary integration/full-run equality belongs to CP-003A. CP-003 configuration-only
acceptance completed October 28, 2026; see CONFIGURATION_ACCEPTANCE.md for fresh
regression results and boundaries. CP-004 remains untouched.
