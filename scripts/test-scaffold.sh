#!/usr/bin/env bash
# Scaffold check (#191): validate that a REAL fresh project scaffolded with the
# LOCAL svforge addon builds. Runs in CI on every PR and gates npm publishes.
#
# Key points:
# - Uses `file:` so sv resolves the addon from ./packages/svforge (local build),
#   NOT the published npm package (which lacks local changes).
# - All addon options are passed explicitly (template + testing + hooks) so sv never prompts.
# - `bunx sv` resolves the workspace's pinned `sv` (^0.15.x from the lockfile);
#   the canary workflow (#205) is what tests against ecosystem `latest`.
# - The dashboard needs a .env at build time (auth/db modules are evaluated);
#   drizzle push is best-effort until drizzle.config.ts is delivered (#187).
# - The plain `dashboard` profile (#319) additionally runs the template vitest
#   baseline, the CLI-schema diff and an HTTP smoke against the REAL Better
#   Auth version — it therefore needs a reachable PostgreSQL (like the
#   dashboard-foundations / -integrations profiles).
set -euo pipefail

TEMPLATE="${1:-base}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Respect TMPDIR when set (small /tmp tmpfs machines); CI runners use /tmp.
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sf-scaffold-$TEMPLATE-XXXXXX")"

SF_PM="${SF_PM:-bun}"
echo "Testing svforge scaffold: template=$TEMPLATE pm=$SF_PM (local addon)"

# Clean up on exit
# rm -rf robuste pour node_modules: les fichiers d'un install concurrent
# peuvent être read-only ou disparaître pendant le unlink — on force les
# perms et on retente une fois avant d'abandonner (le test a déjà PASSÉ à
# ce stade: un cleanup raté ne doit pas rendre la CI rouge).
cleanup_tmp() {
	[ -d "$TMP_DIR" ] || return 0
	chmod -R u+w "$TMP_DIR" 2>/dev/null || true
	rm -rf "$TMP_DIR" 2>/dev/null || { sleep 2; rm -rf "$TMP_DIR" 2>/dev/null || true; }
}
trap cleanup_tmp EXIT

# 0. Build the local addon (prebuild regenerates src/templates.ts + tsdown dist)
cd "$REPO_ROOT/packages/svforge"
bun run build

# create-cli (#417): the one-command creator orchestrates EVERYTHING —
# official `sv create`, ONE grouped `sv add`, post-create validation. This
# profile runs the REAL bin end-to-end (dev mode: --dev-root resolves the
# module addons from this checkout) and asserts the delivered project.
if [ "$TEMPLATE" = "create-cli" ]; then
	SVFORGE_BIN="$REPO_ROOT/packages/svforge/bin/svforge.mjs"
	export SVFORGE_SV_CMD="${SV_CMD:-$REPO_ROOT/node_modules/.bin/sv}"
	cd "$TMP_DIR"
	"$SVFORGE_BIN" create app --template base --pm "$SF_PM" --modules dnd,ui_toast --yes --dev-root "$REPO_ROOT" \
		|| { echo "❌ svforge create failed (#417)"; exit 1; }
	cd app
	test -f .svforge.json || { echo "❌ .svforge.json missing (create-cli #417)"; exit 1; }
	test -f svforge-check.mjs || { echo "❌ svforge-check.mjs missing (create-cli #417)"; exit 1; }
	test -f src/lib/components/svforge/dnd/SortableList.svelte || { echo "❌ dnd module missing (create-cli #417)"; exit 1; }
	test -f src/lib/components/svforge/ui/Toaster.svelte || { echo "❌ ui_toast module missing (create-cli #417)"; exit 1; }
	"$SVFORGE_BIN" doctor || { echo "❌ doctor unhealthy (create-cli #417)"; exit 1; }
	"$SVFORGE_BIN" check || { echo "❌ design-system check failed (create-cli #417)"; exit 1; }

	# The REQUIRED all-modules consumer test (#417): dashboard implied by the
	# registry, runtime attested with a stable flag, complete composition —
	# its TESTS and BUILD must pass against real PostgreSQL.
	"$SVFORGE_BIN" create all-modules-app --pm "$SF_PM" --modules all --runtime long-lived-node --yes --dev-root "$REPO_ROOT" \
		|| { echo "❌ svforge create --modules all failed (#417)"; exit 1; }
	cd all-modules-app
	test -f .svforge.json || { echo "❌ .svforge.json missing (all-modules #417)"; exit 1; }
	grep -q '"profile": "long-lived-node"' .svforge.json || { echo "❌ runtime profile not recorded (#417)"; exit 1; }
	node -e "const m=require('./.svforge.json'); process.exit((m.modules||[]).length >= 13 ? 0 : 1)" \
		|| { echo "❌ incomplete module set in .svforge.json (#417)"; exit 1; }

	# Real PostgreSQL setup — same harness as the dashboard profiles (#312).
	bash scripts/setup.sh >/dev/null 2>&1
	export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/sf_dashboard_test}"
	sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"$TEST_DATABASE_URL\"|" .env && rm -f .env.bak
	if [ "${CI:-}" = "true" ]; then
		bunx drizzle-kit push --force >/tmp/drizzle-push-all-modules.log 2>&1 \
			|| { cat /tmp/drizzle-push-all-modules.log; echo "❌ drizzle-kit push failed (all-modules #417)"; exit 1; }
	fi
	# Build FIRST: it generates src/lib/paraglide (the i18n runtime the
	# shipped suites import) — testing before building fails on a fresh
	# scaffold (#426 review: all-modules consumer test).
	bun run build || { echo "❌ all-modules composition build failed (#417)"; exit 1; }
	bun run test || { echo "❌ all-modules composition tests failed (#417)"; exit 1; }

	echo "✅ Scaffold test passed for template=create-cli"
	exit 0
fi

# 1. Create a fresh SvelteKit project (same baseline as end users)
#    SV_CMD controls the CLI version: pinned workspace sv (PR CI, deterministic,
#    #191) vs ecosystem `bunx sv` (canary, latest, #205).
if [ -z "${SV_CMD:-}" ]; then
	SV_CMD="$REPO_ROOT/node_modules/.bin/sv"
fi
cd "$TMP_DIR"
$SV_CMD create app --template minimal --types ts --no-install --no-add-ons --no-download-check
cd app

# 2. Add the LOCAL svforge addon with all options set (no prompts in CI)
#    Profile variants: base, dashboard (vitest), dashboard-playwright, base-blog
#    base-modules adds svforge itself at the right point (#190 bare-project refusal).
#    dashboard-foundations (#258): permanent composition of the new foundations
#    (audit/notifications/jobs/chat/realtime) against a real PostgreSQL.
if [ "$TEMPLATE" = "dashboard-foundations" ]; then
	$SV_CMD add \
		"file:$REPO_ROOT/packages/svforge=template:dashboard+testing:vitest+hooks:none" \
		"file:$REPO_ROOT/packages/audit" \
		"file:$REPO_ROOT/packages/notifications" \
		"file:$REPO_ROOT/packages/jobs" \
		"file:$REPO_ROOT/packages/chat" \
		"file:$REPO_ROOT/packages/realtime" \
		--install "$SF_PM" --no-download-check
elif [ "$TEMPLATE" = "dashboard-playwright" ]; then
	ADD_SPEC="file:$REPO_ROOT/packages/svforge=template:dashboard+testing:playwright+hooks:none"
elif [ "$TEMPLATE" = "dashboard" ]; then
	ADD_SPEC="file:$REPO_ROOT/packages/svforge=template:dashboard+testing:vitest+hooks:none"
elif [ "$TEMPLATE" = "base-ui-modules" ]; then
	ADD_SPEC="file:$REPO_ROOT/packages/svforge=template:base+testing:vitest+hooks:none"
elif [ "$TEMPLATE" = "dashboard-integrations" ]; then
	ADD_SPEC="file:$REPO_ROOT/packages/svforge=template:dashboard+testing:vitest+hooks:none"
fi
if [ "$TEMPLATE" != "base-modules" ] && [ "$TEMPLATE" != "dashboard-foundations" ]; then
	ADD_SPEC="${ADD_SPEC:-file:$REPO_ROOT/packages/svforge=template:base+testing:vitest+hooks:none}"
	$SV_CMD add "$ADD_SPEC" --install "$SF_PM" --no-download-check
fi

# Blog module on top of base (#185): mdsvex must integrate via vite.config.ts
# (no svelte.config.js in modern sv create) and the scaffold must build.
if [ "$TEMPLATE" = "base-blog" ]; then
	$SV_CMD add "file:$REPO_ROOT/packages/blog" --install "$SF_PM" --no-download-check
	# mdsvex wired in vite.config.ts?
	grep -q "mdsvex" vite.config.ts || { echo "❌ mdsvex missing in vite.config.ts (#185)"; exit 1; }
	grep -q "extensions: \['.svelte', '.md'\]" vite.config.ts || { echo "❌ .md extension missing (#185)"; exit 1; }
	# welcome.md post delivered and compiled by mdsvex
	test -f src/posts/welcome.md || { echo "❌ src/posts/welcome.md missing"; exit 1; }
	# transport hook delivered (#293): the MDsveX component crosses the data
	# boundary via src/hooks.ts (slug on the wire, re-import client-side)
	grep -q "mdx-post" src/hooks.ts || { echo "❌ mdx-post transport missing in hooks.ts (#293)"; exit 1; }
	grep -q "loadPostComponent" src/hooks.ts || { echo "❌ loadPostComponent missing in hooks.ts (#293)"; exit 1; }
fi

# base-ui-modules (#284): historical UI modules composed on a real base
# scaffold — dnd, tiptap (with the pure renderer), graph, ui_toast.
if [ "$TEMPLATE" = "base-ui-modules" ]; then
	for mod in dnd tiptap graph ui_toast; do
		$SV_CMD add "file:$REPO_ROOT/packages/$mod" --install "$SF_PM" --no-download-check
	done
	# delivered components
	test -f src/lib/components/svforge/dnd/SortableList.svelte || { echo "❌ dnd SortableList.svelte missing (#284)"; exit 1; }
	test -f src/lib/components/svforge/tiptap/TiptapEditor.svelte || { echo "❌ tiptap TiptapEditor.svelte missing (#284)"; exit 1; }
	test -f src/lib/components/svforge/tiptap/render-tiptap.ts || { echo "❌ tiptap render-tiptap.ts missing (#284)"; exit 1; }
	test -f src/lib/components/svforge/graph/KnowledgeGraph.svelte || { echo "❌ graph KnowledgeGraph.svelte missing (#284)"; exit 1; }
	test -f src/lib/components/svforge/ui/Toaster.svelte || { echo "❌ ui_toast Toaster.svelte missing (#284)"; exit 1; }
	grep -q "skeleton-svelte" package.json || { echo "❌ skeleton-svelte not declared (#284)"; exit 1; }
fi

# dashboard-integrations (#284): oauth + email + uploads on a real dashboard.
# uploads is installed WITH its security test pack — the endpoint test proves
# the presign contract (filename/contentType/size) that #279 fixed, and runs
# inside the scaffold via `bun run test`.
if [ "$TEMPLATE" = "dashboard-integrations" ]; then
	$SV_CMD add "file:$REPO_ROOT/packages/oauth" --install "$SF_PM" --no-download-check
	$SV_CMD add "file:$REPO_ROOT/packages/email" --install "$SF_PM" --no-download-check
	$SV_CMD add "file:$REPO_ROOT/packages/uploads=testpack:yes" --install "$SF_PM" --no-download-check
	# delivered endpoints/components
	test -f src/routes/api/upload/+server.ts || { echo "❌ upload endpoint missing (#284)"; exit 1; }
	test -f src/lib/components/svforge/uploads/FileUpload.svelte || { echo "❌ FileUpload.svelte missing (#284)"; exit 1; }
	test -f src/routes/api/upload/upload-security.test.ts || { echo "❌ upload test pack missing (#284)"; exit 1; }
	test -f src/lib/components/svforge/ui/OAuthButtons.svelte || { echo "❌ OAuthButtons.svelte missing (#284)"; exit 1; }
	test -f src/lib/server/email.ts || { echo "❌ email server lib missing (#284)"; exit 1; }
fi

# Module composition guards (#190, capability contract #323): graph on base,
# oauth on dashboard. A bare project must REFUSE modules whose required
# capabilities are absent, with a readable message naming the capability.
if [ "$TEMPLATE" = "base-modules" ]; then
	# 1. graph on bare project → refused (missing capability ui.svforge).
	# The refusal makes sv exit non-zero, so capture output separately from
	# the exit code (set -o pipefail would otherwise fail the check).
	graph_output=$($SV_CMD add "file:$REPO_ROOT/packages/graph" --install "$SF_PM" --no-download-check 2>&1 || true)
	if printf '%s' "$graph_output" | grep -q "ui.svforge"; then
		echo "✅ graph refused on bare project (missing ui.svforge, #323)"
	else
		echo "❌ graph was not refused on bare project (#323)"; exit 1
	fi
	# 2. ui_toast on bare project → refused (missing capability ui.skeleton, #323)
	toast_output=$($SV_CMD add "file:$REPO_ROOT/packages/ui_toast" --install "$SF_PM" --no-download-check 2>&1 || true)
	if printf '%s' "$toast_output" | grep -q "ui.skeleton"; then
		echo "✅ ui_toast refused on bare project (missing ui.skeleton, #323)"
	else
		echo "❌ ui_toast was not refused on bare project (#323)"; exit 1
	fi
	# 3. both modules on svforge base → the template provides the capabilities
	$SV_CMD add "file:$REPO_ROOT/packages/svforge=template:base+testing:vitest+hooks:none" --install "$SF_PM" --no-download-check
	$SV_CMD add "file:$REPO_ROOT/packages/graph" --install "$SF_PM" --no-download-check
	test -f src/lib/components/svforge/graph/KnowledgeGraph.svelte || { echo "❌ graph files missing on base (#190)"; exit 1; }
	$SV_CMD add "file:$REPO_ROOT/packages/ui_toast" --install "$SF_PM" --no-download-check
	grep -q "skeleton-svelte" package.json || { echo "❌ skeleton-svelte not declared (#190)"; exit 1; }
fi

# 3. Dashboard: env vars required at build time (auth.ts / db/index.ts)
#    Now that drizzle.config.ts + .env.example + setup.sh are scaffolded (#187),
#    run the REAL setup script instead of hand-writing .env.
if [ "$TEMPLATE" = "dashboard" ] || [ "$TEMPLATE" = "dashboard-playwright" ] || [ "$TEMPLATE" = "dashboard-foundations" ] || [ "$TEMPLATE" = "dashboard-integrations" ]; then
	# Verify the previously-missing root files were delivered (#187)
	test -f drizzle.config.ts || { echo "❌ drizzle.config.ts missing at project root (#187)"; exit 1; }
	test -f .env.example || { echo "❌ .env.example missing at project root (#187)"; exit 1; }
	test -f scripts/setup.sh || { echo "❌ scripts/setup.sh missing at project root (#187)"; exit 1; }
	test -f static/robots.txt || { echo "❌ static/robots.txt missing at project root (#187)"; exit 1; }
	bash scripts/setup.sh >/dev/null 2>&1 || { echo "❌ setup.sh failed"; exit 1; }
	test -f .env || { echo "❌ setup.sh did not create .env"; exit 1; }
	# #312 — the scaffold's integration suites run against a DEDICATED test
	# database (TEST_DATABASE_URL, name must contain a "test" segment — the
	# shipped suites refuse anything else and never read .env). The harness
	# points the scaffold's .env at the SAME isolated instance so the build
	# and dev-server smoke tests never touch a developer database either.
	export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/sf_dashboard_test}"
	sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"$TEST_DATABASE_URL\"|" .env && rm -f .env.bak

	# PostgreSQL is real in CI (#255): require the drizzle push to actually
	# succeed against the service (the dashboard must be usable out of the box).
	# Local dev without a running DB stays best-effort (setup.sh warns).
	if [ "${CI:-}" = "true" ]; then
		bunx drizzle-kit push --force >/tmp/drizzle-push.log 2>&1 \
			|| { cat /tmp/drizzle-push.log; echo "❌ drizzle-kit push failed against PostgreSQL (#255)"; exit 1; }
	fi
fi

# 4. Build the scaffolded project — the actual assertion
bun run build

# 4-320. Compiled CSS canonical-class gate (#320): every canonical class the
# demo screens render must exist in the compiled CSS (a ghost class would
# silently produce NO css), and no ghost class may appear at all.
CSS_BUILT=$(find .svelte-kit/output/client -name '*.css' -type f -exec cat {} + 2>/dev/null || true)
if [ -z "$CSS_BUILT" ]; then
	echo "❌ no compiled client CSS found under .svelte-kit/output/client (#320)"; exit 1
fi
for ghost in btn-md badge-sm badge-md badge-lg preset-tonal-info input-error rounded-card; do
	if printf '%s' "$CSS_BUILT" | grep -q "\\.${ghost}[^a-z0-9-]"; then
		echo "❌ ghost class .${ghost} compiled into the scaffold CSS (#320)"; exit 1
	fi
done
for canonical in btn-base btn-sm btn-lg badge preset-tonal-primary; do
	if ! printf '%s' "$CSS_BUILT" | grep -q "\\.${canonical}[^a-z0-9-]"; then
		echo "❌ canonical .${canonical} missing from compiled CSS (#320)"; exit 1
	fi
done
# rounded-container is rendered by the chat/notifications modules.
if [ -f src/lib/components/svforge/ui/NotificationsBell.svelte ] || [ -f src/routes/chat/+page.svelte ]; then
	printf '%s' "$CSS_BUILT" | grep -q '\.rounded-container[^a-z0-9-]' \
		|| { echo "❌ canonical .rounded-container missing from compiled CSS (#320)"; exit 1; }
fi
echo "✓ compiled CSS canonical-class gate (#320)"

# 4a. Production Vite build gate (#350): an AI-created component that shadows
# a Skeleton primitive must block `bun run build`, not only `bun run check`.
# Exercise both primary scaffolds after their clean builds and always remove the
# fixture before continuing with their normal checks.
if [ "$TEMPLATE" = "base" ] || [ "$TEMPLATE" = "dashboard" ]; then
	DS_FIXTURE="src/lib/features/ai/Dialog.svelte"
	mkdir -p "$(dirname "$DS_FIXTURE")"
	echo '<div>duplicate</div>' > "$DS_FIXTURE"
	set +e
	ds_build_output=$(bun run build 2>&1)
	ds_build_status=$?
	set -e
	rm -rf src/lib/features/ai
	if [ "$ds_build_status" -eq 0 ]; then
		echo "❌ bun run build passed despite a duplicated Skeleton primitive (#350):"
		echo "$ds_build_output"
		exit 1
	fi
	if ! printf '%s' "$ds_build_output" | grep -q 'Duplicated Skeleton primitive "Dialog"'; then
		echo "❌ Vite build did not report the duplicated Skeleton primitive (#350):"
		echo "$ds_build_output"
		exit 1
	fi
	if ! printf '%s' "$ds_build_output" | grep -q '@skeletonlabs/skeleton-svelte'; then
		echo "❌ Vite build did not identify Skeleton as the canonical source (#350):"
		echo "$ds_build_output"
		exit 1
	fi
	echo "✓ Vite build gate rejects duplicated Skeleton primitives (#350)"
fi

# 4b. Svelte/TypeScript quality gate (#266): run the generated project's own
# check script on the main scaffolds. dashboard-foundations joined after #265
# fixed the UUID number/string drift in the DB modules.
if [ "$TEMPLATE" = "base" ] || [ "$TEMPLATE" = "dashboard" ] || [ "$TEMPLATE" = "dashboard-playwright" ] || [ "$TEMPLATE" = "dashboard-foundations" ] || [ "$TEMPLATE" = "base-ui-modules" ] || [ "$TEMPLATE" = "dashboard-integrations" ] || [ "$TEMPLATE" = "base-blog" ]; then
	bun run check || { echo "❌ svelte-check failed on $TEMPLATE scaffold (#266)"; exit 1; }
fi

# ESLint design diagnostics (#346): the config and plugin must be delivered
# to BOTH base and dashboard projects. Real lint verifies JS, TS, and Svelte
# violations with their source files and positions — never a silently omitted rule.
if [ "$TEMPLATE" = "base" ] || [ "$TEMPLATE" = "dashboard" ]; then
	test -f eslint.config.js || { echo "❌ eslint.config.js missing at project root (#346)"; exit 1; }
	test -f eslint-plugin-svforge.mjs || { echo "❌ eslint-plugin-svforge.mjs missing (#346)"; exit 1; }
	mkdir -p src/lib/lint-probe
	printf "import { Dialog } from 'bits-ui';\n" > src/lib/lint-probe/Violation.js
	printf "import { Dialog } from 'bits-ui';\n" > src/lib/lint-probe/Violation.ts
	printf "<script>\n\timport { Dialog } from 'bits-ui';\n</script>\n" > src/lib/lint-probe/Violation.svelte
	if bun run lint >/tmp/sf-eslint.log 2>&1; then
		cat /tmp/sf-eslint.log; echo "❌ ESLint did not report design violations (#346)"; exit 1
	fi
	for file in Violation.js Violation.ts Violation.svelte; do
		grep -q "src/lib/lint-probe/$file" /tmp/sf-eslint.log || { cat /tmp/sf-eslint.log; echo "❌ ESLint missing $file location (#346)"; exit 1; }
	done
	grep -q "svforge/no-design-violations" /tmp/sf-eslint.log || { cat /tmp/sf-eslint.log; echo "❌ ESLint missing svforge rule identifier (#346)"; exit 1; }
	rm -rf src/lib/lint-probe
fi

# Favicon + static assets (#325): the app.html-referenced /favicon.ico must
# resolve (prerendered route) and the primary SVG icon must ship.
test -f src/routes/favicon.ico/+server.ts || { echo "❌ favicon route missing at src/routes/favicon.ico/+server.ts (#325)"; exit 1; }
test -f static/favicon.svg || { echo "❌ static/favicon.svg missing (#325)"; exit 1; }
test -f static/robots.txt || { echo "❌ static/robots.txt missing (#325)"; exit 1; }

# Destinations contract (#325): known root files must exist EXACTLY once —
# never duplicated under src/ by a destination-resolution drift.
for root_file in vitest.config.ts playwright.config.ts drizzle.config.ts .env.example eslint.config.js svforge-check.mjs svforge-modules.json; do
	if [ -f "src/$root_file" ]; then
		echo "❌ root file $root_file was ALSO written under src/ (#325 destination drift)"; exit 1
	fi
done
if [ "$TEMPLATE" != "base" ] && [ "$TEMPLATE" != "base-ui-modules" ] && [ -f src/vitest.config.ts ]; then
	echo "❌ src/vitest.config.ts resurrection — one Vitest config, at the root (#325)"; exit 1
fi

# Baseline Vitest (#235): vitest.config.ts must land at the PROJECT ROOT on
# base too (prebuild only embeds templates/base/src/**), and the baseline
# test must actually run.
if [ "$TEMPLATE" = "base" ] || [ "$TEMPLATE" = "base-ui-modules" ]; then
	test -f vitest.config.ts || { echo "❌ vitest.config.ts missing at project root (#235)"; exit 1; }
	bun run test || { echo "❌ baseline vitest failed on $TEMPLATE scaffold (#235)"; exit 1; }
fi
# dashboard-integrations (#284): the upload security test pack (incl. the size
# contract #279) must pass inside the scaffold.
if [ "$TEMPLATE" = "dashboard-integrations" ]; then
	bun run test || { echo "❌ vitest failed on dashboard-integrations scaffold (#284)"; exit 1; }
fi

# Blog: assert the welcome.md post is actually compiled by mdsvex (not parsed
# as raw Svelte — the #185 regression) by checking the build output.
if [ "$TEMPLATE" = "base-blog" ]; then
	grep -rl "Welcome to your blog" .svelte-kit/output/server/ >/dev/null \
		|| { echo "❌ welcome.md not compiled by mdsvex (#185)"; exit 1; }

	# Runtime smoke (#293): serve the production build and hit /blog and
	# /blog/welcome over HTTP. MDsveX compiles a post into a Svelte COMPONENT
	# (never an HTML string), so the rendered page must contain the markdown
	# body AND the inline Svelte component of welcome.md — not a broken
	# "[object Object]" {@html} output.
	bun run preview -- --port 4188 >/tmp/sf-preview.log 2>&1 &
	PREVIEW_PID=$!
	for i in $(seq 1 30); do
		curl -sf http://localhost:4188/blog >/dev/null 2>&1 && break
		sleep 1
	done
	BLOG_HTML=$(curl -sf http://localhost:4188/blog) || { echo "❌ /blog not served by preview (#293)"; kill $PREVIEW_PID; exit 1; }
	echo "$BLOG_HTML" | grep -q "Welcome to your blog" \
		|| { echo "❌ /blog list lacks the post title (#293)"; kill $PREVIEW_PID; exit 1; }
	POST_HTML=$(curl -sf http://localhost:4188/blog/welcome) || { echo "❌ /blog/welcome not served by preview (#293)"; kill $PREVIEW_PID; exit 1; }
	echo "$POST_HTML" | grep -q "Welcome!" \
		|| { echo "❌ /blog/welcome lacks the markdown h1 (#293)"; kill $PREVIEW_PID; exit 1; }
	echo "$POST_HTML" | grep -q "MDsveX features" \
		|| { echo "❌ /blog/welcome lacks the markdown body (#293)"; kill $PREVIEW_PID; exit 1; }
	echo "$POST_HTML" | grep -q "Count:" \
		|| { echo "❌ /blog/welcome lacks the embedded Svelte component (#293)"; kill $PREVIEW_PID; exit 1; }
	kill $PREVIEW_PID 2>/dev/null
fi

# 4b. dashboard-foundations composition (#258): the five new foundation
# modules must keep composing after future SvelteForge changes — schemas,
# hooks, Paraglide, manifest/llms and the real tests all together.
if [ "$TEMPLATE" = "dashboard-foundations" ]; then
	# Drizzle schemas compose without collision (all registered in the barrel)
	for sym in auditLogs notifications jobs conversations messageReads; do
		grep -q "$sym" src/lib/server/db/schema.ts || { echo "❌ schema $sym missing in Drizzle barrel (#258)"; exit 1; }
	done
	# Hooks are patched/composed without overwriting (paraglide + better-auth);
	# #328: the jobs runner is OPT-IN ONLY — the web runtime never starts a poller.
	grep -q "paraglideMiddleware" src/hooks.server.ts || { echo "❌ paraglide middleware missing (#258)"; exit 1; }
	grep -q "svelteKitHandler" src/hooks.server.ts || { echo "❌ better-auth handler missing (#258)"; exit 1; }
	if grep -q "startJobRunner" src/hooks.server.ts; then
		echo "❌ hooks.server.ts auto-starts the job runner — forbidden since #328"; exit 1
	fi
	# #328: the explicit worker entrypoint IS wired instead
	test -f src/lib/server/jobs/worker.ts || { echo "❌ jobs worker entrypoint missing (#328)"; exit 1; }
	grep -q '"jobs:worker"' package.json || { echo "❌ jobs:worker script missing (#328)"; exit 1; }
	# Paraglide FR/EN stays coherent across all modules
	grep -q "chat_title" messages/fr.json || { echo "❌ chat fr messages missing (#258)"; exit 1; }
	grep -q "chat_title" messages/en.json || { echo "❌ chat en messages missing (#258)"; exit 1; }
	# .svforge.json / llms.txt reflect every installed module (#234)
	for mod in audit notifications jobs chat realtime; do
		grep -q "\"$mod\"" .svforge.json || { echo "❌ module $mod missing in .svforge.json (#258)"; exit 1; }
	done
	for cap in "audit trail" "background jobs" "chat" "realtime (WebSocket)" "notifications"; do
		grep -q "$cap" llms.txt || { echo "❌ capability '$cap' missing in llms.txt (#258)"; exit 1; }
		# #296: .svforge.json carries the SAME capability data as llms.txt
		grep -q "$cap" .svforge.json || { echo "❌ capability '$cap' missing in .svforge.json (#296)"; exit 1; }
	done
	grep -q "Database: postgresql" llms.txt || { echo "❌ llms.txt lacks PostgreSQL (#258)"; exit 1; }
	# Tests of the installed modules run (dashboard vitest baseline)
	bun run test || { echo "❌ vitest failed on dashboard-foundations scaffold (#258)"; exit 1; }
fi

# 4c. base-ui-modules / dashboard-integrations composition (#284): the
#     historical modules must compose in a real consumer project and declare
#     themselves in the AI manifest.
if [ "$TEMPLATE" = "base-ui-modules" ]; then
	for mod in dnd tiptap graph ui_toast; do
		grep -q "\"$mod\"" .svforge.json || { echo "❌ module $mod missing in .svforge.json (#284)"; exit 1; }
	done
	for cap in "drag & drop" "rich text (Tiptap)" "knowledge graph" "toasts (Skeleton Toast)"; do
		grep -q "$cap" llms.txt || { echo "❌ capability '$cap' missing in llms.txt (#284)"; exit 1; }
		grep -q "$cap" .svforge.json || { echo "❌ capability '$cap' missing in .svforge.json (#296)"; exit 1; }
	done
fi
if [ "$TEMPLATE" = "dashboard-integrations" ]; then
	for mod in oauth email; do
		grep -q "\"$mod\"" .svforge.json || { echo "❌ module $mod missing in .svforge.json (#284)"; exit 1; }
	done
	for cap in "oauth (Google/GitHub)" "email (Resend)"; do
		grep -q "$cap" llms.txt || { echo "❌ capability '$cap' missing in llms.txt (#284)"; exit 1; }
		grep -q "$cap" .svforge.json || { echo "❌ capability '$cap' missing in .svforge.json (#296)"; exit 1; }
	done
	# Verify the uploads capability structurally, then regenerate its agent context.
	# The scaffold has no local svforge bin (sv add copies sources, it does not
	# depend on the addon) — run the repo's own CLI against the project (#338).
	bun "$REPO_ROOT/packages/svforge/bin/svforge.mjs" context || { echo "❌ llms.txt regeneration failed (#338)"; exit 1; }
	bun -e '
		const manifest = JSON.parse(await Bun.file(".svforge.json").text());
		if (!Array.isArray(manifest.modules) || !manifest.modules.includes("uploads")) {
			throw new Error("uploads module missing in .svforge.json (#284)");
		}
		const entries = Object.entries(manifest.patterns ?? {}).filter(
			([, pattern]) => typeof pattern === "string" && pattern.startsWith("src/routes/api/upload/")
		);
		const [capability, pattern] = entries[0] ?? [];
		if (entries.length !== 1 || typeof capability !== "string" || typeof pattern !== "string" || !manifest.capabilities?.includes(capability)) {
			throw new Error("uploads capability missing structured manifest data (#296)");
		}
		const lines = (await Bun.file("llms.txt").text()).split("\n");
		const header = lines.indexOf("## Capabilities installed");
		const end = lines.findIndex((line, index) => index > header && line.startsWith("## "));
		const capabilities = lines.slice(header + 1, end === -1 ? lines.length : end);
		if (header === -1 || !capabilities.includes(`- ${capability}`)) {
			throw new Error("regenerated llms.txt omits the uploads capability (#284)");
		}
	'
	# Upload security test pack proves the storage-enforced POST hard limit (#338).
	grep -q "rejects a lying declared size with an oversized multipart payload without retaining an object" src/routes/api/upload/upload-security.test.ts \
		|| { echo "❌ upload test pack lacks the POST hard-limit test (#338)"; exit 1; }
fi

# 5. Assert testing-profile files land at the project ROOT, not src/ (#186)
if [ "$TEMPLATE" = "dashboard" ] || [ "$TEMPLATE" = "dashboard-playwright" ] || [ "$TEMPLATE" = "dashboard-foundations" ] || [ "$TEMPLATE" = "dashboard-integrations" ]; then
	test -f vitest.config.ts || { echo "❌ vitest.config.ts missing at project root"; exit 1; }
fi
if [ "$TEMPLATE" = "dashboard-playwright" ]; then
	test -f playwright.config.ts || { echo "❌ playwright.config.ts missing at project root"; exit 1; }
	test -f e2e/auth.test.ts || { echo "❌ e2e/auth.test.ts missing at project root"; exit 1; }
fi

# 5b. Canonical component structure primitives/ui/layout (#242)
if [ "$TEMPLATE" = "base" ] || [ "$TEMPLATE" = "dashboard" ] || [ "$TEMPLATE" = "dashboard-playwright" ] || [ "$TEMPLATE" = "dashboard-foundations" ] || [ "$TEMPLATE" = "base-ui-modules" ] || [ "$TEMPLATE" = "dashboard-integrations" ]; then
	test -f src/lib/components/svforge/primitives/Button.svelte || { echo "❌ primitives/Button.svelte missing (#242)"; exit 1; }
	test -f src/lib/components/svforge/primitives/index.ts || { echo "❌ primitives/index.ts missing (#242)"; exit 1; }
	test -f src/lib/components/svforge/ui/Card.svelte || { echo "❌ ui/Card.svelte missing (#242)"; exit 1; }
	test -f src/lib/components/svforge/layout/Navbar.svelte || { echo "❌ layout/Navbar.svelte missing (#242)"; exit 1; }
	# No primitive may leak back into ui/ (separation is canonical)
	if [ -f src/lib/components/svforge/ui/Button.svelte ]; then
		echo "❌ Button.svelte must live in primitives/, not ui/ (#242)"; exit 1
	fi
fi

# 5c. Paraglide FR/EN baseline delivered (#239)
if [ "$TEMPLATE" = "base" ] || [ "$TEMPLATE" = "dashboard" ] || [ "$TEMPLATE" = "dashboard-playwright" ] || [ "$TEMPLATE" = "dashboard-foundations" ] || [ "$TEMPLATE" = "base-ui-modules" ] || [ "$TEMPLATE" = "dashboard-integrations" ]; then
	test -f messages/fr.json || { echo "❌ messages/fr.json missing (#239)"; exit 1; }
	test -f messages/en.json || { echo "❌ messages/en.json missing (#239)"; exit 1; }
	test -f project.inlang/settings.json || { echo "❌ project.inlang/settings.json missing (#239)"; exit 1; }
	test -f src/hooks.server.ts || { echo "❌ hooks.server.ts missing (#239)"; exit 1; }
	grep -q "paraglideVitePlugin" vite.config.ts || { echo "❌ paraglide plugin missing in vite.config.ts (#239)"; exit 1; }
fi

# 5d. Design-system harness (#240): catalog delivered + check runs clean
if [ "$TEMPLATE" = "base" ] || [ "$TEMPLATE" = "dashboard" ] || [ "$TEMPLATE" = "dashboard-playwright" ] || [ "$TEMPLATE" = "dashboard-foundations" ] || [ "$TEMPLATE" = "base-ui-modules" ] || [ "$TEMPLATE" = "dashboard-integrations" ]; then
	test -f svforge-catalog.json || { echo "❌ svforge-catalog.json missing (#240)"; exit 1; }
	test -f svforge-check.mjs || { echo "❌ svforge-check.mjs missing (#240)"; exit 1; }
	test -f svforge-modules.json || { echo "❌ svforge-modules.json missing (#236)"; exit 1; }
	test -f .svforge.json || { echo "❌ .svforge.json missing (#234)"; exit 1; }
	test -f llms.txt || { echo "❌ llms.txt missing (#234)"; exit 1; }
	# Assert the checker exit code AND zero diagnostics (ERROR or WARN) —
	# not just one display string (#361 review). The capture is set -e safe:
	# the assignment failure is neutralized so the real scaffold error is
	# always printed before the gate resolves it.
	set +e
	check_output=$(node svforge-check.mjs 2>&1)
	check_status=$?
	set -e
	if [ "$check_status" -ne 0 ] || printf '%s' "$check_output" | grep -Eq '✗|⚠'; then
		echo "❌ svforge check produced diagnostics or failed (exit $check_status) (#240, #335):"
		echo "$check_output"
		exit 1
	fi
	# bun run check chains the design-system check (#343): the generated
	# script must invoke the self-contained local checker.
	grep -q 'svforge-check.mjs' package.json || { echo "❌ bun run check does not chain svforge-check.mjs (#343)"; exit 1; }
fi

# 5e (#343) severity contract through the REAL `bun run check` (base only —
# it compiles Paraglide and runs svelte-check, ~1 min). ERROR fails the
# command; WARN-only still succeeds.
if [ "$TEMPLATE" = "base" ]; then
	mkdir -p src/routes/__ds343
	# ERROR: invented Skeleton-looking utility.
	echo '<div class="btn-md"></div>' > src/routes/__ds343/+page.svelte
	set +e
	err_output=$(bun run check 2>&1)
	err_status=$?
	set -e
	if [ "$err_status" -eq 0 ]; then
		echo "❌ bun run check passed despite a design-system ERROR (#343):"
		echo "$err_output"
		rm -rf src/routes/__ds343
		exit 1
	fi
	printf '%s' "$err_output" | grep -q 'btn-md does not exist' || { echo "❌ design-system ERROR not reported by bun run check (#343):"; echo "$err_output"; rm -rf src/routes/__ds343; exit 1; }
	# WARN-only: arbitrary hex stays informational — the command still succeeds.
	echo '<!-- #a1b2c3 -->' > src/routes/__ds343/+page.svelte
	set +e
	warn_output=$(bun run check 2>&1)
	warn_status=$?
	set -e
	rm -rf src/routes/__ds343
	if [ "$warn_status" -ne 0 ]; then
		echo "❌ bun run check failed on a WARN-only project (#343):"
		echo "$warn_output"
		exit 1
	fi
	echo "✓ bun run check severity contract: ERROR fails, WARN-only passes (#343)"
fi

# 5f. Better Auth runtime gate (#319): the PINNED better-auth version must
#     actually work in the scaffolded dashboard, not just typecheck. Three
#     checks on the plain dashboard profile (needs the real PostgreSQL from
#     the CI service, like the dashboard-foundations profile):
#     a. template vitest baseline — credential lifecycle + admin CRUD against
#        real PG, incl. "admin creates user without losing their session; the
#        created user can sign in" through the REAL Better Auth endpoint;
#     b. @better-auth/cli generate output vs the committed auth.schema.ts;
#     c. HTTP smoke: /setup (first admin) → login → admin CRUD (create user
#        B, admin session survives) → B signs in. E2E OAuth is a documented
#        follow-up (docs/better-auth-upgrades.md) — it needs provider stubs.
if [ "$TEMPLATE" = "dashboard" ]; then
	# 5f.a Template vitest baseline (uses the .env + schema pushed above).
	bun run test || { echo "❌ vitest failed on dashboard scaffold (#319 better-auth runtime gate)"; exit 1; }

	# 5f.b The CLI-generated schema must be reproducible (the template's
	# `auth:schema` path works), and the committed auth.schema.ts must match
	# the INSTALLED better-auth runtime schema — derived via `getSchema()`
	# from the project's own node_modules, NOT from the version-lagging CLI
	# (whose 1.4.x schema knowledge misses runtime 1.7 type/nullability/
	# default/index/FK drift — #319 review). The generator runs via bunx —
	# @better-auth/cli must NOT be a project dependency (its nested
	# @better-auth/core@1.4.x hoists over the runtime's 1.7.x copy and breaks
	# the SSR build). The CLI version is pinned here and in the template's
	# auth:schema source. Two CLI gotchas (#319): the output path must NOT
	# already exist (pre-existing files get overwritten to 0 bytes) and must
	# be relative (absolute paths resolved from the bunx cache are
	# unreliable) — hence the guarded temp file inside the project.
	SCHEMA_GEN=".sf-auth-schema-gate.ts"
	rm -f "$SCHEMA_GEN"
	if ! bunx @better-auth/cli@1.4.21 generate --config src/lib/server/auth.ts --output "$SCHEMA_GEN" --yes >"${TMPDIR:-/tmp}/sf-auth-generate.log" 2>&1; then
		cat "${TMPDIR:-/tmp}/sf-auth-generate.log"
		echo "❌ better-auth generate failed (#319)"; exit 1
	fi
	if [ ! -s "$SCHEMA_GEN" ]; then
		echo "❌ better-auth generate produced an empty schema file (#319)"; exit 1
	fi
	rm -f "$SCHEMA_GEN"
	if ! node "$REPO_ROOT/scripts/check-auth-schema.mjs" src/lib/server/db/auth.schema.ts --project .; then
		echo "❌ committed auth.schema.ts drifted from the installed better-auth runtime schema (#319)"; exit 1
	fi

	# 5f.c Runtime HTTP smoke against the dev server (the /setup route is
	# dev-only). The dedicated test database is already EMPTY here: the vitest
	# suites clean their own rows (#312), so /setup's zero-admin precondition
	# holds WITHOUT a destructive wipe — the old global DELETE FROM is gone.
	# SvelteKit form-action CSRF: POSTs need a matching `origin` header (no
	# token/cookie dance). Action responses may carry "type:failure" bodies
	# over HTTP 200 — assert bodies, not just status codes.
	SMOKE_RUN="$$-$(date +%s)"
	SMOKE_ADMIN_EMAIL="smoke-admin-${SMOKE_RUN}@sf-test.example"
	SMOKE_USER_EMAIL="smoke-user-${SMOKE_RUN}@sf-test.example"

	SMOKE_PORT=5173 # must equal ORIGIN in .env — SvelteKit CSRF and better-auth trust that origin only
	ORIGIN="http://localhost:$SMOKE_PORT"
	(
		set -euo pipefail
		DEV_PID=0
		trap 'kill $DEV_PID 2>/dev/null || true' EXIT
		fail() { echo "❌ $1 (#319)"; exit 1; }

		bun run dev --port "$SMOKE_PORT" --strictPort >"${TMPDIR:-/tmp}/sf-dashboard-dev.log" 2>&1 &
		DEV_PID=$!
		for _ in $(seq 1 90); do
			if curl -sf -o /dev/null "$ORIGIN/login"; then break; fi
			sleep 2
		done
		curl -sf -o /dev/null "$ORIGIN/login" || fail "dev server never became ready on :$SMOKE_PORT"

		# Favicon (#325): /favicon.ico must resolve over HTTP (never 404).
		favicon_status=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/favicon.ico")
		[ "$favicon_status" = "200" ] || fail "/favicon.ico returned HTTP $favicon_status (#325)"

		ADMIN_JAR="${TMPDIR:-/tmp}/sf-smoke-admin-jar.txt"
		USER_JAR="${TMPDIR:-/tmp}/sf-smoke-user-jar.txt"
		rm -f "$ADMIN_JAR" "$USER_JAR"

		# Setup: create the first admin (dev-only route redirects to /login).
		setup_body=$(curl -sf -b "$ADMIN_JAR" -c "$ADMIN_JAR" -H "origin: $ORIGIN" \
			--data "name=Smoke Admin&email=${SMOKE_ADMIN_EMAIL}&password=smokepass123" \
			"$ORIGIN/setup") || fail "POST /setup errored"
		if printf '%s' "$setup_body" | grep -q '"type":"failure"'; then
			fail "POST /setup failed: $setup_body"
		fi

		# SECURITY (#318): sign-up is CLOSED by default — the public Better Auth
		# endpoint must refuse registration (HTTP 400) and create NO user row.
		signup_status=$(curl -s -o "${TMPDIR:-/tmp}/sf-smoke-signup.json" -w '%{http_code}' \
			-H "origin: $ORIGIN" -H 'content-type: application/json' \
			--data '{"name":"Attacker","email":"attacker@example.com","password":"attackerpass123"}' \
			"$ORIGIN/api/auth/sign-up/email") || fail "sign-up probe errored"
		[ "$signup_status" = "400" ] || fail "public sign-up was NOT rejected in closed mode (HTTP $signup_status)"
		grep -q 'EMAIL_PASSWORD_SIGN_UP_DISABLED' "${TMPDIR:-/tmp}/sf-smoke-signup.json" \
			|| fail "sign-up rejection missing the EMAIL_PASSWORD_SIGN_UP_DISABLED code"
		attacker_count=$(bun -e 'const { default: postgres } = await import("postgres"); const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1 }); const rows = await sql`SELECT count(*)::int AS n FROM "user" WHERE email = ${"attacker@example.com"}`; console.log(rows[0].n); await sql.end();')
		[ "$attacker_count" = "0" ] || fail "the anonymous sign-up probe created a user row"

		# Admin login through the real Better Auth credential flow.
		curl -sf -o /dev/null -b "$ADMIN_JAR" -c "$ADMIN_JAR" -H "origin: $ORIGIN" \
			--data "email=${SMOKE_ADMIN_EMAIL}&password=smokepass123" \
			"$ORIGIN/login" || fail "admin login action errored"
		grep -q better-auth.session_token "$ADMIN_JAR" || fail "admin login did not set a session cookie"

		# Admin CRUD: the users page authorizes the admin and the create
		# action persists user B.
		admin_status=$(curl -s -o "${TMPDIR:-/tmp}/sf-smoke-admin.html" -w '%{http_code}' -b "$ADMIN_JAR" "$ORIGIN/admin/users")
		[ "$admin_status" = "200" ] || fail "GET /admin/users returned $admin_status for the admin"
		grep -q "$SMOKE_ADMIN_EMAIL" "${TMPDIR:-/tmp}/sf-smoke-admin.html" || fail "admin users page does not list the admin"

		create_body=$(curl -sf -b "$ADMIN_JAR" -c "$ADMIN_JAR" -H "origin: $ORIGIN" \
			--data "name=Smoke User&email=${SMOKE_USER_EMAIL}&password=smokepass123" \
			"$ORIGIN/admin/users?/create") || fail "admin create action errored"
		if printf '%s' "$create_body" | grep -q '"type":"failure"'; then
			fail "admin create action failed: $create_body"
		fi

		# THE contract: the admin's OWN session survives the create action —
		# the users page must still authorize as the ADMIN (HTTP 200).
		still_admin=$(curl -s -o "${TMPDIR:-/tmp}/sf-smoke-admin2.html" -w '%{http_code}' -b "$ADMIN_JAR" "$ORIGIN/admin/users")
		[ "$still_admin" = "200" ] || fail "admin session did not survive the create action (HTTP $still_admin)"
		grep -q "$SMOKE_USER_EMAIL" "${TMPDIR:-/tmp}/sf-smoke-admin2.html" || fail "admin create action did not persist user B"

		# B can sign in with the credentials the admin created.
		curl -sf -o /dev/null -b "$USER_JAR" -c "$USER_JAR" -H "origin: $ORIGIN" \
			--data "email=${SMOKE_USER_EMAIL}&password=smokepass123" \
			"$ORIGIN/login" || fail "created user B could not sign in"
		grep -q better-auth.session_token "$USER_JAR" || fail "user B login did not set a session cookie"

		# SECURITY (#318): the explicit role decides — non-admin B is redirected
		# away from the users page and the admin keeps full access.
		user_status=$(curl -s -o /dev/null -w '%{http_code}' -b "$USER_JAR" "$ORIGIN/admin/users")
		[ "$user_status" = "302" ] || fail "non-admin B was not redirected from /admin/users (HTTP $user_status)"

		kill "$DEV_PID" 2>/dev/null || true
		echo "✓ Better Auth runtime smoke: setup → closed sign-up rejected → admin login → admin CRUD → user B sign-in → B denied admin (#319, #318)"
	)

	# #312 — the harness leaves the DEDICATED test database EMPTY: remove the
	# rows the smoke flow created (run-scoped marker) and assert that no test
	# data of any kind remains behind.
	SF_MARKER='%@sf-test.example' SF_ATTACKER='attacker@example.com' bun -e 'const { default: postgres } = await import("postgres"); const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1 }); await sql`DELETE FROM "user" WHERE email LIKE ${process.env.SF_MARKER} OR email = ${process.env.SF_ATTACKER}`; const rows = await sql`SELECT count(*)::int AS n FROM "user"`; if (rows[0].n !== 0) { console.error("leftover users:", rows[0].n); await sql.end(); process.exit(1); } await sql.end();' \
		|| { echo "❌ test data left behind in the dedicated test database (#312)"; exit 1; }
fi

# 6. AI-ready: AGENTS.md scaffolded at the project root (#203)
test -f AGENTS.md || { echo "❌ AGENTS.md missing at project root (#203)"; exit 1; }
grep -q "preset-tonal" AGENTS.md || { echo "❌ AGENTS.md lacks Skeleton v5 class guidance (#203)"; exit 1; }
if [ "$TEMPLATE" = "dashboard" ] || [ "$TEMPLATE" = "dashboard-playwright" ] || [ "$TEMPLATE" = "dashboard-foundations" ] || [ "$TEMPLATE" = "dashboard-integrations" ]; then
	grep -q "result.data" AGENTS.md || { echo "❌ dashboard AGENTS.md lacks action-response pattern (#203)"; exit 1; }
fi

echo "✅ Scaffold test passed for template=$TEMPLATE"
