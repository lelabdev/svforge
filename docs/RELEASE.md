# npm release process

Publishing is driven by `.github/workflows/publish.yml`. Releases use npm token
authentication through `secrets.NPM_TOKEN`; OIDC provenance is not enabled. The
workflow has read-only repository permissions because npm publication does not
need GitHub write access.

## Independent versioning

Every workspace owns its version in `packages/*/package.json`. There is no
monorepo-wide version bump: a package is released only when its own manifest
version is not already present in the registry.

The release planner enforces this policy and rejects invalid SemVer, a local
version that is older than the latest published version, or a package without a
matching current entry in `CHANGELOG.md`. SemVer comparison follows the core
and prerelease precedence rules and accepts build metadata.
Its machine-readable output follows [`release-plan.schema.json`](./release-plan.schema.json)
and contains:

- the schema version and `independent` versioning policy;
- the exact commit being released;
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

## Workflow gates

Before the first publication, the workflow:

1. installs the pinned Bun and Node versions;
2. builds all 15 packages and runs the repository tests;
3. runs the base, dashboard, foundation and integration scaffold gates;
4. verifies npm authentication with `npm whoami`;
5. generates and prints the complete commit/version/registry plan;
6. verifies read-only npm package access for every already-published package;
   not-yet-created packages are allowed through this gate because
   `npm access list packages` cannot report a package before its first publish;
7. runs `npm pack --dry-run --json --ignore-scripts` for every package and
   verifies exports, JavaScript, declarations, README, LICENSE and packaged
   paths;
8. packs the current build and completes the **published user journey**
   (base + dashboard: `sv create` → `sv add` from the tarball → `svforge
   doctor`/`check` → setup → server → minimal flow) from a clean temporary
   directory, without importing the monorepo (#462);
9. publishes the plan in dependency order;
10. installs every exact published version in a clean consumer, imports every
    package from a generated TypeScript consumer, and runs `tsc --noEmit` to
    validate package export and declaration resolution;
11. reruns the user journey against the real npm package (`--published`).

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

`scripts/test-user-journey.sh` reproduces the external path from an
installable package (#462):

```bash
bun run test:user-journey              # pack the current build, run from tarballs
bash scripts/test-user-journey.sh --published [version]  # run the real npm package
bun run test:user-journey --template base  # one journey only (no PostgreSQL needed)
```

Local mode runs `npm pack`, extracts the tarball into a temporary directory and
uses `sv add file:<extracted>` — never `file:<repo>/packages/...` and never
`--dev-root`. A file missing from the npm artifact, a broken documented install,
or a project that cannot build/start therefore fails the gate instead of being
masked by the monorepo checkout. The dashboard journey needs a reachable
PostgreSQL (`TEST_DATABASE_URL`, same contract as the scaffold suite); run
`--template base` locally without one. The work is done in a temporary
directory that is removed at the end of the run (`--keep` to inspect it).
