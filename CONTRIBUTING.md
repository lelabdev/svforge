# Contributing to SVForge

SVForge is a starting boilerplate, not a finished product or a component
library. Contributions must keep generated projects generic, composable, and
Skeleton-first.

## Development Setup

```bash
bun install
bun run build:all    # build all packages
bun run test         # run the full test suite
```

## Contribution Workflow

### Issues

- Search existing issues before opening a new one.
- Keep each issue focused on one outcome.
- Write the title in English, start with an action verb, and keep it descriptive
  within 50 characters, including spaces.
- Keep the description concise: state the problem, expected outcome, and
  acceptance criteria.
- Use labels for categories, areas, and priorities.

Example: `Enforce upload size limits`.

### Branches

Create branches from the issue title using this format:

```text
<number>-<title-slug>
```

Start from an up-to-date `main`, convert the title to lowercase kebab-case, and
remove punctuation. For example, issue `#338` becomes
`338-enforce-upload-size-limits`.

### Pull requests

- Keep one issue per pull request and avoid unrelated refactors.
- Reuse the issue title when it accurately describes the pull request.
- Explain what changed and list the commands used for validation.
- Link the issue with `Closes #<number>`.
- Wait for CI to pass. Pull requests are squash-merged into `main`.

## Project Principles

- Keep the base template minimal and useful for many kinds of applications.
- Put optional or product-specific capabilities in composable modules.
- Use Skeleton as the UI foundation instead of adding another component or
  token system.
- Prefer standard SvelteKit, Svelte, PostgreSQL, Drizzle, and Better Auth
  patterns over SVForge-specific abstractions.
- Keep generated source understandable and owned by the consumer project;
  upgrades must not silently overwrite local changes.
- Keep translatable UI copy in JSON message catalogs. Bundled locales are
  replaceable defaults, not product requirements.

## TDD Workflow — Red → Green → Refactor

Every bug fix and feature must follow strict TDD:

### 1. Red — Write a failing test first

Write one focused behavior-level test that describes the intended behavior.
Run it and confirm it fails for the **right reason** (missing behavior, not a
syntax error or missing import).

```bash
bun run test -- tests/your-issue.test.ts
```

### 2. Green — Implement the smallest change

Make the test pass with the minimal production code change. Do not add extra
features or refactors at this stage.

### 3. Refactor — Clean up while tests stay green

Improve code quality, naming, and structure. Run the test after each change
to ensure it stays green.

## Test Categories

| Category | What it proves | Location |
|----------|---------------|----------|
| **Build** | Package builds produce `dist/index.js` | `tests/build.test.ts` |
| **Security** | Auth guards, input validation, XSS prevention | `tests/*-security.test.ts`, `tests/admin-auth.test.ts` |
| **Scaffold** | Addons install at documented paths | `tests/scaffold-paths.test.ts` |
| **Behavior** | Template logic works as intended | `tests/blog-mdsvex.test.ts`, `tests/admin-delete.test.ts` |
| **Quality** | A11y, reactivity, declaration publishing | `tests/a11y-reactivity.test.ts`, `tests/oauth-declarations.test.ts` |

## Tailwind/Skeleton utility lint (#482)

`bun run lint` also lints Svelte source from the base, dashboard and addon
templates with `tailwindcss/no-custom-classname`. The rule compiles the actual Tailwind v4 CSS
entrypoint (`src/routes/layout.css`), including Skeleton and the SvelteForge
theme, so generated utilities and variants are checked by the design system
rather than by a copied color-pair inventory. Scaffolded projects receive the
same rule in their generated ESLint configuration.

This check covers statically readable class strings (including supported
variants and literal class fragments); opaque values assembled at runtime
cannot be reliably validated and are intentionally outside the guarantee. Keep
class candidates as complete literals where practical instead of building
utility names from fragments. The local `logo` CSS hook is explicitly allowed;
new intentional non-utility CSS class hooks should be narrowly documented in
the Tailwind ESLint whitelist.

## Test Helpers

Shared utilities are in `tests/helpers.ts`:

- `packageDir(pkg)` / `packageFile(pkg, ...segments)` — resolve package paths
- `dashboardTemplateFile(...)` / `baseTemplateFile(...)` — resolve template paths
- `tempProject(prefix)` — create isolated temp directories for scaffold tests
- `expectFile(path)` / `expectNoFile(path)` — assertion helpers

## Working With Templates

- Edit files under `packages/*/templates/`, never generated
  `packages/*/src/templates.ts` files directly.
- Scaffolded source belongs under the template's `src/` directory. Root-level
  dashboard files belong under `packages/svforge/templates/dashboard/root/`.
- Run `bun run --filter <package> build` after changing a template and commit
  the regenerated `src/templates.ts` with the source change.
- Run the relevant `scripts/test-scaffold.sh` profile when generated behavior
  changes.

## What to Avoid

- **Do not** write tests that only check committed `dist/` files (dist is gitignored)
- **Do not** use array index as `{#each}` key — use stable identities
- **Do not** assign to `$state` from `$effect` — use `$derived` instead

## Running Tests

```bash
bun run test                    # full suite (sequential, no file parallelism)
bun run test -- tests/foo.test.ts  # single file
bun run test:watch              # watch mode (parallel OK for development)
```

Tests run sequentially (`--no-file-parallelism`) because build tests regenerate
`dist/` artifacts that other tests check. Watch mode uses parallelism for speed.

The packaged user journey is a separate release smoke test (#462, hardened in
#465): from a clean temporary directory it acquires `sv` from the registry
(never the repository's `node_modules`), packs the add-on, and runs the
`scripts/test-scaffold.sh`-style checks from the extracted tarball. It is a
release blocker and a canary check, not a pull-request check (#413):

```bash
bun run test:user-journey                   # base + dashboard from local tarballs
bun run test:user-journey --template base   # base only (no PostgreSQL needed)
bash scripts/test-user-journey.sh --published <version>  # exact published npm version
bash scripts/test-user-journey.sh --sv latest            # acquire the latest `sv`
```

## Building

```bash
bun run build         # build svforge only
bun run build:all     # build all packages
```

Each package runs `prebuild` (regenerates `src/templates.ts` from template dirs)
then `tsdown` (compiles to `dist/`).
