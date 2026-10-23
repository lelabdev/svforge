# Spike #547 — official `sv` foundations: audit + proof-of-concept

Status: **POC only.** No template, `create.ts`, `modes/*` or generated artifact is changed by this PR.
Reproduce with `scripts/spike-547.mjs` (manual, PostgreSQL required; not a CI gate).

## 1. Question answered

Can a newly generated SVForge Dashboard use the **official** `sv add` Drizzle + Better Auth + Paraglide
foundations and keep SVForge's product/security behavior **without reimplementing the foundation**?

Answer from this POC: **yes**, with three documented, additive adaptations:

| Official file | Adaptation | Why |
| --- | --- | --- |
| `src/lib/server/auth.ts` | add `emailAndPassword.disableSignUp` (mode-driven), `user.additionalFields` (`role`, `disabled`), invite `databaseHooks` | product policy + security-critical user columns |
| `src/hooks.server.ts` | append one `handleSvforgePolicy` to the existing `sequence(...)` | Better Auth keeps disabled users' sessions alive |
| `src/lib/server/db/schema.ts` | keep SVForge domain tables (already the official pattern) | domain ownership |

Everything else stays upstream-owned. `role`/`disabled` do **not** need a parallel schema generator.

## 2. Environment (recorded 2026-10-23)

| Component | Version |
| --- | --- |
| `sv` (workspace pin) | `1.1.1` |
| Node / npm / Bun | `24.21.0` / `11.19.0` / `1.3.13` |
| `@sveltejs/kit` (resolved) | `3.1.0` |
| `better-auth` (resolved) | `1.7.12` |
| `drizzle-orm` / `drizzle-kit` | `0.45.4` / `0.31.11` |
| `@inlang/paraglide-js` | `2.29.1` |
| `postgres` | `3.4.9` |

Non-interactive commands accepted by the published CLI:

```bash
sv create app --template minimal --types ts --no-install --no-add-ons --no-download-check
sv add drizzle="database:postgresql+client:postgres.js+docker:no" --no-install --no-download-check
sv add better-auth="demo:" --no-install --no-download-check        # no demo pages
sv add paraglide="languageTags:en,fr+demo:no" --no-install --no-download-check
```

The fixture is generated once per run by `scripts/spike-547.mjs`; it is deleted unless `--keep` is passed.

## 3. Findings

### F1 — the historical npm peer blocker no longer reproduces

`npm install` (no `--force`, no `--legacy-peer-deps`) succeeds with SvelteKit `3.1.0` and Better Auth
`1.7.12`; `bun install` also succeeds. The `ERESOLVE` recorded for the `sv@1.1.0` fixture (#533) must
therefore not be presented as a current blocker. (4 moderate `npm audit` advisories are unrelated.)

### F2 — official addons compose hooks instead of overwriting them

Generated `src/hooks.server.ts` already ends with:

```ts
export const handle: Handle = sequence(handleBetterAuth, handleParaglide);
```

Adding SVForge policy is an append to that sequence (F7), not a file replacement.

### F3 — official `check` is incomplete without a Paraglide compile step

The addon's `check` script is `svelte-kit sync && svelte-check`; the `#lib/paraglide/*` modules only exist
after `paraglide-js compile` (normally produced by the Vite plugin during `dev`/`build`). Running `check`
on a fresh fixture reports 6 errors; after
`npx paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide` it reports 0.
SVForge must keep a compile step in its `check`/`test` scripts (or the addon must grow one upstream).

### F4 — `role` / `disabled` have a supported extension point (the #547 stop condition is cleared)

Declaring them in the official config:

```ts
user: {
  additionalFields: {
    role: { type: 'string', required: true, defaultValue: 'user', input: false },
    disabled: { type: 'boolean', required: true, defaultValue: false, input: false }
  }
}
```

and running the official `npm run auth:schema` (`auth generate --config src/lib/server/auth.ts`) generates:

```ts
role: text("role").default("user").notNull(),
disabled: boolean("disabled").default(false).notNull(),
```

`drizzle-kit push` creates exactly `role text not null default 'user'` / `disabled boolean not null default false`.
This matches SVForge's current `auth.schema.ts` contract, with **no hand-written schema and no parallel generator**.

### F5 — a signup body cannot set `role` or `disabled`

`POST /api/auth/sign-up/email` with `{"role":"admin","disabled":true}` returns 200 and persists
`role = 'user'`, `disabled = false` (`input: false`). The privilege-escalation vector is closed by the
official configuration, not by SVForge code.

### F6 — closed signup is a supported configuration

With `emailAndPassword.disableSignUp = true`, the same endpoint returns `400`
`EMAIL_PASSWORD_SIGN_UP_DISABLED` and creates no row. The three SVForge modes
(`closed` / `invite-only` / `self-service`) therefore remain product configuration; the invite gate is the
existing `databaseHooks.user.create.before` hook, also official Better Auth configuration.

### F7 — a disabled identity keeps its session, so SVForge still owns one policy handle

`GET /api/auth/get-session` keeps returning a session for a user whose `disabled` column is `true`.
Composing one extra handle restores the current behavior:

```ts
const handleSvforgePolicy: Handle = async ({ event, resolve }) => {
	if (event.locals.user) {
		const [row] = await db.select({ disabled: user.disabled }).from(user)
			.where(eq(user.id, event.locals.user.id)).limit(1);
		if (!row || row.disabled) {
			event.locals.user = null;
			event.locals.session = null;
		}
	}
	return resolve(event);
};

export const handle = sequence(handleBetterAuth, handleParaglide, handleSvforgePolicy);
```

Verified: disabled → `locals.user = null`; re-enabled → user restored, `role` intact.

### F8 — schema ownership already matches the intended split

Official `db/schema.ts` brings a domain table (`task`) and `export * from './auth.schema'`; the official
`drizzle.config.ts` points at that file. `drizzle-kit push` creates the four auth tables **and** the domain
table in one schema. SVForge domain tables (invitations, task) keep living there; no `drizzle.config.ts`
fork and no second schema path are needed.

### F9 — schema generation details to plan for

- `npm run auth:schema` needs a **valid `DATABASE_URL`** (the config instantiates the driver) and rewrites
  `src/lib/server/db/auth.schema.ts` **in place**. The generated file starts as a stub: `sv add` prints
  "Run `npm run auth:schema`" but does not run it.
- The official `auth` CLI loads `src/lib/server/auth.ts` directly (SvelteKit virtual modules included), so
  SVForge's separate `auth.schema.config.ts` is no longer required.
- SVForge's review-copy policy (`auth-schema.review.ts`) and the Kit-independent config would be dropped or
  re-expressed upstream.

### F10 — smaller differences to decide, not blockers

- Official runtime dependencies (`better-auth`, `auth`, `drizzle-orm`, `postgres`) land in
  `devDependencies`; SVForge declares them as runtime dependencies.
- Official `db/index.ts` creates a plain `postgres()` client; SVForge's `createDb()` pool-limit factory and
  `closeDb` are not provided (serverless escape hatch).
- Official `.env`/`.env.example` and scripts (`db:*`, `auth:schema`) replace SVForge's versions; SVForge
  adds `SIGNUP_MODE` and its admin bootstrap script.
- Official Paraglide owns `project.inlang/`, `messages/*.json` bootstrap keys, `vite.config.ts`, `app.html`
  and `+layout.svelte` wiring; SVForge keeps catalog **content** (FR/EN keys) and `#lib/paraglide` usage.
- Direct `sv add svforge=template:dashboard` was **not** part of this POC (no template change). The
  collision remains until phase C / published conditional dependency options.

## 4. Ownership matrix (target)

| Path / responsibility | Owner | SVForge action |
| --- | --- | --- |
| `src/lib/server/auth.ts` | official | additive config: signup mode, invite gate, `additionalFields` |
| `src/lib/server/db/index.ts` | official | none (decide on `createDb` helper) |
| `src/lib/server/db/auth.schema.ts` | official (`auth:schema`) | never hand-edited |
| `src/lib/server/db/schema.ts` | official pattern | SVForge domain tables |
| `drizzle.config.ts` | official | none |
| `src/hooks.server.ts` | official | one composed policy handle |
| `src/app.html`, `vite.config.ts`, `project.inlang/`, `messages/` bootstrap | official | catalog content stays SVForge |
| `scripts/create-admin.ts`, `SIGNUP_MODE`, guards, invitations, admin UI, sessions/roles | SVForge | unchanged |
| pins, `better-auth-upgrade.mjs`, runbook pin tests, `auth.schema.config.ts` | SVForge | removable once phase A lands |

## 5. Suggested phase A (not implemented here)

1. In `modes/dashboard.ts`, stop writing `auth.ts`, `db/client.ts`, `db/index.ts`, `db/auth.schema.ts`,
   `auth.schema.config.ts`, `drizzle.config.ts`; keep domain tables (`db/schema.ts` content), policy
   module, guards, admin UI, bootstrap script, catalogs.
2. Apply the three adaptations above through `sv.file` transforms (anchor-checked, idempotent) and prove
   each with a test.
3. Run the official `auth:schema` as part of the scaffold flow **only when `DATABASE_URL` is available**,
   otherwise keep the stub and document the step (matches official UX).
4. Keep a `paraglide-js compile` step in `check`/`test` scripts (F3).
5. Re-run the `test-scaffold.sh dashboard` profile (real PostgreSQL) plus npm/Bun installs.

Phase B (Paraglide) then removes SVForge's own `hooks.server.ts`/inlang wiring; phase C adapts
`create.ts` to run the official `sv add` commands for the dashboard template.

## 6. Risks / open questions

- **`svforge upgrade` for existing projects**: this POC says nothing about migrating a generated project
  from the hand-written foundation to the official one. Keep it non-destructive and out of phase A.
- **Review-copy schema policy**: keeping `auth-schema.review.ts` requires re-adding it on top of the
  official script; dropping it changes the documented workflow.
- **`createDb` serverless helper**: keep as an SVForge addition on top of official `db/index.ts`, or drop.
- **Local/postgres-only `auth:schema`**: CI/release profiles must provide `DATABASE_URL` (they already do
  for the dashboard).
- **Direct `sv add svforge=template:dashboard`**: still blocked by the absence of conditional
  dependencies with options in the published CLI (`setup()` does not receive the addon options); document
  the explicit two-command sequence until an upstream release provides it.

## 7. Reproduce

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sf_547 \
  node scripts/spike-547.mjs --pm npm [--keep] [--dir /tmp/sf-547] [--port 5470]
```

Checks: official add commands, install without peer forcing, hook composition, `additionalFields`
generation (NOT NULL), domain+auth schema push, closed signup, signup role injection ignored, disabled
session rejection through the composed handle, re-enabled restore.
