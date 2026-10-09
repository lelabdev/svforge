# Better Auth upgrade runbook

The dashboard template pins Better Auth; it never scaffolds `latest` or `*`. The authoritative pin is declared in `packages/svforge/src/modes/dashboard.ts` and mirrored in the dashboard template. `tests/better-auth-upgrade.test.ts` guards the carriers.

## Ownership and upstream `sv` compatibility

| Concern                                                                                                                                    | Owner today                | Boundary                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Drizzle client lifecycle, schema, migrations, Better Auth adapter mapping, and pinned dependencies                                         | SVForge dashboard scaffold | `createDb()` exposes the serverless pool limit; auth schema changes are reviewed against the runtime schema. |
| Auth request/session hooks, closed-by-default signup, invitations, roles, disabled-user lifecycle, first-admin bootstrap, and dashboard UX | SVForge dashboard          | These are product/security policies, not generic auth setup.                                                 |
| Generic Better Auth and Drizzle add-on generation                                                                                          | Upstream `sv` add-ons      | Not composed with the dashboard until their generated foundation is compatible and safely extensible.        |

This is a compatibility decision based on the pinned `sv@1.1.0`, not a general rejection of upstream ownership. In a clean scaffold, `sv create` generates SvelteKit `^3.0.0`; the official Better Auth add-on requests `^1.6.24`, which currently resolves to Better Auth `1.7.7` with an optional `@sveltejs/kit: ^2.0.0` peer. npm therefore fails installation with `ERESOLVE`. Bun, pnpm, and Yarn install paths were also exercised, but their more permissive peer handling does not make the generated add-ons composable.

Both application orders were tested with `sv@1.1.0`. Adding official Drizzle after a dashboard scaffold cancels with `Preexisting drizzle config file`. The official Better Auth add-on proceeds but appends duplicate `auth`/`db` imports, auth exports, and request handlers to the dashboard's existing files; the generated dashboard then fails `svelte-check` with duplicate identifiers. Applying the dashboard after the official add-ons instead overwrites their generated auth, hook, schema, Drizzle, and script files; the package manifest can retain conflicting runtime/dev dependency entries and an unused upstream CLI. The official `demo:none` option only omits demo UI: its generated `emailAndPassword.enabled` remains true with no `disableSignUp`, so it does not meet SVForge's closed-signup default.

Do not instruct dashboard users to stack the official add-ons with SvelteForge as a workaround. Revisit composition when upstream supports the generated SvelteKit major and provides idempotent extension points for existing auth/Drizzle files and closed signup. Until then, the table above is the ownership contract: keep only the minimum generic integration necessary in SVForge, and keep the differentiated policies here.

## Manual upgrade policy and validation

Upgrades are deliberate maintainer changes in a normal pull request. There is no scheduled bot or automatic publication.

- PR CI runs the repository checks and Better Auth stack audit.
- The dashboard schema/runtime scaffold gate runs in the release scaffold matrix before publication, **not** on every PR. It uses real PostgreSQL and checks the installed runtime schema and auth flow.
- The stack audit queries OSV.dev for Better Auth packages and their resolved dependency closure. Critical/high advisories block; documented exceptions use [`audit-baseline.json`](audit-baseline.json).

## Pin and schema constraints

Use the helper to inspect or update all version carriers:

```bash
node scripts/better-auth-upgrade.mjs pin
node scripts/better-auth-upgrade.mjs apply --better-auth <version>
```

`@better-auth/cli` is not a scaffold dependency. Its bundled core can lag behind the runtime and conflict with the scaffold's dependency tree. The schema/runtime gate compares `auth.schema.ts` with the schema derived from the installed Better Auth runtime (`getSchema()`); the CLI generation step is only a smoke test of the `auth:schema` path.

Keep the generated schema output as a review copy. The CLI `--output` must be a new, relative path; generating directly over `src/lib/server/db/auth.schema.ts` can erase runtime-only fields such as `user.role` and `user.disabled`. Review and merge schema changes deliberately.

## Local validation

```bash
bun install
bun run lint
bun run typecheck
bun run build:all
bun run test
```

The release-only dashboard gate can be run locally when PostgreSQL is available:

```bash
bash scripts/test-scaffold.sh dashboard
```

To run the audit against the current pin, resolve it in a temporary project as CI does:

```bash
PIN=$(node --input-type=module -e "import { currentPin } from './scripts/better-auth-upgrade.mjs'; console.log(currentPin().version)")
AUDIT_DIR=$(mktemp -d)
( cd "$AUDIT_DIR" && echo '{"name":"audit","private":true}' > package.json && bun add "better-auth@$PIN" )
node scripts/better-auth-audit.mjs "$AUDIT_DIR/bun.lock"
```

After review, open a normal pull request. See [`docs/RELEASE.md`](RELEASE.md) for publication and versioning steps.
