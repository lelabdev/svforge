#!/usr/bin/env bash
# End-to-end validation of the optional reusable Docker builder (#606).
#
# Builds docker/builder.Dockerfile from the reviewed working tree, then proves:
#   1. the image carries the EXACT checked-in dashboard manifest and pinned
#      lockfile — no second, drifting package list;
#   2. `bun install --frozen-lockfile --ignore-scripts` inside the image is a
#      no-op, i.e. the manifest and the lockfile agree;
#   3. the preinstalled stack really imports with Bun.
#
# This performs no registry push and touches no deployed application. It runs
# locally (`bash docker/builder-smoke.sh`) and in CI (.github/workflows/ci.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${SVFORGE_BUILDER_TAG:-svforge-builder:ci}"
MANIFEST="packages/svforge/templates/dashboard/package.json"
LOCK="docker/builder.bun.lock"

for file in "$MANIFEST" "$LOCK" docker/builder.Dockerfile; do
	[ -f "$file" ] || { echo "❌ missing $file" >&2; exit 1; }
done

echo "==> Building $TAG from docker/builder.Dockerfile"
# A healthy default builder is enough on a clean runner. Set
# SVFORGE_BUILDER_BUILDX_BUILDER to an isolated buildx builder when the local
# BuildKit cache is unhealthy (a missing parent snapshot fails the default
# driver before any build step runs).
if [ -n "${SVFORGE_BUILDER_BUILDX_BUILDER:-}" ]; then
	docker buildx build --builder "$SVFORGE_BUILDER_BUILDX_BUILDER" --load \
		-f docker/builder.Dockerfile -t "$TAG" .
else
	docker build -f docker/builder.Dockerfile -t "$TAG" .
fi

echo "==> The image installed the reviewed manifest and lockfile verbatim"
docker run --rm --entrypoint cat "$TAG" /app/package.json | cmp -s - "$MANIFEST" \
	|| { echo "❌ /app/package.json in the image differs from $MANIFEST" >&2; exit 1; }
docker run --rm --entrypoint cat "$TAG" /app/bun.lock | cmp -s - "$LOCK" \
	|| { echo "❌ /app/bun.lock in the image differs from $LOCK" >&2; exit 1; }

echo "==> A frozen reinstall changes nothing (manifest and lockfile agree)"
install_output="$(docker run --rm --entrypoint bun "$TAG" install --frozen-lockfile --ignore-scripts 2>&1)" \
	|| { printf '%s\n' "$install_output" >&2; echo "❌ frozen-lockfile install failed inside the image" >&2; exit 1; }
printf '%s\n' "$install_output" | grep -Eq 'no changes|Checked .* installs' \
	|| { printf '%s\n' "$install_output" >&2; echo "❌ frozen-lockfile install reported changes; refresh $LOCK" >&2; exit 1; }

echo "==> The preinstalled stack imports with Bun"
docker run --rm --entrypoint bun "$TAG" -e '
import { readFileSync } from "node:fs";
const installed = (name) => JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
// Runtime/compiler packages that must actually load, not merely exist on disk.
for (const name of ["zod", "svelte", "vite", "@sveltejs/kit", "drizzle-orm", "better-auth", "postgres"]) {
  const mod = await import(name);
  if (Object.keys(mod).length === 0) throw new Error(`${name} imported empty`);
  console.log(`${name}@${installed(name)}`);
}
// Svelte component packages cannot be imported outside a Svelte compiler
// context; their presence in the image is what matters for a build stage.
for (const name of ["@skeletonlabs/skeleton", "@skeletonlabs/skeleton-svelte", "@inlang/paraglide-js"]) {
  console.log(`${name}@${installed(name)}`);
}
console.log("builder-import-ok");
'

echo "✅ Builder image $TAG validated (build, frozen install, runtime imports)."
