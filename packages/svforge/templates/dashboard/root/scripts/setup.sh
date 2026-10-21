#!/usr/bin/env bash
set -euo pipefail

# Resolve from the script, not the caller's working directory.
if ! command -v node >/dev/null 2>&1; then
	echo "Setup requires Node.js 20.12+ (use a supported SvelteKit Node version)." >&2
	exit 1
fi
exec node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/setup.mjs" "$@"
