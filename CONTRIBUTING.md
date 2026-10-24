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

## PR CI affected-scope report (#570)

PR CI runs the full quality pipeline today, and additionally reports which
workspaces and test suites the PR actually affects:

```bash
node scripts/affected-scope.mjs --base origin/main
node scripts/affected-scope.mjs --base origin/main --json     # machine-readable
```

- The report is computed from the PR **merge-base** diff (not `HEAD^`), maps
  changed paths to workspaces, follows transitive reverse dependents and the
  add-on → `svforge` recipe edge, and derives test ownership from the imports
  each test file makes.
- Cross-cutting paths (`bun.lock`, root configuration, workflows, `scripts/`),
  release metadata (`.changeset/`, package `package.json`/`CHANGELOG.md`) and
  unknown paths select **full scope**; documentation-only changes select no
  build/test.
- Phase A is report-only: every check still runs. `--force-full` reports a full
  scope explicitly. A resolver/detector failure exits non-zero and reports full
  scope instead of silently narrowing it.
- Release assurance is unchanged: `publish.yml` keeps the full pre-publication
  and post-publication gates, the scaffold matrix and the golden paths.

## Templates and generated files

Edit source templates under `packages/*/templates/`, never generated `src/templates.ts` files. Template files must be under `templates/*/src/` or `templates/*/root/`; rebuild the package after edits and commit regenerated output. See the repository [`AGENTS.md`](AGENTS.md) and package-specific agent guidance for executable conventions.

Search for and reuse an existing documentation source before writing one. Add a document only for a necessary responsibility that must be maintained independently. Release and versioning steps are maintained only in [`docs/RELEASE.md`](docs/RELEASE.md).

## Svelte upstream first

Before adding or expanding a generic SvelteKit foundation, check the **published** official `sv add` addons for the supported `sv` version. Prefer `sv create`, official `sv add`, and `sv migrate` for their respective contracts; keep SVForge focused on its product overlays and its own upgrade recipes. Do not infer composability from matching filenames or upstream `main`.

For a proposed foundation, verify the real generated output in a disposable project: exact CLI/package version, options, config and dependency changes, both relevant application orders, package-manager scripts, and the tests/build that exercise the behavior. Delegate only the portion that meets the existing product contract. Record why any overlap stays local, especially for FR/EN i18n and server-side auth/admin policy. The [`upstream ownership and structural reuse matrix`](packages/svforge/docs/structural-duplication.md) records composition risks; the [`SvelteKit compatibility report`](packages/svforge/docs/sveltekit-compatibility.md) records tested versions, promotion policy and migration blockers. Keep the open #547 Better Auth/Drizzle foundation work scoped to that issue; the established npm release process is documented in `docs/RELEASE.md`.

## Release and security

Do not publish packages as part of an ordinary change. Changesets creates a human-reviewed Version Packages PR; follow [`docs/RELEASE.md`](docs/RELEASE.md) for versioning and publication. Report vulnerabilities privately according to [`SECURITY.md`](SECURITY.md).
