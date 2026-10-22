#!/usr/bin/env bash
# Regenerate the llms-*.txt documentation dumps in packages/svforge/docs/.
# Fetch exactly the two official Svelte/Skeleton references for review in a PR.
# Never refresh these unreviewed during publishing. The SHA-256 lock also pins
# the root's supported dependency ranges and sv CLI version.
#
# Usage: bash packages/svforge/scripts/fetch-llms-docs.sh
set -euo pipefail

DOCS_DIR="$(cd "$(dirname "$0")/../docs" && pwd)"
FETCHED="$(date +%Y-%m-%d)"

fetch() {
	local url="$1" out="$2"
	echo "→ $(basename "$out") ($url, fetched $FETCHED)"
	{
		echo "---"
		echo "source: $url"
		echo "fetched: $FETCHED"
		echo "---"
		echo
		curl -sL --fail --max-time 120 "$url"
	} > "$out"
}

fetch "https://skeleton.dev/llms-full.txt" "$DOCS_DIR/llms-skeleton.txt"
fetch "https://svelte.dev/llms-full.txt" "$DOCS_DIR/llms-svelte.txt"

node "$(dirname "$0")/../../../scripts/check-release-docs.mjs" --update-lock

echo "✅ Reference snapshots regenerated and version-pinned in $DOCS_DIR"
echo "   Review compatibility and commit the docs and llms-snapshots.json together in a PR."
