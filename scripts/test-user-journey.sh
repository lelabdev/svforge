#!/usr/bin/env bash
# Published user journey smoke test (#462).
#
# Reproduces the EXTERNAL user path from an installable package:
#
#   package → sv create → sv add → setup → server → minimal journey
#
# Two modes:
#   * local (default)   — `npm pack` the add-on and run the journey from the
#                         EXTRACTED tarball. No `file:<repo>/packages/...`, no
#                         `--dev-root`, no monorepo import. This is the release
#                         gate that must pass BEFORE publishing.
#   * --published [v]   — install the real npm package (latest by default) in a
#                         clean temporary directory. Post-publication signal.
#
# This is a SHORT smoke test: exhaustive behaviour stays in
# `scripts/test-scaffold.sh`. Its job is to catch packaging gaps, a broken
# documented install, and runtime failures that local `file:` scaffolds hide.
#
# The dashboard journey needs a reachable PostgreSQL (same URL contract as the
# scaffold suite: TEST_DATABASE_URL). Run `--template base` locally without one.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIMARY_PACKAGE="svforge"
SF_PM="${SF_PM:-bun}"

MODE="local"
VERSION=""
TEMPLATES=()
KEEP=0

usage() {
	cat <<'EOF'
Usage: scripts/test-user-journey.sh [options]

  --published [version]   install the published npm package (default: local tarballs)
  --template <name>       run only one journey (base or dashboard); may repeat
  --keep                  keep the temporary directory for inspection
  -h, --help              show this help
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--published)
			MODE="published"
			shift
			if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
				VERSION="$1"
				shift
			fi
			;;
		--template)
			shift
			[ $# -gt 0 ] || { echo "❌ --template requires a value (base or dashboard)" >&2; exit 1; }
			case "$1" in
				base | dashboard) TEMPLATES+=("$1") ;;
				*) echo "❌ Unknown template: $1 (expected base or dashboard)" >&2; exit 1 ;;
			esac
			shift
			;;
		--keep)
			KEEP=1
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "❌ Unknown argument: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done
[ ${#TEMPLATES[@]} -gt 0 ] || TEMPLATES=(base dashboard)

step() { echo; echo "▶ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# `sv` symlinks a `file:` add-on into its OWN node_modules and only removes the
# previous link when the (followed) target still exists. Our tarball lives in a
# per-run temporary directory, so a previous run leaves a BROKEN symlink that
# makes the next `sv add` fail with EEXIST. Clear it before a local run.
clean_sv_addon_cache() {
	local sv_real
	sv_real="$(readlink -f "$REPO_ROOT/node_modules/sv" 2>/dev/null || true)"
	[ -n "$sv_real" ] || return 0
	rm -rf "$(dirname "$sv_real")/node_modules/$PRIMARY_PACKAGE" 2>/dev/null || true
}

echo "User journey smoke test: mode=$MODE${VERSION:+ version=$VERSION} templates=${TEMPLATES[*]}"

# 1. Local mode packs the CURRENT build, so build the add-on first. The
#    published mode must never touch the checkout's sources.
if [ "$MODE" = "local" ]; then
	step "Building $PRIMARY_PACKAGE (the packed tarball must be the current build)"
	(cd "$REPO_ROOT/packages/$PRIMARY_PACKAGE" && bun run build)
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sf-user-journey-XXXXXX")"
SERVER_PIDS=()
cleanup() {
	clean_sv_addon_cache
	for pid in "${SERVER_PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
	if [ "$KEEP" = "1" ]; then
		echo "ℹ keeping $WORK_DIR (--keep)"
		return 0
	fi
	chmod -R u+w "$WORK_DIR" 2>/dev/null || true
	rm -rf "$WORK_DIR" 2>/dev/null || { sleep 2; rm -rf "$WORK_DIR" 2>/dev/null || true; }
}
trap cleanup EXIT

# 2. Resolve the `sv add` source. Local: extracted tarball; published: npm spec.
SOURCE_ARGS=(source --dest "$WORK_DIR/registry")
if [ "$MODE" = "published" ] && [ -n "$VERSION" ]; then
	SOURCE_ARGS=(source --published "$VERSION" --dest "$WORK_DIR/registry")
elif [ "$MODE" = "published" ]; then
	SOURCE_ARGS=(source --published --dest "$WORK_DIR/registry")
fi
SOURCE="$(cd "$REPO_ROOT" && node scripts/user-journey.mjs "${SOURCE_ARGS[@]}")"
echo "add-on source: $SOURCE"

# 3. The packaged CLI a real user invokes, exactly from the chosen artifact.
if [ "$MODE" = "local" ]; then
	SVFORGE_CLI=(node "$WORK_DIR/registry/$PRIMARY_PACKAGE/bin/svforge.mjs")
	# A local run must not resolve the add-on from the checkout.
	case "$SOURCE" in
		file:"$REPO_ROOT"/*) fail "local mode resolved a monorepo path: $SOURCE" ;;
	esac
elif [ -n "$VERSION" ]; then
	SVFORGE_CLI=(npx --yes "$PRIMARY_PACKAGE@$VERSION")
else
	SVFORGE_CLI=(npx --yes "$PRIMARY_PACKAGE")
fi

if [ -z "${SV_CMD:-}" ]; then
	SV_CMD="$REPO_ROOT/node_modules/.bin/sv"
fi
clean_sv_addon_cache
# Wait for a dev server to answer on `$1/` (any status), up to ~3 minutes.
wait_for_port() {
	local port="$1"
	for _ in $(seq 1 90); do
		curl -sf -o /dev/null "http://localhost:$port/" 2>/dev/null && return 0
		sleep 2
	done
	return 1
}

run_base() {
	local addon="$SOURCE=template:base+testing:vitest+hooks:none"
	local port=4211

	step "base: sv create"
	mkdir -p "$WORK_DIR/base"
	cd "$WORK_DIR/base"
	$SV_CMD create app --template minimal --types ts --no-install --no-add-ons --no-download-check
	cd app

	step "base: sv add (documented install)"
	$SV_CMD add "$addon" --install "$SF_PM" --no-download-check

	# The add-on copied its sources: the project must be self-contained.
	test -f .svforge.json || fail "base: .svforge.json missing from the package"
	test -f svforge-check.mjs || fail "base: svforge-check.mjs missing from the package"
	test -f src/lib/components/svforge/primitives/Button.svelte || fail "base: primitives/Button.svelte missing (packaging gap)"
	test -f messages/fr.json || fail "base: messages/fr.json missing (packaging gap)"

	step "base: svforge doctor"
	"${SVFORGE_CLI[@]}" doctor

	step "base: svforge check"
	"${SVFORGE_CLI[@]}" check

	step "base: check + test + build"
	bun run check
	bun run test
	bun run build

	step "base: dev server answers 200 on /"
	bun run dev --port "$port" --strictPort >"$WORK_DIR/base-dev.log" 2>&1 &
	SERVER_PIDS+=("$!")
	wait_for_port "$port" || { cat "$WORK_DIR/base-dev.log" >&2; fail "base: dev server never became ready"; }
	local status
	status="$(curl -s -L -o /dev/null -w '%{http_code}' "http://localhost:$port/")"
	[ "$status" = "200" ] || fail "base: GET / returned HTTP $status"
	kill "${SERVER_PIDS[-1]}" 2>/dev/null || true
	echo "✅ base journey passed"
}

run_dashboard() {
	local addon="$SOURCE=template:dashboard+testing:vitest+hooks:none"
	local port=4212

	step "dashboard: sv create"
	mkdir -p "$WORK_DIR/dashboard"
	cd "$WORK_DIR/dashboard"
	$SV_CMD create app --template minimal --types ts --no-install --no-add-ons --no-download-check
	cd app

	step "dashboard: sv add (documented install)"
	$SV_CMD add "$addon" --install "$SF_PM" --no-download-check

	test -f .svforge.json || fail "dashboard: .svforge.json missing from the package"
	test -f drizzle.config.ts || fail "dashboard: drizzle.config.ts missing at the project root"
	test -f scripts/setup.sh || fail "dashboard: scripts/setup.sh missing at the project root"
	test -f src/lib/components/svforge/primitives/Button.svelte || fail "dashboard: primitives/Button.svelte missing (packaging gap)"

	step "dashboard: setup + real PostgreSQL schema"
	bash scripts/setup.sh >/dev/null 2>&1 || fail "dashboard: scripts/setup.sh failed"
	test -f .env || fail "dashboard: setup.sh did not create .env"
	export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/sf_dashboard_test}"
	sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"$TEST_DATABASE_URL\"|" .env && rm -f .env.bak
	# Better Auth trusts ORIGIN only — align it with the journey port.
	sed -i.bak "s|^ORIGIN=.*|ORIGIN=http://localhost:$port|" .env && rm -f .env.bak
	bunx drizzle-kit push --force >"$WORK_DIR/drizzle-push.log" 2>&1 \
		|| { cat "$WORK_DIR/drizzle-push.log" >&2; fail "dashboard: drizzle-kit push failed (is PostgreSQL reachable?)"; }

	step "dashboard: svforge doctor + check"
	"${SVFORGE_CLI[@]}" doctor
	"${SVFORGE_CLI[@]}" check

	step "dashboard: test + build"
	bun run test
	bun run build

	step "dashboard: auth journey (setup → redirect → login → /admin)"
	SMOKE_RUN="$$-$(date +%s)"
	SMOKE_ADMIN_EMAIL="journey-admin-${SMOKE_RUN}@sf-test.example"
	local origin="http://localhost:$port"
	local admin_jar="$WORK_DIR/admin-cookies.txt"
	rm -f "$admin_jar"

	bun run dev --port "$port" --strictPort >"$WORK_DIR/dashboard-dev.log" 2>&1 &
	SERVER_PIDS+=("$!")
	wait_for_port "$port" || { cat "$WORK_DIR/dashboard-dev.log" >&2; fail "dashboard: dev server never became ready"; }

	# Protected route while anonymous must redirect to /login (#462 checklist).
	local anon_code anon_target
	anon_code="$(curl -s -o /dev/null -w '%{http_code}' "$origin/admin")"
	anon_target="$(curl -s -o /dev/null -w '%{redirect_url}' "$origin/admin")"
	{ [ "$anon_code" = "302" ] || [ "$anon_code" = "303" ]; } \
		|| fail "dashboard: anonymous /admin returned HTTP $anon_code (expected a redirect)"
	case "$anon_target" in *"/login"*) ;; *) fail "dashboard: anonymous /admin redirected to '$anon_target', not /login" ;; esac

	setup_body="$(curl -sf -b "$admin_jar" -c "$admin_jar" -H "origin: $origin" \
		--data "name=Journey Admin&email=${SMOKE_ADMIN_EMAIL}&password=journeypass123" \
		"$origin/setup")" || fail "dashboard: POST /setup errored"
	if printf '%s' "$setup_body" | grep -q '"type":"failure"'; then fail "dashboard: POST /setup failed: $setup_body"; fi

	curl -sf -o /dev/null -b "$admin_jar" -c "$admin_jar" -H "origin: $origin" \
		--data "email=${SMOKE_ADMIN_EMAIL}&password=journeypass123" \
		"$origin/login" || fail "dashboard: admin login action errored"
	grep -q better-auth.session_token "$admin_jar" || fail "dashboard: login did not set a session cookie"

	local admin_code users_code
	admin_code="$(curl -s -o /dev/null -w '%{http_code}' -b "$admin_jar" "$origin/admin")"
	[ "$admin_code" = "200" ] || fail "dashboard: GET /admin returned HTTP $admin_code for the admin"
	users_code="$(curl -s -o /dev/null -w '%{http_code}' -b "$admin_jar" "$origin/admin/users")"
	[ "$users_code" = "200" ] || fail "dashboard: GET /admin/users returned HTTP $users_code for the admin"

	kill "${SERVER_PIDS[-1]}" 2>/dev/null || true

	# Leave the dedicated test database empty (#312).
	SMOKE_RUN="$SMOKE_RUN" bun -e '
		const { default: postgres } = await import("postgres");
		const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
		await sql`DELETE FROM "user" WHERE email LIKE ${"%-" + process.env.SMOKE_RUN + "@sf-test.example"}`;
		await sql.end();
	' || true
	echo "✅ dashboard journey passed"
}

for template in "${TEMPLATES[@]}"; do
	"run_$template"
done

echo
echo "✅ User journey smoke test passed (mode=$MODE${VERSION:+ version=$VERSION} templates=${TEMPLATES[*]})"
