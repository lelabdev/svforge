# SVForge

SVForge is an [`sv`](https://github.com/sveltejs/cli) community addon that adds production-ready foundations to a normal SvelteKit project. It is a starter, not a component library or a shadcn/ui clone: the generated source belongs to your project, and richer UI components come directly from [`@skeletonlabs/skeleton-svelte`](https://skeleton.dev).

SVForge supports `sv` 1.x (`^1.1.0`). Choose a deployment target before adding runtime modules; see [deployment profiles](docs/deployment-profiles.md).

## Install

The official integrations run **first**: SVForge extends their output and
refuses to write anything when it is missing (the published `sv` cannot install
them conditionally — upstream sveltejs/cli#1419). `svforge create` does this
ordering for you; for a manual install, run the official add-ons yourself:

```bash
# Base UI and application foundations
npx sv create my-app
cd my-app
npx sv add "paraglide=languageTags:en,fr+demo:no"   # official foundation first
npx sv add svforge=template:base+testing:vitest --no-git-check
npm run dev

# Or use the dashboard with Better Auth, PostgreSQL, and Drizzle
npx sv create my-dashboard
cd my-dashboard
npx sv add "paraglide=languageTags:en,fr+demo:no"                                   # official i18n
npx sv add "drizzle=database:postgresql+client:postgres.js+docker:no"                # official ORM
npx sv add "better-auth=demo:"                                                       # official auth
npx sv add svforge=template:dashboard+testing:vitest --no-git-check
bash scripts/setup.sh
# Configure PostgreSQL and DATABASE_URL in .env, generate the auth tables the
# official Better Auth add-on only stubs, then review the target:
npm run auth:schema
npm run db:push
# Create the first admin via /setup in development or npm run admin:create
npm run dev
```

Dashboard projects use PostgreSQL. `bash scripts/setup.sh` (Node.js 20.12+; use a supported SvelteKit Node version) only prepares local files: it copies the final, add-on-composed `.env.example` if `.env` is absent, restricts `.env` to owner access, ensures Git ignores it, and generates a cryptographic Better Auth secret when missing, shorter than 32 characters, or a placeholder. A `.env` that Git already tracks (staged or committed) is refused rather than filled with a secret — an ignore rule cannot protect an indexed file; untrack it with `git rm --cached .env` and rotate any committed secret first. Existing settings and valid secrets are preserved on reruns. It never executes `.env`, connects to a database, starts Docker, or runs Drizzle. `bash scripts/setup.sh --defer` leaves files unchanged and prints how to resume.

Create PostgreSQL yourself and set `DATABASE_URL` privately in `.env`; database provisioning and the CLI setup prompt are not included in this first bootstrap step. After verifying the target, use `<pm> run db:push` for initial local development, or review versioned migrations with `<pm> run db:generate` followed by `<pm> run db:migrate`. These commands are separate from preparation; no forced schema push runs automatically. Once the schema is ready, create the first admin with `<pm> run admin:create` or `/setup` in development. Setup reports the database as unchecked, even when a URL already exists.

Playwright is an optional profile:

```bash
# after the official Paraglide/Drizzle/Better Auth add-ons above
npx sv add svforge=template:dashboard+testing:playwright --no-git-check
npx playwright install
npm run test:e2e
```

You can also add SVForge during `sv create`, or run `npx sv add svforge` in an existing project to choose a template — after the official add-ons for that template are installed.

### Static deployment

The base template's public routes are prerendered and can use SvelteKit's static adapter:

```bash
npx sv add 'sveltekit-adapter=adapter:static' --install npm --no-git-check
```

`--no-git-check` is needed because the scaffold has already modified the working tree. The supported `sv` add-on updates the existing `vite.config.ts` and installs `@sveltejs/adapter-static`; it does not need a separate `svelte.config.js`. New routes must also be prerenderable for `npm run build` to succeed with the static adapter.

## SvelteKit compatibility

The supported `sv` pin, tested framework versions, real scaffold profiles and official migration status are recorded in the [SvelteKit compatibility report](docs/sveltekit-compatibility.md). Fresh scaffolds target the current stable Kit major; framework migrations remain the responsibility of `sv migrate`.

## Templates

Every scaffolded component follows the [Skeleton v5-first baseline](docs/skeleton-baseline.md): Tailwind utilities plus verified Skeleton primitives, no component CSS layer, a pointer affordance on every enabled control, and a recorded audit disposition per file. Repeated meaningful compositions live in one discoverable component instead of being re-assembled per route — see [atomic, reusable UI composition](docs/ui-composition.md) for the shared modal/password/header contracts and the audit of what is deliberately not extracted.

- **`base`** — Skeleton UI and Tailwind, reusable foundations (`Button`, `Input`, `Select`, `Card`, `Badge`, `Table`), theme and dark mode, SEO, Paraglide EN/FR (English default), and Vitest.
- **`dashboard`** — base plus Better Auth, PostgreSQL/Drizzle, protected admin routes, user management, and setup scripts.

### Showcase

`/showcase` is the design-system gallery (colors, variants, every shared component, theme switching). Installed modules can contribute their own child demo by adding a route plus a `meta.ts` next to it — `dnd` ships `/showcase/dnd` (a working sortable list), `ui_toast` ships `/showcase/ui-toast` (every toast variant fired through the module's own store) `tiptap` ships `/showcase/tiptap` (the real editor, toolbar and sanitized preview over a local document) `graph` ships `/showcase/graph` (an interactive local knowledge graph with a keyboard-reachable node selection) and `uploads` ships `/showcase/uploads` (the real upload policy with simulated progress — no request, no storage, no credentials), all with local fixture data: the showcase index discovers demos with a build-time glob and lists only what is installed, so a plain Base project imports nothing and shows no empty section.

**Demos are optional.** They are a visual/manual testing aid for capabilities that are genuinely worth exploring — not a second product implementation, and never a duplicate of a real application screen. Changing application behaviour does not require creating or updating a demo; an existing demo only has to keep building.

#### Removing showcase pages from production

The showcase is prerendered with the rest of the site, so it has to be excluded **before the production build** — no runtime flag can hide a page that is already in the output.

1. Delete the gallery and every installed demo route:
   ```bash
   rm -rf src/routes/showcase
   ```
2. Remove every link pointing at it. In the Base template that is the `links` array passed to `Navbar`/`Footer` in `src/routes/+layout.svelte` (drop the `href: '/showcase'` entries) and the showcase `<Button>` in `src/routes/+page.svelte` (remove its now-unused `localizeHref` import too). Confirm nothing is left:
   ```bash
   grep -rn "/showcase" src --exclude-dir=paraglide || echo "no showcase references left"
   ```
   (`src/lib/paraglide` is generated at build time, so it is excluded from the check; a module's now-unused `showcase_*` message keys may stay in `messages/*.json`.)
3. Build and verify the output, while the installed components stay usable:
   ```bash
   bun run build
   ls .svelte-kit/output/prerendered/pages | grep showcase   # must print nothing
   grep -rq "/showcase" .svelte-kit/output/prerendered || echo "no showcase in the build"
   test -f src/lib/components/svforge/dnd/SortableList.svelte  # module code is untouched
   ```
   (With `@sveltejs/adapter-static` the same files land in your `build/` output directory.)

The `dnd` module (or any other installed module) keeps working: only the demo routes go away, never `src/lib/components/svforge/**`. SVForge tracks the files it delivered, so after running `svforge upgrade` re-check step 2/3 — an upgrade plan may list the showcase files again, and you should keep them deleted (or re-apply the removal) if production must stay clean.

Dashboard sign-up is closed by default; `SIGNUP_MODE` can be set to `invite-only` or `self-service`. The admin role is granted through `<pm> run admin:create`, not public sign-up. Integration tests use `TEST_DATABASE_URL` and refuse database names without a `test` segment; see the generated `.env.example` before running them.

Skeleton is the visual and primitive source of truth. The theme is in `src/lib/styles/svelteforge-theme.css`; global CSS wiring is in `src/routes/layout.css`. Static UI text uses Paraglide message catalogs. These are editable defaults, not restrictions on a consumer project.

## Optional modules

Add only the capabilities your application needs. **Requires** names the template or capability that must already be present; optional integrations compose with other modules.

<!-- MODULES-TABLE:START -->
| Package | What it adds | Requires | Optional integrations |
|---------|--------------|----------|----------------------|
| `@svforge/ui_toast` | Toast notifications (Skeleton Toast) | ui.skeleton | — |
| `@svforge/dnd` | Drag & drop sortable lists |  | — |
| `@svforge/tiptap` | Rich text editor (Tiptap, toolbar + preview) | ui.skeleton, i18n.messages | — |
| `@svforge/graph` | Knowledge graph visualization (force-graph) | ui.svforge | — |
| `@svforge/email` | Transactional emails (Resend) |  | — |
| `@svforge/oauth` | Social auth buttons (Google, GitHub) | auth.currentUser | ui.skeleton |
| `@svforge/uploads` | File uploads (S3-compatible POST hard limit, PUT best-effort fallback) | auth.currentUser, i18n.messages | ui.skeleton |
| `@svforge/blog` | MDsveX blog (posts + list + detail) | ui.svforge, i18n.messages | — |
| `@svforge/realtime` | WebSocket transport (publish/subscribe, channels isolés) | runtime.websocket | — |
| `@svforge/audit` | Business action audit trail (append-only) | database.drizzle.postgres, auth.currentUser, auth.admin, i18n.messages, ui.svforge | — |
| `@svforge/notifications` | Persistent business notifications (read/unread) | database.drizzle.postgres, i18n.messages | runtime.websocket |
| `@svforge/jobs` | Background job foundation (retry, progress, backend encapsulé) | database.drizzle.postgres, runtime.longLivedWorker | runtime.websocket |
| `@svforge/chat` | Composable app chat (conversations, messages, read-state) | database.drizzle.postgres, auth.currentUser, i18n.messages, ui.svforge | runtime.websocket, storage.object |
<!-- MODULES-TABLE:END -->

Presets are recipes over those same modules, not additional templates:

<!-- PRESETS-TABLE:START -->
| Preset | Description | Requires | Composition |
|--------|-------------|----------|-------------|
| `saas` | Dashboard SaaS de départ : auth + admin + email + uploads | **dashboard** | email + uploads (optional: tiptap, oauth, dnd) |
| `community` | Site communautaire : base + blog + toast | base | blog + ui_toast (optional: tiptap, graph) |
<!-- PRESETS-TABLE:END -->

```bash
# Base-compatible modules
npx sv add @svforge/blog @svforge/ui_toast

# After scaffolding the dashboard (auth + PostgreSQL capabilities)
npx sv add @svforge/uploads @svforge/notifications

# In a dashboard project
npx svforge preset saas
```

The tables come from the scaffolded `svforge-modules.json` contract. Regenerate them with `node scripts/gen-modules-table.mjs --write`.

## Project context and checks

A scaffold includes generated `AGENTS.md` conventions, `.svforge.json` project state, `llms.txt` context, and a component catalog/checker. `svforge check` checks the design-system and project conventions; `svforge context` synchronizes `.svforge.json`, the managed locale block in `AGENTS.md`, and `llms.txt` from `project.inlang/settings.json`.

Skeleton remains the default. A project can deliberately register another UI library:

```bash
npm install @acme/ui
npx svforge ui register @acme/ui --component-root src/lib/components/acme-ui
npx svforge ui prefer @acme/ui
```

Copy-in roots must be narrow directories under `src/lib/components/<library>`. Registration keeps project metadata and checker exemptions scoped to that library; unregistered project code remains checked.

Generated projects use `eslint-plugin-tailwindcss` to reject unknown static Tailwind classes. The separate `svforge-check.mjs` handles SVForge design-system rules and arbitrary spacing/radius guidance (WARN by default, blocking with `--strict`). Registered copy-in component roots receive scoped exemptions. See [upstream ownership and structural reuse](docs/structural-duplication.md) for the addon boundary, audited overlaps, and opt-in WARN-only copied-component detector.

## CLI plans

Inspect a deterministic, versioned plan before creating a project or adding modules:

```bash
npx svforge create my-app --template dashboard --pm npm --modules chat --plan --json
# From an existing dashboard project:
npx svforge add realtime --runtime long-lived-node --plan --json
```

Plan mode is non-interactive and side-effect free: it does not write project files, install packages, initialize Git, or invoke `sv`. Supply all required choices up front. Schema version 1 reports choices, explicit and supporting modules, capability requirements and gaps, runtime constraints, exact compatible package versions, commands, warnings, and conflicts. Exit status is `0` for a ready plan or no-op, `1` for a blocked plan, and `2` when `--json` is used without `--plan`. `--plan` without `--json` prints a human-readable summary.

Agents should inspect the JSON plan, explain the commands and conflicts, and get approval before running the same command without `--plan --json`; then finish with `svforge verify`. Create and add use the same resolvers and command builders for plan and apply. `svforge add` pins modules to the exact versions in the running CLI's compatibility manifest unless a local source or explicit version override was requested.

## Upgrade

`svforge upgrade <base|dashboard|module>` shows an explicit plan before applying updates. Use `--dry-run` to inspect changes without writing, or `--json` for machine-readable results. Consumer modifications are reported as conflicts rather than silently overwritten; `--force` backs up overwritten files.

## Optional Graphify setup

If Graphify is already installed, `svforge create --graphify` opts into project-scoped initialization. SVForge does not install Graphify or add a runtime dependency. Without the flag Graphify is untouched; if requested but unavailable, scaffolding continues.

## License

MIT
