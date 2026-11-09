#!/usr/bin/env bash
# Run as deploy, never as root. systemd units/sudoers are root-owned.
set -Eeuo pipefail
umask 027
ROOT=/opt/glampro_suite
mode=${1:-}
version=${2:-}
[[ ${3:-} == schema-compatible ]] || { echo 'Confirm schema compatibility explicitly' >&2; exit 1; }
[[ $mode == deploy || $mode == activate || $mode == rollback ]] || { echo 'Expected deploy, activate or rollback' >&2; exit 1; }
[[ $version =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo 'Invalid version' >&2; exit 1; }
mkdir -p "$ROOT/releases"
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { echo 'Another production operation is running' >&2; exit 1; }
release="$ROOT/releases/$version"
if [[ $mode == deploy ]]; then
  [[ ! -e $release ]] || { echo 'Release exists; publish a new version or roll back' >&2; exit 1; }
  # Workflow uploads an archive, not an expanded tree: symlinks/modes are preserved.
  (cd "$ROOT/incoming/$version" && sha256sum --check release.tar.gz.sha256)
  mkdir "$release"
  tar --extract --gzip --file "$ROOT/incoming/$version/release.tar.gz" --directory "$release" --no-same-owner --no-same-permissions
  chmod -R g+rX,o-rwx "$release"
fi
[[ -f $release/VERSION && $(cat "$release/VERSION") == "$version" ]] || { echo 'Release version mismatch' >&2; exit 1; }
[[ -f $release/PLATFORM && $(cat "$release/PLATFORM") == ubuntu-22.04-x64 ]] || { echo 'Wrong release platform' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'Release requires x86-64 VPS' >&2; exit 1; }
[[ $(/opt/glampro_suite-runtime/node-v24.21.0/bin/node -p 'process.versions.node') == "$(cat "$release/NODE_VERSION")" ]] || { echo 'Install the exact release Node version before deployment' >&2; exit 1; }
[[ -f $release/apps/api/dist/src/index.js && -f $release/apps/web/dist/index.html ]] || { echo 'Incomplete release' >&2; exit 1; }
previous=''
if [[ -L $ROOT/current ]]; then previous=$(readlink -f "$ROOT/current");
elif [[ -e $ROOT/current ]]; then echo 'current must be a release symlink' >&2; exit 1; fi
if [[ -n $previous && ( $previous != "$ROOT/releases/"* || ! -f $previous/success ) ]]; then
  echo 'Current path is not a recorded healthy release; manual review required' >&2; exit 1
fi
if [[ $mode == rollback ]]; then
  [[ -f $release/success ]] || { echo 'Rollback requires a previously healthy release' >&2; exit 1; }
fi
# Does not apply schema changes. Secrets are loaded by the root-owned unit.
ln -sfn "$release" "$ROOT/candidate"
sudo -n /usr/bin/systemctl restart glampro_suite-migration-status.service
public_host=$(cat /etc/glampro_suite/public-host)
[[ $public_host =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+$ ]] || { echo 'Invalid public hostname' >&2; exit 1; }
worker_enabled=false
[[ ! -e $ROOT/worker-enabled ]] || worker_enabled=true
switch_to() {
  ln -sfn "$1" "$ROOT/.current-next"
  mv -Tf "$ROOT/.current-next" "$ROOT/current"
}
restart_services() {
  # Stop the worker first: never let an old worker overlap a new API release.
  sudo -n /usr/bin/systemctl stop glampro_suite-worker.service || return 1
  sudo -n /usr/bin/systemctl restart glampro_suite-api.service || return 1
  if [[ $worker_enabled == true ]]; then
    sudo -n /usr/bin/systemctl restart glampro_suite-worker.service || return 1
    sleep 2
    /usr/bin/systemctl is-active --quiet glampro_suite-worker.service || return 1
  fi
}
ready() {
  local attempt
  for attempt in {1..12}; do
    if /usr/bin/systemctl is-active --quiet glampro_suite-api.service &&
       curl --fail --silent --max-time 5 http://127.0.0.1:9100/health/ready >/dev/null &&
       curl --fail --silent --max-time 5 --resolve "$public_host:443:127.0.0.1" "https://$public_host/" >/dev/null; then
      return 0
    fi
    sleep 5
  done
  return 1
}
recover() {
  local status=$?
  trap - EXIT
  if [[ $status != 0 ]]; then
    echo 'Deployment failed; database and uploads were not restored.' >&2
    if [[ -n $previous ]]; then
      switch_to "$previous"
      if restart_services && ready; then echo 'Previous application restored.' >&2;
      else echo 'CRITICAL: recovery failed; administrator intervention required.' >&2; fi
    else
      sudo -n /usr/bin/systemctl stop glampro_suite-worker.service || true
      sudo -n /usr/bin/systemctl stop glampro_suite-api.service || true
      rm -f "$ROOT/current"
      echo 'No previous release; application stopped.' >&2
    fi
  fi
  exit "$status"
}
# Catch signals, restart failures, and local readiness failures after activation.
trap recover EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
switch_to "$release"
restart_services
ready
# Marker is not refreshed by rollback; it records initial successful activation.
if [[ ! -f $release/success ]]; then date -u +%FT%TZ > "$release/success"; fi
printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$mode" "$version" >> "$ROOT/deployments.log"
trap - EXIT INT TERM
echo "Healthy release: $version"
