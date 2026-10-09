# SVForge

SVForge is an [`sv`](https://github.com/sveltejs/cli) community addon that adds production-ready foundations to a normal SvelteKit project. It is a starter, not a component library or a shadcn/ui clone: the generated source belongs to your project, and richer UI components come directly from [`@skeletonlabs/skeleton-svelte`](https://skeleton.dev).

SVForge supports `sv` 1.x (`^1.1.0`). Choose a deployment target before adding runtime modules; see [deployment profiles](docs/deployment-profiles.md).

## Install

```bash
# Base UI and application foundations
npx sv create my-app
cd my-app
npx sv add svforge=template:base+testing:vitest
npm run dev

# Or use the dashboard with Better Auth, PostgreSQL, and Drizzle
npx sv create my-dashboard
cd my-dashboard
npx sv add svforge=template:dashboard+testing:vitest
bash scripts/setup.sh
npm run dev
```

Dashboard projects use PostgreSQL. Configure the generated `.env` using `.env.example` before starting the app. Playwright is an optional profile:

```bash
npx sv add svforge=template:dashboard+testing:playwright
npx playwright install
npm run test:e2e
```

You can also add SVForge during `sv create`, or run `npx sv add svforge` in an existing project to choose a template.

## Templates

- **`base`** — Skeleton UI and Tailwind, reusable foundations (`Button`, `Input`, `Select`, `Card`, `Badge`, `Table`), theme and dark mode, SEO, Paraglide FR/EN, and Vitest.
- **`dashboard`** — base plus Better Auth, PostgreSQL/Drizzle, protected admin routes, user management, and setup scripts.

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
npx sv add @svforge/blog @svforge/uploads
npx svforge preset saas
```

The tables come from the scaffolded `svforge-modules.json` contract. Regenerate them with `node scripts/gen-modules-table.mjs --write`.

## Project context and checks

A scaffold includes generated `AGENTS.md` conventions, `.svforge.json` project state, `llms.txt` context, and a component catalog/checker. `svforge check` checks the design-system and project conventions; `svforge context` regenerates `llms.txt`.

Skeleton remains the default. A project can deliberately register another UI library:

```bash
npm install @acme/ui
npx svforge ui register @acme/ui --component-root src/lib/components/acme-ui
npx svforge ui prefer @acme/ui
```

Copy-in roots must be narrow directories under `src/lib/components/<library>`. Registration keeps project metadata and checker exemptions scoped to that library; unregistered project code remains checked.

Generated projects use `eslint-plugin-tailwindcss` to reject unknown static Tailwind classes. The separate `svforge-check.mjs` handles SVForge design-system rules and arbitrary spacing/radius guidance (WARN by default, blocking with `--strict`). Registered copy-in component roots receive scoped exemptions. See [structural duplication](docs/structural-duplication.md) for the opt-in WARN-only copied-component detector.

## Upgrade

`svforge upgrade <base|dashboard|module>` shows an explicit plan before applying updates. Use `--dry-run` to inspect changes without writing, or `--json` for machine-readable results. Consumer modifications are reported as conflicts rather than silently overwritten; `--force` backs up overwritten files.

## Optional Graphify setup

If Graphify is already installed, `svforge create --graphify` opts into project-scoped initialization. SVForge does not install Graphify or add a runtime dependency. Without the flag Graphify is untouched; if requested but unavailable, scaffolding continues.

## License

MIT
