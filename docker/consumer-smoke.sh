#!/usr/bin/env bash
# End-to-end validation of the reusable builder from a CONSUMER perspective (#606).
#
# `docker/builder-smoke.sh` validates the builder image itself. This script
# proves the acceptance criteria that only an independent application can show:
#   1. a realistic app build stage starts FROM the immutable builder image,
#      inherits its common node_modules and sees BUN_INSTALL_CACHE_DIR;
#   2. the application's own `package.json` + `bun.lock` stay authoritative:
#      a different pin (zod 3.x here) wins over the builder's 4.x and an
#      app-only dependency (nanoid) is installed;
#   3. the produced runtime image is independent from the builder — it has no
#      builder-only dependency and serves the compiled app.
#
# The fixture lives in `docker/examples/app/`. No registry push, no deployment.
# Runs locally and in CI (.github/workflows/ci.yml) after the builder smoke.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${SVFORGE_BUILDER_TAG:-svforge-builder:ci}"
APP_IMAGE="${SVFORGE_CONSUMER_TAG:-svforge-builder-consumer:ci}"
APP_DIR="docker/examples/app"
HOST_PORT="${SVFORGE_CONSUMER_PORT:-3210}"

for file in "$APP_DIR/Dockerfile" "$APP_DIR/package.json" "$APP_DIR/bun.lock"; do
	[ -f "$file" ] || { echo "❌ missing $file" >&2; exit 1; }
done

build_image() {
	local tag="$1" dockerfile="$2" context="$3"
	shift 3
	if [ -n "${SVFORGE_BUILDER_BUILDX_BUILDER:-}" ]; then
		docker buildx build --builder "$SVFORGE_BUILDER_BUILDX_BUILDER" --load \
			-f "$dockerfile" -t "$tag" "$@" "$context"
	else
		docker build -f "$dockerfile" -t "$tag" "$@" "$context"
	fi
}

if ! docker image inspect "$TAG" >/dev/null 2>&1; then
	echo "==> Builder image $TAG not present; building it from docker/builder.Dockerfile"
	build_image "$TAG" docker/builder.Dockerfile .
fi

echo "==> Building the independent fixture app FROM $TAG with its own lockfile"
# The fixture Dockerfile asserts the builder contract inside the build stage
# (inherited node_modules, /bun-cache) and that its own zod pin won.
build_image "$APP_IMAGE" "$APP_DIR/Dockerfile" "$APP_DIR" \
	--build-arg "BUILDER_IMAGE=$TAG"

echo "==> Runtime image is independent from the builder"
docker run --rm --entrypoint sh "$APP_IMAGE" -c '
set -eu
for pkg in svelte @sveltejs/kit better-auth @skeletonlabs/skeleton; do
	[ ! -d "node_modules/$pkg" ] || { echo "runtime leaked builder-only dependency: $pkg" >&2; exit 1; }
done
[ -d node_modules/zod ] && [ -d node_modules/nanoid ]
echo "runtime keeps only application production dependencies"
'

echo "==> Compiled app serves and resolves its own pinned dependencies"
container="$(docker run -d -e PORT=3000 -p "${HOST_PORT}:3000" "$APP_IMAGE")"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

body=""
for _ in $(seq 1 60); do
	body="$(curl -fsS "http://127.0.0.1:${HOST_PORT}/" 2>/dev/null || true)"
	[ -n "$body" ] && break
	sleep 1
done

fail() { echo "❌ $1" >&2; exit 1; }
[ -n "$body" ] || fail "compiled app did not answer on port ${HOST_PORT}"
printf '%s' "$body" | grep -q 'zod-ok' \
	|| fail "server response did not prove the app-pinned zod 3 runtime"
printf '%s' "$body" | grep -Eq '[A-Za-z0-9_-]{21}' \
	|| fail "server response did not contain a nanoid id from the app-only dependency"

echo "✅ Consumer build validated ($APP_IMAGE): builder layer reused, own lockfile respected, runtime independent."
