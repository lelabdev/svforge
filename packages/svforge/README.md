<div align="center">

<img src="https://raw.githubusercontent.com/lelabdev/svforge/main/packages/svforge/brand/android-chrome-192x192.png" alt="SVForge icon" width="76">

# SVForge

**Your SvelteKit starting point. Your code, your choices.**

Create an editable app, add features as you go, and stay in control of the source.
SVForge is a CLI built on the official Svelte tooling — not a separate framework.

[![npm version](https://img.shields.io/npm/v/svforge?logo=npm&label=npm)](https://www.npmjs.com/package/svforge)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/lelabdev/svforge/blob/main/LICENSE)

[Quick start](#quick-start) · [Templates](#choose-your-foundation) · [Modules](#add-features) · [Docs](#learn-more)

</div>

---

| **Create** | **Add** | **Check** |
| :--- | :--- | :--- |
| `svforge create` | `svforge add` | `svforge check` |
| Start with working foundations | Install compatible modules | Inspect your project |

## Quick start

Create a **Base** SvelteKit app with Skeleton UI, Tailwind CSS, theming and FR/EN:

```bash
npx svforge create my-app --template base
cd my-app
npm run dev
```

No global install needed. The generated SvelteKit source is yours to edit. Fresh SvelteKit 3 projects need Node.js 22.17+.

## Choose your foundation

| **Base** | **Dashboard** |
| :--- | :--- |
| Skeleton UI, Tailwind, themes, layouts, SEO, FR/EN, tests | Everything in Base + Better Auth, Drizzle/PostgreSQL, protected admin pages |

For **Dashboard**, start here:

```bash
npx svforge create my-dashboard --template dashboard
cd my-dashboard
bash scripts/setup.sh
```

Start PostgreSQL, configure `DATABASE_URL` in `.env`, then initialize the schema **before running the app**:

```bash
npm run auth:schema
npm run db:push
npm run dev
```

Registration is closed by default; see the [Dashboard setup guide](https://github.com/lelabdev/svforge/blob/main/packages/svforge/docs/usage-guide.md#install) for administrator setup and database safety.

## Add features

In a generated project, install compatible modules with the SVForge CLI:

```bash
npx svforge add blog ui_toast
```

More modules cover rich text, uploads, email, OAuth, notifications, chat, jobs, audit logs, realtime, drag and drop and graphs. Some require a database, authentication or a long-lived Node runtime.

```bash
npx svforge check
npx svforge upgrade base --dry-run
```

## Learn more

- [Full usage guide and module requirements](https://github.com/lelabdev/svforge/blob/main/packages/svforge/docs/usage-guide.md)
- [Deployment profiles](https://github.com/lelabdev/svforge/blob/main/packages/svforge/docs/deployment-profiles.md)
- [SvelteKit compatibility](https://github.com/lelabdev/svforge/blob/main/packages/svforge/docs/sveltekit-compatibility.md)
- [Source, issues and contributions](https://github.com/lelabdev/svforge)

MIT licensed.
