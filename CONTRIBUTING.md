# Contributing to SVForge

## Development

Use Bun from the repository root:

```bash
bun install
bun run build:all
bun run test
bun run lint
bun run typecheck
```

For generated-project changes, run the relevant scaffold profile, for example:

```bash
bash scripts/test-scaffold.sh base
bash scripts/test-scaffold.sh dashboard
```

Run `node scripts/check-generated.mjs` on a clean working tree to verify committed generated artifacts. The CI workflow is the authoritative list of required checks.

Use disposable scratch directories with an EXIT cleanup trap for manual tests and
scaffold experiments. Do not leave temporary clones, logs or generated projects
under `/tmp` after a run. Never delete another project's temporary files or
active test directories when cleaning up.

## Contribution process

- Search existing issues first; keep issues and pull requests focused.
- Branch from an up-to-date `main` using `<issue>-<short-kebab-case-title>`.
- Follow test-first development for behavior changes; use behavior-level tests.
- For a published behavior change, normally add a `.changeset/*.md` via `bun run changeset`, selecting the affected package(s) and `patch`, `minor`, or `major`, with a user-facing summary. Multi-package changes list each package. Example: an `@svforge/blog` release that must refresh the embedded compatibility manifest also includes `svforge: patch`.
- Docs-only, tests-only, and other changes without published impact do not need a Changeset. An omitted Changeset is a review follow-up, not an automatic contribution blocker; use `bun run changeset --empty` only when an explicit no-release marker is useful.
- Changesets control version selection and package changelogs. There is no required PR-title, branch-name, or commit-message format.
- Explain the change and validations in the pull request, and link its issue with `Closes #<number>`.
- Wait for CI; changes land through squash-merged pull requests.

## PR CI affected scope (#570)

Every PR computes a deterministic affected scope from the **merge-base** diff
and applies it conservatively:

| Change family | Build | Tests | Mandatory guards |
| --- | --- | --- | --- |
| Docs / committed `graphify-out/**` artifacts | skipped | skipped | lint, typecheck, audits, generated-manifest check |
| Tests only | all workspaces | only the changed test files | always run |
| Workspace change | **all by default** | **all by default** | always run |
| Workspace change + `ci:targeted` label | **all workspaces** | affected suites (ownership derived from test imports) | always run |
| Lockfile, root config, workflows, `scripts/`, `docker/`, release metadata (`.changeset/`, package `package.json`/`CHANGELOG.md`), unknown path, detector failure | all | all | always run |

- Run the report locally: `node scripts/affected-scope.mjs --base origin/main`
  (`--json` for machines, `--force-full` to force full scope).
- Test-scoped execution is opt-in with the **`ci:targeted`** label until the
  report has been confronted with real PRs. The build is **never** scoped in
  this phase: a measured targeted run (2026-10-24) failed repository guards that
  inspect every workspace `dist/` (structure/cli-create addon inventory,
  package-entry), so only test selection is enabled. The **`ci:full`** label
  (or a push / manual dispatch) forces the complete pipeline.
- Measure a PR (or explicit runs) with `node scripts/ci/measure-ci.mjs --pr
  <number> --markdown`; it reads the scope mode and job/step durations from
  GitHub Actions without re-running anything.
- A detector failure exits non-zero and reports FULL scope: it can never make a
  job green by narrowing the run. Skipped optional work is stated in the job
  summary; the required `quality` job still runs every mandatory guard.
- Release assurance is unchanged: `publish.yml` keeps the full pre-publication
  gates, the scaffold matrix, packed consumers and the golden paths; the
  release workflow is not scoped by this resolver.

## Templates and generated files

Edit source templates under `packages/*/templates/`, never generated `src/templates.ts` files. Template files must be under `templates/*/src/` or `templates/*/root/`; rebuild the package after edits and commit regenerated output. See the repository [`AGENTS.md`](AGENTS.md) and package-specific agent guidance for executable conventions.

Search for and reuse an existing documentation source before writing one. Add a document only for a necessary responsibility that must be maintained independently. Release and versioning steps are maintained only in [`docs/RELEASE.md`](docs/RELEASE.md).

## Svelte upstream first

Before adding or expanding a generic SvelteKit foundation, check the **published** official `sv add` addons for the supported `sv` version. Prefer `sv create`, official `sv add`, and `sv migrate` for their respective contracts; keep SVForge focused on its product overlays and its own upgrade recipes. Do not infer composability from matching filenames or upstream `main`.

For a proposed foundation, verify the real generated output in a disposable project: exact CLI/package version, options, config and dependency changes, both relevant application orders, package-manager scripts, and the tests/build that exercise the behavior. Delegate only the portion that meets the existing product contract. Record why any overlap stays local, especially for FR/EN i18n and server-side auth/admin policy. The [`upstream ownership and structural reuse matrix`](packages/svforge/docs/structural-duplication.md) records composition risks; the [`SvelteKit compatibility report`](packages/svforge/docs/sveltekit-compatibility.md) records tested versions, promotion policy and migration blockers. Keep the open #547 Better Auth/Drizzle foundation work scoped to that issue; the established npm release process is documented in `docs/RELEASE.md`.

## Release and security

Do not publish packages as part of an ordinary change. Changesets creates a human-reviewed Version Packages PR; follow [`docs/RELEASE.md`](docs/RELEASE.md) for versioning and publication. Report vulnerabilities privately according to [`SECURITY.md`](SECURITY.md).
