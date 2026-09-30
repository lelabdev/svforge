# npm release process

Publishing is driven by `.github/workflows/publish.yml`. Releases use npm token
authentication through `secrets.NPM_TOKEN`; OIDC provenance is not enabled. The
workflow has read-only repository permissions because npm publication does not
need GitHub write access.

## Independent versioning

Every workspace owns its version in `packages/*/package.json`. There is no
monorepo-wide version bump: a package is released only when its own manifest
version is not already present in the registry.

Each SVForge release still presents a single coherent distribution: the
unscoped `svforge` package is the public **distribution version** (the one
users install and run), while every `@svforge/*` module keeps its own
independent version. A module that did not change is never republished merely
because `svforge` was.

To keep those two levels coherent, the planner derives a machine-readable
**compatibility manifest** from the actual package manifests:

```json
{
  "schema": 1,
  "template": { "name": "svforge", "version": "2.1.0" },
  "packages": {
    "svforge": "2.1.0",
    "@svforge/addon-kit": "2.1.0",
    "@svforge/ui_toast": "2.0.1",
    "@svforge/dnd": "2.0.3"
  }
}
```

It is embedded into the published `svforge` CLI during prebuild
(`packages/svforge/src/compat-manifest.ts`), so an ordinary
`svforge create my-app --modules all` installs the exact compatible module
versions shipped with that `svforge` — the user never selects module versions
and the CLI never resolves an implicit `latest`. The same manifest is part of
the release plan, which is what the post-publish golden path validates.
Because the manifest is embedded, a module bump that is not accompanied by a
`svforge` bump would go stale: the planner rejects a release where `svforge`
is already published while a module is being republished
(`assertCompatibilityFreshness`) — bump `svforge` and the manifest ships anew.

The release planner enforces this policy and rejects invalid SemVer, a local
version that is older than the latest published version, or a package without a
matching current entry in `CHANGELOG.md`. SemVer comparison follows the core
and prerelease precedence rules and accepts build metadata.
Its machine-readable output follows [`release-plan.schema.json`](./release-plan.schema.json)
and contains:

- the schema version and `independent` versioning policy;
- the exact commit being released;
- the compatibility manifest (distribution version + every module version);
- every package name, version, manifest path and workspace directory;
- local package dependencies and their publication order;
- registry versions and whether the exact local version is already published;
- the changelog path and number of validated package release entries.

`CHANGELOG.md` uses one marked entry per package release. Each entry must name
an exact package and immutable version, date the release, and explicitly cover
breaking changes, migrations, fixes, and deprecations. Use `None.` when a
section is empty. Validate it locally with:

```bash
node scripts/changelog.mjs
```

This format is intentionally suitable for `svforge upgrade` and automated
release tooling to identify the package versions belonging to one release.

Generate the plan locally without contacting npm:

```bash
bun run release:plan
```

Query npm and save the registry-aware plan:

```bash
node scripts/release-plan.mjs \
  --check-registry \
  --output /tmp/svforge-release-plan.json
```

The planner orders local dependencies before their dependents. Independent
packages with no relationship are ordered deterministically, with scoped
`@svforge/*` packages before the unscoped `svforge` package.

The SvelteForge package embeds the validated entries during its prebuild.
`svforge upgrade base` and `svforge upgrade dashboard` then print the release
notes between the installed recipe version and the target recipe version. Use
`--to <version>` to select an explicit target available in the installed addon.

## Pipeline levels (#413)

Validation cost sits where it belongs:

| Trigger | Runs |
|---------|------|
| **Pull request** (`ci.yml`) | install, lint, typecheck, OSV audit, Better Auth stack audit, generated-manifest freshness, build, Vitest. **No PostgreSQL, no scaffold, no user journey.** A new push cancels the previous run. |
| **Push to `main`** (`ci.yml`) | the same fast checks + **one** representative scaffold (`test-scaffold.sh base`). |
| **Release** (`publish.yml`) | the full superset: quality + the 9-profile scaffold matrix + the external user journey + the one-command golden path, all **blocking** before the first `npm publish`. |
| **Weekly** (`canary.yml`) | the scaffolds (and the external journey) against the `latest` ecosystem, opening a drift issue on failure. |

## Workflow gates

`publish.yml` runs as separate jobs; the `publish` job starts only once
`quality`, `scaffolds` and `user-journey` are green. Before the first
publication, the workflow:

1. installs the pinned Bun and Node versions;
2. builds all 15 packages and runs the repository tests (quality job);
3. runs the FULL scaffold matrix — `base`, `dashboard`,
   `dashboard-playwright`, `base-blog`, `base-modules`,
   `dashboard-foundations`, `base-ui-modules`, `dashboard-integrations`,
   `create-cli` — with PostgreSQL for the DB profiles;
4. verifies npm authentication with `npm whoami`;
5. generates and prints the complete commit/version/registry plan;
6. verifies read-only npm package access for every already-published package;
   not-yet-created packages are allowed through this gate because
   `npm access list packages` cannot report a package before its first publish;
7. runs `npm pack --dry-run --json --ignore-scripts` for every package and
   verifies exports, JavaScript, declarations, README, LICENSE and packaged
   paths;
8. acquires `sv` from the registry into a scratch prefix and completes the
   **external user journey** (base + dashboard: `sv create` → `sv add` from
   the tarball → `svforge doctor`/`check` → setup → server → minimal flow)
   from a clean temporary directory, without touching the monorepo's
   `node_modules` (#462, #465);
9. completes the **golden path** (`--path create`): ONE non-interactive
   `svforge create` from the packed artifacts (`--addon-root`, never
   `--dev-root` or the checkout), then verifies the manifest records every
   requested module, runs `svforge verify`, mounts the real PostgreSQL schema,
   boots the app and replays the setup/login/admin flow (#470);
10. publishes the plan in dependency order;
11. installs every exact published version in a clean consumer, imports every
    package from a generated TypeScript consumer, and runs `tsc --noEmit` to
    validate package export and declaration resolution;
12. reruns the user journey against the EXACT published `svforge` version from
    the release plan (`--published "$VERSION"`), and reruns the golden path
    against the exact per-package versions from the release plan's
    compatibility manifest (`--path create --published "$VERSION"
    --compat-manifest <plan>`).

The workflow uses a repository-global concurrency group so a production push
and a manual dispatch cannot publish simultaneously, even from different refs.
All third-party actions are pinned to commit SHAs.

## Resuming a failed release

The publish step reads the registry state captured by the plan. It skips an
exact package version that already exists and publishes the remaining versions.
A rerun therefore resumes after an intermediate failure instead of attempting
to republish an immutable npm version. The plan must be regenerated on each
run so it reflects the current registry state.

An unchanged version produces no `npm publish` call.

## Authentication and permissions

The npm account behind `NPM_TOKEN` must be allowed to publish every scoped
`@svforge/*` package and the unscoped `svforge` package. `npm whoami` verifies
that the token is present and valid. For packages already in the registry, the
release plan runs `npm access list packages --json` and rejects any package
that is absent or not reported as writable. Not-yet-published packages are
skipped by this lookup; npm remains the authority when their first publish is
attempted.

Do not print, commit or include npm tokens in release output. Never run the
publish command locally or trigger the production workflow without explicit
maintainer authorization.

## Local preflight

Build first, then inspect all package tarballs without publishing:

```bash
bun run build:all
node scripts/release-plan.mjs --preflight
```

The preflight requires each package to contain `README.md`, `package.json`,
`LICENSE`, `dist/index.js`, `dist/index.d.ts`, and every declared export or
binary entry point.

The post-publication consumer smoke test is also available locally with a
registry-aware plan:

```bash
node scripts/npm-consumer-smoke.mjs --plan /tmp/svforge-release-plan.json
```

It installs exact package versions plus a temporary TypeScript compiler with
scripts disabled, generates imports for every package, and runs `tsc --noEmit`
with NodeNext resolution. This validates the real package exports and
TypeScript declarations, not just the existence of a `.d.ts` file. The smoke
test is intentionally run only after publication; unpublished local versions
cannot be tested from npm.

## Published user journey

`scripts/test-user-journey.sh` reproduces the path a **real external user**
follows (#462, hardened in #465). It starts from an empty temporary directory
and acquires the `sv` CLI from the registry into a scratch prefix — it never
reads `$REPO_ROOT/node_modules`:

```bash
bun run test:user-journey                   # pack the current build, run from tarballs
bun run test:user-journey --template base   # one journey only (no PostgreSQL needed)
bash scripts/test-user-journey.sh --published <version>  # the exact published npm version
bash scripts/test-user-journey.sh --sv latest            # acquire the latest `sv` (canary)
```

Local mode runs `npm pack`, extracts the tarball under the scratch prefix and
uses `sv add file:<extracted>` — never `file:<repo>/packages/...` and never
`--dev-root`. `--published` **requires an explicit version** (there is no
`latest` fallback), so the post-publish signal always tests the exact artifact
that was just shipped. A file missing from the npm artifact, a broken
documented install, or a project that cannot build/start therefore fails the
gate instead of being masked by the monorepo checkout. The dashboard journey
needs a reachable PostgreSQL (`TEST_DATABASE_URL`, same contract as the scaffold
suite); run `--template base` locally without one. The work is done in a
temporary directory that is removed at the end of the run (`--keep` to inspect
it).

### One-command golden path (`--path create`, #470)

`--path create` exercises the product promise directly: a single
non-interactive `svforge create ... --yes` instead of the manual
`sv create` → `sv add`. It asserts the generated `.svforge.json` records the
requested template, every requested module (the `--modules all` set is derived
from the canonical registry, not a duplicated list) and the attested runtime,
then runs `svforge verify`, sets up the PostgreSQL schema, boots the app and
replays the dashboard setup/login/admin flow.

- **Pre-publish** sources the add-ons from the packed artifacts via
  `--addon-root`. That mode **fails closed**: a requested artifact missing from
  the addon-root is an error, never a silent npm fallback, so the gate can only
  validate the CURRENT packaged artifacts.
- **Post-publish** pins the exact per-package versions from the release plan's
  compatibility manifest via `--compat-manifest <plan>`, so a module whose
  version differs from `svforge` is still tested at its own version.

```bash
# pre-publish (blocking), from packed artifacts
bash scripts/test-user-journey.sh --path create
# post-publish, exact per-package versions from the release plan
bash scripts/test-user-journey.sh --path create --published <version> --compat-manifest /tmp/svforge-compat.json
```

Where it runs:

| Workflow | Invocation | Purpose |
|----------|-----------|---------|
| **Publish** (`publish.yml`) | manual `bash scripts/test-user-journey.sh`, then `--path create` (pre-publish, blocking) | the documented two-step install and the one-command golden path from the current artifacts |
| **Publish, post** (`publish.yml`) | `--published "$VERSION"`, then `--path create --published "$VERSION" --compat-manifest <plan>` | the exact artifact just shipped, at its exact per-package versions |
| **Canary** (`canary.yml`) | `SV_VERSION=latest bash scripts/test-user-journey.sh` from the `base` matrix entry | real install path against the floating ecosystem `sv` |
