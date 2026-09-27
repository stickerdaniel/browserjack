#!/bin/sh
# Pack the real tarball and smoke-test an installation from it, so a broken
# publish (missing dist/, wrong bin wiring) fails here instead of on npm.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cd "$root"
packdir="${BROWSERJACK_ARTIFACT_DIR:-$workdir}"
mkdir -p "$packdir"
packdir="$(cd "$packdir" && pwd -P)"
tarball="$packdir/$(npm pack --pack-destination "$packdir" | tail -1)"

cd "$workdir"
npm init -y > /dev/null
npm install --no-fund --no-audit "$tarball" > /dev/null

./node_modules/.bin/browserjack --help > /dev/null

set +e
BROWSERJACK_HOME="$workdir/home" ./node_modules/.bin/browserjack status --json > status.json
status_exit=$?
set -e
test "$status_exit" -eq 2
node -e "const r = require('./status.json'); if (r.installed !== false) process.exit(1)"

if [ -n "${BROWSERJACK_ARTIFACT_DIR:-}" ]; then
  shasum -a 256 "$tarball" > "$tarball.sha256"
fi

echo "pack:check ok ($(basename "$tarball"))"
