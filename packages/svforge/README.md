# SVForge

**Start SvelteKit projects with editable foundations and optional modules.**

SVForge is a CLI for creating and extending SvelteKit applications. It brings together Skeleton UI, Tailwind CSS, project conventions, and application features without locking you into a framework of its own. It uses the official Svelte tools internally, but **you use SVForge directly**.

## Quick start

Create a Base app:

```bash
npx svforge create my-app --template base
cd my-app
npm run dev
```

No global installation needed. The generated project is an ordinary SvelteKit app, and its source code is yours to edit.

## Choose a starting point

| Template | Includes |
| --- | --- |
| **Base** | Skeleton UI, Tailwind CSS, theming, FR/EN, layouts, SEO and tests |
| **Dashboard** | Everything in Base, plus Better Auth, Drizzle/PostgreSQL, protected admin pages and user management |

To create a Dashboard:

```bash
npx svforge create my-dashboard --template dashboard
cd my-dashboard
bash scripts/setup.sh
```

Dashboard needs a running PostgreSQL database. Configure `DATABASE_URL` in `.env`, then initialize the schema:

```bash
npm run auth:schema
npm run db:push
npm run dev
```

See the [Dashboard setup guide](https://github.com/lelabdev/svforge/blob/main/packages/svforge/docs/usage-guide.md#install) for prerequisites and safe database setup.

## Add features as you need them

From a generated project, use the SVForge CLI to add compatible modules:

```bash
npx svforge add blog ui_toast
```

Other modules cover rich text, drag and drop, uploads, email, OAuth, notifications, jobs, audit logs, realtime, chat and graphs. Some require Dashboard, PostgreSQL or a long-lived server.

SVForge also provides project checks and upgrades:

```bash
npx svforge check
npx svforge upgrade base --dry-run
```

## Documentation

- [Full usage guide and modules](https://github.com/lelabdev/svforge/blob/main/packages/svforge/docs/usage-guide.md)
- [Deployment requirements](https://github.com/lelabdev/svforge/blob/main/packages/svforge/docs/deployment-profiles.md)
- [SvelteKit compatibility](https://github.com/lelabdev/svforge/blob/main/packages/svforge/docs/sveltekit-compatibility.md)
- [Source code and issues](https://github.com/lelabdev/svforge)

**License:** MIT
