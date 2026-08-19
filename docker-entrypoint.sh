#!/bin/sh
set -eu

mkdir -p "${TMPDIR:-/tmp}"
node scripts/init-db.mjs
exec node server.js
