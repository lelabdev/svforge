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

Run `node scripts/check-generated.mjs` to verify committed generated artifacts. The CI workflow is the authoritative list of required checks.

## Contribution process

- Search existing issues first; keep issues and pull requests focused.
- Branch from an up-to-date `main` using `<issue>-<short-kebab-case-title>`.
- Follow test-first development for behavior changes; use behavior-level tests.
- For a published behavior change, normally add a `.changeset/*.md` via `bun run changeset`, selecting the affected package(s) and `patch`, `minor`, or `major`, with a user-facing summary. Multi-package changes list each package. Example: an `@svforge/blog` release that must refresh the embedded compatibility manifest also includes `svforge: patch`.
- Docs-only, tests-only, and other changes without published impact do not need a Changeset. An omitted Changeset is a review follow-up, not an automatic contribution blocker; use `bun run changeset --empty` only when an explicit no-release marker is useful.
- Changesets control version selection and package changelogs. There is no required PR-title, branch-name, or commit-message format.
- Explain the change and validations in the pull request, and link its issue with `Closes #<number>`.
- Wait for CI; changes land through squash-merged pull requests.

## Templates and generated files

Edit source templates under `packages/*/templates/`, never generated `src/templates.ts` files. Template files must be under `templates/*/src/` or `templates/*/root/`; rebuild the package after edits and commit regenerated output. See the repository [`AGENTS.md`](AGENTS.md) and package-specific agent guidance for executable conventions.

Search for and reuse an existing documentation source before writing one. Add a document only for a necessary responsibility that must be maintained independently. Release and versioning steps are maintained only in [`docs/RELEASE.md`](docs/RELEASE.md).

## Svelte upstream first

Before adding or expanding a generic SvelteKit foundation, check the **published** official `sv add` addons for the supported `sv` version. Prefer `sv create`, official `sv add`, and `sv migrate` for their respective contracts; keep SVForge focused on its product overlays and its own upgrade recipes. Do not infer composability from matching filenames or upstream `main`.

For a proposed foundation, verify the real generated output in a disposable project: exact CLI/package version, options, config and dependency changes, both relevant application orders, package-manager scripts, and the tests/build that exercise the behavior. Delegate only the portion that meets the existing product contract. Record why any overlap stays local, especially for FR/EN i18n and server-side auth/admin policy. The [`upstream ownership and structural reuse matrix`](packages/svforge/docs/structural-duplication.md) records composition risks; the [`SvelteKit compatibility report`](packages/svforge/docs/sveltekit-compatibility.md) records tested versions, promotion policy and migration blockers. Keep #547 (Better Auth/Drizzle implementation) and #549 (npm publication) scoped to their existing issues.

## Release and security

Do not publish packages as part of an ordinary change. Changesets creates a human-reviewed Version Packages PR; follow [`docs/RELEASE.md`](docs/RELEASE.md) for versioning and publication. Report vulnerabilities privately according to [`SECURITY.md`](SECURITY.md).
