# Better Auth upgrade runbook

The dashboard template pins Better Auth; it never scaffolds `latest` or `*`. The authoritative pin is declared in `packages/svforge/src/modes/dashboard.ts` and mirrored in the dashboard template. `tests/better-auth-upgrade.test.ts` guards the carriers.

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
