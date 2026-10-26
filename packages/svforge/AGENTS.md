# AGENTS.md — package `svforge`

Spécificiques du package principal. **Lire d'abord le [AGENTS.md racine](../../AGENTS.md)** — positionnement, gotchas prebuild, conventions, état v5.

## Templates

```
templates/base/
├── src/lib/components/svforge/       ← primitives / ui / layout
├── src/lib/styles/
│   └── svelteforge-theme.css         ← thème Skeleton v5 complet
└── src/routes/
    ├── layout.css                    ← unique point d'entrée CSS global
    └── landing + showcase

templates/dashboard/                 ← overlay : base + auth + admin + DB
├── src/lib/server/                  ← auth (better-auth), db (drizzle/postgres), schemas (zod), admin.ts
├── src/routes/(app)/admin/          ← users CRUD, settings, dashboard
├── src/routes/login/ setup/         ← setup = bootstrap 1er admin (dev-only, atomique — la prod passe par `<pm> run admin:create` (PM-agnostic, #325))
├── src/hooks.server.ts              ← session better-auth → locals
├── e2e/ + playwright.config.ts      ← profil playwright opt-in (⚠️ #186 : écrit dans src/)
└── vitest.config.ts                 ← ⚠️ racine du template = jamais embarqué (#186)
```

### Contrat CSS (#313)

Le scaffold reste volontairement minimal :

- `src/routes/layout.css` charge Tailwind, Skeleton, Skeleton Svelte, les fontes, les plugins, le dark variant et `svelteforge-theme.css`. Il ne doit pas devenir une couche de design globale.
- `src/lib/styles/svelteforge-theme.css` est la source de vérité visuelle Skeleton v5 : palettes, surfaces, brand, root backgrounds, typo, radius/shapes, borders/rings/outlines.
- Il n'y a **pas** de `tokens.css` ni de `index.css` générique dans le boilerplate.
- Pour le layout/whitespace local, utiliser les utilities Tailwind standard (`p-4`, `gap-6`, `max-w-7xl`, etc.).
- Une couche de tokens/effets spécifique au produit ne se crée que plus tard, si un besoin concret et répété n'est pas couvert par Skeleton/Tailwind.

Le pattern admin (#318) : **rôle explicite persisté** — colonne `user.role` (`admin` | `user`), accordée UNIQUEMENT par le bootstrap atomique `bootstrapFirstAdmin` (`src/lib/server/first-admin.ts`, verrou consultatif + vérification « aucun admin existant » dans la transaction ; CLI `<pm> run admin:create`). `isAdmin()` (`src/lib/server/admin.ts`) vérifie le rôle côté serveur — JAMAIS de dérivation par ordre (`createdAt`). L'inscription publique est **fermée par défaut** (`SIGNUP_MODE` : `closed` | `invite-only` | `self-service`, résolu dans `src/lib/server/signup-mode.ts`, inconnu ⇒ fermé).

## Modes (`src/modes/`)

- `base.ts` : écrit tous les fichiers de `baseFiles`
- `dashboard.ts` : deps runtime (drizzle-orm, better-auth, postgres) + devDeps (drizzle-kit, vitest, playwright si opt-in) + patch `package.json` (scripts test) + `baseFiles` puis overlay `dashboardFiles` (filtrage playwright)

L'entry `src/index.ts` : déclare les deps communes (fonts, skeleton, tailwind v4, phosphor, clsx, tailwind-merge) et patche `vite.config.ts` (plugin `@tailwindcss/vite`).

## doctor / upgrade

`src/doctor.ts` (read-only, #178) and `src/upgrade.ts` (#179, complet par
#327) sont exportés du package et exposés via le CLI (`bin/svforge.mjs`).
L'upgrade est un moteur diffable : plan → diff → apply (`--dry-run`, `--json`),
baseline SHA-256 écrite à l'install (`.svforge-versions.json`), sauvegardes
versionnées `.svforge-backup/<recipe>/<timestamp>-<version>/`, rollback
atomique. Le moteur vit dans `@svforge/addon-kit` (`src/upgrade.ts`) et est
partagé par base, dashboard ET les 13 modules (recettes extraites au prebuild →
`src/module-recipes.ts` — NE PAS éditer à la main). Le resolver de destination
canonique (src vs racine) vit dans `src/destinations.ts`, utilisé à la fois par
les modes de scaffold et par l'upgrade.

## Après modification d'un template

**Toujours** régénérer le manifest :

```bash
cd packages/svforge && bun run build   # prebuild (templates.ts) + tsdown
bun run test                           # tests racine
```

Puis vérifier en réel si la modif touche le scaffold : `bash scripts/test-scaffold.sh <base|dashboard>` (cf. #191 pour la réintégration CI).

## Conventions PostgreSQL (#255)

Le dashboard et tous les modules DB (`audit`, `notifications`, `jobs`, `chat`) utilisent **PostgreSQL via `drizzle-orm/pg-core`**. Conventions canoniques — à respecter pour tout nouveau module DB :

- **ids** : `uuid('id').primaryKey().defaultRandom()` pour les tables métier ; `text` pour les tables Better Auth (user/session/account/verification)
- **timestamps** : `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()` — `withTimezone` partout
- **JSON** : `jsonb` pour les champs structurés (`metadata`, `payload`, `result`)
- **FK** : identity/auth rows may use `.references(() => table.id, { onDelete: 'cascade' })` where Better Auth owns the lifecycle. Domain tables referencing `user` must **not** use `ON DELETE CASCADE` without an explicit product reason: dashboard lifecycle is deactivation, preserving historical identity.
- **join tables** : PK composite explicite (`primaryKey({ columns: [...] })`) — PostgreSQL n'a pas de rowid implicite
- **driver** : `postgres` (postgres.js) via `drizzle-orm/postgres-js` — jamais de `@libsql/client` / `sqlite-core`
- **better-auth** : `drizzleAdapter(db, { provider: 'pg' })`
- **config** : `drizzle.config.ts` dialect `postgresql`, URL via `process.env.DATABASE_URL` (drizzle-kit charge `.env` automatiquement)
