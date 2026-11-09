#!/usr/bin/env bash
# Run in CI AFTER npm ci / npm run build. Never read local .env files into a bundle.
set -Eeuo pipefail
version=${1:-}
[[ $version =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || exit 1
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
[[ ! -e bundle ]] || { echo 'bundle already exists' >&2; exit 1; }
mkdir -p bundle/apps/api bundle/apps/web bundle/packages/shared bundle/deploy
cp package.json package-lock.json bundle/
cp -a node_modules bundle/
cp apps/api/package.json apps/api/prisma.config.ts bundle/apps/api/
cp -a apps/api/dist apps/api/prisma bundle/apps/api/
cp apps/web/package.json bundle/apps/web/
cp -a apps/web/dist bundle/apps/web/
cp packages/shared/package.json bundle/packages/shared/
cp -a packages/shared/dist bundle/packages/shared/
cp deploy/release.sh bundle/deploy/
# npm workspaces may have nested dependencies; preserve those if present.
for workspace in apps/api apps/web packages/shared; do
  if [[ -d $workspace/node_modules ]]; then
    cp -a "$workspace/node_modules" "bundle/$workspace/"
    rm -rf "bundle/$workspace/node_modules/.cache" "bundle/$workspace/node_modules/.vite"
  fi
done
printf '%s\n' "$version" > bundle/VERSION
node -p 'process.versions.node' > bundle/NODE_VERSION
printf 'ubuntu-22.04-x64\n' > bundle/PLATFORM
# Refuse accidentally copied secrets even if an output directory was dirty.
if find bundle -type f -name '.env*' -print -quit | grep -q .; then
  echo 'Unexpected environment file in release bundle' >&2; exit 1
fi
test -f bundle/apps/api/dist/src/index.js
test -f bundle/apps/api/dist/generated/prisma/client.js
test -f bundle/apps/web/dist/index.html
test -f bundle/node_modules/prisma/build/index.js
