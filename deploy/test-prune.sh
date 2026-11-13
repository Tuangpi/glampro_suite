#!/usr/bin/env bash
# Isolated retention tests for prune-releases.sh: no services, no real /opt paths.
set -Eeuo pipefail
base=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
TEST_ROOT=''
new_case() {
  TEST_ROOT="$tmp/$1"
  mkdir -p "$TEST_ROOT/releases" "$TEST_ROOT/incoming"
  sed -e "s@^ROOT=/opt/glampro_suite\$@ROOT=$TEST_ROOT@" "$base/prune-releases.sh" >"$tmp/run.sh"
}
release() { # release <version> <marker-age-days> [failed]
  local version=$1 age=$2 state=${3:-healthy}
  local dir="$TEST_ROOT/releases/$version"
  mkdir -p "$dir"
  if [[ $state == healthy ]]; then printf 'ok\n' >"$dir/success"; fi
  if ((age > 0)); then
    touch -d "$age days ago" "$dir"
    if [[ -f $dir/success ]]; then touch -d "$age days ago" "$dir/success"; fi
  fi
}
incoming() { # incoming <version> <age-days>
  local dir="$TEST_ROOT/incoming/$1"
  mkdir -p "$dir"
  printf 'archive\n' >"$dir/release.tar.gz"
  if (($2 > 0)); then touch -d "$2 days ago" "$dir"; fi
}
link_current() { ln -sfn "$TEST_ROOT/releases/$1" "$TEST_ROOT/current"; }
prune() { bash "$tmp/run.sh" "$@"; }
reject() { if prune "$@" >"$tmp/out" 2>&1; then
  echo "Unexpected success: $*" >&2
  exit 1
fi; }
# Dry run reports candidates and deletes nothing.
new_case dry-run
for version in v1.0.0 v1.0.1 v1.0.2 v1.0.3 v1.0.4 v1.0.5; do release "$version" 0; done
link_current v1.0.5
incoming v1.0.1 10
incoming v1.0.6 0
prune --keep 2 >"$tmp/out"
grep -q 'would remove' "$tmp/out"
[[ ! -e $TEST_ROOT/cleanup.log ]]
for version in v1.0.0 v1.0.1 v1.0.2 v1.0.3 v1.0.4 v1.0.5; do [[ -d $TEST_ROOT/releases/$version ]]; done
[[ -d $TEST_ROOT/incoming/v1.0.1 && -d $TEST_ROOT/incoming/v1.0.6 ]]
# Apply keeps current plus one rollback target and drops the rest.
new_case apply
for version in v1.0.0 v1.0.1 v1.0.2 v1.0.3 v1.0.4 v1.0.5; do release "$version" 0; done
link_current v1.0.5
incoming v1.0.1 10
incoming v1.0.6 0
prune --keep 2 --apply >"$tmp/out"
[[ $(readlink -f "$TEST_ROOT/current") == "$TEST_ROOT/releases/v1.0.5" ]]
[[ -d $TEST_ROOT/releases/v1.0.4 && -d $TEST_ROOT/releases/v1.0.5 ]]
for version in v1.0.0 v1.0.1 v1.0.2 v1.0.3; do [[ ! -e $TEST_ROOT/releases/$version ]]; done
[[ ! -e $TEST_ROOT/incoming/v1.0.1 ]]
[[ -d $TEST_ROOT/incoming/v1.0.6 ]]
grep -q 'removed .*releases/v1.0.3' "$TEST_ROOT/cleanup.log"
grep -q 'removed .*incoming/v1.0.1' "$TEST_ROOT/cleanup.log"
# The running release survives even when it is older than --keep releases.
new_case rollback-target
for version in v1.0.0 v1.0.1 v1.0.2 v1.0.3 v1.0.4 v1.0.5; do release "$version" 0; done
link_current v1.0.2
prune --keep 2 --apply >"$tmp/out"
[[ -d $TEST_ROOT/releases/v1.0.2 ]]
[[ -d $TEST_ROOT/releases/v1.0.4 && -d $TEST_ROOT/releases/v1.0.5 ]]
[[ ! -e $TEST_ROOT/releases/v1.0.3 && ! -e $TEST_ROOT/releases/v1.0.0 ]]
# Failed releases age out, but the newest failed release is retained for diagnosis.
new_case failed
release v1.0.0 40 failed
release v1.0.1 0
release v1.0.2 30 failed
link_current v1.0.1
prune --failed-days 14 --apply >"$tmp/out"
[[ ! -e $TEST_ROOT/releases/v1.0.0 ]]
[[ -d $TEST_ROOT/releases/v1.0.2 ]]
# A pending upload that was never extracted may age out, except the newest one.
new_case pending
release v1.0.0 0
link_current v1.0.0
incoming v1.0.1 40
prune --incoming-days 7 --apply >"$tmp/out"
[[ -d $TEST_ROOT/incoming/v1.0.1 ]]
incoming v1.0.2 30
prune --incoming-days 7 --apply >"$tmp/out"
[[ ! -e $TEST_ROOT/incoming/v1.0.1 ]]
[[ -d $TEST_ROOT/incoming/v1.0.2 ]]
# A held deployment lock skips retention instead of racing it.
new_case locked
release v1.0.0 0
link_current v1.0.0
incoming v1.0.1 40
(exec 8>"$TEST_ROOT/deploy.lock"
  flock -n 8
  prune --incoming-days 0 --apply >"$tmp/out"
  [[ -d $TEST_ROOT/incoming/v1.0.1 ]])
grep -q 'skipping retention' "$tmp/out"
# Unexpected names and symlinks are never touched.
new_case unexpected
release v1.0.0 0
link_current v1.0.0
mkdir -p "$TEST_ROOT/releases/notes" "$TEST_ROOT/incoming/keep-me"
ln -s "$tmp" "$TEST_ROOT/releases/v9.9.9"
prune --apply >"$tmp/out" 2>&1
[[ -d $TEST_ROOT/releases/notes && -d $TEST_ROOT/incoming/keep-me ]]
[[ -L $TEST_ROOT/releases/v9.9.9 ]]
grep -q 'Ignoring unexpected entry: .*releases/notes' "$tmp/out"
# An unrecognised `current` and an unsafe --keep abort before deleting anything.
new_case unsafe
release v1.0.0 0
mkdir "$TEST_ROOT/current"
reject --apply
[[ -d $TEST_ROOT/releases/v1.0.0 ]]
reject --keep 1 --apply
grep -q 'at least 2' "$tmp/out"
[[ -d $TEST_ROOT/releases/v1.0.0 ]]
echo 'Retention regression tests passed: dry-run, keep, protection, age, lock, paths.'
