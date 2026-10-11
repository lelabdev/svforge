# Release process

Changesets owns package version selection and package changelog generation.
After Changesets are merged to `main`,
`.github/workflows/version-packages.yml` creates or updates a **human-reviewed
Version Packages PR**. It never publishes packages. The PR includes independent
package versions, generated changelog entries, the refreshed compatibility
manifest, regenerated upgrade notes, and `.changeset/release-candidates.json`.
That reviewed manifest records the version-bumped packages plus first-time
package versions absent from npm, and remains stable across retries. GitHub
Actions must be allowed to create pull requests in the repository's Actions
settings; this change does not alter repository-wide permissions.

Stable npm publication is handled by `.github/workflows/publish.yml` after
a maintainer merges the bot-created `Version Packages` PR from
`changeset-release/main` into `main`, or via an explicitly dispatched recovery
that independently verifies this exact already-merged PR before running any jobs. The release job reruns the blocking
quality, scaffold, and packed-artifact user-journey gates, then invokes the
Changesets CLI directly using npm Trusted Publishing (OIDC) with no persistent
npm token. GitHub Release creation remains separately gated. Only after the exact-version consumer,
published user journey, and compatibility-manifest golden path all pass does a
separate finalizer verify the exact npm versions, push `package@version` tags,
and create GitHub Releases from the package changelogs. It uses
`secrets.NPM_TOKEN`; OIDC provenance is not enabled. Ordinary merges never
publish stable packages.

The former `.github/workflows/canary.yml` was a weekly upstream drift detector,
not an npm snapshot publisher; it is now `.github/workflows/ecosystem-drift.yml`
with its schedule and marker-based issue deduplication preserved. npm snapshots
use the separate `.github/workflows/canary-snapshots.yml` workflow. Successful snapshots are exposed under both the `dev` and `canary` npm dist-tags. It is
**dispatch-only** (no push, pull-request, or schedule trigger), requires the
explicit `publish-canary` confirmation, and runs against `main` in the
`npm-canary` GitHub Environment. Before the first dispatch, maintainers must
configure that environment with required reviewers. Merging the workflow or an
implementation PR cannot publish anything. Dispatch it only while the target
Changesets are present on `main` (before the stable Version Packages PR consumes
them); with no pending Changesets, preparation fails closed without publishing.

The workflow archives the selected commit into a disposable directory and runs
Changesets snapshot mode there. Snapshot versions use a deterministic
`0.0.0-canary-<12-char-sha>-<run-id>` prerelease, so retrying the same Actions
run targets the same immutable npm versions; a new dispatch gets a new run ID.
When addon snapshots are selected, a temporary Changeset also snapshots
`svforge`, whose embedded compatibility manifest points at the exact new addon
snapshot versions while unchanged addons retain their exact stable versions.
Publication fails closed if any unchanged compatibility version is not already
present on npm (including first-time stable package releases still awaiting the
Version Packages approval).

The workflow configures npm authentication with the pinned `actions/setup-node`
registry setup and verifies the protected `NPM_TOKEN` using `npm whoami` before
snapshot preparation or any npm registry write. The temporary user `.npmrc` is
created by the action; no token is committed to the repository or copied into
the archived workspace.

The workflow runs lint, typecheck, audit, builds, and the full repository test
suite against stable package versions before applying snapshot versions; release
changelog tests intentionally require the stable versions. After snapshot
versioning, it revalidates the exact compatibility manifest, rebuilds every
snapshot package, runs the packed dashboard golden path with all modules (using
the workflow's disposable PostgreSQL service), packs each candidate, and runs a
clean consumer install/typecheck using those exact tarballs plus exact stable
registry versions. Only after those gates does Changesets publish the immutable
versions under a unique `canary-run-<run-id>` staging tag (never `latest` or
`canary`). The workflow repeats the consumer and golden-path checks against the
published exact versions, and only then promotes candidate packages to the
public `canary` and `dev` dist-tags. Promotion restores previous `canary` pointers if a
multi-package update fails; the per-run staging tags are removed on completion.
The workflow serializes with stable publication, creates no Git tags/releases,
and never changes npm `latest`.

To disable canaries, remove or disable the workflow and remove the `npm-canary`
Environment secret/reviewer access. If validation fails before promotion, the
existing `canary` and `latest` tags remain untouched; the staging tag is cleaned
up by the workflow. If manual recovery is needed, inspect `npm view <package>
dist-tags --json`, restore the previous `canary` **and** `dev` pointers with
`npm dist-tag add <package>@<previous-version> <tag>` (or remove a newly-created
pointer with `npm dist-tag rm <package> <tag>`), and remove any leftover
`canary-run-<run-id>` tag. Stable releases continue to be governed exclusively
by the reviewed Version Packages flow.

## Release policy: grouped stable releases, optional numbered canaries (#572)

**Issues and pull requests are units of work, not releases.** Multiple reviewed
PRs and their Changesets accumulate on `main`; `Version Packages` is a
reviewable staging PR, and only an explicit maintainer merge starts a stable
publication. Documentation-only changes that do not alter an npm package do not
need a Changeset or release. A package change uses the appropriate
`patch`, `minor`, or `major` Changeset. Changesets independently calculates
the version for each affected package, updating dependent modules and the
`svforge` compatibility manifest as needed.

The `canary` channel is **optional**, intended to test genuine published npm
artifacts, installability, exports and generated consumer apps ahead of a stable
release. It is not a mandatory gate and not an npm publish per issue or PR.
The intended canary naming scheme is `<prospective-version>-canary.<N>`, e.g.
`2.2.1-canary.1`, `2.2.1-canary.2`, independently per public package.
Canary numbers reflect a *prospective* version, not a commitment to release
that exact stable version: a group of changes originally expected to be
`2.2.1` may legitimately become `2.3.0` or `3.0.0`. Each published
version is immutable. A stable version must be published independently from
its prerelease and only the explicit stable publication may advance `latest`.

Canary publication must be isolated from working-tree manifests and package
changelogs, use an exact revision, and never move `latest`. Verify built
tarballs from an external npm consumer and the generated SvelteKit app before
promoting the `canary` dist-tag. Ensure retry safety, version uniqueness,
rollback of partial dist-tag updates and dependency/compatibility coherence
across the 15 independently versioned packages.

**Authentication:** both stable and canary publication should use npm Trusted
Publishing (OIDC), not expiring npm tokens; the workflow GitHub identity must
match the configured trusted publisher for each package. A workflow that moves
the `canary` dist-tag requires npm's additional dist-tag permission. The
current legacy canary workflow is not yet migrated by this policy document.

**Do not merge or dispatch a release solely because a documentation or CI
policy change landed.** Preserve the outstanding 2.2.0 recovery against
already-merged Version Packages PR #562.

## Stable and development npm channels

- **Stable** is `latest` (`npm install svforge@latest` or simply `npm install svforge`). Only a human-approved **Version Packages** merge can trigger the gated stable workflow.
- **Development** is `dev` (`npm install svforge@dev`). The existing manual, protected [Canary Snapshots](../.github/workflows/canary-snapshots.yml) action publishes immutable `0.0.0-canary-<sha>-<run>` versions, validates their exact npm artifacts, and points both `dev` and the backward-compatible `canary` aliases at the successful snapshots. Neither alias affects `latest`. The aliases are promoted and restored together if any write fails.
- A `dev` package set is only available **after** an operator explicitly runs the workflow with `publish-canary` and approves the protected `npm-canary` environment. It is not continuously published on each commit. Addon-only changes yield addon and distribution snapshots as needed for the exact compatibility manifest. The ordinary stable release continues to use Changesets independently.

## One-time 2.2.0 package baseline

The first release after adopting Changesets intentionally publishes all **15** public workspaces at **`2.2.0`**, aligning the initial distribution and addon package numbers. This is a **single release baseline, not ongoing lockstep versioning**.

For that release only, `scripts/version-packages.mjs` temporarily provides Changesets with a fixed group while calculating versions and package changelogs, then restores `.changeset/config.json` before preparing the reviewed Version Packages PR. It refuses any unexpected starting state or a result in which packages do not all reach `2.2.0`. The PR must show all 15 candidates, matching package changelogs and the exact compatibility manifest before human approval. **Do not merge an older Version Packages PR containing mixed `2.0.x` / `2.2.0` versions.** Once this implementation PR is merged, the bot must regenerate #562.

After the `2.2.0` release, `fixed: []` and `linked: []` stay in source: a changed addon gets its own patch/minor/major version, while `svforge` receives a separate small bump when its embedded manifest must be refreshed. Unchanged addons are not republished. This baseline exception is not a reason to set permanent fixed-version groups.

## Independent versioning

Every workspace owns its version in `packages/*/package.json`. Changesets uses
independent mode (no `fixed` or `linked` groups): a package is versioned only
when selected by its Changeset or by an internal dependency rule. Adoption
leaves existing manifest versions untouched. Version preparation adds any
unchanged package version absent from npm to the candidate manifest so it is
visible in the human-reviewed Version Packages PR. The stable workflow fails
closed if that manifest omits a version `changeset publish` would publish. Do
not reset package versions to the registry during migration. The release plan
validates registry state, artifact contents, and compatibility-manifest
freshness without becoming a second version selector.

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
matching current entry in its `packages/*/CHANGELOG.md`. Its preflight also
rejects a release where an addon changes without bumping `svforge`, because the
published CLI would otherwise embed an outdated compatibility manifest.
Its machine-readable output follows [`release-plan.schema.json`](./release-plan.schema.json)
and contains:

- the schema version and `independent` versioning policy;
- the exact commit being released;
- the compatibility manifest (distribution version + every module version);
- every package name, version, manifest path and workspace directory;
- local package dependencies and their publication order;
- registry versions and whether the exact local version is already published;
- the changelog path and number of validated package release entries.

Each public workspace has a `CHANGELOG.md` maintained by Changesets and
`@changesets/changelog-github`, which associates release notes with their PRs.
The root `CHANGELOG.md` is retained as a historical archive; its entries are
not version inputs. Package changelogs feed `svforge upgrade` and the release
plan validator. Check them locally with:

```bash
bun run changelog:check
```

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

The `svforge` package embeds the per-package changelog entries during its
prebuild. `svforge upgrade` prints notes between the installed recipe version
and the target recipe version. Use `--to <version>` to select an explicit
target available in the installed addon.

## Pipeline levels (#413)

Validation cost sits where it belongs:

| Trigger | Runs |
|---------|------|
| **Push to `main`** (`version-packages.yml`) | Changesets creates or updates the human-reviewed **Version Packages** PR. No npm publication or GitHub Release. |
| **Pull request** (`ci.yml`) | install, lint, typecheck, OSV audit, Better Auth stack audit, generated-manifest freshness, build, Vitest. **No PostgreSQL, no scaffold, no user journey.** A new push cancels the previous run. |
| **Push to `main`** (`ci.yml`) | the same fast checks + **one** representative scaffold (`test-scaffold.sh base`). |
| **Merged Version Packages PR** (`publish.yml`) | quality + the 9-profile scaffold matrix + external and published user journeys + the one-command golden path; GitHub Releases are finalized only after all blocking checks pass. |
| **Weekly** (`ecosystem-drift.yml`) | the scaffolds (and the external journey) against the `latest` ecosystem, opening or updating a deduplicated drift issue on failure. No npm publication. |
| **Manual npm canary** (`canary-snapshots.yml`) | required `publish-canary` confirmation + protected `npm-canary` environment; isolated snapshot artifacts, pre/post-publish exact-version consumers, and compatibility golden path before `canary` dist-tag promotion. No PR, push, schedule, or `latest` publication. |

### Measured CI timing snapshot (2026-10-10)

These are successful, sequential main-branch runs around the final CI audit—not a
controlled benchmark. No CI workflow topology, cache, or artifact changes were
made between them, so the differences must not be claimed as an optimization.

| Run / commit | `quality` job | `Run tests` step | `main-smoke` job |
|--------------|---------------|-----------------|-----------------|
| [#534 / `8a9a4bd`](https://github.com/lelabdev/svforge/actions/runs/38008231900) | 2m13s | 1m29s | 1m09s |
| [#535 / `855df3a`](https://github.com/lelabdev/svforge/actions/runs/38011140207) | 1m44s | 1m08s | 0m51s |

The Vitest step is the largest measured quality step. The observed variation is
not enough evidence for shared build artifacts, cache complexity, or weaker
isolation; the simple blocking pipeline is retained. No current post-change
`publish.yml` run is available, and a release workflow must not be triggered
just to manufacture a benchmark.

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
4. validates npm CLI 11.5.1+ and the GitHub OIDC publishing environment (no `npm whoami`);
5. generates and prints the complete commit/version/registry plan, then checks
   that its publishable versions match the candidate manifest committed in the
   human-reviewed Version Packages PR. This fails closed if `changeset publish`
   would include an unselected unpublished package;
6. uses the public registry release plan to check existing package versions; npm
   validates the trusted publisher's per-package write permissions during the actual
   publish (OIDC does not authorize `npm access list packages` or `npm whoami`);
7. runs `npm pack --dry-run --json --ignore-scripts` for every package and
   verifies exports, JavaScript, declarations, README, LICENSE and packaged
   paths;
8. acquires `sv` from the registry into a scratch prefix and completes the
   **external user journey** (base + dashboard: `sv create` → `sv add` from
   the tarball → `svforge doctor`/`check` → setup → server → minimal flow)
   from a clean temporary directory, without touching the monorepo's
   `node_modules` (#462, #465);
9. completes the **golden path** (`--path create`): npm-installs the local
   `svforge` CLI from its packed tarball in a scratch prefix, then invokes that
   installed CLI with real registry `sv`, no TTY, and no `--hooks` flag. The
   CLI must still pass `hooks:none` to the grouped `sv add`; both base and
   dashboard runs are blocking. Add-ons resolve from packed artifacts
   (`--addon-root`, never `--dev-root` or the checkout), then the journey
   verifies the manifest, runs `svforge verify`, mounts real PostgreSQL, boots
   the app and replays the setup/login/admin flow (#437, #470);
10. publishes only the versions selected by Changesets through the official
action, with automatic GitHub Release creation disabled and npm lifecycle
scripts disabled because every package was already built and tarball-preflighted;
11. installs every exact published version in a clean consumer, imports every
    package from a generated TypeScript consumer, and runs `tsc --noEmit` to
    validate package export and declaration resolution;
12. reruns the user journey against the EXACT published `svforge` version from
    the release plan (`--published "$VERSION"`), and reruns the golden path
    against the exact per-package versions from the release plan's
    compatibility manifest (`--path create --published "$VERSION"
    --compat-manifest <plan>`);
13. only after all post-publication checks pass, verifies every changed package
    version exists on npm, then pushes its package tag and creates its GitHub
    Release from the matching package changelog. The finalizer is idempotent.

The stable publisher uses a repository-global, non-cancelling concurrency
group. It triggers only for a merged, bot-authored `Version Packages` PR on
`main`, or an explicit recovery dispatch that independently verifies the PR's
identity and immutable merge commit, so ordinary merges and open PRs cannot publish. The Changesets action does not push tags or create GitHub Releases;
the post-validation finalizer does so only for the changed, registry-verified
versions. Third-party actions are pinned to commit SHAs.

## Resuming a failed release

After an authentication/workflow fix, **do not rerun the previous GitHub Actions
attempt**: that run uses its original workflow commit and would repeat the old
`npm whoami` failure. Run `Publish` on `main` with **Run workflow**, entering
`release_pr: 562` for the pending 2.2.0 baseline. The authorization job checks
that PR #562 was merged from the expected Changesets branch by the release bot,
that its merge commit belongs to `main`, and that it contains a reviewed release
candidate manifest. The entire quality/scaffold/user-journey battery runs again
against the **original release merge commit**, never the moving branch tip. Only
after all gates pass may npm receive published artifacts. This is also valid
for later approved release PRs, using their own numbers.

Changesets checks the registry before publishing. A partial publish failure
stops the job before post-publication checks, tags, or GitHub Releases. On a
rerun, Changesets skips exact versions already published and publishes the
remaining versions. If consumer or golden-path validation fails, no release
announcement is made. A later rerun validates the exact artifacts again before
the finalizer resumes; existing tags/releases are verified and never duplicated.
The release plan is regenerated from the same merged PR commit, while the
reviewed candidate manifest preserves the original publish set across retries.
This lets finalization announce packages published by an earlier partial
attempt without publishing or announcing any unselected version.

An unchanged version produces no publication or release announcement.

## Authentication and permissions

Stable npm publishing uses **Trusted Publishing (OIDC)**: no `NPM_TOKEN`, no
long-lived npm credentials, and no token rotation. A GitHub-hosted publish job
is granted `id-token: write` and uses Node 24 / npm 11.5.1+; Changesets CLI
invokes npm, which exchanges the workflow identity for a short-lived npm token.
`npm whoami` and `npm access list packages` cannot check OIDC publishing
rights and must not be reintroduced as release gates.

**One-time npm package configuration (requires the npm package owner's login
and 2FA):** for each of the 15 packages, set its Trusted Publisher to:
- Provider: GitHub Actions
- Owner: `lelabdev`
- Repository: `svforge`
- Workflow filename: `publish.yml`
- Environment: none
- Allowed action: **Allow npm publish** (not just staging)

This can be configured from each package's npmjs.com Settings → Trusted
Publishing. Alternatively, after logging into npm locally with npm CLI
11.15.0+, the package owner can configure the entire workspace once:

```bash
for manifest in packages/*/package.json; do
  pkg=$(node -p "require('./$manifest').name")
  npm trust github "$pkg" --repo lelabdev/svforge --file publish.yml --allow-publish --yes
  sleep 2
done
```

An already configured trusted publisher may require inspection before adding
another; do not revoke an existing trust relationship without understanding it.
The account owner must authorize this first trust setup, but **future CI
publications have no npm credentials to manage**. npm verifies authorization
per package on `npm publish`. Do not print, commit, or paste npm credentials.
The separate `canary-snapshots.yml` still uses a token pending its own OIDC
migration; stable publishing no longer depends on it.

Do not trigger production publication without explicit maintainer authorization.

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
`sv create` → `sv add`. In local mode, the test npm-installs `svforge` from the
exact tarball produced by `npm pack` and invokes its installed bin, alongside a
real externally installed `sv` CLI. The CI runner has no TTY, and the default
path deliberately omits `--hooks`; `svforge create` must resolve that omission
to `hooks:none` for the addon. Explicit hook choices (including
`--hooks lefthook`) remain supported. The journey asserts the generated
`.svforge.json` records the requested template, every requested module (the
`--modules all` set is derived from the canonical registry, not a duplicated
list) and the attested runtime, then runs `svforge verify`, sets up the
PostgreSQL schema, boots the app and replays the dashboard setup/login/admin
flow.

- **Pre-publish** sources the add-ons from the packed artifacts via
  `--addon-root`. That mode **fails closed**: a requested artifact missing from
  the addon-root is an error, never a silent npm fallback, so the gate can only
  validate the CURRENT packaged artifacts.
- **Post-publish** pins the exact per-package versions from the release plan's
  compatibility manifest via `--compat-manifest <plan>`, so a module whose
  version differs from `svforge` is still tested at its own version.

```bash
# pre-publish (blocking), packed CLI + add-ons; CI is non-TTY
bash scripts/test-user-journey.sh --path create
# reproduce the no-TTY default locally (base; dashboard needs TEST_DATABASE_URL)
bash scripts/test-user-journey.sh --path create --template base </dev/null
# explicit hook override remains available
bash scripts/test-user-journey.sh --path create --template base --hooks lefthook </dev/null
# post-publish, exact per-package versions from the release plan
bash scripts/test-user-journey.sh --path create --published <version> --compat-manifest /tmp/svforge-compat.json
```

Where it runs:

| Workflow | Invocation | Purpose |
|----------|-----------|---------|
| **Stable release** (`publish.yml`) | after the merged Version Packages PR: `bash scripts/test-user-journey.sh --hooks lefthook`, then `--path create` (pre-publish, blocking, non-TTY) | the documented two-step install and the one-command golden path from current packed CLI/add-ons; default hooks omission and explicit Lefthook are covered |
| **Publish, post** (`publish.yml`) | `--published "$VERSION"`, then `--path create --published "$VERSION" --compat-manifest <plan>` | the exact artifact just shipped, at its exact per-package versions |
| **Ecosystem drift** (`ecosystem-drift.yml`) | `SV_VERSION=latest bash scripts/test-user-journey.sh` from the `base` matrix entry | real install path against floating ecosystem `sv`; failures update the drift issue, not npm |
