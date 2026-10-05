<div align="center">

# SVForge

[![npm: svforge](https://img.shields.io/npm/v/svforge?label=svforge&logo=npm)](https://www.npmjs.com/package/svforge)
[![npm: @svforge/addon-kit](https://img.shields.io/npm/v/@svforge/addon-kit?label=@svforge%2Faddon-kit&logo=npm)](https://www.npmjs.com/package/@svforge/addon-kit)
[![npm: @svforge/chat](https://img.shields.io/npm/v/@svforge/chat?label=@svforge%2Fchat&logo=npm)](https://www.npmjs.com/package/@svforge/chat)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Production-ready foundations for SvelteKit projects.**

Start with SvelteKit. Add a solid project structure, a design system, auth/data foundations, optional modules, and context that helps coding agents reuse what is already there.

[Getting started](#getting-started) · [Templates](#templates) · [Modules](#modules) · [AI-ready](#ai-ready) · [Contributing](CONTRIBUTING.md)

</div>

---

## What SVForge is

SVForge is a collection of [`sv`](https://github.com/sveltejs/cli) community addons for building SvelteKit applications without rebuilding the same foundations on every project.

It **does not replace SvelteKit** and it is not a framework on top of it. Your project stays a normal SvelteKit app.

SVForge adds the pieces around it:

- a coherent application structure and design-system conventions;
- Skeleton UI + Tailwind foundations;
- Paraglide i18n from day one (FR/EN initial locales);
- Vitest and quality gates;
- a dashboard starter with Better Auth, Drizzle and PostgreSQL;
- composable modules for common application capabilities;
- machine-readable project context for coding agents.

The generated source belongs to your project. There is no opaque application runtime to depend on after scaffolding.

## Getting started

Create a SvelteKit project, then apply an SVForge template:

```bash
npx sv create my-app
cd my-app

# Lightweight application foundation
npx sv add svforge=template:base+testing:vitest

# Or a full application/dashboard foundation
npx sv add svforge=template:dashboard+testing:vitest
```

For the dashboard template, configure PostgreSQL and the generated environment:

```bash
bash scripts/setup.sh
npm run dev  # or bun/pnpm/yarn equivalent
```

The dashboard uses a standard `DATABASE_URL`, so local PostgreSQL, a server you manage, or a managed PostgreSQL provider all fit the same project structure.

## Templates

SVForge intentionally keeps the template surface small.

### `base`

A clean starting point for SvelteKit applications:

- Svelte 5 + TypeScript
- Skeleton UI + Tailwind CSS
- canonical `primitives / ui / layout` component structure
- complete Skeleton v5 theme and dark mode foundations
- one global CSS entrypoint (`src/routes/layout.css`)
- Paraglide with FR + EN catalogs
- SEO + sitemap helpers
- Vitest baseline
- generated agent/project context

The CSS surface is deliberately small: `src/routes/layout.css` only wires Tailwind, Skeleton, fonts and plugins, while `src/lib/styles/svelteforge-theme.css` is the visual source of truth. SVForge does not scaffold a generic `tokens.css` or style barrel by default; local layout and whitespace use normal Tailwind utilities. Project-specific token/effect layers can be introduced later when a concrete repeated need justifies them.

Use `base` when the application does not need the full authenticated dashboard foundation.

### `dashboard`

Everything in `base`, plus the standard full-stack foundation:

- Better Auth
- Drizzle ORM
- PostgreSQL
- authenticated app layout
- admin dashboard and user management
- Zod validation patterns
- database setup scripts
- real scaffold checks against PostgreSQL

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="SVForge dashboard" width="760" />
</p>

## Compose only what the project needs

Modules are normal `sv` addons. Add them when the product needs them:

```bash
npx sv add @svforge/realtime
npx sv add @svforge/uploads
npx sv add @svforge/notifications
```

Or compose several capabilities into the same project:

```bash
npx sv add \
  @svforge/chat \
  @svforge/realtime \
  @svforge/uploads \
  @svforge/notifications
```

Modules copy their implementation into the application and integrate with the existing SVForge conventions instead of creating a parallel architecture.

## Modules

### Foundations

- **`@svforge/realtime`** — WebSocket transport, channels, authorization, reconnect and subscriptions.
- **`@svforge/audit`** — append-only business audit trail with admin history.
- **`@svforge/jobs`** — small PostgreSQL-backed background job runner with retries and progress.
- **`@svforge/email`** — transactional email through Resend.
- **`@svforge/uploads`** — S3/R2 presigned uploads with server-side validation.
- **`@svforge/oauth`** — Google/GitHub social authentication for dashboard projects.

### Application features

- **`@svforge/notifications`** — persistent in-app notifications with read/unread state.
- **`@svforge/chat`** — conversations, participants, messages and per-user read state.
- **`@svforge/blog`** — MDsveX blog foundation.

### UI and editing

- **`@svforge/ui_toast`** — Skeleton-based toast feedback.
- **`@svforge/dnd`** — sortable drag-and-drop UI.
- **`@svforge/tiptap`** — rich-text editor, toolbar and sanitized preview.
- **`@svforge/graph`** — interactive knowledge-graph visualization.

The goal is not to ship mini SaaS products inside the boilerplate. Modules cover the reusable first part of a capability and leave product-specific behavior in the application.

## Presets are recipes, not more templates

Presets bundle a useful composition without duplicating module code or multiplying the template matrix.

```bash
# Dashboard + common SaaS foundations
npx svforge preset saas

# Base + community/content foundations
npx svforge preset community
```

A preset only gives you the composition to apply. The actual project is still built from the same `base` / `dashboard` templates and the same standalone modules.

## A design system that agents can follow

Canonical shared components live under:

```text
src/lib/components/svforge/
├── primitives/
├── ui/
└── layout/
```

The reuse order is explicit:

1. SVForge primitives
2. SVForge UI components
3. SVForge layouts
4. Skeleton UI
5. create something new only when no existing component fits

For global visual decisions, the same rule applies: use the Skeleton theme and presets first. Do not create a parallel palette/token layer simply to restyle the scaffold.

`svforge check` keeps Skeleton as the default, reports likely unregistered UI packages as actionable warnings, and still enforces duplicate Skeleton primitives, invalid utilities, theme drift, and project structure. A human may select another UI/headless library explicitly.

## Defaults vs constraints

The templates ship opinionated defaults so a scaffold renders, builds and type-checks immediately. They are **starting points, not framework constraints** — each one has a single identified source of truth:

| Concern | Scaffolded default | Source of truth (edit here) |
|---------|--------------------|-----------------------------|
| Palette / theme | complete Skeleton v5 theme (`svelteForge`) | `src/lib/styles/svelteforge-theme.css` |
| Fonts | Inter (body), Space Grotesk (headings), Fira Code (code) | `src/routes/layout.css` (`@fontsource-variable/*` imports) |
| UI copy locales | `fr` (baseLocale) + `en` catalogs | `messages/<locale>.json` + `project.inlang/settings.json` |

**Theme** — the palette, surfaces, radius and typography roles are ordinary Skeleton v5 theme values. Replace them directly in `svelteforge-theme.css`; nothing else in the architecture changes.

**Fonts** — the three `@fontsource-variable/*` imports in `src/routes/layout.css` are the only place fonts are declared (Space Grotesk and Inter are mapped to heading/body roles in the theme; Fira Code is mapped to the native `--font-mono` token in the `@theme` block of `src/routes/layout.css` — Skeleton's own code/pre/kbd styles (and Tailwind's `font-mono` utility) consume it, with no global `code`/`pre` overrides). Swap an import and its role mapping to change a font, or delete both to drop one.

**i18n (Paraglide)** — `messages/<locale>.json` catalogs are the AI-first, diffable source of truth for static UI copy. Components consume the generated messages; agents and humans edit the JSON, never the generated `src/lib/paraglide/` output. `fr` and `en` are the initial locale set, not the only supported locales:

- **add a locale** (example: Spanish) — create `messages/es.json` with the full key set, then add `"es"` to `locales` in `project.inlang/settings.json`;
- **remove a locale** — delete its catalog and its `locales` entry;
- **change the base locale** — edit `baseLocale` in `project.inlang/settings.json`.

Keep key parity across every configured locale (a key exists in all catalogs or none). Modules ship their message keys for the scaffolded locales (`fr`/`en`); when you add a locale, port the installed modules' keys into the new catalog. Static UI copy lives in the catalogs; long-form editorial, business and CMS content (MDsveX posts, database records) belongs in its own storage, not in `messages/`.

## AI-ready

SVForge projects carry their own implementation context so an agent can inspect the project before inventing architecture.

A scaffold includes:

- **`AGENTS.md`** — project conventions and implementation rules (canonical agent instructions);
- **`.svforge.json`** — machine-readable template/modules/capabilities state;
- **`llms.txt`** — concise context generated from the project state;
- **`svforge-catalog.json`** — reusable component catalog;
- **`svforge-modules.json`** — module metadata and composition information.

## Agent instruction support (#347)

**Decision: AGENTS.md is the sole agent convention of a SvelteForge project.** Every convention an agent needs — positioning, valid Skeleton v5 classes, reuse order, design-system contract, i18n rules — is scaffolded in one `AGENTS.md` file at the project root. There is exactly one file to read and one file to edit.

SVForge scaffolds no tool-specific instruction file (no Claude, Gemini, Copilot, or Cursor variant) and ships no synchronization or drift machinery. Whether a given tool loads `AGENTS.md` automatically is that tool's own feature — SVForge does not claim generic tool support.

These instructions are **advisory**: they tell agents what to prefer. Mechanical enforcement stays in `svforge check` (duplicated primitives and invalid utilities remain blocking; unregistered UI packages are warnings) and in `svelte-check`/tests. Instruction files are never the only guardrail, and `svforge check` does not depend on them.

To deliberately select a UI library, install it first and then register it so the project manifest, `llms.txt`, generated `AGENTS.md`, and checker exemptions stay in sync:

```bash
npx svforge ui register @acme/ui --component-root src/lib/components/acme-ui
npx svforge ui prefer @acme/ui
```

Omit `--component-root` for packages consumed directly from imports. Only registered copy-in component roots receive scoped design-system/lint exemptions; other project code remains checked.

Typical workflow:

```text
PRD / feature request
        ↓
read AGENTS.md + llms.txt + .svforge.json
        ↓
reuse existing components and modules
        ↓
implement product-specific code
        ↓
svforge check + svelte-check + tests + build
```

Useful commands:

```bash
# Validate SVForge design-system/project rails
svforge check

# Regenerate llms.txt from the project manifest
svforge context

# Explicit, reviewable template upgrade (plan → diff → apply)
svforge upgrade base --dry-run
svforge upgrade base
svforge upgrade dashboard
svforge upgrade blog        # every module shares the same protocol
```

Upgrades are intentionally conservative: generated files are owned by the consumer project, locally modified files are never silently overwritten (conflicts come with a readable diff), and `--dry-run` / `--json` let you inspect the exact plan before anything is written.


## Boring by design

SVForge favors standard pieces that can survive the lifetime of an application:

- SvelteKit stays the application framework.
- PostgreSQL stays a normal PostgreSQL database.
- Drizzle stays behind application/domain code rather than becoming the architecture.
- Better Auth handles authentication instead of a custom auth layer.
- Skeleton provides the UI foundation instead of introducing another component system.
- Modules are optional and composable; templates do not multiply for every feature combination.

This keeps generated projects understandable by a developer who knows the underlying tools, even without knowing SVForge first.

## Quality gates

The repository tests both source-level contracts and **real generated consumer projects**.

Permanent scaffold profiles cover the base/dashboard templates, Playwright, Blog, the newer dashboard foundations, historical UI modules, and dashboard integrations. PostgreSQL-backed profiles run against a real database in CI, and an ecosystem canary regularly exercises the addons against current upstream tooling.

The publish workflow uses the same scaffold gates before package publication.

The Better Auth stack is pinned (never `latest`) and bumped manually in a normal PR. CI validates every bump with the dashboard scaffold (real PostgreSQL), the schema/runtime smoke and the Better Auth stack audit. See [docs/better-auth-upgrades.md](docs/better-auth-upgrades.md) (#319, #460).

## Repository

```text
packages/
├── svforge/          # base + dashboard templates and CLI helpers
├── addon-kit/        # @svforge/addon-kit — shared upgrade/recipe engine
├── realtime/
├── audit/
├── notifications/
├── jobs/
├── chat/
├── email/
├── uploads/
├── oauth/
├── blog/
├── tiptap/
├── dnd/
├── graph/
└── ui_toast/
```

Each module is independently packaged and owns the source it adds to a consumer project.

## Development

```bash
bun install
bun test
bun run --filter '*' build

# Test an actual generated project
bash scripts/test-scaffold.sh base
bash scripts/test-scaffold.sh dashboard
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for repository conventions and [docs/RELEASE.md](docs/RELEASE.md) for the release process.

## Security

Found a vulnerability? **Do not open a public issue.** Report it privately
through [GitHub security advisories](https://github.com/lelabdev/svelteforge/security/advisories/new)
— supported versions, response targets, safe-harbor boundaries, and guidance
for leaked credentials or generated-project issues are documented in
[SECURITY.md](SECURITY.md).

## License

MIT
