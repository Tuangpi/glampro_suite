#!/usr/bin/env bash
# Retention for /opt/glampro_suite. Run as deploy, never as root.
# Dry-run by default; --apply performs deletions. Never deletes the release behind
# `current`, the two newest healthy releases, or a pending staging upload.
set -Eeuo pipefail
umask 027
ROOT=/opt/glampro_suite
keep=3
incoming_days=7
failed_days=14
apply=false
usage() {
  cat <<'USAGE'
Usage: prune-releases.sh [--keep N] [--incoming-days N] [--failed-days N] [--apply]

  --keep N           healthy releases to retain, minimum 2   [3]
  --incoming-days N  remove staging uploads older than N days [7]
  --failed-days N    remove failed releases older than N days [14]
  --apply            delete the reported paths; default only reports them
USAGE
}
while (($#)); do
  case $1 in
    --keep) keep=${2:?--keep requires a value}; shift 2 ;;
    --incoming-days) incoming_days=${2:?--incoming-days requires a value}; shift 2 ;;
    --failed-days) failed_days=${2:?--failed-days requires a value}; shift 2 ;;
    --apply) apply=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done
# Two healthy releases are the minimum: the running one and a rollback target.
[[ $keep =~ ^[0-9]+$ && $keep -ge 2 ]] || { echo '--keep must be an integer of at least 2' >&2; exit 1; }
[[ $incoming_days =~ ^[0-9]+$ ]] || { echo '--incoming-days must be a non-negative integer' >&2; exit 1; }
[[ $failed_days =~ ^[0-9]+$ ]] || { echo '--failed-days must be a non-negative integer' >&2; exit 1; }
[[ -d $ROOT/releases ]] || { echo "Missing $ROOT/releases" >&2; exit 1; }
# Serialise with deployment: a prune must never race an activation or rollback.
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { echo 'Another production operation is running; skipping retention'; exit 0; }
current=''
if [[ -L $ROOT/current ]]; then current=$(readlink -f "$ROOT/current"); fi
if [[ -e $ROOT/current && ! -L $ROOT/current ]]; then echo 'current must be a release symlink' >&2; exit 1; fi
now=$(date +%s)
incoming_cutoff=$((now - incoming_days * 86400))
failed_cutoff=$((now - failed_days * 86400))
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
: >"$tmpdir/healthy"
: >"$tmpdir/failed"
version_name() { [[ ${1##*/} =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }
mtime() { stat -c %Y "$1" 2>/dev/null || printf '0'; }
log() {
  local line
  line="$(date -u +%FT%TZ) $*"
  printf '%s\n' "$line"
  if [[ $apply == true ]]; then printf '%s\n' "$line" >>"$ROOT/cleanup.log"; fi
}
for dir in "$ROOT"/releases/*/; do
  [[ -d $dir && ! -L ${dir%/} ]] || continue
  dir=${dir%/}
  version_name "$dir" || { echo "Ignoring unexpected entry: $dir" >&2; continue; }
  if [[ -f $dir/success ]]; then
    printf '%s %s\n' "$(mtime "$dir/success")" "$dir" >>"$tmpdir/healthy"
  else
    printf '%s %s\n' "$(mtime "$dir")" "$dir" >>"$tmpdir/failed"
  fi
done
mapfile -t healthy < <(sort -rn "$tmpdir/healthy" | cut -d' ' -f2-)
mapfile -t failed < <(sort -rn "$tmpdir/failed" | cut -d' ' -f2-)
protected=' '
for entry in "$current" "${healthy[0]:-}" "${healthy[1]:-}"; do
  if [[ -n $entry ]]; then protected+="$entry "; fi
done
is_protected() { [[ $protected == *" $1 "* ]]; }
failures=0
freed=0
removals=0
remove() {
  local path=$1 reason=$2 bytes=0 size
  if [[ $path != "$ROOT/releases/"* && $path != "$ROOT/incoming/"* ]]; then
    echo "Refusing to delete unexpected path: $path" >&2
    failures=$((failures + 1))
    return
  fi
  if ! version_name "$path"; then
    echo "Refusing to delete non-release path: $path" >&2
    failures=$((failures + 1))
    return
  fi
  if [[ ! -d $path || -L $path ]]; then
    echo "Refusing to delete non-directory: $path" >&2
    failures=$((failures + 1))
    return
  fi
  if size=$(du -sb -- "$path" 2>/dev/null | cut -f1) && [[ $size =~ ^[0-9]+$ ]]; then bytes=$size; fi
  if [[ $apply == true ]]; then
    if rm -rf -- "$path"; then
      freed=$((freed + bytes))
      removals=$((removals + 1))
      log "removed $path ($reason, ${bytes}B)"
    else
      echo "Failed to remove $path" >&2
      failures=$((failures + 1))
    fi
  else
    freed=$((freed + bytes))
    removals=$((removals + 1))
    log "would remove $path ($reason, ${bytes}B)"
  fi
}
index=0
for dir in "${healthy[@]:-}"; do
  [[ -n $dir ]] || continue
  index=$((index + 1))
  if ((index <= keep)); then continue; fi
  if is_protected "$dir"; then continue; fi
  remove "$dir" 'superseded release'
done
# Keep the newest failed release for diagnosis; older ones only consume space.
index=0
for dir in "${failed[@]:-}"; do
  [[ -n $dir ]] || continue
  index=$((index + 1))
  if ((index == 1)); then continue; fi
  if is_protected "$dir"; then continue; fi
  if (($(mtime "$dir") >= failed_cutoff)); then continue; fi
  remove "$dir" 'failed release'
done
newest_incoming=''
if [[ -d $ROOT/incoming ]]; then
  for dir in "$ROOT"/incoming/*/; do
    [[ -d $dir && ! -L ${dir%/} ]] || continue
    dir=${dir%/}
    version_name "$dir" || { echo "Ignoring unexpected entry: $dir" >&2; continue; }
    if [[ -z $newest_incoming ]] || (($(mtime "$dir") > $(mtime "$newest_incoming"))); then newest_incoming=$dir; fi
  done
  for dir in "$ROOT"/incoming/*/; do
    [[ -d $dir && ! -L ${dir%/} ]] || continue
    dir=${dir%/}
    version_name "$dir" || continue
    # An extracted release makes its staging archive disposable at any age.
    if [[ -d $ROOT/releases/${dir##*/} ]]; then
      remove "$dir" 'extracted upload'
      continue
    fi
    # Otherwise the newest upload may still be a pending candidate.
    if [[ $dir == "$newest_incoming" ]]; then continue; fi
    if (($(mtime "$dir") >= incoming_cutoff)); then continue; fi
    remove "$dir" 'stale upload'
  done
fi
if ((removals == 0)); then
  printf 'Nothing to prune.\n'
else
  printf 'Retention %s: %d path(s), %d MB.\n' \
    "$([[ $apply == true ]] && echo complete || echo planned)" "$removals" "$((freed / 1048576))"
fi
exit $((failures > 0))
