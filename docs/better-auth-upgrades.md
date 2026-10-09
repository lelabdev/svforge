# Better Auth upgrades — manual bump & CI validation (#319, #460)

The dashboard scaffold ships a **pinned** Better Auth stack. The pin lives in
`packages/svforge/src/modes/dashboard.ts` and is mirrored in
`packages/svforge/templates/dashboard/package.json`; a drift guard
(`tests/better-auth-upgrade.test.ts`) keeps every carrier in lockstep. The
scaffold NEVER floats (`latest`, `*`) — a generated project must be
reproducible (#197).

The live pin is whatever `packages/svforge/src/modes/dashboard.ts` declares — print it at
any time with `node scripts/better-auth-upgrade.mjs pin`. The value is parsed from the source
at runtime, so it never goes stale after an upgrade PR merges (#319 review). Historical: #319
migrated the pin from ~1.4.21 to the 1.6.x/1.7.x fix stream to cover GHSA-g38m-r43w-p2q7 —
OAuth auto-link account takeover, fixed in 1.6.11.

## Policy — manual bump, CI validated

There is **no autonomous Better Auth dependency bot** (#460). A maintainer
decides when to move the pin, opens a normal PR, and CI validates it before
review and merge. One upgrade process for the whole repository, instead of a
bespoke workflow per package.

| Step | Who |
| --- | --- |
| Change the pinned version and every carrier | maintainer, normal branch |
| Repository quality checks + Better Auth stack audit | PR CI |
| Dashboard schema/runtime scaffold gate | Release scaffold matrix, before publication |
| Review and merge | maintainer, after CI is green |

The old scheduled cadence (daily security escalation, weekly minor/patch
publication, automatic migration issue for majors) was removed. Majors and
prereleases are no longer special-cased: they follow the same manual PR + CI
validation, and a major still needs a human migration review of the
auth/schema/runtime behavior before merging.

## PR validation and release scaffold gate

A Better Auth bump PR runs repository-level CI: lint, typecheck, build, tests,
and the Better Auth stack audit. The dashboard schema/runtime scaffold is
**not** part of every PR gate; it runs in the release scaffold matrix before
publication. Both layers matter, but the release matrix must not be mistaken
for routine PR CI.

The release workflow's **`bash scripts/test-scaffold.sh dashboard`** gate runs a
real scaffold against real PostgreSQL and checks:

- production build + `svelte-check` (0 errors);
- template Vitest baseline — the credential-lifecycle suite proves the contract
  end-to-end against the installed Better Auth version: admin A creates B
  without losing their session, **B signs in through the real `auth.handler`**,
  wrong passwords are rejected, and duplicate/atomicity guarantees hold;
- schema drift — the committed `auth.schema.ts` must match the schema **derived
  from the installed better-auth runtime** (`getSchema()` from the project's
  own `node_modules`). The comparison covers column names, types, nullability,
  defaults, uniques/indexes and foreign keys. The lagging `@better-auth/cli`
  output is NOT the reference (see below); the CLI generate step remains a
  smoke test of the shipped `auth:schema` path;
- HTTP smoke — `vite dev` + real requests: `/setup` (first admin) → login →
  admin CRUD (create user B, admin session survives) → B signs in.

The **Better Auth stack audit** (`scripts/better-auth-audit.mjs`) runs in PR CI
and in the release workflow. It queries OSV.dev for better-auth,
`@better-auth/*` and their **full resolved dependency closure**: regular +
optional dependencies and required peer dependencies, resolved to the shallowest
(hoisted) lockfile entry. This includes hoisted transitive packages (e.g. `jose`),
which a lockfile-key scope filter silently misses (#319 review). It **fails on
critical/high** advisories; moderate/low findings are reported without blocking.
Documented reachability exceptions use the existing
[`docs/audit-baseline.json`](audit-baseline.json) mechanism (#351): a scoped
`{ package, version, advisory, path, reason }` entry with a written
justification.

## The CLI (`@better-auth/cli`) is NOT a scaffold dependency

The CLI versions independently of `better-auth` and lags it (latest stable
1.4.x while the runtime is 1.7.x). Its own dependency tree pins
`@better-auth/core@1.4.x`, and bun hoists that copy over the runtime's
`@better-auth/core@1.7.x` — which breaks the SSR build with
`SyntaxError: The requested module '@better-auth/core/error' does not provide
an export named 'APIError'`.

Therefore:

- the generator runs via the SELECTED package manager's on-demand runner
  (`bunx` for bun scaffolds, `npx --yes` for npm, `pnpm dlx` for pnpm —
  #325): the dlx cache is isolated from the project's `node_modules`,
- the CLI version is pinned in the scaffold gate and in the template's
  `auth:schema` source,
- **do not add `@better-auth/cli` to the scaffold's dependencies** until its
  bundled core matches the runtime major,
- the schema drift gate in the scaffold gate is the drift detector: the
  committed `auth.schema.ts` is diffed against the schema derived from the
  installed RUNTIME (`getSchema()`), so a newer runtime that changes names,
  types, nullability, defaults, indexes or FKs tells you to review and
  re-commit — even while the CLI's bundled knowledge still lags behind.
  The `bunx @better-auth/cli generate` step in the gate stays as a smoke
  test of the shipped `auth:schema` regeneration path.

Gotchas encoded in the gate (verified against the CLI): the `--output` path
must **not already exist** (existing files are overwritten to 0 bytes) and
must be **relative**. #325 additionally ships the scaffold's `auth:schema`
as a REVIEW copy (`--output auth-schema.review.ts`): regenerating directly
over `src/lib/server/db/auth.schema.ts` wipes runtime-only columns
(`user.role`, `user.disabled`) and breaks the build until hand-merged. The
committed schema stays the runtime-gated source of truth.

## 1.7.x migration notes (applied in #319)

- `drizzleAdapter(db, { provider: 'pg' })` must now pass the model mapping
  explicitly: `drizzleAdapter(db, { provider: 'pg', schema: { user, session,
  account, verification } })`. The old introspection of the drizzle instance
  is gone — without the mapping every write fails with
  `Cannot convert undefined or null to object`. The scaffold gate catches
  this class of regression via the HTTP smoke.
- The credential contract is unchanged (verified against the 1.7.3 sources):
  emails are stored lowercased, credential accounts keep
  `providerId: 'credential'` with `accountId = user.id`, and
  `better-auth/crypto` still exports `hashPassword`/`verifyPassword`. The
  isolated `createCredentialUser` helper stays — the official admin plugin's
  `createUser` is session-safe but drags in the plugin's own role/ban schema
  fields and permission model, which duplicates the template's explicit
  persisted `user.role` column (#318: `admin` granted only by the atomic
  first-admin bootstrap) + `disabled` lifecycle. Adopting the plugin is a
  product decision, not a dependency upgrade.

## Known follow-ups

- **E2E OAuth coverage**: the runtime smoke covers email/password (setup,
  login, admin CRUD, created-user sign-in). A full OAuth E2E flow (Google/
  GitHub against the `oauth` module) needs provider stubs or test tenants and
  is tracked as a follow-up — the `oauth` module carries its own test pack
  meanwhile.
- **`@better-auth/cli` 1.7.x**: when the CLI catches up with the runtime
  major (its bundled `@better-auth/core` no older than the runtime), it can be
  considered again as a regular devDependency. Until then it stays bunx-only.

## Manual run

```bash
# Print the LIVE pin (parsed from packages/svforge/src/modes/dashboard.ts)
node scripts/better-auth-upgrade.mjs pin

# Bump every carrier to the chosen version
node scripts/better-auth-upgrade.mjs apply --better-auth <version>

# Validate the repository-level PR gates locally
bun install
bun run lint && bun run typecheck
bun run --filter '*' build && bun run test

# Optional local reproduction of the release-only dashboard scaffold gate
# (not run by ordinary PR CI; requires PostgreSQL)
bash scripts/test-scaffold.sh dashboard   # schema/runtime smoke + real PostgreSQL

# Stack audit against the PINNED version (better-auth is not in the repo
# lockfile — resolve it in a scratch project, as ci.yml does)
PIN=$(node --input-type=module -e "import { currentPin } from './scripts/better-auth-upgrade.mjs'; console.log(currentPin().version)")
AUDIT_DIR=$(mktemp -d)
( cd "$AUDIT_DIR" && echo '{"name":"audit","private":true}' > package.json && bun add "better-auth@$PIN" )
node scripts/better-auth-audit.mjs "$AUDIT_DIR/bun.lock"
```

Then open a normal PR. PR CI re-runs the repository tests and the Better Auth
stack audit (`.github/workflows/ci.yml`). The dashboard schema/runtime gate is
part of the release scaffold matrix (`.github/workflows/publish.yml`, #413), so
it runs before publication instead of on every pull request.
