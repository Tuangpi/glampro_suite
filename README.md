# Glampro Suite

Salon management: appointments, POS, customers, catalogue, staff, packages,
messaging, and commission/payroll.

## Start here

- [Documentation](docs/README.md) — feature guides and operational references.
- [Project](PROJECT.md) — architecture, priorities, and safety constraints.
- [Tasks](TASKS.md) — outstanding work and release gates.
- [Progress](PROGRESS.md) — recent changes and verification.

## Local development

Requirements: Node.js **24+**, npm, and a running PostgreSQL database.

From the repository root:

```sh
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Copy templates only if those local files do not already exist. Edit the API
environment: set `DATABASE_URL` to the intended development database and replace
`JWT_SECRET` with a private random value. Match the web proxy target to the API
port. The templates do not start PostgreSQL or create a database.

On a new, approved development database:

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Default addresses: web `http://localhost:5173`, API `http://localhost:9000`.
The development seed creates one demo salon; it is not a reset. See
[demo accounts, email verification, and seeding](docs/development/demo-seeding.md).

## Common commands

Production CI/CD setup: [Ubuntu VPS guide](docs/operations/CI_CD.md) covers GitHub
settings, security scans, configuration values, versioned releases, and rollback.
Optional error monitoring: [Sentry setup and privacy](docs/operations/sentry.md).

| Command                     | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `npm run dev`               | Start shared build watcher, API, and web                       |
| `npm run build`             | Build all workspaces and generate Prisma client                |
| `npm run lint`              | Lint workspaces                                                |
| `npm run typecheck`         | Build shared contracts, generate Prisma client, check types    |
| `npm test`                  | Run workspace tests; requires a disposable API test database   |
| `npm run verify`            | Formatting, lint, typecheck, and tests; stops on first failure |
| `npm run db:migrate:status` | Inspect migration status for the configured database           |

API tests require **`TEST_DATABASE_URL`**, separate from the application database.
Create and migrate the disposable database before testing; some tests intentionally
retain immutable receipts. See [test database setup](docs/development/demo-seeding.md#keep-automated-tests-out-of-the-application-database).
Do not run `db:reset`, application migrations, deployment, or activation without
the appropriate target review and authorization.
