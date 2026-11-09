# CI/CD — Ubuntu VPS, no Docker

Ubuntu **22.04 x86-64**, Node **24.21.0**, branch **master**. Production uses
systemd, nginx, and PostgreSQL; there is no staging environment. Only CI tests use
a temporary PostgreSQL container. Existing databases/uploads are never reset or seeded.

Repository commands run from the repository root. VPS commands name the required
account. Replace `salon.example.com`, version examples, and repository placeholders.

## 1. Initial Setup Guide

### GitHub — once

1. Enable Actions and merge the workflows into **master**.
2. Create environment **production**, restrict it to **master**, and configure
   independent reviewers if your GitHub plan allows it.
3. Add these environment secrets:

   | Secret                | Value                                           |
   | --------------------- | ----------------------------------------------- |
   | `VPS_HOST`            | VPS hostname/IPv4 (not an IPv6 literal)         |
   | `VPS_PORT`            | SSH port, e.g. `22`                             |
   | `VPS_USER`            | `deploy`                                |
   | `VPS_SSH_PRIVATE_KEY` | Dedicated Ed25519 private key                   |
   | `VPS_KNOWN_HOSTS`     | Host-key line verified against provider console |

4. Set environment variable `PRODUCTION_URL=https://salon.example.com` (no path);
   match it to nginx and `/etc/glampro_suite/public-host`.
5. Protect **master** with PR/review and the displayed **CI quality/security** checks.
   Disable force pushes; restrict `v*` tags and workflow/security changes to maintainers.
   `GITHUB_TOKEN` is automatic; no GitHub token is needed on the VPS.

### VPS packages and runtime — administrator

Inspect existing services/data before changes; arrange an approved transition window.
Do not overwrite another site, database, or shared Node installation.

```sh
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx curl xz-utils ca-certificates util-linux
```

Install official Linux x64 glibc Node **24.21.0** into a dedicated root-owned
directory, not into a user's NVM or the shared `/usr/local` installation. Download
its archive and authenticate `SHASUMS256.txt` with Node's official release keys
before running the following from the download directory. Do not copy an
unverified binary from an existing NVM installation.

```sh
# Run only after authenticating SHASUMS256.txt using Node's official release keys.
grep ' node-v24.21.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum --check -
# Refuse to overwrite an existing runtime; inspect it separately if present.
sudo install -d -m 755 -o root -g root /opt/glampro_suite-runtime
sudo mkdir -m 755 /opt/glampro_suite-runtime/node-v24.21.0 &&
  sudo tar -xJf node-v24.21.0-linux-x64.tar.xz \
    -C /opt/glampro_suite-runtime/node-v24.21.0 --strip-components=1 --no-same-owner
sudo chown -R root:root /opt/glampro_suite-runtime/node-v24.21.0
/opt/glampro_suite-runtime/node-v24.21.0/bin/node --version
```

Stop if any installation command fails; do not use a partially extracted runtime.
The root-owned `/opt/glampro_suite-runtime/node-v24.21.0/bin/node` must exactly
match release metadata. Verify the runtime parent directory is root-owned and not
writable by deployment/application accounts. Do not add this runtime to global
PATH, create `/usr/local/bin/node` symlinks, replace `/usr/bin/node`, remove root's
NVM, or restart existing PM2 applications as part of this setup. systemd and the
deployment script call the dedicated executable directly. Node upgrades require
updating those paths, tests, and release metadata together and planning rollback.
Have the DBA provision/review the intended least-privilege PostgreSQL role/database,
private access, and backups. CI currently tests PostgreSQL 17.

### Accounts and production environment — administrator

Review existing names first. Reuse the existing shared `deploy` account; the application
runs as the separate non-login user `glampro_suite`, never as `deploy` or root.
Only create the runtime account/group below if they do not already exist.

```sh
sudo groupadd --system glampro_suite-code
sudo useradd --system --user-group --home-dir /var/lib/glampro_suite --shell /usr/sbin/nologin glampro_suite
sudo usermod -aG glampro_suite-code glampro_suite
id deploy
sudo usermod -aG glampro_suite-code deploy
sudo usermod -aG glampro_suite-code www-data
sudo install -d -m 2750 -o deploy -g glampro_suite-code /opt/glampro_suite
sudo install -d -m 2750 -o deploy -g glampro_suite-code /opt/glampro_suite/releases /opt/glampro_suite/incoming
sudo install -d -m 750 -o glampro_suite -g glampro_suite /var/lib/glampro_suite /var/lib/glampro_suite/uploads
sudo install -d -m 755 -o root -g root /etc/glampro_suite
```

Reconnect deployment SSH after group changes; restart nginx after setup. Never give
`deploy` general sudo or write access to root-owned configuration/Node.

```sh
sudo install -m 600 -o root -g root deploy/.env.production.example /etc/glampro_suite/production.env
sudoedit /etc/glampro_suite/production.env
printf '%s\n' 'salon.example.com' | sudo tee /etc/glampro_suite/public-host >/dev/null
sudo chmod 644 /etc/glampro_suite/public-host
```

`public-host` contains only the hostname (for example, `glampro.tusphere.com`),
without `https://`, a path, or a trailing slash. It is separate from nginx configuration.

For an existing VPS, migrate the current production configuration into
`/etc/glampro_suite/` without overwriting existing secrets with the example file.
Keep `production.env` root-owned with mode `600`, and `public-host` root-owned
with mode `644`. Install the updated systemd units and run `sudo systemctl daemon-reload`
before the next activation. Do not delete the previous configuration until the
updated deployment has been verified; running services need an approved restart
to load changed environment values.

The application/data paths and service names now use `glampro_suite`. Existing
installations using `/opt/glampro`, `/var/lib/glampro`, or `glampro-*.service`
need an administrator-reviewed migration window: stop the old API/worker before
starting replacements, preserve releases/uploads and symlink targets, review
ownership for the new runtime account, and retire old units and sudoers only after
verification. Old release scripts still reference the old names; do not assume
cross-layout rollback works. Keep backups and a tested recovery plan. Database
names/credentials and the shared Node installation are not renamed.

Edit the domain and environment before use:

- Set the reviewed `DATABASE_URL`, distinct JWT secrets (`openssl rand -hex 32`),
  real SMTP values, durable uploads, and `HOST=127.0.0.1`.
- Keep `MESSAGING_ENABLED=false`. Never put secrets in git or `VITE_` variables.
- Use literal `KEY=value` syntax, no `export`/shell substitutions. Do not source
  the root-only file; systemd loads it. See `deploy/.env.production.example`.

For an existing environment file, use `sudoedit /etc/glampro_suite/production.env`
and set `PORT=9100` while preserving all other settings/secrets. Before activation,
check `sudo ss -ltnp 'sport = :9100'`; investigate any listener rather than stopping
another project. The deployment readiness probe also uses `127.0.0.1:9100`.
Keep `HOST=127.0.0.1`; do not expose the API port publicly.

### SSH and services

On a trusted workstation:

```sh
ssh-keygen -t ed25519 -f ./glampro_suite-deploy-key -C github-actions-glampro_suite
```

Use a dedicated non-interactive key. Store its private key only in the GitHub secret.
Install the public key in the deploy user's `authorized_keys`, prefixed with
`restrict `; `.ssh` mode 700, file mode 600, both owned by `deploy`.
Keep a separate tested administrator login.
Use a dedicated key per project even when sharing the `deploy` account. Sharing an
account also shares its effective project permissions; different keys do not isolate
projects from that account. Keep existing authorized keys for other deployments.

Verify `ssh-keyscan -p 22 YOUR_VPS_HOST` against the provider-console fingerprint
(`sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). Preserve custom-port
`[host]:port` format in `VPS_KNOWN_HOSTS`; never disable host-key checks.

As administrator, install reviewed repository units and restricted sudoers:

```sh
sudo install -m 644 -o root -g root deploy/systemd/*.service /etc/systemd/system/
sudo visudo -cf deploy/glampro_suite.sudoers
sudo install -m 440 -o root -g root deploy/glampro_suite.sudoers /etc/sudoers.d/glampro_suite
sudo systemctl daemon-reload
```

If units were previously created manually on the VPS, they still contain the old
runtime path until an administrator installs or edits all four definitions. Set
each `ExecStart` executable to
`/opt/glampro_suite-runtime/node-v24.21.0/bin/node`, preserving its arguments,
then run `sudo systemctl daemon-reload`. Inspect with
`sudo systemctl cat glampro_suite-api.service glampro_suite-worker.service glampro_suite-migration-status.service glampro_suite-migrate@.service --no-pager`.
Do not start/enable the API or worker before the runtime, configuration, database,
and first release are ready. Updating local repository files does not update VPS units.

Deployment may operate API/worker and read migration status, not apply migrations.
Do not enable/start the API until the first healthy release exists.

### Domain, HTTPS, and backups — administrator

Point DNS to the VPS. Copy `apps/web/nginx.conf` to
`/etc/nginx/sites-available/glampro` and replace the hostname; preserve other sites.
The template retains its previous frontend root. If using the release layout in
this guide, manually set nginx's frontend root to
`/opt/glampro_suite/current/apps/web/dist`. nginx configuration and site naming
are managed separately; they are not automatically renamed by deployment.
Also change this site's API upstreams to `127.0.0.1:9100`, retaining the existing
path mapping (including `/api/health` to `/health`) and WebSocket settings. The
repository nginx template is intentionally unchanged and still uses port `9000`;
do not copy it over an existing site unchanged. Validate with `sudo nginx -t`
before an administrator-approved reload; preserve other sites and certificates.

```sh
sudo ln -s /etc/nginx/sites-available/glampro /etc/nginx/sites-enabled/glampro
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d salon.example.com
sudo certbot renew --dry-run
```

Allow SSH and public 80/443 only; keep API 9100 and PostgreSQL private. Preserve
admin access during firewall changes. The API expects one trusted reverse proxy;
review that assumption before adding a CDN/proxy.

Before customer data, configure encrypted off-VPS backups, retention, isolated
restore tests, security updates, disk/log/HTTPS monitoring, and alerting. Backup
and host-monitoring automation are not provided by this repository.

**First deployment:** publish a release below, apply approved pending migrations
if needed, then deploy (**activate** if already extracted). After success run
`sudo systemctl enable glampro_suite-api.service`. Verify business workflows before use.

## 2. Daily Workflow

1. Branch from up-to-date **master**; make the change and open a PR.
2. Locally run `npm ci`, `npm run verify`, and `npm run build`.
   Integration tests require an isolated `TEST_DATABASE_URL`, never production.
3. Pass CI quality/security and review; merge. Merging does **not** deploy.
4. When ready to ship, review schema compatibility, backups, and the previous
   healthy version. Create a new stable tag from reviewed master:

```sh
git switch master
git pull --ff-only
git tag v1.0.0
git push origin v1.0.0
```

5. Wait for **Release** to validate, rerun CI, build/scan, and publish the archive/checksum.
   Do not reuse/move a published tag. Releases must be stable `vMAJOR.MINOR.PATCH`
   tags whose commit is in master history.
6. Open **Actions → Production deploy or rollback → Run workflow**, select
   **master**, enter the version, select **deploy**, confirm schema compatibility,
   and complete any production review.
7. Verify frontend, `/api/health`, `/opt/glampro_suite/current`, logs, and critical
   business workflows. Retain the current and several healthy previous releases/assets.

CI gates formatting, lint, types, tests/build, deployment regressions, npm audit,
Semgrep, Trivy, and ClamAV. Fix failures; scans do not prove an application secure.
Runtime/uploads, host security, signing, and full DAST need separate controls.
Checksums detect corruption, not malicious maintainer changes. Treat deployment
key holders and release maintainers as trusted production operators.

## 3. Special Workflows

### Rollback or retry

Use the same workflow on **master** with schema-compatibility confirmation:

| Operation  | When                                                        |
| ---------- | ----------------------------------------------------------- |
| `deploy`   | New archive; target directory must not exist                |
| `activate` | Reviewed, complete candidate already extracted              |
| `rollback` | Retained previously healthy version with a `success` marker |

The workflow downloads GitHub assets for every operation, including rollback.
Rollback reuses retained code/dependencies; it does **not** restore SQL, environment,
or uploads. Match the target's exact Node version. For emergency rollback as deploy user:

```sh
bash /opt/glampro_suite/current/deploy/release.sh rollback v1.0.0 schema-compatible
```

Local activation failures attempt previous-release recovery. With no previous
release, services stop and `current` is removed. Public-only HTTPS failure does
**not** trigger automatic rollback. Inspect DNS/TLS/network first. Power loss/SIGKILL
may interrupt recovery; check symlink/services/logs before retrying. Never delete
an active lock or run overlapping operations. Activation is not zero-downtime.

### Approved migrations

Deployment checks migration status only; pending migrations block activation.
Obtain explicit owner approval for SQL/target, verified backups, the maintenance
window, and target/previous-release compatibility. Review **all pending SQL**.

Download assets on a trusted workstation:

```sh
gh release download v1.0.0 --repo OWNER/REPOSITORY --pattern 'release.tar.gz*'
sha256sum --check release.tar.gz.sha256
```

Copy both assets to `/opt/glampro_suite/incoming/v1.0.0/` as `deploy`.
In the approved window, the deploy user holds the shared lock and prepares the candidate:

```sh
exec 9>/opt/glampro_suite/deploy.lock
flock -n 9 || exit 1
cd /opt/glampro_suite/incoming/v1.0.0
sha256sum --check release.tar.gz.sha256
# Skip extraction if a failed deployment already prepared this exact directory.
mkdir /opt/glampro_suite/releases/v1.0.0
tar -xzf release.tar.gz -C /opt/glampro_suite/releases/v1.0.0 --no-same-owner --no-same-permissions
chmod -R g+rX,o-rwx /opt/glampro_suite/releases/v1.0.0
```

While the lock remains held, an administrator runs in another session:

```sh
sudo systemctl start glampro_suite-migrate@v1.0.0.service
sudo journalctl -u glampro_suite-migrate@v1.0.0.service --no-pager -n 50
```

Stop and investigate failures; never reset or blindly mark resolved. After confirmed
success, unlock with `flock -u 9` and select **activate** in the workflow.
Prefer backwards-compatible migrations. Database restore is a separate approved
incident action with explicit data-loss accounting, not automatic rollback.
Bootstrap/seeding requires separate review; see [platform console](platform-console.md).

### Messaging and diagnostics

Messaging stays off until separately approved. Follow [WhatsApp/SMS setup](whatsapp-sms-integration.md).
An administrator sets `MESSAGING_ENABLED=true`, creates `/opt/glampro_suite/worker-enabled`,
and enables `glampro_suite-worker.service`; deployment then starts/checks it. To disable,
set false, remove the marker, and `sudo systemctl disable --now glampro_suite-worker.service`.
Verify actual provider delivery, not just a running process.

```sh
sudo systemctl status glampro_suite-api.service
sudo journalctl -u glampro_suite-api.service -n 100 --no-pager
sudo journalctl -u glampro_suite-migration-status.service -n 50 --no-pager
sudo nginx -t
curl --fail http://127.0.0.1:9100/health/ready
curl --fail https://salon.example.com/api/health
readlink -f /opt/glampro_suite/current
```

| Failure                    | Check                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| SSH                        | Key ownership, port/firewall, trusted fingerprint                          |
| Node/native module         | Exact Node, Ubuntu 22.04, x86-64; do not patch dependencies on VPS         |
| nginx 403 / HTTPS          | Group permissions, correct host, certificate, DNS/proxy                    |
| Pending migrations         | Approved migration procedure above                                         |
| Existing release directory | Inspect candidate; use activate or publish a new version                   |
| sudo/unit / recovery       | Root-owned configuration and restricted permissions; involve administrator |

Keep logs redacted. Run `bash deploy/test-release.sh` locally for mocked regressions;
verify real GitHub execution, systemd, native compatibility, migration/recovery, and
business workflows before production. Historical test findings are not current results.
