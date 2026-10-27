# Scoping CI builds with a complete dist-dependency model (#656)

This page records the dependency model that allows the opt-in `ci:targeted` run to build a **reduced but safe** workspace set, and the scenarios that must always fall back to a full build. It is the continuation of #570 (report, conservative activation, measured correction) and the answer to its unfinished acceptance criterion: *an isolated addon change rebuilds only the necessary workspaces*.

The default policy is unchanged: **a workspace change runs full validation** unless the PR carries the `ci:targeted` label. `ci:full` forces full scope. Tests are never skipped to make a scope fit — the build is escalated instead.

## Why a model is required

Several repository tests do not consume sources only; they inspect the **built output** of workspaces:

- `tests/structure.test.ts` — every workspace has `dist/index.js`;
- `tests/cli-create.test.ts` — add-on option registries loaded from `dist`, and the generated plan;
- `tests/package-entry.test.ts` — the built entries of `svforge` and `@svforge/addon-kit` (and it *returns early* when a `dist` file is missing);
- `tests/modules.test.ts`, `tests/build.test.ts` — each add-on builds and emits `dist/index.js`;
- packaging/release/journey consumers (`addon-packaging`, `npm-consumer-smoke`, `release-plan`, `user-journey`, `real-bin`, `canary-*`) — `npm pack`, the CLI binary and published payloads.

A scoped build that omits one of those workspaces turns such a test into a **silent pass**. The previous phase-C probe failed exactly this way (`structure.test.ts` / `cli-create.test.ts` inspecting dist files of unbuilt addons), which is why builds stayed unscoped.

## Inventory (current tree)

`distInventory()` walks `tests/**/*.test.ts`, follows their **local imports**
(helpers, fixtures, re-exports) and classifies each consumer:

| Requirement | Count | Meaning |
| --- | --- | --- |
| Unbounded (`kind: all`) | 76 | Dynamic enumeration, `npm pack`, CLI binary, guarded dist assertions, **non-literal dynamic imports**, **subprocess invocations**, or a dist reference that names no workspace → **full build** |
| Bounded (`kind: selected`) | 3 | A literal `packages/<dir>/dist/...` path or a package-name import reachable from the test (directly or through a helper) that maps to specific workspaces |
| No dist consumer | rest | Source-only imports and repository scripts do not constrain the build |

79 test files consume built artifacts today. The inventory is computed, not hand-maintained: `tests/affected-scope.test.ts` asserts that `structure`, `cli-create`, `package-entry`, `modules` and `build` stay **unbounded** (regression fixtures), so a narrowing change fails there first.

The analysis is deliberately conservative: fixture source embedded in a template
literal can look like an import (for example `tests/helpers/official-foundation.ts`
contains generated-file text), and such an unresolved import escalates to a full
build. A false positive costs build time; a false negative would skip a test's
artifact.

## Local imports are part of the requirement (#656 B-01)

A test that looks dist-free can import a helper that reads built output, so the
analysis walks **relative imports transitively**:

- `import`/`export … from`, side-effect `import '…'`, literal `import('…')` and
  `require('…')` are followed when they are relative;
- files under `tests/` and `scripts/` are walked recursively (cycle-safe); a file
  reached outside them (a workspace source imported by a test) is inspected once
  but not followed — its internals are implementation of a source import;
- **fail closed** for: an unresolvable relative import, an unreadable file, a
  non-literal dynamic import (`import(variable)`, template literals) or
  `require(variable)`, a subprocess invoking a package manager/CLI, a guarded
  `existsSync(dist) → return`, or a dist reference with no identifiable
  workspace. A relative `.json` import is resolved as data (no build impact).

Fixtures in `tests/affected-scope.test.ts` cover a dist read in a helper, a helper
chain with re-exports, a guarded assertion, dynamic imports, subprocesses,
unresolvable helpers, and a bounded source-only chain that stays scoped.

## Rules

1. **Unbounded runtime loading is detected first, without any `dist` hint** (#656 B-02): a non-literal `import(expression)` / `require(expression)` (including template literals) and a subprocess invoking a package manager or the CLI are unbounded *before* the "does this file mention dist?" shortcut — a test can load a compiled package at runtime without naming one.
2. **Mentions of `dist` are detected broadly** (`distPath`, `dist/`, `dist/index.js`…). A missed mention would narrow the build, so detection error falls on the conservative side.
3. **Unbounded signals force a full build**: `readdirSync`, `packages/${…}`, template-literal dynamic imports, `--filter '*'`, `npm|bun|pnpm pack`, `bin/svforge.mjs`, a `'packages'`/`PACKAGES` reference, or a `dist` reference with no identifiable workspace.
4. **A guarded assertion is uncertainty, not a skip**: `if (!existsSync(distPath)) return;` proves nothing when the workspace was not built → full build.
5. **Bounded consumers must be covered by the scoped order**; a requirement outside the order escalates to a full build.
6. **Escalation never skips work**: the plan only ever moves from `selected` to `all` builds; the test selection is untouched.
7. Resolution stays pure and testable: `distRequirementsForSource()`, `distRequirementsForFile()`, `distInventory()` and `planBuildSet()` are exported from `scripts/affected-scope.mjs`; `scripts/ci/affected-step.mjs` only translates the plan into CI outputs.

## Scope-aware inventory guards (#656)

The formerly global guards no longer demand every workspace's `dist`; they
verify the run's **declared build set**:

- `tests/helpers/build-scope.ts` reads `SVFORGE_BUILD_WORKSPACES` (exported by
  the CI build step for a scoped build; absent or `all` → every workspace, which
  is also the local/full behaviour). It throws on an unknown or empty set, so a
  typo fails loudly instead of shrinking the guard.
- `structure`, `modules`, `build` and `cli-create` verify each built workspace
  (add-on entry, `dist/index.js`, option registry) and keep their source-level
  contracts for every package. `cli-create` still asserts that EVERY module
  declares its add-on options; only the dist comparison is scoped.
- The resolver recognises these files (`helpers/build-scope`) as *scope-aware*
  and stops treating them as unbounded; guards that genuinely need all artifacts
  or spawn packaging/CLI processes (`addon-packaging`, `user-journey`, `real-bin`,
  `changesets`, `package-entry`, the canaries) keep escalating to a full build.

## Fail-closed gating (#656 review B-01)

A reduced build is allowed **only when every selected test can run against it**.

- `partitionBuildSet()` reports what is *runnable* under the scoped order and
  what is not; `planCiSteps()` uses that only as a gate. Any selected test with
  an unbounded/uncertain requirement, or one outside the scoped order, escalates
  the **whole run** back to a full build + full tests.
- The `deferred_test_files` output therefore stays empty on a passing required
  check: no scoped build may be green while selected tests have not run. The
  earlier "defer to full validation" behaviour was removed — running missing
  tests after merge or at release cannot catch a regression before merge.
- Consequence, measured and documented below: with the repository's current test
  shape (almost every test is owned by `svforge`, and ~37 meta-tests need every
  workspace's `dist`), an isolated add-on change is **always** escalated to a
  full build. The 3-workspace experiment from the previous revision remains a
  performance upper bound, not a gated validation.

## Scenarios that still require a full build

- Any change to root config, workflows, `scripts/`, lockfile, release metadata or an unknown path (resolver-level full scope).
- Tests-only changes (a changed test may import a built package) — unchanged from #570.
- Any `ci:targeted` run whose selected tests include an unbounded consumer: all inventory, packaging, release-plan, canary and journey tests.
- Any selection that needs a workspace outside the computed build order.

## Measuring on GitHub Actions (same SHA)

A PR event cannot compare two policies on one commit, because labels are captured when the run is created. `ci.yml` therefore accepts a dispatched measurement:

```bash
# one commit, two runs
gh workflow run ci.yml --ref <branch> -f scope=full
gh workflow run ci.yml --ref <branch> -f scope=targeted -f base=<PR base sha>
```

Both runs execute the same SHA; compare the `quality` duration, the number of test files, and the build step summary. Record the numbers (and the scenarios that fell back to a full build) in the PR. The default PR policy is not changed by this measurement path.

## Recorded measurements

Filled in on the PR for #656 (see the PR body): full validation vs `ci:targeted` on the same commit, with the selected build set and the escalation reason when a full build was kept.
