# CI/CD on an Ubuntu VPS

## 1. What this repository provides

There is **no staging environment**. Pull requests and main pushes run CI using
a disposable PostgreSQL database. Stable tags run CI again, build three Linux
amd64 images (API, web, migration tool), scan them, and publish a GitHub Release
with an immutable image-digest manifest. Production deploy/rollback is manual.

Files, relative to the repository root:

| File                             | Purpose                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`       | Format, lint, types, tests, build, dependency audit, Semgrep, Trivy, ClamAV |
| `.github/workflows/release.yml`  | Tag validation, scanned images in GHCR, release bundle                      |
| `.github/workflows/deploy.yml`   | Manual deployment **or rollback**, production environment approval          |
| `deploy/compose.production.yml`  | PostgreSQL, API, frontend, optional messaging worker, migration tool        |
| `deploy/release.sh`              | Server lock, manifest checks, readiness checks, application recovery        |
| `deploy/.env.production.example` | Server-only configuration template                                          |

Assumptions: dedicated **x86-64 Ubuntu 24.04 VPS**, Docker Compose v2 with
`--wait`, default branch **main**, domain pointing to this VPS, host nginx
terminating HTTPS, and new production database/storage. If production already
exists, stop and plan its data/secret/upload transfer first. This setup does not
import existing data, initialize an administrator, or activate financial features.

The path is intentionally fixed at **`/opt/glampro`**, the Compose project at
**`glampro`**, and the frontend binding at **`127.0.0.1:8080`**. Do not edit just
one occurrence if changing these. A single VPS can briefly interrupt service;
this is not a zero-downtime or high-availability setup.

## 2. Values to replace

Normally **no YAML edits are needed** for the current GitHub repository. GHCR
names derive automatically from `github.repository` (lowercased). Before using:

| Value                                    | Where                                | What to do                                                        |
| ---------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `main`                                   | All three workflows                  | Change all branch checks if your default branch differs           |
| `linux/amd64`                            | Release workflow                     | Requires x86-64 VPS; ARM requires different builds and validation |
| `production`                             | Deploy workflow / GitHub Environment | Keep the names identical                                          |
| VPS address, SSH account/port/key        | GitHub Environment secrets           | Configure below; never hardcode keys in YAML                      |
| Public HTTPS origin                      | GitHub variable and VPS environment  | Replace `salon.example.com` everywhere                            |
| Passwords, JWTs, SMTP, PostgreSQL digest | VPS environment file                 | Replace every `REPLACE_...` before deployment                     |

Versions such as `v1.0.0` identify the **whole release**, independent of the
workspace package versions. Only stable `vMAJOR.MINOR.PATCH` tags are accepted.

## 3. GitHub account/repository setup

1. Push these files to your repository's default branch. In **Settings → Actions
   → General**, allow Actions and the SHA-pinned actions used by these workflows.
   Default workflow token permissions can remain read-only; release jobs request
   their own narrowly scoped write permissions.
2. In **Settings → Environments**, create **production**. Allow deployment only
   from `main`. Add required reviewers and prevent self-review if your plan and
   repository visibility support these features. If unavailable, manual dispatch
   remains available, but it is **not independent reviewer approval**. Anyone
   able to change workflows or access the deployment key is highly privileged.
3. Add these **environment secrets** under production:

   | Secret                | Example/meaning                                                  |
   | --------------------- | ---------------------------------------------------------------- |
   | `VPS_HOST`            | `203.0.113.10` or a DNS hostname; IPv4/DNS only in this workflow |
   | `VPS_PORT`            | `22` or your SSH port                                            |
   | `VPS_USER`            | `glampro-deploy`                                                 |
   | `VPS_SSH_PRIVATE_KEY` | Complete private Ed25519 deployment key, including header/footer |
   | `VPS_KNOWN_HOSTS`     | Verified OpenSSH known-hosts line for this host and port         |

4. Add environment **variable** `PRODUCTION_URL`, e.g.
   `https://salon.example.com` (no path).
5. Protect `main`: require pull requests, review, and successful **CI / quality**
   and **CI / security** checks (select their actual displayed names after the
   first run). Disable force pushes. Restrict creation/update/deletion of `v*`
   tags with repository rulesets where available; allow only release maintainers.
6. Releases use the built-in `GITHUB_TOKEN`; do **not** add it as a secret. Ensure
   the repository's Actions token has package-write access to its GHCR packages.
   For existing packages, grant this repository Actions access in package settings.
7. Keep GHCR packages private unless you intend public distribution. For VPS
   pulls, create a dedicated account/token with **read:packages** access only to
   the required packages (authorize organization SSO when applicable). This token
   belongs on the VPS, not in the production application environment.

Protect workflow/security configuration changes with owner review. A checksum in
the GitHub Release detects corruption, not a compromised GitHub maintainer. Image
signing/verification and provenance policy are not implemented by these files.

## 4. Prepare the VPS

Use an administrator session; replace domain, account, port, and key values.
Install Docker Engine and the Compose plugin using Docker's official Ubuntu
instructions, not an unreviewed `curl | sh`. Install prerequisites:

```sh
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx curl util-linux
sudo adduser --disabled-password --gecos '' glampro-deploy
sudo usermod -aG docker glampro-deploy
sudo install -d -m 750 -o glampro-deploy -g glampro-deploy /opt/glampro
sudo install -d -m 700 -o glampro-deploy -g glampro-deploy /home/glampro-deploy/.ssh
```

**Security:** membership in `docker` effectively grants root-level control. Use
a dedicated deployment key and a dedicated VPS; do not treat this as a restricted
unprivileged account. Restrict SSH access at your provider/firewall as practical.
GitHub-hosted runner addresses change; do not lock yourself out with a static
allowlist that excludes them. Do not expose the Docker daemon over TCP.

On your trusted workstation, generate a separate key (not your personal key):

```sh
ssh-keygen -t ed25519 -f ./glampro-deploy -C github-actions-glampro
```

For non-interactive Actions, use a dedicated key without a passphrase. Put its
private contents in `VPS_SSH_PRIVATE_KEY`; never commit the file. Add the public
key as one line in `/home/glampro-deploy/.ssh/authorized_keys`, prefixed with
`restrict ` to disable forwarding/PTY. Set ownership to `glampro-deploy` and mode 600. Keep a separate tested administrator login before disabling password/root
SSH. Reconnect after Docker group membership changes.

Get the host-key fingerprint through your VPS provider console:

```sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

On your workstation, run `ssh-keyscan -p 22 YOUR_VPS_HOST`, verify its fingerprint
against that trusted console value, and put the verified output in
`VPS_KNOWN_HOSTS`. **Do not blindly trust keyscan output or disable host checks.**

Configure inbound firewall/provider rules for your SSH port and TCP 80/443 only.
Docker-published ports can bypass UFW; this Compose file publishes only the web
port on loopback. Never add public 5432/9000/8080 mappings. Keep Ubuntu/Docker
patched and configure monitoring for disk space, backups, HTTPS, and failed jobs.

## 5. Server environment and registry login

Copy `deploy/.env.production.example` to `/opt/glampro/.env.production` on the
VPS. Set owner `glampro-deploy`, mode 600, and replace **all** placeholders.
This file is never uploaded by Actions or committed.

As `glampro-deploy`, select/pin PostgreSQL (17 uses the volume layout in Compose):

```sh
docker pull postgres:17-bookworm
docker image inspect postgres:17-bookworm --format '{{index .RepoDigests 0}}'
```

Use that full `postgres@sha256:...` value for `POSTGRES_IMAGE`. Generate different
random values for password and JWT secrets with `openssl rand -hex 32`. Match
the database password in `POSTGRES_PASSWORD` and `DATABASE_URL`. The database
hostname is **database**, not localhost. Changing the initialization password
later does not change an existing PostgreSQL role password.

Set real HTTPS origins and working SMTP settings; production email is required
for workflows such as authentication codes. Never put secrets in `VITE_` values:
the frontend embeds those publicly and uses `/api` on the same origin.

As the deployment account, authenticate to GHCR once:

```sh
read -rsp 'GHCR read-only token: ' GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_PACKAGE_READER --password-stdin
unset GHCR_TOKEN
```

Docker stores these credentials under that account; protect its home directory.
Rotate both registry credentials and SSH keys periodically.

## 6. Domain, reverse proxy, and HTTPS

Point your DNS A record at the VPS. Only create AAAA if IPv6 is configured.
Create `/etc/nginx/sites-available/glampro` (replace the domain):

```nginx
server {
    listen 80;
    server_name salon.example.com;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # Overwrite untrusted inbound forwarding headers at the public edge.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it and obtain TLS:

```sh
sudo ln -s /etc/nginx/sites-available/glampro /etc/nginx/sites-enabled/glampro
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d salon.example.com
sudo certbot renew --dry-run
```

The container nginx must preserve the trusted host proxy's client address and
scheme; it is reachable only on VPS loopback. Do not put another proxy/CDN in
front without reviewing forwarded-header trust. The API trusts one proxy hop.

## 7. First release and approved database initialization

Commit/merge the pipeline first. From a trusted workstation:

```sh
git switch main
git pull --ff-only
git tag v1.0.0
git push origin v1.0.0
```

Wait for **Release** to succeed. It reruns CI, publishes scanned images to
`ghcr.io/OWNER/REPOSITORY-api`, `-web`, `-migrator`, and creates release assets
`release.tar.gz` plus its checksum. It never automatically deploys.

For a new database, or a release with pending migrations, the owner must review
the exact target, SQL, backups, and rollback compatibility **before** running any
migration. Deployment only executes `prisma migrate status` and stops on pending
migrations. No reset, migration, seed, or administrator creation runs automatically.

After explicit approval, download the GitHub release bundle on a trusted machine
using `gh release download v1.0.0 --pattern 'release.tar.gz*'`, verify with
`sha256sum --check release.tar.gz.sha256`, extract and copy its three files to
`/opt/glampro/incoming/v1.0.0/` as the deployment account. Then on the VPS:

```sh
cd /opt/glampro
exec 9>/opt/glampro/deploy.lock
flock -n 9 || exit 1
docker compose --env-file .env.production --env-file incoming/v1.0.0/images.env -f incoming/v1.0.0/compose.production.yml up -d database
docker compose --env-file .env.production --env-file incoming/v1.0.0/images.env -f incoming/v1.0.0/compose.production.yml run --rm migrator ../../node_modules/.bin/prisma migrate deploy
flock -u 9
```

Replace `v1.0.0` for each approved release. Stop if the migration fails; do not
reset, edit journals, or automatically mark migrations resolved. Production seed
and platform-admin initialization require their own review: see the existing
demo-seeding and platform-console guides. Do not run development seeding on VPS.

## 8. Deploy a release

1. GitHub → **Actions → Production deploy or rollback → Run workflow**.
2. Select **main**, set version (e.g. `v1.0.0`), operation **deploy**.
3. Verify target/previous releases are compatible with the current schema, then
   tick `schema_compatible`. For a first release, verify the selected release.
4. Approve the environment deployment if required reviewers are configured.
5. Watch logs. The job downloads the published bundle, verifies checksum, connects
   using the verified host key, and deploys digest-pinned images.

The server locks deployments, checks migration status, starts services, waits up
to 180 seconds for health, and checks `/api/health` (database readiness) and `/`.
On success it updates `/opt/glampro/current` and `deployments.log`. It does not
restore data or modify the schema. The workflow then checks public HTTPS.

**Public HTTPS check failure does not automatically roll back:** DNS/TLS/network
failure is not evidence the application is broken. Investigate and manually roll
back if appropriate. Local startup/readiness failure restores the prior healthy
application release where available. First deployment has no prior release.
Failed releases remain on disk for investigation; fix and issue a new version.

Messaging stays disabled by default. To activate, follow the existing provider
setup guide, obtain authorization, set `MESSAGING_ENABLED=true`, and
`COMPOSE_PROFILES=messaging` in the server environment. With the profile enabled,
Compose checks the worker stays running, **not** actual provider delivery. Never
treat this as messaging acceptance. When disabling messaging, explicitly stop
and remove the worker using the current Compose configuration before clearing
the profile; do not leave an old worker processing messages.

## 9. Rollback

Use the same workflow, choose **rollback**, and select a version that was
previously healthy on this VPS. Verify database compatibility before checking the
confirmation box. Rollback uses its retained Compose file and image digests;
uploads and database volumes remain unchanged. Deployments are serialized on
GitHub and the server. Emergency server operation, as the deployment account:

```sh
bash /opt/glampro/current/release.sh rollback v1.0.0 schema-compatible
```

Prefer additive, backward-compatible migrations (expand/contract across releases).
A destructive migration can make old application images unusable. **Application
rollback never restores a database backup**: that could erase newer sales,
payments, bookings, and journals. Database recovery is a separate owner-approved
incident operation with a recovery point and outage plan.

## 10. Backups, retention, and maintenance

Before a schema change, produce and verify a PostgreSQL backup and an uploads
backup. Example as deployment account (replace timestamp):

```sh
cd /opt/glampro
mkdir -p -m 700 backups
docker compose --env-file .env.production --env-file current/images.env -f current/compose.production.yml exec -T database sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/database-TIMESTAMP.dump
test -s backups/database-TIMESTAMP.dump
docker compose --env-file .env.production --env-file current/images.env -f current/compose.production.yml exec -T api tar -czf - -C /data uploads > backups/uploads-TIMESTAMP.tar.gz
```

`pg_dump` produces a consistent database snapshot, but uploaded files and database
references are not an atomic snapshot together. Quiesce writes under an approved
maintenance plan when that consistency is required. Schedule encrypted off-VPS
backups with monitoring and retention suited to your data-loss tolerance; these
files do **not** install automated backups. Test restoration on an isolated host,
never by overwriting production. A backup stored only on the VPS is insufficient.

Keep at least the current and several previous healthy releases and their GHCR
digests. Do not delete packages required for rollback or run indiscriminate Docker
volume/image pruning. Logs rotate at 10 MB × 3 per service. Track database/disk
growth. Upgrade pinned PostgreSQL digests deliberately; do not change major
versions without a migration plan. Base application image tags are mutable at
build time; deployed digests are immutable. Rebuild a new release for security
updates. Review/update pinned Actions and scanning tools regularly.

## 11. Security checks and limits

- `npm audit`: blocks high/critical dependency findings (including dev tools).
- Semgrep: version-pinned engine and local rules for dynamic evaluation, backend
  shell execution, and unsafe Prisma queries. This is a **small baseline**, not a
  comprehensive security audit or full dataflow rule pack.
- Trivy: high/critical vulnerabilities, secrets, and configuration findings in
  source/images. Unfixed findings are not silently ignored; scan errors fail.
- ClamAV: updates signatures, scans source and script-disabled installed
  dependencies, then the exported release image filesystem. Oversized scan limits
  are reported as detections rather than quietly skipped. False positives or
  oversized files need investigation, not `continue-on-error`.
- No production secrets are passed to CI tests or release builds. Quality jobs
  execute dependency install scripts in an ephemeral runner without production
  secrets; the separate security job inspects dependencies with scripts disabled.

No scan proves absence of malware or vulnerabilities. Runtime host compromise,
customer uploads after deployment, account takeover, and business authorization
bugs require separate controls. Continuous upload scanning, comprehensive DAST,
image signing, and runtime antivirus are **not implemented**. CI quality/security
checks are independent jobs; a failed security gate prevents release publication
but does not prevent code from executing in the disposable quality runner.

## 12. Troubleshooting and verification

Initial local verification on November 9, 2026 found release blockers in existing
application code/dependencies: an appointment explanatory-text assertion fails;
the Semgrep baseline flags unsafe Prisma calls in `company-purge.service.ts` and
`payroll-close-fixture.ts`; `npm audit` reports 14 advisories, including one high.
Review and resolve these before expecting a green release. These findings are
not proof of exploitable vulnerabilities, and no exceptions have been added.
Four payroll tests timed out in the full suite but passed in isolation. API tests
still require a separately prepared disposable database. Trivy/ClamAV, live image
startup, GitHub execution, and VPS recovery were not verified locally.

```sh
cd /opt/glampro
docker compose --env-file .env.production --env-file current/images.env -f current/compose.production.yml ps
docker compose --env-file .env.production --env-file current/images.env -f current/compose.production.yml logs --tail 100 api web
curl --fail http://127.0.0.1:8080/api/health
curl --fail https://salon.example.com/api/health
```

Do not paste environment files or unredacted logs into issues.

| Failure                       | Check                                                                      |
| ----------------------------- | -------------------------------------------------------------------------- |
| GHCR denied                   | VPS read token, package permissions/SSO, deployment account Docker login   |
| SSH host mismatch             | Verify changed fingerprint via provider console; never bypass verification |
| Pending migrations            | Stop; use the owner-approved migration procedure, never reset              |
| Database auth                 | Match URL/role password; existing volumes retain original credentials      |
| Readiness failure             | API/database logs, schema, required JWT/database values                    |
| HTTPS-only failure            | DNS, host nginx, certificate, provider firewall                            |
| Security job failure          | Fix finding or investigate scanner availability; no bypass is built in     |
| Failed version already exists | Inspect retained failed release; publish a new version                     |

Local checks: `bash -n deploy/release.sh deploy/test-release.sh`,
`bash deploy/test-release.sh`, `npm run verify`, and `npm run build` (tests require
a separately prepared disposable database). On a Docker-equipped machine, validate
Compose with real environment/manifest values, build each Dockerfile target, and
exercise initial deploy, failed deploy, and rollback before using customer data.
Mocked script tests do not prove Docker startup, VPS access, SMTP, messaging, or
production recovery works.

Official references:

- Docker Ubuntu installation: <https://docs.docker.com/engine/install/ubuntu/>
- GitHub environments and availability: <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>
- GHCR authentication: <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>
- ClamAV usage: <https://docs.clamav.net/manual/Usage/Scanning.html>
