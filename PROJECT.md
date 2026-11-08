# Glampro Suite — project

## Purpose and priority

Improve the existing salon-management product without a rewrite. The application
covers booking, POS, customers, catalogue, staff, packages, messaging, and reporting.
Product direction and supplied demos are not proof of implemented or released behavior.

Commission/payroll is the recorded first-priority workstream. Follow the
[feature index](docs/commission_payroll/README.md) and its task checklist; do not
resume superseded staff-commission work or treat local acceptance as activation.

## Architecture

- npm workspaces; Node.js 24+ and TypeScript.
- `apps/web`: React, Vite, Tailwind, React Query, and shared UI components.
- `apps/api`: Express, Prisma, and PostgreSQL. Routes validate and authorize;
  services own business logic and transactional writes.
- `packages/shared`: schemas, contracts, constants, and commission/payroll logic.
- Tenant/outlet context and backend role/module guards enforce access. A salon's
  `SUPER_ADMIN` role does not grant platform administrator access.
- Operational receipts, payments, holdings, and immutable journals remain
  authoritative. Keep exact-money handling, idempotency, and transaction boundaries.

## Development and safety

Use the [README](README.md) for setup and commands and the
[documentation index](docs/README.md) for feature details.

- Inspect current code, tests, and the working tree before editing. Preserve
  unrelated changes; follow existing conventions and avoid new dependencies.
- API tests require an explicit, separate disposable `TEST_DATABASE_URL`.
  Never use the application database for tests; some fixtures retain receipts.
- Database STOP orders from the commission/payroll targeting incidents remain
  relevant: no application database migrations, resets, cleanup, or repair without
  target-specific owner review and authorization. Older blanket reset permission
  in the history is not current permission. Production deployment, activation,
  payments, and irreversible data changes require explicit authorization.
- Never expose secrets, bypass authentication for local debugging, hand-edit
  generated clients, or weaken immutable-ledger protections for test cleanup.
- Run relevant tests and quality checks. Record actual results and limitations;
  a mocked test is not browser, database, provider, concurrency, or release evidence.

## Decisions and authoritative records

- Current financial policy: [commission/payroll decisions](docs/commission_payroll/DECISIONS.md).
- Feature contracts and operational limits: [documentation index](docs/README.md).
- Architecture decisions ADR 0002–0019 and 0021, plus Design 1–7:
  [preserved project record](docs/archive/2026-11-07/PROJECT.md#architecture-decisions).
- [ADR 0020 — POS vouchers and recorded refunds](docs/decisions/ADR-0020-pos-vouchers-refunds.md).
- Pending work: [TASKS.md](TASKS.md). Recent evidence: [PROGRESS.md](PROGRESS.md).

Stable decision/task IDs and supplied source assets are retained. Historical
checkpoints can be superseded by later records; inspect the feature's current
checklist and code before acting. Resolve conflicting policy explicitly rather
than silently changing business behavior.

## Documentation rule

Keep this overview, tasks, and progress short. Put feature detail in its existing
guide, link instead of duplicating, and archive long histories. This replaces the
older three-documents-only rule; it does not erase approved decisions or evidence.
The [dated archive](docs/archive/2026-11-07/README.md) preserves the full prior records.
