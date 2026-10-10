<div align="center">

# SVForge

[![npm: svforge](https://img.shields.io/npm/v/svforge?label=svforge&logo=npm)](https://www.npmjs.com/package/svforge)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Production-ready foundations for SvelteKit projects.**

Build on a normal SvelteKit app with a Skeleton-based design system, optional full-stack foundations, and composable modules. Generated source belongs to your project.

[Quick start](#quick-start) · [Templates](#templates) · [Modules](#modules) · [Contributing](CONTRIBUTING.md)

</div>

## Quick start

```bash
npx sv create my-app
cd my-app
npx sv add svforge=template:base+testing:vitest
npm run dev
```

Choose `template:dashboard` for the Better Auth, Drizzle, PostgreSQL, and admin foundation. Configure its environment with `bash scripts/setup.sh` before running it. Full install options and current package details are in [`packages/svforge/README.md`](packages/svforge/README.md).

## Templates

| Template | Includes |
| --- | --- |
| `base` | SvelteKit, Skeleton UI, Tailwind CSS, FR/EN Paraglide, theme, layouts, SEO, and Vitest |
| `dashboard` | Base plus Better Auth, Drizzle, PostgreSQL, protected admin routes, and setup scripts |

The base template is intentionally small. Rich UI components come from the official `@skeletonlabs/skeleton-svelte` package; optional product capabilities are separate addons.

![SVForge dashboard](docs/screenshots/dashboard.png)

## Modules

Add only what an application needs, for example:

```bash
npx sv add @svforge/blog @svforge/ui_toast
```

Modules include email, uploads, OAuth, realtime, jobs, audit, notifications, chat, blog, rich text, drag-and-drop, toast, and graph visualization. See the [package guide](packages/svforge/README.md#optional-modules) for the current list and requirements. Presets are recipes over the same templates and modules: `saas` requires a dashboard project; `community` requires a base project.

```bash
# In a dashboard project
npx svforge preset saas
# In a base project
npx svforge preset community
```

## Generated project context

Projects include an `AGENTS.md`, `.svforge.json`, `llms.txt`, and the design-system catalog/checker. These help agents inspect the project and reuse its existing components; they are generated-project assets, not instructions for this repository. `svforge check` validates the project, and `svforge context` synchronizes `.svforge.json`, the managed locale block in `AGENTS.md`, and `llms.txt` from `project.inlang/settings.json`.

## Repository

```text
packages/svforge/   templates, CLI, and project checks
packages/*/         independently packaged addons
packages/addon-kit/ shared addon utilities
```

```bash
bun install
bun run build:all
bun run test
bun run lint
bun run typecheck
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the short development workflow and [`docs/RELEASE.md`](docs/RELEASE.md) for the sole release and versioning procedure.

## Security

Do not report vulnerabilities in public issues. Use [GitHub Security Advisories](https://github.com/lelabdev/svforge/security/advisories/new); see [`SECURITY.md`](SECURITY.md) for response targets and reporting guidance.

## License

MIT
