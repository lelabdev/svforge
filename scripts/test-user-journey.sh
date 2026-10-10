#!/usr/bin/env bash
# External user journey smoke test (#462, hardened in #465, golden path #470).
#
# Reproduces the path a REAL external user follows — from a clean temporary
# directory, with tooling acquired from the registry (never the repository's
# own node_modules):
#
#   manual path: acquire sv → sv create → sv add (packed tarball | exact npm)
#                → setup → check/test/build → boot → minimal journey
#   create path: acquire sv → ONE `svforge create` (#417, the promised UX)
#                → project manifest/diagnostics → setup → build/tests
#                → boot → minimal journey
#
# Modes:
#   * local (default)   — `npm pack` the add-on and run the journey from the
#                         EXTRACTED tarball. No `file:<repo>/packages/...`, no
#                         `--dev-root`, no checkout tooling. Blocking pre-publish
#                         release gate; this path does not run in PR CI.
#   * --published <v>   — install the EXACT npm version (the one just published).
#
# Paths:
#   * --path manual (default) — the documented two-step `sv create` + `sv add`.
#   * --path create           — the ONE-COMMAND `svforge create` golden path
#                               (#470). Pre-publish it resolves the current
#                               PACKAGED artifacts via `--addon-root`; published
#                               it pins `--addon-version`.
#
# This is a SHORT smoke test: exhaustive behaviour stays in
# `scripts/test-scaffold.sh`. Its job is to catch packaging gaps, a broken
# documented install, registry acquisition failures, and runtime failures that
# local `file:` scaffolds hide.
#
# The dashboard journey needs a reachable PostgreSQL (same URL contract as the
# scaffold suite: TEST_DATABASE_URL). Run `--template base` locally without one.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIMARY_PACKAGE="svforge"
SF_PM="${SF_PM:-bun}"

MODE="local"
VERSION=""
SV_VERSION="${SV_VERSION:-}"
HOOK_MODE="none"
PATH_MODE="manual"
COMPAT_MANIFEST_FILE=""
TEMPLATES=()
KEEP=0

usage() {
	cat <<'EOF'
Usage: scripts/test-user-journey.sh [options]

  --published <version>   install the exact published npm version
  --path <manual|create>  manual two-step install (default) or the ONE-COMMAND
                          `svforge create` golden path (#470)
  --compat-manifest <p>   exact per-package version map (release plan) for the
                          published golden path (#470)
  --template <name>       run only one journey (base or dashboard); may repeat
  --hooks <mode>          generated hooks mode: none (default) or lefthook
  --sv <version>          override the `sv` CLI version to acquire (default: repo pin,
                          use "latest" for the ecosystem canary)
  --keep                  keep the temporary directory for inspection
  -h, --help              show this help
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--published)
			MODE="published"
			shift
			if [ $# -eq 0 ] || [ "${1#-}" != "$1" ]; then
				echo "❌ --published requires an exact version (for example --published 2.0.1)" >&2
				exit 1
			fi
			VERSION="$1"
			shift
			;;
		--sv)
			shift
			[ $# -gt 0 ] || { echo "❌ --sv requires a version" >&2; exit 1; }
			SV_VERSION="$1"
			shift
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
		--hooks)
			shift
			[ $# -gt 0 ] || { echo "❌ --hooks requires a value (none or lefthook)" >&2; exit 1; }
			case "$1" in
				none | lefthook) HOOK_MODE="$1" ;;
				*) echo "❌ Unknown hooks mode: $1 (expected none or lefthook)" >&2; exit 1 ;;
			esac
			shift
			;;
		--path)
			shift
			[ $# -gt 0 ] || { echo "❌ --path requires a value (manual or create)" >&2; exit 1; }
			case "$1" in
				manual | create) PATH_MODE="$1" ;;
				*) echo "❌ Unknown path: $1 (expected manual or create)" >&2; exit 1 ;;
			esac
			shift
			;;
		--compat-manifest)
			shift
			[ $# -gt 0 ] || { echo "❌ --compat-manifest requires a path" >&2; exit 1; }
			COMPAT_MANIFEST_FILE="$1"
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

echo "User journey smoke test: mode=$MODE${VERSION:+ version=$VERSION}${SV_VERSION:+ sv=$SV_VERSION} path=$PATH_MODE templates=${TEMPLATES[*]}"

# 1. Local mode packs the CURRENT build, so build the add-on first. The
#    published mode must never touch the checkout's sources.
if [ "$MODE" = "local" ]; then
	step "Building $PRIMARY_PACKAGE (the packed tarball must be the current build)"
	(cd "$REPO_ROOT/packages/$PRIMARY_PACKAGE" && bun run build)
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sf-user-journey-XXXXXX")"
SERVER_PIDS=()
cleanup() {
	for pid in "${SERVER_PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
	if [ "$KEEP" = "1" ]; then
		echo "ℹ keeping $WORK_DIR (--keep)"
		return 0
	fi
	chmod -R u+w "$WORK_DIR" 2>/dev/null || true
	rm -rf "$WORK_DIR" 2>/dev/null || { sleep 2; rm -rf "$WORK_DIR" 2>/dev/null || true; }
}
trap cleanup EXIT

# 2. Resolve the `sv add` source AND acquire `sv` externally into the scratch
#    prefix. Local: extracted tarball; published: exact npm specifier.
SOURCE_ARGS=(source --dest "$WORK_DIR")
[ -n "$SV_VERSION" ] && SOURCE_ARGS+=(--sv "$SV_VERSION")
if [ "$MODE" = "published" ]; then
	SOURCE_ARGS+=(--published "$VERSION")
fi
SOURCE="$(cd "$REPO_ROOT" && node scripts/user-journey.mjs "${SOURCE_ARGS[@]}")"
echo "add-on source: $SOURCE"

# 3. The `sv` CLI comes from the scratch prefix installed above — never
#    `$REPO_ROOT/node_modules/.bin/sv`.
SV_CMD="$WORK_DIR/node_modules/.bin/sv"
[ -x "$SV_CMD" ] || fail "external sv CLI missing at $SV_CMD (registry acquisition failed)"
echo "sv CLI: $SV_CMD"

# 4. The packaged CLI a real user invokes, exactly from the chosen artifact.
if [ "$MODE" = "local" ]; then
	SVFORGE_CLI=(node "$WORK_DIR/registry/$PRIMARY_PACKAGE/bin/svforge.mjs")
	# A local run must not resolve the add-on from the checkout.
	case "$SOURCE" in
		file:"$REPO_ROOT"/*) fail "local mode resolved a monorepo path: $SOURCE" ;;
	esac
elif [ -n "$VERSION" ]; then
	SVFORGE_CLI=(npx --yes "$PRIMARY_PACKAGE@$VERSION")
else
	fail "published mode requires an exact version"
fi

# 5. Golden path (#470): the ONE-COMMAND creator resolves the add-ons from an
#    explicit source. Pre-publish packs + extracts the CURRENT module packages
#    into a local addon-root (never the checkout, never --dev-root); published
#    pins the exact npm version so it can never validate an implicit `latest`.
ADDON_ROOT=""
if [ "$PATH_MODE" = "create" ]; then
	if [ "$MODE" = "local" ]; then
		step "Packing the current module packages for the addon-root"
		ADDON_ROOT="$(cd "$REPO_ROOT" && node scripts/user-journey.mjs addon-set --dest "$WORK_DIR")"
		[ -d "$ADDON_ROOT/$PRIMARY_PACKAGE" ] || fail "addon-root missing the packed $PRIMARY_PACKAGE package"
		echo "addon-root: $ADDON_ROOT"
	else
		ADDON_SPEC_VERSION="$VERSION"
		if [ -n "$COMPAT_MANIFEST_FILE" ]; then
			# The plan's per-package map must describe the exact published version.
			node -e 'const c=require(process.argv[1]); const compat=c.compatibility??c; if(compat.template?.version !== process.argv[2]) { console.error(`compat template ${compat.template?.version} != ${process.argv[2]}`); process.exit(1); }' \
				"$COMPAT_MANIFEST_FILE" "$VERSION" || fail "compatibility manifest template version does not match the published $VERSION"
		fi
	fi
fi

# Assert the delivered project records every requested choice (#470).
assert_create_project() {
	local template="$1" expected_modules="$2" runtime="${3:-}"
	test -f .svforge.json || fail "create: .svforge.json missing (the one-command creator did not configure the project)"
	test -f AGENTS.md || fail "create: AGENTS.md missing (AI-ready artifact)"
	test -f llms.txt || fail "create: llms.txt missing (AI-ready artifact)"
	TEMPLATE="$template" EXPECTED_MODULES="$expected_modules" EXPECTED_RUNTIME="$runtime" node -e '
		const fs = require("fs");
		const manifest = JSON.parse(fs.readFileSync(".svforge.json", "utf8"));
		const fail = (message) => { console.error(message); process.exit(1); };
		if (manifest.template !== process.env.TEMPLATE) fail(`template ${manifest.template} != ${process.env.TEMPLATE}`);
		const modules = manifest.modules ?? [];
		const expected = process.env.EXPECTED_MODULES ? process.env.EXPECTED_MODULES.split(",").filter(Boolean) : [];
		const missing = expected.filter((id) => !modules.includes(id));
		if (missing.length > 0) fail(`module(s) requested but not installed: ${missing.join(", ")}`);
		if (process.env.EXPECTED_RUNTIME && manifest.deployment?.profile !== process.env.EXPECTED_RUNTIME) {
			fail(`runtime ${manifest.deployment?.profile} != ${process.env.EXPECTED_RUNTIME}`);
		}
	' || fail "create: manifest does not match the requested configuration"
}

# Boot the generated base project and probe the root page (#470).
base_dev_smoke() {
	local port="$1"
	step "base: dev server answers 200 on /"
	bun run dev --port "$port" --strictPort >"$WORK_DIR/base-dev.log" 2>&1 &
	SERVER_PIDS+=("$!")
	wait_for_port "$port" || { cat "$WORK_DIR/base-dev.log" >&2; fail "base: dev server never became ready"; }
	local status
	status="$(curl -s -L -o /dev/null -w '%{http_code}' "http://localhost:$port/")"
	[ "$status" = "200" ] || fail "base: GET / returned HTTP $status"
	kill "${SERVER_PIDS[-1]}" 2>/dev/null || true
}

# Real PostgreSQL setup + schema push, shared by both dashboard paths.
dashboard_database_setup() {
	local port="$1"
	step "dashboard: setup + real PostgreSQL schema"
	bash scripts/setup.sh >/dev/null 2>&1 || fail "dashboard: scripts/setup.sh failed"
	test -f .env || fail "dashboard: setup.sh did not create .env"
	export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/sf_dashboard_test}"
	# Kit 3 evaluates dynamic private env vars during build-time route analysis;
	# make DATABASE_URL available to the build process as well as .env.
	export DATABASE_URL="$TEST_DATABASE_URL"
	sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"$TEST_DATABASE_URL\"|" .env && rm -f .env.bak
	# Better Auth trusts ORIGIN only — align it with the journey port.
	sed -i.bak "s|^ORIGIN=.*|ORIGIN=http://localhost:$port|" .env && rm -f .env.bak
	bunx drizzle-kit push --force >"$WORK_DIR/drizzle-push.log" 2>&1 \
		|| { cat "$WORK_DIR/drizzle-push.log" >&2; fail "dashboard: drizzle-kit push failed (is PostgreSQL reachable?)"; }
}

# Build the generated project and run the ONE-COMMAND readiness check (#470).
project_verify() {
	step "project: svforge verify (#470)"
	"${SVFORGE_CLI[@]}" verify || fail "svforge verify: the generated project is not ready"
}

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
	local addon="$SOURCE=template:base+testing:vitest+hooks:$HOOK_MODE"
	local port=4211

	step "base: sv create"
	mkdir -p "$WORK_DIR/base"
	cd "$WORK_DIR/base"
	$SV_CMD create app --template minimal --types ts --no-install --no-add-ons --no-download-check
	cd app

	step "base: sv add (documented install)"
	$SV_CMD add "$addon" --install "$SF_PM" --no-download-check

	if [ "$HOOK_MODE" = "lefthook" ]; then
		test -f .lefthook.yml || fail "base: hooks:lefthook did not create .lefthook.yml"
		grep -q 'lefthook install' package.json || fail "base: hooks:lefthook did not add the prepare script"
		if [ ! -d .git ]; then git init -q; fi
		bun run prepare || fail "base: lefthook prepare script failed"
		test -f .git/hooks/pre-commit || fail "base: lefthook did not install the pre-commit hook"
		git config user.email tests@example.com
		git config user.name 'SvelteForge user journey'
		mkdir -p src
		printf '<div class="p-[13px]">warning</div>\n' > src/Warning.svelte
		git add src/Warning.svelte
		if git commit -m 'strict Lefthook must block this commit' >"$WORK_DIR/lefthook-commit.log" 2>&1; then
			cat "$WORK_DIR/lefthook-commit.log" >&2
			fail "base: Lefthook allowed a commit containing a strict design-system warning"
		fi
		grep -q 'WARN' "$WORK_DIR/lefthook-commit.log" || {
			cat "$WORK_DIR/lefthook-commit.log" >&2
			fail "base: blocked Lefthook commit did not report the expected warning"
		}
	fi

	# The add-on copied its sources: the project must be self-contained.
	test -f .svforge.json || fail "base: .svforge.json missing from the package"
	test -f svforge-check.mjs || fail "base: svforge-check.mjs missing from the package"
	test -f src/lib/components/svforge/primitives/Button.svelte || fail "base: primitives/Button.svelte missing (packaging gap)"
	test -f messages/fr.json || fail "base: messages/fr.json missing (packaging gap)"

	step "base: svforge doctor"
	"${SVFORGE_CLI[@]}" doctor

	step "base: svforge check"
	"${SVFORGE_CLI[@]}" check

	step "base: build + check + test"
	# Build FIRST: it generates src/lib/paraglide, which the shipped suites import.
	bun run build
	bun run check
	bun run test

	base_dev_smoke "$port"
	echo "✅ base journey passed"
}

# Shared dashboard journey (#470): boot the generated app and exercise the
# minimal real user flow (anonymous redirect → setup → login → /admin).
# Both the manual `sv create → sv add` path and the one-command golden path
# call it, so the two journeys can never drift apart.
dashboard_auth_journey() {
	local port="$1"
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
}

run_dashboard() {
	local addon="$SOURCE=template:dashboard+testing:vitest+hooks:$HOOK_MODE"
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

	dashboard_database_setup "$port"

	step "dashboard: svforge doctor + check"
	"${SVFORGE_CLI[@]}" doctor
	"${SVFORGE_CLI[@]}" check

	step "dashboard: build + test"
	# Build FIRST: it generates src/lib/paraglide, which the shipped suites import.
	bun run build
	bun run test

	dashboard_auth_journey "$port"
	echo "✅ dashboard journey passed"
}

# ── Golden path: ONE `svforge create` command (#470) ─────────────────

# Assemble the argv for `svforge create` from the shell (the pure helper in
# scripts/user-journey.mjs owns the unit-tested contract).
create_command_args() {
	local template="$1"
	CREATE_ARGS=(create app --template "$template" --pm "$SF_PM" --testing vitest --hooks none --yes)
	if [ "$template" = "dashboard" ]; then
		# The complete canonical set requires a long-lived runtime.
		CREATE_ARGS+=(--modules all --runtime long-lived-node)
	else
		CREATE_ARGS+=(--modules ui_toast)
	fi
	if [ "$MODE" = "local" ]; then
		CREATE_ARGS+=(--addon-root "$ADDON_ROOT")
	elif [ -n "$COMPAT_MANIFEST_FILE" ]; then
		# Exact per-package versions from the release plan (#470).
		CREATE_ARGS+=(--compat-manifest "$COMPAT_MANIFEST_FILE")
	else
		CREATE_ARGS+=(--addon-version "$ADDON_SPEC_VERSION")
	fi
}

run_base_create() {
	local port=4211
	step "base: ONE svforge create (golden path)"
	mkdir -p "$WORK_DIR/base-create"
	cd "$WORK_DIR/base-create"
	create_command_args base
	SVFORGE_SV_CMD="$SV_CMD" "${SVFORGE_CLI[@]}" "${CREATE_ARGS[@]}" || fail "base: svforge create failed"
	cd app
	assert_create_project base ui_toast
	project_verify
	base_dev_smoke "$port"
	echo "✅ base golden path passed"
}

run_dashboard_create() {
	local port=4212
	step "dashboard: ONE svforge create (golden path)"
	mkdir -p "$WORK_DIR/dashboard-create"
	cd "$WORK_DIR/dashboard-create"
	create_command_args dashboard
	SVFORGE_SV_CMD="$SV_CMD" "${SVFORGE_CLI[@]}" "${CREATE_ARGS[@]}" || fail "dashboard: svforge create --modules all failed"
	cd app
	# All modules are implied — the manifest must not silently drop any.
	test -f drizzle.config.ts || fail "dashboard: drizzle.config.ts missing at the project root"
	test -f scripts/setup.sh || fail "dashboard: scripts/setup.sh missing at the project root"
	# Derive the expected `--modules all` set from the canonical registry, never
	# a duplicated count/list (#470 Blocker A).
	local expected_modules
	expected_modules="$("${SVFORGE_CLI[@]}" modules | tr '\n' ',' | sed 's/,$//')"
	[ -n "$expected_modules" ] || fail "dashboard: could not read the canonical module list from svforge"
	echo "expected modules (${expected_modules//,/ })"
	assert_create_project dashboard "$expected_modules" long-lived-node
	dashboard_database_setup "$port"
	project_verify
	dashboard_auth_journey "$port"
	echo "✅ dashboard golden path passed"
}

for template in "${TEMPLATES[@]}"; do
	if [ "$PATH_MODE" = "create" ]; then
		"run_${template}_create"
	else
		"run_$template"
	fi
done

echo
echo "✅ User journey smoke test passed (mode=$MODE${VERSION:+ version=$VERSION} path=$PATH_MODE templates=${TEMPLATES[*]})"
