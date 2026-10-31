<div align="center">

# SVForge

[![npm: svforge](https://img.shields.io/npm/v/svforge?label=svforge&logo=npm)](https://www.npmjs.com/package/svforge)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Create and extend SvelteKit apps with foundations you can actually edit.**

SVForge is a CLI for SvelteKit projects: start with a ready-to-use UI or dashboard, add only the features you need, and keep ownership of the generated code. It uses the official Svelte CLI under the hood; it is **not** a separate framework or just an `sv` addon.

[Quick start](#quick-start) · [Templates](#choose-a-template) · [Modules](#add-modules) · [Docs](packages/svforge/docs/usage-guide.md)

</div>

## Quick start

Create a Base project with Skeleton UI, Tailwind CSS, theming, FR/EN internationalization and tests:

```bash
npx svforge create my-app --template base
cd my-app
npm run dev
```

No global installation is required. The result is a regular, editable SvelteKit project. For fresh SvelteKit 3 projects, use Node.js 22.17 or later.

## Choose a template

| | Base | Dashboard |
| --- | --- | --- |
| **Built in** | Skeleton UI, Tailwind, theme, layouts, SEO, FR/EN, tests | Everything in Base, plus Better Auth, Drizzle/PostgreSQL, protected admin routes and user management |
| **Best for** | Websites and custom apps | Apps needing accounts, a database and administration |

To create a Dashboard:

```bash
npx svforge create my-dashboard --template dashboard
cd my-dashboard
bash scripts/setup.sh
```

Before starting, **run PostgreSQL and set `DATABASE_URL` in `.env`**. Then prepare the authentication schema and database:

```bash
npm run auth:schema
npm run db:push
npm run dev
```

Dashboard registration is **closed by default**. Create the first administrator through `/setup` in development or `npm run admin:create`. See the [Dashboard setup instructions](packages/svforge/docs/usage-guide.md#install) for details before changing a real database.

## Add modules

In a generated project, add features with the SVForge CLI:

```bash
npx svforge add blog ui_toast
```

Modules include a blog, rich-text editor, uploads, OAuth, email, notifications, chat, jobs, audit logging, realtime, drag and drop, and graphs. Some require authentication, PostgreSQL or a long-lived Node.js runtime. SVForge checks module prerequisites and compatible versions.

See the [complete module list and requirements](packages/svforge/docs/usage-guide.md#optional-modules).

## Check and evolve your project

SVForge generates editable files plus project conventions for developers and coding agents (`AGENTS.md`, `.svforge.json`, and `llms.txt`).

```bash
npx svforge doctor
npx svforge check
npx svforge upgrade base --dry-run
```

SVForge can also be used as an `sv add` community addon. For manual official-first installation, advanced configuration and upgrade behavior, see the [full usage guide](packages/svforge/docs/usage-guide.md). Use the official `sv migrate` for framework migrations.

## Documentation

- [Full usage guide](packages/svforge/docs/usage-guide.md) — manual installation, dashboard setup, modules and upgrades
- [Deployment requirements](packages/svforge/docs/deployment-profiles.md) — static, server and worker constraints
- [SvelteKit compatibility](packages/svforge/docs/sveltekit-compatibility.md) — tested versions and migrations

## Contributing

This repository contains the SVForge CLI, the template sources and separately versioned `@svforge/*` addons. To contribute, follow [CONTRIBUTING.md](CONTRIBUTING.md). Release instructions are in [docs/RELEASE.md](docs/RELEASE.md).

## Security and license

Report security issues privately using [GitHub Security Advisories](https://github.com/lelabdev/svforge/security/advisories/new); see [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).
