<div align="center">

# SVForge

[![npm: svforge](https://img.shields.io/npm/v/svforge?label=svforge&logo=npm)](https://www.npmjs.com/package/svforge)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**SvelteKit foundations you can build on.**

SVForge extends the official [Svelte CLI](https://github.com/sveltejs/cli) with an editable Skeleton-based UI, optional application foundations, and composable modules. Start with SvelteKit, keep the generated source, and add only what your project needs.

[Get started](#quick-start) · [Choose a template](#templates) · [Explore modules](#optional-modules) · [Documentation](packages/svforge/README.md) · [Website](https://svforge.dev)

</div>

## Quick start

Create a project with the SVForge CLI:

```bash
npx svforge create my-app --template base
cd my-app
npm run dev
```

`svforge create` orchestrates the official `sv create` and `sv add` commands. It is **not** a separate SvelteKit generator.

Prefer using the Svelte CLI directly? The same foundations are available as an `sv` community addon:

```bash
npx sv create my-app
cd my-app
npx sv add svforge=template:base+testing:vitest
npm run dev
```

For authentication, a database, and protected administration routes, start with the dashboard instead:

```bash
npx svforge create my-dashboard --template dashboard
cd my-dashboard
bash scripts/setup.sh
npm run dev
```

The dashboard requires PostgreSQL and environment configuration; check the generated `.env.example` and the [dashboard setup guide](packages/svforge/README.md#install).

## Svelte first, SVForge where it adds value

SVForge is a **starter and collection of optional addons**, not a new framework, component library, or replacement for the Svelte toolchain.

| Official Svelte tooling | SVForge |
| --- | --- |
| `sv create` creates the SvelteKit application | Adds editable `base` and `dashboard` project foundations |
| Official `sv add` addons provide general integrations when they compose safely | Adds Skeleton UI conventions, FR/EN Paraglide content, and product-specific modules |
| `sv migrate` handles Svelte and SvelteKit migrations | `svforge upgrade` handles only SVForge-owned recipes |
| SvelteKit controls runtime and deployment | Adds project checks and context for developers and coding agents |

The goal is to **reuse upstream tools, not duplicate them**. Your generated app remains a normal SvelteKit project; you own its source and can adapt or remove the SVForge defaults.

## Templates

| Starting point | What you get |
| --- | --- |
| **`base`** | Svelte 5, Skeleton UI, Tailwind CSS, theme and dark mode, layouts, SEO, Paraglide FR/EN, and Vitest |
| **`dashboard`** | Everything in base, plus Better Auth, Drizzle/PostgreSQL, guarded admin routes, user management, and setup scripts |

Both are starting points rather than fixed application architectures. The dashboard does not enable public sign-up by default; see the [template and authentication details](packages/svforge/README.md#templates).

![SVForge dashboard preview](docs/screenshots/dashboard.png)

## Optional modules

Install only the capabilities you need using the same official addon workflow:

```bash
# In a base project
npx sv add @svforge/blog @svforge/ui_toast

# In a dashboard project with the required auth/database foundations
npx sv add @svforge/uploads @svforge/notifications
```

Available capabilities include blog, rich-text editing, email, OAuth, uploads, notifications, audit logs, jobs, realtime, chat, drag-and-drop, graph visualization, and toast notifications. Modules declare their prerequisites; some require PostgreSQL, authentication, or a long-lived Node runtime.

Want a predefined combination? `svforge preset saas` composes dashboard-compatible modules; `svforge preset community` composes base-compatible modules. See the [complete module matrix](packages/svforge/README.md#optional-modules) and [deployment profiles](packages/svforge/docs/deployment-profiles.md) before selecting runtime-dependent modules.

## Built for developers and coding agents

Generated projects include `AGENTS.md`, `.svforge.json`, `llms.txt`, and a component catalog/checker so developers and agents can discover existing conventions and reuse components instead of inventing parallel UI patterns.

```bash
npx svforge check
npx svforge context
npx svforge upgrade base --dry-run
```

`svforge check` validates project/design-system conventions. `svforge context` refreshes managed project context, while `svforge upgrade` previews or applies changes to SVForge-owned recipes and reports conflicts with user edits. Use the official `sv migrate` for SvelteKit framework migrations.

Read the [CLI and project guide](packages/svforge/README.md#project-context-and-checks) for the full behavior and options.

## Contributing

SVForge is a Bun workspace containing the CLI, templates, and independently packaged addons. To work on the repository:

```bash
bun install
bun run build:all
bun run test
bun run lint
bun run typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, PRs, and checks, and [the upstream ownership guide](packages/svforge/docs/structural-duplication.md) for decisions about official Svelte integrations. Release and versioning procedures are maintained in [docs/RELEASE.md](docs/RELEASE.md).

## Security

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/lelabdev/svforge/security/advisories/new), not public issues. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
