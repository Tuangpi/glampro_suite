# CI/CD — Ubuntu 22.04 VPS, without Docker

## 1. Overview

**No Docker on the VPS. No staging environment.** Production uses Node.js,
systemd, host nginx, and PostgreSQL. GitHub-hosted CI uses a temporary PostgreSQL
service container only for tests; it is never installed on your server.

```text
Pull request / master push → quality tests + security checks
Stable v1.0.0 tag → CI again → build on Ubuntu 22.04 → scan release → GitHub Release
Manual deploy → verified SSH upload → versioned directory → systemd restart
Local readiness failure → restore previous application release
```

| File                             | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`       | Format, lint, types, tests, build, npm audit, Semgrep, Trivy, ClamAV       |
| `.github/workflows/release.yml`  | Build/scan application archive and publish a GitHub Release                |
| `.github/workflows/deploy.yml`   | Manual deploy or rollback, using production environment controls           |
| `deploy/package-release.sh`      | Package compiled code, dependencies, migrations, metadata                  |
| `deploy/release.sh`              | Server lock, checksum/version checks, activation and recovery              |
| `deploy/systemd/`                | API, optional worker, migration-status, administrator-only migration units |
| `deploy/glampro.sudoers`         | Exact permitted application service operations                             |
| `deploy/.env.production.example` | Production environment template                                            |
| `apps/web/nginx.conf`            | Host nginx site template                                                   |

Assumptions: **Ubuntu 22.04 x86-64**, Node **24.21.0**, branch **master**, one
production domain, PostgreSQL managed on the host or separately. Check `uname -m`
returns `x86_64`. ARM servers require a different build runner and validation.
Release dependencies can include native binaries: do not build on a newer Ubuntu
and assume compatibility. CI packaging uses `ubuntu-22.04` and the same Node
version as the VPS. Existing production databases/uploads are never imported,
reset, seeded, or replaced by this pipeline.

**Existing server:** inspect current services, ports, database, storage and nginx
before installation. These instructions are not authorization to replace an
existing site, create another database over production, or stop live services.
Arrange a reviewed maintenance window for the initial transition.

## 2. What you must replace

| Value                      | Where                                                 | Action                                                                        |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `master`                   | All workflows                                         | Already matches this repository; change every branch check if renamed         |
| `24.21.0`                  | Release workflow and VPS Node install                 | Keep identical; update deliberately and plan rollback across runtime upgrades |
| `salon.example.com`        | nginx, environment, public-host file, GitHub variable | Replace with your real DNS hostname                                           |
| VPS hostname/user/port/key | GitHub production secrets                             | Configure below                                                               |
| `REPLACE_...`              | Server environment                                    | Replace all placeholders with real credentials                                |
| `/opt/glampro`             | Scripts, nginx, units                                 | Fixed installation path; no YAML change normally required                     |
| `/usr/local/bin/node`      | Scripts and units                                     | Install Node here or update all occurrences consistently                      |

No GHCR account, registry token, Docker, or Compose is required. Release versions
identify the whole application and do not change workspace package versions.
The release archive includes locked development dependencies because Prisma's
migration CLI/config need tooling; runtime services still use `NODE_ENV=production`.
This increases archive size and vulnerability surface; all shipped files are scanned.

## 3. GitHub setup

1. Merge these files into **master** and enable Actions under **Settings → Actions
   → General**. Permit the SHA-pinned actions in the workflows. Default token
   permissions may stay read-only; the release publishing job requests contents-write.
2. Create **Settings → Environments → production**. Restrict deployments to
   **master**. Configure required reviewers/prevent self-review if available for
   your GitHub plan and repository visibility. Manual dispatch alone is not
   independent reviewer approval.
3. Add these **production environment secrets**:

   | Secret                | Value                                                             |
   | --------------------- | ----------------------------------------------------------------- |
   | `VPS_HOST`            | IPv4 or DNS hostname; this workflow does not accept IPv6 literals |
   | `VPS_PORT`            | SSH port, e.g. `22`                                               |
   | `VPS_USER`            | `glampro-deploy`                                                  |
   | `VPS_SSH_PRIVATE_KEY` | Complete dedicated Ed25519 private key                            |
   | `VPS_KNOWN_HOSTS`     | Server host-key line verified against provider console            |

4. Add environment **variable** `PRODUCTION_URL`, e.g. `https://salon.example.com`,
   without a path. It must match nginx and the server public-host file.
5. Protect **master**: require pull requests, review, and the displayed **CI quality**
   and **CI security** checks after their first run. Disable force pushes. Restrict
   creation/update/deletion of `v*` tags to release maintainers using rulesets where
   available. Protect workflow/deployment/security-rule changes with owner review.
6. `GITHUB_TOKEN` is supplied automatically; do not create a secret with that name.
   No long-lived GitHub token is needed on the VPS.

The release checksum detects corruption, not a compromised repository maintainer.
Release signing/provenance verification is not implemented. Deployment credentials
can run application code with production access: treat maintainers/key holders as
trusted operators even though they are not given arbitrary sudo.

## 4. Ubuntu prerequisites and Node

Install missing prerequisites after reviewing existing services:

```sh
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx curl xz-utils ca-certificates util-linux
```

Install the official **Linux x64 glibc** Node 24.21.0 binary, not a musl/Alpine
build. Verify its download against official signed checksums before installing.
For an administrator who has verified the official files in a temporary directory:

```sh
# Run only after authenticating SHASUMS256.txt using Node's official release keys.
grep ' node-v24.21.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum --check -
sudo tar -xJf node-v24.21.0-linux-x64.tar.xz -C /usr/local --strip-components=1 --no-same-owner
/usr/local/bin/node --version
```

Do not overwrite an existing system-wide Node installation without reviewing other
applications. systemd does not load your interactive nvm shell configuration;
units intentionally use an absolute, root-owned Node path. The deploy script checks
its exact version against release metadata. Runtime upgrades may prevent rollback
to older archives until the matching Node version is restored under an approved plan.

## 5. Accounts and persistent directories

Run as an administrator; review names if they already exist:

```sh
sudo groupadd --system glampro-code
sudo useradd --system --user-group --home-dir /var/lib/glampro --shell /usr/sbin/nologin glampro
sudo usermod -aG glampro-code glampro
sudo adduser --disabled-password --gecos '' glampro-deploy
sudo usermod -aG glampro-code glampro-deploy
sudo usermod -aG glampro-code www-data
sudo install -d -m 2750 -o glampro-deploy -g glampro-code /opt/glampro
sudo install -d -m 2750 -o glampro-deploy -g glampro-code /opt/glampro/releases /opt/glampro/incoming
sudo install -d -m 750 -o glampro -g glampro /var/lib/glampro /var/lib/glampro/uploads
sudo install -d -m 755 -o root -g root /etc/glampro
```

API/worker run as **glampro**, not the deployment account. They can read release
code but cannot modify it. Only `/var/lib/glampro` is writable inside their service
sandbox. Uploads survive release changes. nginx reads static frontend files through
the `glampro-code` group. Reconnect deployment SSH and restart nginx after group
changes. Do not give `glampro-deploy` general sudo, Docker-group membership, or
write access to systemd units, sudoers, nginx config, or the Node installation.

Install the template as root-owned configuration:

```sh
sudo install -m 600 -o root -g root deploy/.env.production.example /etc/glampro/production.env
sudoedit /etc/glampro/production.env
printf '%s\n' 'salon.example.com' | sudo tee /etc/glampro/public-host >/dev/null
sudo chmod 644 /etc/glampro/public-host
```

Replace the domain before running. systemd reads the root-only EnvironmentFile
before dropping privileges; do not `source` it in a deployment shell. Use
`KEY=value`, no `export`, no shell substitutions, and quoted literal values where
needed. Never commit this file. It is not uploaded by Actions. Generate distinct
JWT secrets with `openssl rand -hex 32`. Use a URL-safe database password or encode
it correctly in the URL. Set real SMTP values; production auth/email workflows need
working SMTP. Never put secrets in browser `VITE_` variables.

`HOST=127.0.0.1` binds the API to loopback. `DATABASE_URL` must reference your
reviewed production database. If PostgreSQL is already installed, reuse the intended
instance/role; do not recreate it. If absent, have the database administrator install
a supported PostgreSQL version, create a least-privilege application role/database,
and configure backups. Keep PostgreSQL loopback/private and match CI's PostgreSQL
major version if your production compatibility requirements differ from CI's 17.

## 6. SSH and constrained service permissions

On a trusted workstation generate a **dedicated** deployment key:

```sh
ssh-keygen -t ed25519 -f ./glampro-deploy -C github-actions-glampro
```

For non-interactive Actions use a dedicated key without a passphrase. Put its
private contents in `VPS_SSH_PRIVATE_KEY`, never in git. On the VPS install its
public key in `/home/glampro-deploy/.ssh/authorized_keys` as one line prefixed
with `restrict ` (disables forwarding/PTY). Directory mode 700, file mode 600,
owned by `glampro-deploy`. Keep a tested separate administrator login.

Get the trusted host-key fingerprint from the provider console:

```sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Run `ssh-keyscan -p 22 YOUR_VPS_HOST` on your workstation; verify the fingerprint
against that console value before storing the output in `VPS_KNOWN_HOSTS`. For a
custom port retain its `[host]:port` format. Never blindly trust keyscan output
or disable host-key verification.

Install the root-owned unit/sudoers files from this repository:

```sh
sudo install -m 644 -o root -g root deploy/systemd/*.service /etc/systemd/system/
sudo visudo -cf deploy/glampro.sudoers
sudo install -m 440 -o root -g root deploy/glampro.sudoers /etc/sudoers.d/glampro
sudo systemctl daemon-reload
```

Deployment can restart/stop only the API/worker and run **read-only migration
status** against the candidate release. The migration-deploy unit is deliberately
not permitted in sudoers. These services execute application code as `glampro`,
never as root. Enable API boot startup only after the first healthy deployment:
`sudo systemctl enable glampro-api.service`. Do not start it before `current` exists.

## 7. nginx, DNS, HTTPS, firewall

Point the domain A record at the VPS; add AAAA only if IPv6 is configured. Copy
`apps/web/nginx.conf` to `/etc/nginx/sites-available/glampro`, replace
`salon.example.com`, then enable it. Do not replace another site's configuration.

```sh
sudo ln -s /etc/nginx/sites-available/glampro /etc/nginx/sites-enabled/glampro
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d salon.example.com
sudo certbot renew --dry-run
```

The static directory will not exist until first deployment; nginx can still
validate/start and Certbot can complete HTTP validation. Keep a valid HTTPS
certificate before deploying: local activation checks use HTTPS with DNS resolution
forced to loopback and the configured hostname. This checks the correct virtual
host, TLS, and frontend; API readiness is checked directly at loopback port 9000.

Allow only your SSH port and public TCP 80/443 through Ubuntu/provider firewalls.
Never expose 9000 or PostgreSQL publicly. Preserve an admin connection while
changing SSH/firewall settings. nginx overwrites untrusted forwarding headers;
the API trusts one reverse proxy. Review this trust model before adding a CDN or
additional proxy. Configure OS security updates and host/disk/HTTPS monitoring.

## 8. Create a versioned release

From the trusted workstation after merging and verifying master:

```sh
git switch master
git pull --ff-only
git tag v1.0.0
git push origin v1.0.0
```

Only `vMAJOR.MINOR.PATCH` stable tags are accepted. The tag commit must be in
master's history. The Release workflow reruns CI, builds with Node 24.21.0 on
Ubuntu 22.04, packages compiled API/shared/frontend plus locked dependencies and
migrations, scans the unpacked archive, and publishes `release.tar.gz` and
`release.tar.gz.sha256`. No build/install scripts execute on the VPS. No release
is deployed automatically. Do not overwrite a published version; issue a new tag.

## 9. First initialization / explicitly approved migrations

Deployments run only `prisma migrate status`; pending migrations stop activation.
No automatic migrate, reset, seed, administrator initialization, or feature
activation occurs. Existing application data must never be used for CI tests.

For a new database or pending schema change, the owner must review the exact
SQL/target, verified backups, and compatibility with current/previous releases
**before** approving a migration. Download release assets with GitHub CLI on a
trusted workstation:

```sh
gh release download v1.0.0 --repo OWNER/REPOSITORY --pattern 'release.tar.gz*'
sha256sum --check release.tar.gz.sha256
```

Copy both assets to `/opt/glampro/incoming/v1.0.0/` as `glampro-deploy`. Under an
approved maintenance window, as **glampro-deploy**, acquire the same deployment
lock and prepare the reviewed candidate directory:

```sh
exec 9>/opt/glampro/deploy.lock
flock -n 9 || exit 1
cd /opt/glampro/incoming/v1.0.0
sha256sum --check release.tar.gz.sha256
# Skip extraction if a failed deployment already prepared this exact directory.
mkdir /opt/glampro/releases/v1.0.0
tar -xzf release.tar.gz -C /opt/glampro/releases/v1.0.0 --no-same-owner --no-same-permissions
chmod -R g+rX,o-rwx /opt/glampro/releases/v1.0.0
```

While that lock remains held, the administrator runs in another session:

```sh
sudo systemctl start glampro-migrate@v1.0.0.service
sudo journalctl -u glampro-migrate@v1.0.0.service --no-pager -n 50
```

If migration fails, stop and investigate; never reset/automatically mark resolved.
After administrator confirmation, release the lock with `flock -u 9`. Because
this release is already extracted, activate it using workflow operation **activate**
(described below), not **deploy**. This also lets you retry a verified prepared
release after correcting an environment issue. Administrator/bootstrap seeding
requires separate review; see the existing demo-seeding/platform-console guides.

Prefer additive backwards-compatible schema changes (expand/contract). Destructive
migrations can make old application archives unusable. The pipeline never rolls
back SQL and never restores a database backup automatically.

## 10. Deploy and verify

GitHub → **Actions → Production deploy or rollback → Run workflow**:

1. Select **master**.
2. Enter the published release, e.g. `v1.0.0`.
3. Choose **deploy** for a new archive, **activate** only for an already extracted,
   reviewed candidate, or **rollback** for a previously healthy release.
4. Confirm schema compatibility with both target and previous release. For the
   first release verify the target against the initialized database.
5. Complete the production environment review if configured; watch workflow logs.

The workflow verifies the checksum, uploads over verified SSH, then runs the
server script as the deployment account. The script acquires a lock, validates
version/platform/Node metadata, runs candidate migration status, atomically switches
`/opt/glampro/current`, restarts services, and verifies readiness/frontend HTTPS.
Successful activations get a `success` marker and an entry in `deployments.log`.
Activation checks are smoke tests, not acceptance tests of sales/payments/payroll.

If local activation fails, the previous symlink and services are restored and
rechecked. A first-release failure stops application services and removes `current`.
Failed candidate directories remain for investigation. Signals are handled after
activation begins, but power loss/SIGKILL cannot guarantee recovery. Investigate
an interrupted deployment before retrying. Downtime and brief frontend/API version
mismatch are possible during activation: this is not zero-downtime deployment.

After local success the workflow checks public HTTPS/API. **Public-only failure
is not automatically rolled back**: diagnose DNS/TLS/firewall/network first. The
local readiness check proves database connectivity, not migration compatibility
beyond the explicit operator confirmation and Prisma status check.

## 11. Rollback and messaging

Run the same workflow with **rollback**, a previously healthy version on this
VPS, and explicit schema-compatibility confirmation. It reuses the retained
archive's code/dependencies, not a rebuild. Uploads, environment and PostgreSQL
remain unchanged. Emergency server operation as deployment account:

```sh
bash /opt/glampro/current/deploy/release.sh rollback v1.0.0 schema-compatible
```

Keep current and several healthy previous releases plus their GitHub assets.
Never delete retained releases needed for recovery. Rolling back across a Node
version change requires the matching Node version and coordinated service restart.
Database restoration is a separate owner-approved incident procedure because it
can erase newer bookings, sales, payments and immutable records.

Messaging is OFF by default. Activate only after the existing provider/tenant
setup and explicit approval. Set `MESSAGING_ENABLED=true` in the root-only
production environment, create `/opt/glampro/worker-enabled`, and enable the
worker boot unit as administrator: `sudo systemctl enable glampro-worker.service`.
Deployment restarts/checks it when that marker exists. A running process is not
proof of provider delivery. To disable, set the environment false, remove the
marker, and `sudo systemctl disable --now glampro-worker.service`. Do not leave
old workers sending messages.

## 12. Backups, monitoring and diagnostics

Set up **scheduled encrypted off-VPS backups**, retention, failure monitoring and
tested restoration before customer data. This repository does not install backup
automation. Example host-local backup under an administrator's approved maintenance
procedure (adapt database authentication/name to the reviewed target):

```sh
sudo install -d -m 700 /var/backups/glampro
sudo -u postgres pg_dump -Fc -d glampro | sudo tee /var/backups/glampro/database-TIMESTAMP.dump >/dev/null
sudo test -s /var/backups/glampro/database-TIMESTAMP.dump
sudo tar -czf /var/backups/glampro/uploads-TIMESTAMP.tar.gz -C /var/lib/glampro uploads
```

Use shell `set -o pipefail` when scripting that pipeline. Database snapshots and
uploads are not atomic together; quiesce writes under an approved plan when needed.
A same-VPS backup is insufficient. Test restores on a separate isolated host, never
by overwriting production. Retain releases and monitor archive/disk growth.
Configure journald limits/retention and alerting; no automatic host log policy is
installed. Restrict logs because they may contain personal data.

```sh
sudo systemctl status glampro-api.service
sudo journalctl -u glampro-api.service -n 100 --no-pager
sudo journalctl -u glampro-migration-status.service -n 50 --no-pager
sudo nginx -t
curl --fail http://127.0.0.1:9000/health/ready
curl --fail https://salon.example.com/api/health
readlink -f /opt/glampro/current
```

Never post production environment files, credentials, or unredacted logs.

| Failure                             | Action                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Node mismatch / native module error | Match release Node version, Ubuntu 22.04 and x86-64; do not install deps on VPS to conceal it |
| SSH failure                         | Verify key, ownership, port, firewall and trusted host fingerprint                            |
| nginx 403                           | Check `glampro-code` membership, traversal/group permissions, nginx restart                   |
| Pending migrations                  | Stop and use explicit owner-approved migration procedure                                      |
| sudo/unit failure                   | Validate root-owned sudoers and units; never grant arbitrary sudo                             |
| Existing release directory          | Inspect candidate; activate only after review or publish a new version                        |
| HTTPS smoke failure                 | Check real hostname, certificate, DNS/loopback config and nginx virtual host                  |
| Security finding                    | Investigate/fix; no bypass is built in                                                        |

## 13. Security checks and verification boundaries

- `npm audit`: blocks high/critical dependency findings, including tooling.
- Semgrep: version-pinned local baseline for dynamic evaluation, shell execution
  and unsafe Prisma raw calls. It is small, not a comprehensive dataflow audit.
- Trivy: high/critical vulnerabilities, secrets and configuration findings in
  source and the complete release tree. Unfixed findings are not ignored.
- ClamAV: refreshes signatures, scans source/script-disabled installed dependencies
  and the final release directory. Scan errors or size-limit detections fail.
- Quality jobs execute dependency scripts only in disposable hosted runners, without
  production secrets. Security and quality are independent jobs; both gate releases.

No scan proves absence of malware/vulnerabilities. Uploads created after deployment,
runtime compromise, authorization bugs, account takeover and host dependencies
need separate controls. Runtime/upload antivirus, full DAST, signing and automatic
host patching/backups are not implemented. Review pinned tools/actions regularly.

Existing earlier local checks found an appointment assertion failure, four payroll
full-suite timeouts (passed in isolation), two Semgrep unsafe-Prisma findings, and
14 dependency advisories including one high. Those are blockers, not approved
exceptions; rerun on the actual branch to establish current status. Disposable API
integration tests require a configured isolated `TEST_DATABASE_URL`.

Run local shell tests with `bash deploy/test-release.sh`. Real systemd startup,
Ubuntu 22.04 native compatibility, migrations, GitHub execution and actual VPS
recovery must be verified before customer production use. Mocked tests do not prove
authentication, messaging, database operations or live recovery works.

Official references:

- Node downloads/checksums: <https://nodejs.org/en/download/>
- systemd execution/environment: <https://www.freedesktop.org/software/systemd/man/systemd.exec.html>
- GitHub environments: <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>
- ClamAV: <https://docs.clamav.net/manual/Usage/Scanning.html>
