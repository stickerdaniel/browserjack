#!/bin/sh
# Pack the real tarball and smoke-test an installation from it, so a broken
# publish (missing dist/, wrong bin wiring) fails here instead of on npm.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cd "$root"
tarball="$workdir/$(npm pack --pack-destination "$workdir" | tail -1)"

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

echo "pack:check ok ($(basename "$tarball"))"
