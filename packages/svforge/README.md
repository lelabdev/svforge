# SVForge

**sv community addon** — production-ready foundations for SvelteKit projects.

SVForge starts from a normal SvelteKit app and adds the pieces you would otherwise rebuild on every project: a coherent application structure and design-system conventions, Skeleton UI v5 + Tailwind CSS v4, Paraglide i18n (FR/EN initial locales), Vitest quality gates, and an optional admin dashboard with Better Auth + Drizzle ORM + PostgreSQL. It **does not replace SvelteKit** — the generated source belongs to your project, there is no opaque runtime to depend on after scaffolding.

**Not a component library. Not a shadcn clone.** SVForge gives you the essentials — buttons, inputs, selects, cards, badges, theme, SEO, layouts — so you start fast and own everything. For richer components (dialog, tabs, tooltip, date-picker…), use the official [`@skeletonlabs/skeleton-svelte`](https://skeleton.dev) components directly.

Choose a target before architecture work: see [deployment profiles](docs/deployment-profiles.md) for Node, serverless, edge, and separate-worker constraints.

### CLI compatibility

SVForge and its modules support `sv` 1.x from `1.1.0` (`^1.1.0` peer range). Real user journeys and scaffold builds are validated against `sv@1.1.0`, including the SvelteKit 3 project it generates.

## Install

Create a SvelteKit project, then apply a template:

```bash
# Base template (UI kit + layouts + theme)
npx sv create my-app
cd my-app
npx sv add svforge=template:base+testing:vitest
npm run dev  # or your package manager's dev command

# Dashboard template (base + auth + DB + admin)
npx sv create my-app
cd my-app
npx sv add svforge=template:dashboard+testing:vitest
bash scripts/setup.sh && npm run dev  # or your package manager's dev command

# Dashboard with the opt-in Playwright browser profile
npx sv add svforge=template:dashboard+testing:playwright
npx playwright install && npm run test:e2e  # or your package manager's equivalent
```

`sv create` also accepts the addon at creation time:

```bash
npx sv create my-app --template minimal --types ts --add 'svforge=template:base+testing:vitest' --install bun --no-download-check
```

Or add to an existing SVForge project:
```bash
npx sv add svforge   # prompts: base or dashboard
```

Dashboard projects include the Vitest baseline by default (`bun run test`).
The Playwright profile is opt-in with `testing:playwright`; it adds
`@playwright/test`, the `test:e2e` script, browser configuration, and E2E tests.

## What you get

### Base Template

- **UI kit** — Button, Card, Badge, Alert, Input, Select, Textarea, Checkbox, Toggle, Table
- **Layout** — Navbar, Footer, ThemeToggle
- **Utils** — Logo, Seo, generateSitemap(), cn()
- **SVForge theme** — complete Skeleton v5 theme with custom oklch palettes
- **Minimal CSS architecture** — `src/routes/layout.css` is the single global CSS entrypoint and imports `src/lib/styles/svelteforge-theme.css` directly
- **No generic token layer** — no scaffolded `tokens.css` or style barrel; use Skeleton for visual theme decisions and standard Tailwind utilities for local layout/spacing
- **Dark/light mode** — auto-detects system preference, manual toggle
- **Demo page** at `/demo-ui`

Project-specific token/effect layers are intentionally not pre-created. Add them later only when a concrete repeated product need is not already covered by Skeleton or Tailwind.

### Dashboard Template

Everything in Base, plus:

- **Better Auth** — email/password, session management
- **Drizzle ORM + PostgreSQL** (`pg-core` + `postgres` driver) — user/session/account/verification schema + app tables
- **Admin dashboard** — stats, user management (CRUD), settings
- **Zod validation** — type-safe schemas on all server actions
- **Setup script** — `bash scripts/setup.sh` (generates secret, inits DB)
- **Pre-configured** — drizzle.config.ts, .env.example, tsconfig

## Defaults vs constraints

The scaffolded palette, fonts and locales are **ready-made defaults, not framework constraints** — each has one identified source of truth in the generated project:

- **Theme**: the complete Skeleton v5 palette/theme in `src/lib/styles/svelteforge-theme.css` is SVForge's default theme. Replace its values (or point the import at another Skeleton v5 theme) without changing the architecture.
- **Fonts**: Inter, Space Grotesk and Fira Code are declared only by the `@fontsource-variable/*` imports in `src/routes/layout.css` and mapped to roles (body/headings/code) by the theme. Change or remove them there.
- **Locales**: `messages/<locale>.json` catalogs are the AI-first source of truth for static UI copy — edit the JSON, never the generated `src/lib/paraglide/` output. `fr` (baseLocale) and `en` are the initial locales, not a limit: add or remove a locale via `messages/*.json` + `project.inlang/settings.json` (one catalog + one `locales` entry per locale), and change `baseLocale` in the same settings file. Keep key parity across every configured locale; modules ship their message keys for the scaffolded locales (fr/en) — port them into any locale you add. Static UI copy stays in the catalogs — long-form editorial, business and CMS content belongs elsewhere (MDsveX, database).

## Module Addons

Composable opt-in modules — pick 2–3 as needed. **Requires** = template to scaffold first (`base` or `dashboard`); **Optional integrations** compose with other modules:

<!-- MODULES-TABLE:START -->
| Package | What it adds | Requires | Optional integrations |
|---------|--------------|----------|----------------------|
| `@svforge/ui_toast` | Toast notifications (Skeleton Toast) | base | — |
| `@svforge/dnd` | Drag & drop sortable lists | base | — |
| `@svforge/tiptap` | Rich text editor (Tiptap, toolbar + preview) | base | — |
| `@svforge/graph` | Knowledge graph visualization (force-graph) | base | — |
| `@svforge/email` | Transactional emails (Resend) | base | — |
| `@svforge/oauth` | Social auth buttons (Google, GitHub) | **dashboard** | — |
| `@svforge/uploads` | File uploads (S3/R2, presigned, security test pack opt-in) | base | testpack |
| `@svforge/blog` | MDsveX blog (posts + list + detail) | base | — |
| `@svforge/realtime` | WebSocket transport (publish/subscribe, channels isolés) | base | — |
| `@svforge/audit` | Business action audit trail (append-only) | **dashboard** | — |
| `@svforge/notifications` | Persistent business notifications (read/unread) | **dashboard** | realtime, email |
| `@svforge/jobs` | Background job foundation (retry, progress, backend encapsulé) | **dashboard** | realtime, notifications, email |
| `@svforge/chat` | Composable app chat (conversations, messages, read-state) | **dashboard** | realtime, uploads, notifications |
<!-- MODULES-TABLE:END -->

Presets are composition recipes (`npx svforge preset <name>`):

<!-- PRESETS-TABLE:START -->
| Preset | Description | Requires | Composition |
|--------|-------------|----------|-------------|
| `saas` | Dashboard SaaS de départ : auth + admin + email + uploads | **dashboard** | email + uploads (optional: tiptap, oauth, dnd) |
| `community` | Site communautaire : base + blog + toast | base | blog + ui_toast (optional: tiptap, graph) |
<!-- PRESETS-TABLE:END -->

```bash
npx sv add @svforge/ui_toast
npx sv add @svforge/uploads
npx sv add @svforge/chat
npx sv add @svforge/jobs
```

The machine-readable contract (`svforge-modules.json`) is the single source of truth — this table is generated, see `scripts/gen-modules-table.mjs`.

## AI-ready workflow

Every scaffold is agent-ready: `AGENTS.md` (conventions), `.svforge.json`
(machine-readable manifest: template, stack, modules, capabilities, patterns),
`llms.txt` (LLM summary), `svforge-catalog.json` + `svforge-check.mjs`
(design-system harness). Modules merge their capability into the manifest and
`llms.txt` at install time. Skeleton remains the default; projects can deliberately
select any installed UI/headless package without a hard-blocking second-kit rule:

```bash
npm install @acme/ui
npx svforge ui register @acme/ui --component-root src/lib/components/acme-ui
npx svforge ui prefer @acme/ui
```

Registration updates `.svforge.json`, `llms.txt`, and the generated UI-strategy
block in `AGENTS.md`. `svforge check` guides on likely unregistered UI usage;
registered copy-in roots receive scoped checker and ESLint exemptions.

## Tailwind arbitrary values

The design-system checker is the single policy for arbitrary spacing and radius
values. The Tailwind v4 ESLint plugin was evaluated but is not installed: its
rules either reject accepted structural values or miss non-scale spacing/radius
values. See [the evaluation record](docs/tailwind-linting.md).

## Upgrade

`svforge upgrade <base|dashboard|module>` migrates an installed project to the
latest recipe — src files, ROOT files, dependencies, scripts and JSON — through
one diffable protocol shared by base, dashboard and the 13 standalone modules.

```
svforge upgrade base                 # apply the migration
svforge upgrade base --dry-run       # plan + diff, write NOTHING
svforge upgrade base --json          # machine-readable plan/result
svforge upgrade blog --force         # overwrite user-modified files (backed up)
```

**How it works (#327):**

1. **Install writes the baseline.** A fresh scaffold (or module install)
   records `.svforge-versions.json`: the recipe version + a SHA-256 checksum of
   every delivered file. The first upgrade already has a real baseline.
2. **Plan before any write.** The engine computes the full operation list —
   `add`, `modify`, `delete`, `move`, `dependency`, `script`, JSON
   transformation — each with a readable diff, and only then touches disk.
3. **Conflicts come from the baseline.** A file that still matches what svforge
   installed is updated; a file that diverges from the baseline is a *user
   modification* (#283) — reported as a conflict with its diff, never
   overwritten without `--force`.
4. **Atomic apply, versioned backups.** Overwritten content is backed up under
   `.svforge-backup/<recipe>/<timestamp>-<version>/` (successive upgrades never
   overwrite a previous backup). Any mid-apply failure rolls every write back:
   applied atomically or not at all.

Recipes are generated from the actually shipped packages (#283): the version
announced by the command cannot drift from the shipped code, and release notes
between the installed and target versions come from the structured changelog.
Legacy `.svforge-versions.json` files (32-bit hashes, pre-#327) degrade safely:
their entries read as "no baseline", i.e. the conservative skip behavior.

## License

MIT
