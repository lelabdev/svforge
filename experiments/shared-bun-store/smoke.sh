#!/usr/bin/env bash
# Isolated Docker smoke: uses unique resources, cleans up its own volumes only.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
export COMPOSE_PROJECT_NAME="svforge-bun-smoke-$$"

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose config -q
docker compose run --rm --no-deps install-a
docker compose run --rm --no-deps install-b
docker compose up -d --no-deps app-a app-b

# Both consumers must link to a physically identical global store entry.
a="$(docker compose exec -T app-a readlink -f /app/node_modules/zod | tr -d '\r')"
b="$(docker compose exec -T app-b readlink -f /app/node_modules/zod | tr -d '\r')"
test "$a" = "$b"
case "$a" in
  /bun-store/links/*) ;;
  *) echo "Expected global store symlink, got: $a" >&2; exit 1 ;;
esac

# Different app-specific packages must remain available.
docker compose exec -T app-a bun -e 'import("nanoid").then(m => { if (!m.nanoid()) process.exit(1) })'
docker compose exec -T app-b bun -e 'import("date-fns").then(m => { if (!m.format) process.exit(1) })'

# Each app serves a valid response using external store dependencies.
docker compose exec -T app-a bun -e 'const r = await fetch("http://127.0.0.1:3000"); const j = await r.json(); if (!r.ok || j.app !== "app-a" || j.className !== "px-4") process.exit(1)'
docker compose exec -T app-b bun -e 'const r = await fetch("http://127.0.0.1:3000"); const j = await r.json(); if (!r.ok || j.app !== "app-b" || j.className !== "px-4") process.exit(1)'

echo "Shared store path: $a"
docker compose exec -T app-a du -sh /app/node_modules /bun-store
docker compose exec -T app-b du -sh /app/node_modules
echo "PASS: two apps share one Bun store while keeping distinct node_modules links."
