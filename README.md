<div align="center">

<img src="packages/svforge/brand/android-chrome-192x192.png" alt="SVForge icon" width="76">

# SVForge

**Your SvelteKit starting point. Your code, your choices.**

Create an app, add what you need, and keep the generated source.
SVForge is a CLI that builds on the official Svelte tooling — not a separate framework.

[![npm version](https://img.shields.io/npm/v/svforge?logo=npm&label=npm)](https://www.npmjs.com/package/svforge)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Get started](#quick-start) · [Choose a template](#choose-your-foundation) · [Add modules](#add-only-what-you-need) · [Docs](packages/svforge/docs/usage-guide.md)

</div>

---

### Create · Compose · Evolve

| **Create a project** | **Add capabilities** | **Keep it healthy** |
| :--- | :--- | :--- |
| `svforge create` | `svforge add` | `svforge check` / `upgrade` |
| Editable UI or dashboard | Optional, compatible modules | Checks and upgrade previews |

## Quick start

Start a SvelteKit app with Skeleton UI, Tailwind CSS, theming and FR/EN content:

```bash
npx svforge create my-app --template base
cd my-app
npm run dev
```

That's it for **Base**. No global install; you own the generated SvelteKit code. Fresh SvelteKit 3 projects require Node.js 22.17+.

## Choose your foundation

| | **Base** | **Dashboard** |
| :--- | :--- | :--- |
| **Includes** | Skeleton UI, Tailwind, themes, layouts, SEO, FR/EN, tests | Base + Better Auth, Drizzle/PostgreSQL, protected admin pages, user management |
| **For** | Websites and custom applications | Apps with accounts, data and administration |

### Need the Dashboard?

```bash
npx svforge create my-dashboard --template dashboard
cd my-dashboard
bash scripts/setup.sh
```

**Before running the app:** start PostgreSQL, set `DATABASE_URL` in `.env`, then initialize the authentication schema and database:

```bash
npm run auth:schema
npm run db:push
npm run dev
```

Dashboard registration is **closed by default**. Create the first admin through `/setup` in development or `npm run admin:create`. [Read the setup guide](packages/svforge/docs/usage-guide.md#install) before changing a real database.

## Add only what you need

In your generated project:

```bash
npx svforge add blog ui_toast
```

Pick from blog, rich text, uploads, email, OAuth, chat, notifications, jobs, audit logging, realtime, drag and drop, and graphs. Some modules require authentication, PostgreSQL or a long-lived Node runtime; SVForge checks their prerequisites.

[Explore modules and requirements](packages/svforge/docs/usage-guide.md#optional-modules)

## Built to evolve with you

Generated projects include editable conventions and context for coding agents (`AGENTS.md`, `.svforge.json`, `llms.txt`).

```bash
npx svforge doctor
npx svforge check
npx svforge upgrade base --dry-run
```

Want the manual `sv add` workflow instead? It's supported too. [See the full usage guide](packages/svforge/docs/usage-guide.md) for official-first setup, advanced modules and safe upgrades. Use `sv migrate` for SvelteKit framework migrations.

---

## Explore the docs

| Guide | What you'll find |
| :--- | :--- |
| [Usage guide](packages/svforge/docs/usage-guide.md) | Install options, Dashboard setup, modules and upgrades |
| [Deployment](packages/svforge/docs/deployment-profiles.md) | Static, server and worker requirements |
| [Compatibility](packages/svforge/docs/sveltekit-compatibility.md) | Tested SvelteKit versions and migrations |

<details>
<summary><strong>Contributing, security and license</strong></summary>

SVForge is a workspace containing the CLI, template sources and independent `@svforge/*` addons. See [CONTRIBUTING.md](CONTRIBUTING.md) and [release instructions](docs/RELEASE.md).

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/lelabdev/svforge/security/advisories/new); see [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).

</details>
