# Development demo seed

Run `npm run db:seed` from
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite` only after confirming that
`DATABASE_URL` points to the intended development database with migrations applied.
The command writes demo records. It is not a database reset.

The development seed creates:

- A separate platform administrator, `superadmin@gmail.com`, with initial password
  `superadmin12345`. Sign in at `/platform/login`.
- One demo company, **Glampro Demo Salon**, with slug `glampro-demo`.
- Its owner, `admin@gmail.com`, with initial password `admin12345` and company-level
  `SUPER_ADMIN` access. Sign in at `/login`. This role grants no platform access.
- Existing sample staff, customers, catalogue, bookings and sales in that company.

These credentials are development-only. Production seeding still requires explicit
non-demo credentials and does not create the demo platform administrator. Production
platform initialization remains the separate `platform:bootstrap` command.

Email verification is unchanged. Platform login requires working SMTP and the email
code; the company owner follows the existing owner verification flow. Seeding does
not bypass either flow or activate real messaging.

### SMTP connection refused during login

`ECONNREFUSED 127.0.0.1:1025` means the configured local SMTP inbox is not
listening. The API does not start an inbox itself. Start your capture-only SMTP
inbox on loopback before signing in, or configure an authorized SMTP provider.
For a local inbox, the API settings are:

```dotenv
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
```

Restart the API after changing its environment. Read the verification code in
the local inbox's UI; capture-only mail is not delivered to the Gmail mailbox.
Do not unset SMTP to bypass platform verification: platform sign-in refuses
unconfigured email. A refused connection returns `503 EMAIL_SEND_FAILED` and
clears the failed login challenge; retry login after restoring SMTP.

The npm warning about `--skipwarn` is unrelated. Remove that unsupported flag
from the command or launcher that supplies it; it is not required for `npm run dev`.

## Existing databases

Repeated seeds do not duplicate the demo company or platform account. Existing
passwords are preserved, and a disabled platform administrator is not re-enabled.
These passwords are therefore initial credentials, not forced password resets.

The previous seed created `superadmin@gmail.com` as a tenant user. Updating the seed
does not delete or disable that existing user, delete other companies, or reset data.
An existing demo company's ownership is reassigned to `admin@gmail.com` when the
updated seed runs. Cleaning up an old account or resetting its password requires
separate approval and review of its historical references and active sessions.

## Verification

Pure seed tests validate account separation and dataset references. The opt-in test
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/apps/api/prisma/seed-accounts.acceptance.test.ts`
requires a fresh migrated disposable database at
`127.0.0.1:55468/seed_accounts_acceptance` and `SEED_ACCOUNTS_ACCEPTANCE=1`.
It runs the seed twice and checks ownership, hashed initial credentials, unchanged
row counts, audit creation, preserved changed passwords and disabled platform status.
Never point this test at an application database.
