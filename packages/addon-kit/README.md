# @svforge/addon-kit

Shared runtime for every `@svforge/*` sv addon. Two concerns, one small
package, so policies never diverge across modules:

## Capability contract (#323)

Modules no longer describe prerequisites as template names. They declare
**capabilities** they `provides` / `requires` / `optional`, and the kit checks
them **structurally** on the real project (package.json dependencies,
conventional directories) — never by project origin. A non-SVForge project
that provides the same capabilities (its own Better Auth, its own Drizzle
setup, its own Paraglide catalogs…) can install the modules.

```ts
import { checkModuleCapabilities } from '@svforge/addon-kit';

const gate = checkModuleCapabilities(cwd, 'audit');
if (!gate.ok) {
	cancel(gate.message); // readable: missing capability + how to install it
	return;
}
```

## Safe JSON merges (#324)

`planAddonContext` and `planCatalogMerges` replace the old per-module
`try { JSON.parse } catch { {} }` helpers. Invalid JSON is NEVER silently
treated as an empty file: every transform is computed and validated in memory
FIRST, and the plan fails with the file path, the parse diagnostic and a
remediation step — before anything is written. On failure the source files
stay byte-for-byte identical.

## Vocabulary

| Capability | Meaning | Structural detection |
|---|---|---|
| `ui.skeleton` | Skeleton v5 design system + theme wiring | `@skeletonlabs/skeleton` dependency |
| `ui.svforge` | SVForge base UI kit (primitives/ui + utils) | `src/lib/components/svforge/` present |
| `i18n.messages` | Paraglide message catalogs (FR/EN initial locales) | paraglide dependency + `messages/*.json` |
| `auth.currentUser` | Authenticated user in `locals.user` | `better-auth` dependency |
| `auth.admin` | Admin role helpers (`#lib/server/admin.js`) | `src/lib/server/admin.*` present |
| `database.drizzle.postgres` | Drizzle ORM + PostgreSQL driver | `drizzle-orm` + `postgres`/`pg` dependencies |
| `storage.object` | S3-compatible object storage client | `@aws-sdk/client-s3` dependency |
| `runtime.longLivedWorker` | Runtime keeping a worker alive | not verifiable from files → warning |
| `runtime.websocket` | Runtime allowing WebSocket servers | not verifiable from files → warning |
