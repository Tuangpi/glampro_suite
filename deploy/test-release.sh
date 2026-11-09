#!/usr/bin/env bash
# Exercise the real release script using isolated paths and mocked external tools.
set -Eeuo pipefail
base=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/root/incoming/v1.0.0" "$tmp/root/incoming/v1.0.1"
sed "s@^ROOT=/opt/glampro\$@ROOT=$tmp/root@" "$base/release.sh" > "$tmp/release.sh"
export TEST_LOG="$tmp/log" TEST_FAILURE="$tmp/failure"
cat > "$tmp/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$TEST_LOG"
if [[ -f $TEST_FAILURE && "$*" == *releases/v1.0.1/* && "$*" == *'up -d'* ]]; then exit 1; fi
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/bin/curl"
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH"
for version in v1.0.0 v1.0.1; do
  dir="$tmp/root/incoming/$version"
  cp "$base/compose.production.yml" "$base/release.sh" "$dir/"
  for component in API WEB MIGRATOR; do
    printf '%s_IMAGE=ghcr.io/example/app@sha256:%064d\n' "$component" 0
  done > "$dir/images.env"
done
if bash "$tmp/release.sh" deploy 'v1.0.0;id' schema-compatible 2>/dev/null; then echo 'Unsafe version accepted'; exit 1; fi
if bash "$tmp/release.sh" deploy v1.0.0 2>/dev/null; then echo 'Unconfirmed deployment accepted'; exit 1; fi
bash "$tmp/release.sh" deploy v1.0.0 schema-compatible
[[ $(readlink "$tmp/root/current") == "$tmp/root/releases/v1.0.0" ]]
if bash "$tmp/release.sh" deploy v1.0.0 schema-compatible 2>/dev/null; then echo 'Duplicate accepted'; exit 1; fi
if bash "$tmp/release.sh" rollback v1.0.0 2>/dev/null; then echo 'Unconfirmed rollback accepted'; exit 1; fi
touch "$TEST_FAILURE"
if bash "$tmp/release.sh" deploy v1.0.1 schema-compatible; then echo 'Failed deployment accepted'; exit 1; fi
[[ $(readlink "$tmp/root/current") == "$tmp/root/releases/v1.0.0" ]]
grep -q 'releases/v1.0.0/compose.production.yml up -d' "$TEST_LOG"
bash "$tmp/release.sh" rollback v1.0.0 schema-compatible
! grep -Eq 'migrate deploy|down|volume rm' "$TEST_LOG"
# Reject digest-less manifests before executing Docker.
sed -i 's/@sha256:[a-f0-9]*/:latest/' "$tmp/root/releases/v1.0.0/images.env"
if bash "$tmp/release.sh" rollback v1.0.0 schema-compatible 2>/dev/null; then echo 'Mutable image accepted'; exit 1; fi
echo 'Deployment regression tests passed.'