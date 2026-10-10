# SvelteKit compatibility and migration policy

**Verified 2026-10-10.** SVForge follows the current stable Svelte ecosystem; it does not silently retarget every dependency to `latest`. This report records real projects created with the published `sv` CLI, SVForge npm-packed artifacts, and the resolved framework versions used for the checks.

## Support policy

- **Scaffold target:** the current stable SvelteKit major, currently Kit 3, created by the exact `sv` version pinned in the repository root (`sv@1.1.1`). The release workflow's existing scaffold and packed-consumer jobs are the blocking certification gates.
- **Previous Kit major:** Kit 2 is not a fresh-scaffold target. Existing Kit 2 projects must use Svelte's official `sv migrate sveltekit-3`; `svforge upgrade` only updates SVForge recipes and is not a framework migrator. As of this report, Kit 2 → Kit 3 migration of a project containing the current SVForge overlay is **not certified** because the official migration has reproducible unresolved issues (see below). Do not advertise a successful migration until the resolution criteria are met.
- **Stable versus drift:** the root `package.json` and `bun.lock` pin the exact `sv` CLI used by deterministic CI/release jobs. Generated SvelteKit dependencies use the ranges emitted by `sv create`; package managers resolve them normally and projects should commit their own lockfile. The weekly `canary.yml` remains the sole floating ecosystem-drift workflow (`sv@latest` and latest ecosystem dependencies). Do not add another scheduled drift workflow.
- **Promotion is human-controlled:** after a canary or manual compatibility run passes, a reviewed PR updates the exact root `sv` pin and lockfile, this report's tested-version row, and any CLI-specific regression tests. Never make a successful `latest` run rewrite stable pins automatically. A release is not compatible merely because an upstream version was announced.

## Reproducible current-major report

The checks used Node.js `24.21.0`, Bun `1.3.13`, the published `sv@1.1.1`, and freshly generated projects. The framework packages resolved in the packed base/blog consumer were:

| Package                        | Resolved version |
| ------------------------------ | ---------------: |
| `sv`                           |          `1.1.1` |
| `@sveltejs/kit`                |          `3.0.1` |
| `svelte`                       |         `5.57.2` |
| `vite`                         |          `8.3.4` |
| `@sveltejs/vite-plugin-svelte` |          `7.3.1` |
| `@tailwindcss/vite`            |          `4.3.3` |
| `@sveltejs/adapter-auto`       |          `8.0.0` |
| `svelte-check`                 |          `4.7.6` |
| `typescript`                   |          `6.0.3` |

No package-manager `--force` or `--legacy-peer-deps` peer-resolution flags were used. The database profiles use `drizzle-kit push --force` only against disposable PostgreSQL 17 test databases.

| Real project/profile    | Artifact and package manager                                                                          | Result                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base`                  | `npm pack` of SVForge CLI/add-on; Bun `1.3.13`, npm `11.19.0`, pnpm `10.12.1`, Yarn Classic `1.22.22` | All four install paths passed `svelte-check`, production build, 5 Vitest tests and an HTTP 200 smoke.                                                  |
| `base + blog/mdsvex`    | `npm pack` of SVForge and `@svforge/blog`; Bun                                                        | Passed SVForge doctor/check, `svelte-check` (0 errors/warnings), build and 5 tests.                                                                    |
| `dashboard`             | `npm pack` golden path with current SVForge and all module artifacts; Bun + disposable PostgreSQL 17  | Passed `svforge verify` (doctor, design check, Svelte check, build, tests), 57 tests and the setup/login/admin HTTP journey.                           |
| `dashboard-foundations` | Real `sv create` → compiled local addon packages → install; Bun + disposable PostgreSQL 17            | Passed schema push, build, Svelte check and 57 tests. This supplements the packed full-dashboard run; it is not counted as the packed-artifact result. |

The four package-manager runs cover the packed `base` path; the blog and database profiles were exercised with Bun. This is a targeted certification set, not a claim that every profile was run under every manager. The release workflow already covers the blocking profile matrix and consumer tarballs; this issue does not add a second cron or an exhaustive PR matrix.

### Commands used

From the repository root, after `bun install --frozen-lockfile --ignore-scripts` and `bun run build:all`:

```sh
# Packed base consumer, repeat with SF_PM=npm, SF_PM=pnpm, SF_PM=yarn
SF_PM=bun bash scripts/test-user-journey.sh --template base --sv 1.1.1

# Real generated project with the compiled blog add-on
SV_CMD='bunx sv@1.1.1' SF_PM=bun bash scripts/test-scaffold.sh base-blog

# Real dashboard and representative PostgreSQL/module profile; point these
# commands only at a fresh disposable PostgreSQL 17 test database.
CI=true TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5434/sf_dashboard_test \
  SV_CMD='bunx sv@1.1.1' SF_PM=bun bash scripts/test-scaffold.sh dashboard
CI=true TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5434/sf_dashboard_test \
  SV_CMD='bunx sv@1.1.1' SF_PM=bun bash scripts/test-scaffold.sh dashboard-foundations

# Packed full dashboard + all module artifacts (same disposable DB requirement)
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5434/sf_dashboard_test \
  SF_PM=bun bash scripts/test-user-journey.sh --template dashboard --path create --sv 1.1.1
```

The packed base/blog path can be reproduced with the following steps after `bun run build:all`:

```sh
REPO=$PWD
WORK=$(mktemp -d)
SOURCE=$(node scripts/user-journey.mjs source --dest "$WORK/addons" --sv 1.1.1)
SV="$WORK/addons/node_modules/.bin/sv"
CLI_TARBALL=$(find "$WORK/addons/packs" -maxdepth 1 -name 'svforge-*.tgz' | head -1)
CLI=$(node scripts/user-journey.mjs install-cli --tarball "$CLI_TARBALL" --dest "$WORK/cli")
mkdir -p "$WORK/project"
cd "$WORK/project"
"$SV" create app --template minimal --types ts --no-install --no-add-ons --no-download-check
cd app
"$SV" add "$SOURCE=template:base+testing:vitest+hooks:none" --install bun --no-download-check
mkdir -p "$WORK/blog-packs" "$WORK/addons/registry/blog"
(cd "$REPO/packages/blog" && npm pack --pack-destination "$WORK/blog-packs" --json --ignore-scripts)
tar -xzf "$(find "$WORK/blog-packs" -name '*.tgz' | head -1)" \
  -C "$WORK/addons/registry/blog" --strip-components=1
"$SV" add "file:$WORK/addons/registry/blog" --install bun --no-download-check
"$CLI" doctor
"$CLI" check
bun run check
bun run build
bun run test
```

The user-journey helper uses the equivalent packed-artifact path for SVForge and for the full module set.

## Kit 3 integration notes

A fresh `sv@1.1.1 create` emits `vite.config.ts`, package import mappings for `#lib`, and no `svelte.config.js`. The real base, blog and dashboard builds above pass this layout. SVForge's existing `$lib` consumers are supported by its Vite wiring, but Kit 3 currently emits a non-blocking `config_option_deprecated_alias` warning for the compatibility alias. Removing that warning requires a separately validated `#lib` transition across SVForge and module templates; do not remove the fallback without that coverage.

Paraglide's generated `src/hooks.ts` and `src/hooks.server.ts` are exercised by current-major `svelte-check` and builds. `sv migrate sveltekit-3` also changes `svelte.config.js` → Vite configuration, `$lib` → `#lib`, environment APIs and adapter expectations. Review its generated `MIGRATION_TASKS.md`, especially environment, hook and adapter behavior; an exit code of zero from the migrator alone is not a completed migration.

## Kit 2 migration probe and blocker

A real Kit 2.70.3 minimal project was created with published `sv@0.15.4`, then the current SVForge npm tarball was added. Before migration its resolved versions were Svelte `5.57.2`, Vite `8.3.4`, `@sveltejs/vite-plugin-svelte` `7.3.1`, `svelte-check` `4.7.6`, and TypeScript `6.0.3`. A user-owned comment was inserted after `sv add`. The published `sv@1.1.1 migrate sveltekit-3 --tasks all --no-install --no-git-check --confirm` completed, updated the package range to Kit 3, and preserved the comment. A normal `npm install` resolved Kit 3.0.1 without peer-dependency overrides; Svelte, Vite, plugin, svelte-check and TypeScript remained at the versions above.

### Reproducing the migration probe

After `bun install --frozen-lockfile --ignore-scripts` and `bun run build:all` in the repository, these commands create the Kit 2 project and add the packed SVForge artifact. Run them in a disposable directory; the checks below intentionally include failures described in the report.

```sh
REPO=$PWD
TMP=$(mktemp -d)
npm install --prefix "$TMP/sv2" --no-save --no-package-lock --ignore-scripts sv@0.15.4
"$TMP/sv2/node_modules/.bin/sv" create "$TMP/app" --template minimal --types ts --no-install --no-add-ons --no-download-check
SOURCE=$(node scripts/user-journey.mjs source --dest "$TMP/addon" --sv 1.1.1)
SV="$TMP/addon/node_modules/.bin/sv"
cd "$TMP/app"
"$SV" add "$SOURCE=template:base+testing:vitest+hooks:none" --install npm --no-download-check
echo '<!-- user-owned marker: preserve me -->' >> src/routes/+page.svelte
"$SV" migrate sveltekit-3 --cwd "$TMP/app" --tasks all --no-install --no-git-check --confirm
npm install --no-audit --no-fund
grep -Fq 'user-owned marker: preserve me' src/routes/+page.svelte
npm run check       # reproduced failure: extensionless #lib/paraglide imports
npm run build       # passed
```

Use the same packed CLI for SVForge's post-migration diagnostics:

```sh
CLI_TARBALL=$(find "$TMP/addon/packs" -maxdepth 1 -name 'svforge-*.tgz' | head -1)
CLI=$(cd "$REPO" && node scripts/user-journey.mjs install-cli --tarball "$CLI_TARBALL" --dest "$TMP/cli")
"$CLI" doctor
"$CLI" check
set +e
"$CLI" upgrade base --dry-run  # reports migration conflicts; applies nothing
UPGRADE_STATUS=$?
set -e
test "$UPGRADE_STATUS" -eq 1
grep -Fq 'user-owned marker: preserve me' "$TMP/app/src/routes/+page.svelte"
```

This is **not a passing migration certification**:

- `npm run build`, `svforge doctor`, and `svforge check` passed after migration.
- `npm run check` failed on unresolved extensionless `#lib/paraglide/runtime` and `#lib/paraglide/server` imports left by the official `lib-alias` migration, with related implicit hook parameter diagnostics. This matches the open upstream Svelte CLI migration reports [#1392](https://github.com/sveltejs/cli/issues/1392) and [#1410](https://github.com/sveltejs/cli/issues/1410); do not patch the generated user project in SVForge or report this as green.
- `svforge upgrade base --dry-run` made no changes and reported recipe conflicts for files changed by migration. Its non-zero conflict result is expected to require review, not permission to overwrite migrated/user files.
- The Kit 2 project had existing generated build state. The stale Kit 2 declarations described in upstream [#1410](https://github.com/sveltejs/cli/issues/1410) are another reason to keep this migration path uncertified until the official task handles ordinary in-place projects.

### Criteria to promote Kit 2 migration support

On the same real Kit 2 + packed SVForge fixture, rerun the official migration after the upstream issues are resolved. Require: user-owned files remain byte-identical except for explicitly intended official transforms; generated `#lib` imports resolve; manual instructions are reviewed; the package-manager lockfile is updated without force flags; `svelte-check`, build and relevant tests pass; `svforge doctor` and `svforge check` pass; and `svforge upgrade --dry-run` reports conflicts without modifying files. Record the exact CLI/framework versions and update this report in a reviewed PR before claiming support.
