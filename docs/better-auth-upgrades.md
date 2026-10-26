# Better Auth ownership, upgrade and security runbook

**The official `sv add better-auth` (with `sv add drizzle`) integrations own the dashboard's auth/DB foundation (#547).** SVForge composes them and owns only its product/security policies. There is no SVForge Better Auth pin any more: the version comes from the published `sv` add-on and its dependency range.

## Ownership contract

| Concern | Owner | Boundary |
| --- | --- | --- |
| Better Auth instance, Drizzle adapter, session cookies, request handler, auth tables, `auth:schema`, Drizzle config/client, dependency versions | Official `sv add drizzle better-auth` | Generated files are upstream-owned; SVForge only extends them |
| `user.role` / `user.disabled` columns | SVForge (`user.additionalFields` config, `input: false`) | Declared through the supported config; the official `auth:schema` script generates them (`not null default`) |
| Closed/invite/self-service sign-up policy, invitations, first-admin bootstrap, admin guards, disabled-session rejection, dashboard UX | SVForge (`auth-policy.ts`, `auth-guard.ts`) | Product/security rules, not generic auth setup |
| Schema/runtime parity gate | CI scaffold matrix (`scripts/check-auth-schema.mjs`) | Compares the **generated** schema with the installed runtime `getSchema()` |

## How SVForge extends the official output

The dashboard add-on runs **after** the official add-ons (see `svforge create`) and applies anchored, idempotent patches:

1. `src/lib/server/auth.ts` — imports `svforgeAuthPolicy` and spreads it before `plugins` (policy keeps the official `sveltekitCookies` plugin last).
2. `src/hooks.server.ts` — composes `sequence(handleParaglide, handleBetterAuth, handleSvforgePolicy)`; the official handler is untouched.
3. `src/env.ts` + `.env`/`.env.example` — declare/append `SIGNUP_MODE`.
4. `src/lib/server/db/schema.ts` — SVForge domain tables next to the official `export * from './auth.schema'`.

A missing anchor fails the scaffold loudly instead of shipping a dashboard without the security policy.

**Direct `sv add` (no `svforge create`)**: the official Paraglide, Drizzle and Better Auth add-ons must run first — the published `sv` cannot install them conditionally (upstream sveltejs/cli#1419). SVForge checks this before any write and cancels with the exact commands (`sv add "paraglide=languageTags:en,fr+demo:no"`, then `drizzle=…`, `better-auth=demo:` for the dashboard, then re-run the SVForge add).

## Security behavior (must stay identical)

- sign-up is `closed` by default (`SIGNUP_MODE`), `invite-only` and `self-service` are explicit;
- no sign-up body can set `role` or `disabled` (`input: false`, verified in the POC);
- `role`/`disabled` are persisted, NOT NULL columns with defaults;
- a disabled identity is rejected at session creation and its live sessions are neutralized by the composed guard;
- the initial administrator is created only by the atomic bootstrap (`admin:create` / dev-only `/setup`).

## Historical compatibility record (why the migration waited)

The experiments that motivated #547 were recorded with published `sv@1.1.0`; the repository pins `sv@1.1.1` (see `package.json` and the [dated compatibility report](../packages/svforge/docs/sveltekit-compatibility.md)). They are **historical evidence, not a claim about current versions**:

- that fixture produced SvelteKit `^3.0.0` while the Better Auth add-on declared an optional `@sveltejs/kit: ^2.0.0` peer; npm failed with `ERESOLVE`;
- `sv add drizzle` **after** a dashboard scaffold cancelled with `Preexisting drizzle config file`;
- `sv add better-auth` after a scaffold produced duplicate imports/handlers and broke `svelte-check`;
- applying the old dashboard **after** the official add-ons overwrote their foundation.

The #547 proof-of-concept re-tested the published CLI: npm and Bun installs succeed without peer forcing, hooks already compose, and `role`/`disabled` are supported through `additionalFields`. See [`docs/spikes/547-official-integrations-poc.md`](spikes/547-official-integrations-poc.md) and `scripts/spike-547.mjs`.

## Schema generation

`auth:schema` is the official script (`auth generate --config src/lib/server/auth.ts --output src/lib/server/db/auth.schema.ts`). It needs a valid `DATABASE_URL` and rewrites its output in place. The generated file is upstream-owned: never hand-edit it. The scaffold gate (`scripts/check-auth-schema.mjs`) compares it with the installed runtime schema, including the SVForge `role`/`disabled` columns (allowlisted as app-level auth-user extensions).

## Upgrade and audit policy

Upgrades are deliberate maintainer changes in a normal pull request. There is no scheduled bot or automatic publication.

- PR CI runs the repository checks and the Better Auth stack audit.
- The audit resolves the range declared by the **installed official `sv` add-on** (`scripts/better-auth-version.mjs`), not a repository pin:

```bash
RANGE=$(node --input-type=module -e "import { officialBetterAuthRange } from './scripts/better-auth-version.mjs'; console.log(officialBetterAuthRange())")
AUDIT_DIR=$(mktemp -d)
trap 'rm -rf "$AUDIT_DIR"' EXIT
( cd "$AUDIT_DIR" && echo '{"name":"audit","private":true}' > package.json && bun add "better-auth@$RANGE" )
node scripts/better-auth-audit.mjs "$AUDIT_DIR/bun.lock"
```

- Critical/high advisories block; documented exceptions live in [`audit-baseline.json`](audit-baseline.json).
- The dashboard schema/runtime scaffold gate runs in the release scaffold matrix (real PostgreSQL), not on every PR.

## Local validation

```bash
bun install
bun run lint
bun run typecheck
bun run build:all
bun run test
```

With PostgreSQL available, run the dashboard scaffold gate:

```bash
bash scripts/test-scaffold.sh dashboard
```

After review, open a normal pull request. See [`docs/RELEASE.md`](RELEASE.md) for publication and versioning steps.
