# Add a platform administrator — one-time VPS procedure

This is separate from first-account seeding. Obtain explicit approval for the
target database, authorizing active platform administrator, new account and reason.
Every platform administrator can access all companies. Naming an authorizer is an
audit attribution, not proof of their consent: the sudo administrator must verify
that approval separately. Do not rerun seeds, insert raw SQL or disable verification.

The standalone script uses the deployed release's compiled validation, password
hashing and Prisma client. It requires no new release or migration. It creates the
account and audit record in one transaction and refuses existing emails. It does
not reset passwords or create salon data. Confirm current backups before writes.

## Install reviewed script

Transfer only `deploy/create-platform-admin.mjs` from a trusted workstation to the
VPS administrator's home directory using your existing SSH/SFTP connection. Compare
`sha256sum` on both machines. As `aridient`, install the reviewed file:

```sh
sudo install -d -o root -g root -m 755 /usr/local/lib/glampro_suite-ops
sudo install -o root -g root -m 644 /home/aridient/create-platform-admin.mjs /usr/local/lib/glampro_suite-ops/create-platform-admin.mjs
sudo readlink -f /opt/glampro_suite/current
```

The following example targets the already deployed `v1.0.2`. Stop if current is a
different release; review its compatibility and adjust the version deliberately.

## Temporary credentials — aridient

```sh
sudo sh -c 'umask 077; set -C; : > /run/glampro_suite-add-admin.env'
sudoedit /run/glampro_suite-add-admin.env
```

Enter real values privately, one assignment per line:

```dotenv
ADMIN_EMAIL=NEW_REAL_EMAIL
ADMIN_PASSWORD=NEW_UNIQUE_PASSWORD
ADMIN_NAME="New Operator Name"
AUTHORIZING_ADMIN_EMAIL=EXISTING_ACTIVE_OPERATOR_EMAIL
ADMIN_CREATION_REASON="Approved additional operator"
```

Replace every placeholder. Use a real, non-demo mailbox. Use a unique password of
at least 12 characters and at most 72 UTF-8 bytes. A password-manager-generated
24+ character alphanumeric password avoids environment-file escaping issues.
Never put credentials in shell arguments, logs, Git or chat. If the file already
exists, investigate and edit it rather than overwriting blindly.

## Execute once — aridient

This writes to the database in `/etc/glampro_suite/production.env`. Confirm the
target and approval before running. Do not run deployments concurrently.

```sh
sudo bash <<'CREATE_ADMIN'
set -eu
cd /opt/glampro_suite/releases/v1.0.2/apps/api
exec 9>/opt/glampro_suite/deploy.lock
flock -n 9 || { echo 'STOP: another production operation holds the lock'; exit 1; }
test "$(readlink -f /opt/glampro_suite/current)" = /opt/glampro_suite/releases/v1.0.2
test -s /run/glampro_suite-add-admin.env
systemd-run --unit="glampro_suite-add-admin-$(date -u +%Y%m%d%H%M%S)" --wait \
  --property=Type=oneshot \
  --property=User=glampro_suite \
  --property=Group=glampro_suite-code \
  --property=WorkingDirectory=/opt/glampro_suite/releases/v1.0.2/apps/api \
  --property=EnvironmentFile=/etc/glampro_suite/production.env \
  --property=EnvironmentFile=/run/glampro_suite-add-admin.env \
  --setenv=NODE_ENV=production \
  --property=UMask=0027 \
  --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes \
  --property=ProtectHome=yes \
  --property=ProtectSystem=strict \
  --property=TimeoutStartSec=300 \
  /opt/glampro_suite-runtime/node-v24.21.0/bin/node \
  /usr/local/lib/glampro_suite-ops/create-platform-admin.mjs \
  /opt/glampro_suite/releases/v1.0.2
CREATE_ADMIN
```

Record the unit name printed by systemd-run. Inspect that exact unit's
`Result`/`ExecMainStatus` with `sudo systemctl show UNIT --no-pager -p Result -p ExecMainStatus`
and logs with `sudo journalctl -u UNIT --no-pager -n 40`. Expect success/0 and
`Platform administrator created; email verification remains enabled.`
On failure stop; do not reset, disable verification or blindly retry. A lost
connection can leave a successful job: check the unit before repeating.

After the job finishes, whether it succeeds or fails:

```sh
sudo rm -- /run/glampro_suite-add-admin.env
```

The new operator signs in at `/platform/login` and completes emailed verification.
Working SMTP is required. No API restart is needed. Keep the original account.
Delete the uploaded home-directory script when no longer needed; it contains no
credentials. Unit logs contain no intended password output.

## Verification scope

`bash deploy/test-release.sh` runs offline provisioning tests. They verify control
flow with mocks, not real database rollback, concurrency, SMTP, or a deployed run.
Production execution and login must be verified separately by the administrator.
