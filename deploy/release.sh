#!/usr/bin/env bash
# Executed on the VPS. All release paths are fixed; never eval a release manifest.
set -Eeuo pipefail
umask 077
ROOT=/opt/glampro
mode=${1:-}
version=${2:-}
[[ ${3:-} == schema-compatible ]] || { echo 'Confirm schema compatibility explicitly' >&2; exit 1; }
[[ $mode == deploy || $mode == rollback ]] || { echo 'Expected deploy or rollback' >&2; exit 1; }
[[ $version =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo 'Invalid version' >&2; exit 1; }
mkdir -p "$ROOT/releases"
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { echo 'Another production operation is running' >&2; exit 1; }
release="$ROOT/releases/$version"
if [[ $mode == deploy ]]; then
  [[ ! -e $release ]] || { echo 'Release already exists; use rollback or a new version' >&2; exit 1; }
  mkdir "$release"
  # Copy from an unprivileged, separately uploaded bundle before validation.
  cp "$ROOT/incoming/$version/compose.production.yml" "$release/compose.production.yml"
  cp "$ROOT/incoming/$version/images.env" "$release/images.env"
  cp "$ROOT/incoming/$version/release.sh" "$release/release.sh"
fi
[[ -f $release/images.env && -f $release/compose.production.yml ]] || { echo 'Missing release files' >&2; exit 1; }
for key in API_IMAGE WEB_IMAGE MIGRATOR_IMAGE; do
  [[ $(grep -c "^$key=" "$release/images.env") == 1 ]] || { echo "Invalid $key" >&2; exit 1; }
  grep -Eq "^$key=ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$" "$release/images.env" || { echo "Unpinned $key" >&2; exit 1; }
done
[[ $(wc -l < "$release/images.env") == 3 ]] || { echo 'Unexpected manifest content' >&2; exit 1; }
compose() {
  local dir=$1; shift
  docker compose --env-file "$ROOT/.env.production" --env-file "$dir/images.env" -f "$dir/compose.production.yml" "$@"
}
previous=$(readlink -f "$ROOT/current" || true)
if [[ $mode == rollback ]]; then
  [[ -f $release/success ]] || { echo 'Rollback requires a previously healthy release' >&2; exit 1; }
  [[ ${3:-} == schema-compatible ]] || { echo 'Confirm schema compatibility explicitly' >&2; exit 1; }
fi
compose "$release" config --quiet
compose "$release" pull
# Schema modifications are deliberately NOT automatic. Run migrate deploy only
# under the separately documented owner-approved migration procedure.
compose "$release" run --rm migrator ../../node_modules/.bin/prisma migrate status
restore() {
  echo 'Deployment failed.' >&2
  if [[ -n $previous && -f $previous/success ]]; then
    echo 'Restoring previous application images (database is NOT restored).' >&2
    compose "$previous" up -d --remove-orphans --wait --wait-timeout 180 || return 1
  fi
}
if ! compose "$release" up -d --remove-orphans --wait --wait-timeout 180; then
  restore
  exit 1
fi
healthy=false
for attempt in {1..12}; do
  if curl --fail --silent --max-time 10 http://127.0.0.1:8080/api/health >/dev/null &&
     curl --fail --silent --max-time 10 http://127.0.0.1:8080/ >/dev/null; then
    healthy=true; break
  fi
  sleep 5
done
if [[ $healthy != true ]]; then restore; exit 1; fi
date -u +%FT%TZ > "$release/success"
ln -sfn "$release" "$ROOT/current"
printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$mode" "$version" >> "$ROOT/deployments.log"
echo "Healthy release: $version"