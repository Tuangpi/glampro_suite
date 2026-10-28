# CP-003 readiness and plan lifecycle browser acceptance

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
