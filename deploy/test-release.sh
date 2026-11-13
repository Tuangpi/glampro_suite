#!/usr/bin/env bash
# No real service operations or databases: every case gets an isolated root.
set -Eeuo pipefail
base=$(cd "$(dirname "$0")" && pwd)
node --test "$base/verify-prisma-engine.test.cjs"
node --test "$base/create-platform-admin.test.mjs"
bash "$base/test-prune.sh"
# Guard the shared deployment account and runtime isolation against naming drift.
for name in glampro_suite-api glampro_suite-worker glampro_suite-migration-status glampro_suite-migrate@; do
  unit="$base/systemd/$name.service"
  grep -qx 'User=glampro_suite' "$unit"
  grep -qx 'Group=glampro_suite-code' "$unit"
  grep -qx 'EnvironmentFile=/etc/glampro_suite/production.env' "$unit"
  grep -q '^WorkingDirectory=/opt/glampro_suite/' "$unit"
  grep -q '^ExecStart=/opt/glampro_suite-runtime/node-v24\.21\.0/bin/node ' "$unit"
done
# Retention runs as the deployment account, never as root or the runtime account.
grep -qx 'User=deploy' "$base/systemd/glampro_suite-prune.service"
grep -qx 'Group=glampro_suite-code' "$base/systemd/glampro_suite-prune.service"
grep -qx 'ExecStart=/bin/bash /opt/glampro_suite/current/deploy/prune-releases.sh --apply' \
  "$base/systemd/glampro_suite-prune.service"
grep -qx 'ReadWritePaths=/opt/glampro_suite' "$base/systemd/glampro_suite-prune.service"
grep -qx 'OnCalendar=daily' "$base/systemd/glampro_suite-prune.timer"
grep -qx 'PORT=9100' "$base/.env.production.example"
grep -q '^deploy ALL=(root) NOPASSWD:' "$base/glampro_suite.sudoers"
for service in glampro_suite-api glampro_suite-worker glampro_suite-migration-status; do
  test -f "$base/systemd/$service.service"
  grep -q "/usr/bin/systemctl restart $service.service" "$base/glampro_suite.sudoers"
done
test -f "$base/systemd/glampro_suite-migrate@.service"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
export TEST_ROOT TEST_LOG TEST_FAILURE
TEST_LOG="$tmp/commands.log"
TEST_FAILURE="$tmp/failure"
cat > "$tmp/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
if [[ -f $TEST_FAILURE ]]; then
  reason=$(cat "$TEST_FAILURE")
  if [[ $reason == migration && "$*" == *migration-status* ]]; then exit 1; fi
  if [[ $reason == restart && "$*" == 'restart glampro_suite-api.service' && $(readlink "$TEST_ROOT/current") == *v1.0.1 ]]; then exit 1; fi
  if [[ $reason == worker && "$*" == 'is-active --quiet glampro_suite-worker.service' && $(readlink "$TEST_ROOT/current") == *v1.0.1 ]]; then exit 1; fi
fi
MOCK
cat > "$tmp/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
[[ $1 == -n ]] && shift
exec "$@"
MOCK
cat > "$tmp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$TEST_LOG"
if [[ "$*" == *'/health/ready'* && "$*" != *'http://127.0.0.1:9100/health/ready'* ]]; then exit 1; fi
if [[ -f $TEST_FAILURE && $(cat "$TEST_FAILURE") == health && $(readlink "$TEST_ROOT/current") == *v1.0.1 ]]; then exit 1; fi
exit 0
MOCK
printf '#!/usr/bin/env bash\nprintf "24.21.0\\n"\n' > "$tmp/bin/node"
printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/bin/sleep"
printf '#!/usr/bin/env bash\nprintf "x86_64\\n"\n' > "$tmp/bin/uname"
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH"
new_case() {
  TEST_ROOT="$tmp/$1"
  mkdir -p "$TEST_ROOT/releases" "$TEST_ROOT/incoming"
  printf 'salon.example.com\n' > "$TEST_ROOT/public-host"
  rm -f "$TEST_FAILURE"
  sed -e "s@^ROOT=/opt/glampro_suite\$@ROOT=$TEST_ROOT@" \
      -e "s@/usr/bin/systemctl@$tmp/bin/systemctl@g" \
      -e "s@/opt/glampro_suite-runtime/node-v24.21.0/bin/node@$tmp/bin/node@g" \
      -e "s@/etc/glampro_suite/public-host@$TEST_ROOT/public-host@g" "$base/release.sh" > "$tmp/run.sh"
}
archive() {
  local version=$1 dir="$tmp/package"
  rm -rf "$dir"
  mkdir -p "$dir/apps/api/dist/src" "$dir/apps/web/dist" "$dir/deploy" "$TEST_ROOT/incoming/$version"
  printf '%s\n' "$version" > "$dir/VERSION"
  printf 'ubuntu-22.04-x64\n' > "$dir/PLATFORM"
  printf '24.21.0\n' > "$dir/NODE_VERSION"
  touch "$dir/apps/api/dist/src/index.js" "$dir/apps/web/dist/index.html"
  cp "$base/release.sh" "$dir/deploy/"
  tar -czf "$TEST_ROOT/incoming/$version/release.tar.gz" -C "$dir" .
  (cd "$TEST_ROOT/incoming/$version" && sha256sum release.tar.gz > release.tar.gz.sha256)
}
run() { bash "$tmp/run.sh" "$@"; }
reject() { if run "$@" >/dev/null 2>&1; then echo "Unexpected success: $*" >&2; exit 1; fi; }
new_case success
archive v1.0.0
reject deploy 'v1.0.0;id' schema-compatible
reject deploy v1.0.0
run deploy v1.0.0 schema-compatible
[[ $(readlink "$TEST_ROOT/current") == "$TEST_ROOT/releases/v1.0.0" ]]
reject deploy v1.0.0 schema-compatible
reject rollback v1.0.0
reject rollback v9.0.0 schema-compatible
archive v1.0.1
run deploy v1.0.1 schema-compatible
run activate v1.0.1 schema-compatible
run rollback v1.0.0 schema-compatible
[[ $(readlink "$TEST_ROOT/current") == "$TEST_ROOT/releases/v1.0.0" ]]
printf 'wrong-version\n' > "$TEST_ROOT/releases/v1.0.1/VERSION"
reject activate v1.0.1 schema-compatible
printf 'v1.0.1\n' > "$TEST_ROOT/releases/v1.0.1/VERSION"
printf '99.0.0\n' > "$TEST_ROOT/releases/v1.0.1/NODE_VERSION"
reject activate v1.0.1 schema-compatible
for failure in restart health migration worker; do
  new_case "$failure"
  archive v1.0.0
  run deploy v1.0.0 schema-compatible
  archive v1.0.1
  if [[ $failure == worker ]]; then touch "$TEST_ROOT/worker-enabled"; fi
  printf '%s\n' "$failure" > "$TEST_FAILURE"
  reject deploy v1.0.1 schema-compatible
  [[ $(readlink "$TEST_ROOT/current") == "$TEST_ROOT/releases/v1.0.0" ]]
  [[ ! -f $TEST_ROOT/releases/v1.0.1/success ]]
done
new_case checksum
archive v1.0.0
printf 'corrupt' >> "$TEST_ROOT/incoming/v1.0.0/release.tar.gz"
reject deploy v1.0.0 schema-compatible
[[ ! -e $TEST_ROOT/current ]]
new_case first-failure
archive v1.0.1
printf 'restart\n' > "$TEST_FAILURE"
reject deploy v1.0.1 schema-compatible
[[ ! -e $TEST_ROOT/current ]]
grep -q 'stop glampro_suite-api.service' "$TEST_LOG"
grep -q 'curl .*http://127.0.0.1:9100/health/ready' "$TEST_LOG"
new_case locked
archive v1.0.0
(exec 8>"$TEST_ROOT/deploy.lock"; flock -n 8; reject deploy v1.0.0 schema-compatible)
! grep -q 'glampro_suite-migrate@' "$TEST_LOG"
echo 'Deployment regression tests passed: activation, rollback, recovery, checksum, lock, confirmations.'
