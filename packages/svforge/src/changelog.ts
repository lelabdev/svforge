// AUTO-GENERATED - DO NOT EDIT
// Run bun run prebuild to regenerate from package CHANGELOG.md files

export interface ChangelogEntry {
	package: string;
	version: string;
	date: string;
	body: string;
}

export const RELEASE_NOTES: ChangelogEntry[] = [
  {
    "package": "@svforge/addon-kit",
    "version": "2.2.2",
    "date": "",
    "body": "### Patch Changes\n\n- [#672](https://github.com/lelabdev/svforge/pull/672) [`a1b9b82`](https://github.com/lelabdev/svforge/commit/a1b9b82cca937de41fd900b01ebc181ec6d28dbd) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/graph` now ships its own interactive showcase page: `/showcase/graph` renders the module's real `KnowledgeGraph` over a local fixture, mirrors node selection in a live panel (`aria-live`) with keyboard-reachable node buttons next to the canvas interaction, and keeps English/French copy — including the fixture labels — in `messages/*.json` on install (the module now declares `ui.svforge` and `i18n.messages`). Nothing is fetched or persisted; the showcase index lists the demo automatically alongside the DnD, toast and Tiptap demos.\n\n- [#667](https://github.com/lelabdev/svforge/pull/667) [`a12657a`](https://github.com/lelabdev/svforge/commit/a12657aa546471e6f2852aa3381f7b8fb3761ff3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - The design-system gallery moved from `/demo-ui` to `/showcase`, and the showcase is now the discovery surface for module demos. Each installed module can ship a self-contained demo route plus a `meta.ts` (`title`, optional `description`, optional `order`, as locale functions); the index lists them with a build-time glob, so a plain Base project imports no module code and renders no empty section. `@svforge/dnd` is the pilot: `/showcase/dnd` reorders a real `SortableList` with local fixture data and shows the resulting order, with English/French copy merged into `messages/*.json` on install (the module now declares `ui.svforge` + `i18n.messages`).\n\n- [#671](https://github.com/lelabdev/svforge/pull/671) [`bf24d6a`](https://github.com/lelabdev/svforge/commit/bf24d6a75dfa42c06f9e2947c6d9c4d5f32c3fc3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/tiptap` now ships its own interactive showcase page: `/showcase/tiptap` runs the module's real editor and toolbar over a local document and renders the sanitized preview of the same content as you type, with a reset control and English/French copy merged into `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). Nothing is sent or persisted; the showcase index lists the demo automatically next to the existing DnD and toast demos.\n\n- [#670](https://github.com/lelabdev/svforge/pull/670) [`6931824`](https://github.com/lelabdev/svforge/commit/69318241f104465ee1f00ae4a5b5b4628c246314) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/ui_toast` now ships its own interactive showcase page: `/showcase/ui-toast` fires the module's real toaster store for the success, error, info and warning variants, mounts its own `Toaster` group so it works before the root layout is wired, and keeps English/French copy in `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). The showcase index lists it automatically next to the existing DnD demo.\n\n- [#673](https://github.com/lelabdev/svforge/pull/673) [`c093e06`](https://github.com/lelabdev/svforge/commit/c093e068ce763ff17e4651e1b81cf56e3fe26c40) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/uploads` now ships its own showcase page: `/showcase/uploads` runs the module's **shared upload policy** (allowed MIME types + file-size limit) over a local file selection, shows the Skeleton progress affordance and the success/error states with English/French copy, and never contacts `/api/upload`, S3/R2 or storage — the real `FileUpload` flow stays documented on the page. The policy itself moved to `#lib/uploads/policy.ts` so the endpoint and any client pre-check cannot drift, with the module now declaring `ui.svforge` in addition to its auth/i18n requirements."
  },
  {
    "package": "@svforge/addon-kit",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/addon-kit",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/addon-kit",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Compose addon `.env.example` contributions deterministically and reject duplicate keys or invalid values.\n- Validate and atomically update registered UI-library configuration; keep module capabilities consistent with generated blog files.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/addon-kit",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/audit",
    "version": "2.2.2",
    "date": "",
    "body": "### Patch Changes\n\n- [#666](https://github.com/lelabdev/svforge/pull/666) [`c92daa9`](https://github.com/lelabdev/svforge/commit/c92daa968bf5640243044401802f64ae7e70aafa) Thanks [@LudoLoops](https://github.com/LudoLoops)! - New projects now start in **English** (`baseLocale: \"en\"`, locales `[\"en\",\"fr\"]`) and ship a reusable `ui/LocaleSwitcher.svelte` in the Base navbar and the Dashboard shell. The switcher reads the project's configured Paraglide locales (adding a third language needs no component change), marks the active locale, keeps the current route, query string and fragment, and forces the document reload Paraglide needs to render the new copy and `<html lang>`. Its anchors stay in the server-rendered HTML, so prerendered localized routes keep being discovered without the previous hidden locale-link block. Internal navigation (navbar, footer, landing page, dashboard sidebar, audit pagination, chat list) now goes through `localizeHref()`, so navigating from `/fr/...` no longer silently returns to English."
  },
  {
    "package": "@svforge/audit",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/audit",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/audit",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/blog",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/blog",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/blog",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Align generated blog routes with Skeleton and Paraglide, and format post dates as UTC calendar dates.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/blog",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/chat",
    "version": "2.2.2",
    "date": "",
    "body": "### Patch Changes\n\n- [#666](https://github.com/lelabdev/svforge/pull/666) [`c92daa9`](https://github.com/lelabdev/svforge/commit/c92daa968bf5640243044401802f64ae7e70aafa) Thanks [@LudoLoops](https://github.com/LudoLoops)! - New projects now start in **English** (`baseLocale: \"en\"`, locales `[\"en\",\"fr\"]`) and ship a reusable `ui/LocaleSwitcher.svelte` in the Base navbar and the Dashboard shell. The switcher reads the project's configured Paraglide locales (adding a third language needs no component change), marks the active locale, keeps the current route, query string and fragment, and forces the document reload Paraglide needs to render the new copy and `<html lang>`. Its anchors stay in the server-rendered HTML, so prerendered localized routes keep being discovered without the previous hidden locale-link block. Internal navigation (navbar, footer, landing page, dashboard sidebar, audit pagination, chat list) now goes through `localizeHref()`, so navigating from `/fr/...` no longer silently returns to English."
  },
  {
    "package": "@svforge/chat",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/chat",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/chat",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Replace the invalid Skeleton surface hover pairing with a generated utility.\n- Integrate the shared Skeleton-based NotificationsBell in the chat route.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/chat",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/dnd",
    "version": "2.3.0",
    "date": "",
    "body": "### Minor Changes\n\n- [#667](https://github.com/lelabdev/svforge/pull/667) [`a12657a`](https://github.com/lelabdev/svforge/commit/a12657aa546471e6f2852aa3381f7b8fb3761ff3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - The design-system gallery moved from `/demo-ui` to `/showcase`, and the showcase is now the discovery surface for module demos. Each installed module can ship a self-contained demo route plus a `meta.ts` (`title`, optional `description`, optional `order`, as locale functions); the index lists them with a build-time glob, so a plain Base project imports no module code and renders no empty section. `@svforge/dnd` is the pilot: `/showcase/dnd` reorders a real `SortableList` with local fixture data and shows the resulting order, with English/French copy merged into `messages/*.json` on install (the module now declares `ui.svforge` + `i18n.messages`)."
  },
  {
    "package": "@svforge/dnd",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/dnd",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/dnd",
    "version": "2.0.2",
    "date": "2026-10-04",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Use generated Tailwind utilities for sortable drag states instead of custom classes.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/dnd",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/email",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/email",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/email",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Contribute the mail-provider configuration keys to the composed `.env.example` with documented placeholders.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/email",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/graph",
    "version": "2.3.0",
    "date": "",
    "body": "### Minor Changes\n\n- [#672](https://github.com/lelabdev/svforge/pull/672) [`a1b9b82`](https://github.com/lelabdev/svforge/commit/a1b9b82cca937de41fd900b01ebc181ec6d28dbd) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/graph` now ships its own interactive showcase page: `/showcase/graph` renders the module's real `KnowledgeGraph` over a local fixture, mirrors node selection in a live panel (`aria-live`) with keyboard-reachable node buttons next to the canvas interaction, and keeps English/French copy — including the fixture labels — in `messages/*.json` on install (the module now declares `ui.svforge` and `i18n.messages`). Nothing is fetched or persisted; the showcase index lists the demo automatically alongside the DnD, toast and Tiptap demos."
  },
  {
    "package": "@svforge/graph",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/graph",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/graph",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Remove an unused graph container class marker.\n- Replace explicit `any` values in the force-graph adapter with a typed graph interface.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/graph",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/jobs",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/jobs",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/jobs",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/notifications",
    "version": "2.2.2",
    "date": "",
    "body": "### Patch Changes\n\n- [#648](https://github.com/lelabdev/svforge/pull/648) [`288f21d`](https://github.com/lelabdev/svforge/commit/288f21d69256881d25bfa508f98539426bf8d856) Thanks [@LudoLoops](https://github.com/LudoLoops)! - - `@svforge/tiptap`: every toolbar `ToggleGroup` control now declares `cursor-pointer` (Skeleton's `btn` sets no cursor), matching the list/block and link buttons that already did.\n  - `@svforge/notifications`: the notification popover surface uses the Skeleton `card` radius utility instead of reapplying `rounded-container` by hand (same 12px theme radius, one less manual token).\n  - `svforge`: compatibility manifest refresh for the bumped add-ons.\n  \n  Addon-family audit for [#594](https://github.com/lelabdev/svforge/issues/594): OAuth buttons, FileUpload, Toaster, DnD, Graph, Blog, Audit and Chat were audited and left unchanged — their pointer states, specialized behaviors (grab cursors, dynamic graph sizing, native file input) and native-button capability contracts are intentional and already correct."
  },
  {
    "package": "@svforge/notifications",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.\n\n- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style."
  },
  {
    "package": "@svforge/notifications",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/notifications",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Replace the invalid Skeleton unread-surface pairing with a generated utility.\n- Add the reusable NotificationsBell using Skeleton Popover and the base Badge primitive.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/notifications",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/oauth",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#600](https://github.com/lelabdev/svforge/pull/600) [`3032aee`](https://github.com/lelabdev/svforge/commit/3032aee83c8d2df87891f3cd35419e45a0397ac7) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Give enabled OAuth provider buttons a pointer cursor and retain a not-allowed cursor while sign-in is pending.\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/oauth",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/oauth",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Contribute OAuth provider keys to the composed `.env.example` with documented placeholders.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/oauth",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/realtime",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility."
  },
  {
    "package": "@svforge/realtime",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/realtime",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/tiptap",
    "version": "2.3.0",
    "date": "",
    "body": "### Minor Changes\n\n- [#671](https://github.com/lelabdev/svforge/pull/671) [`bf24d6a`](https://github.com/lelabdev/svforge/commit/bf24d6a75dfa42c06f9e2947c6d9c4d5f32c3fc3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/tiptap` now ships its own interactive showcase page: `/showcase/tiptap` runs the module's real editor and toolbar over a local document and renders the sanitized preview of the same content as you type, with a reset control and English/French copy merged into `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). Nothing is sent or persisted; the showcase index lists the demo automatically next to the existing DnD and toast demos."
  },
  {
    "package": "@svforge/tiptap",
    "version": "2.2.2",
    "date": "",
    "body": "### Patch Changes\n\n- [#648](https://github.com/lelabdev/svforge/pull/648) [`288f21d`](https://github.com/lelabdev/svforge/commit/288f21d69256881d25bfa508f98539426bf8d856) Thanks [@LudoLoops](https://github.com/LudoLoops)! - - `@svforge/tiptap`: every toolbar `ToggleGroup` control now declares `cursor-pointer` (Skeleton's `btn` sets no cursor), matching the list/block and link buttons that already did.\n  - `@svforge/notifications`: the notification popover surface uses the Skeleton `card` radius utility instead of reapplying `rounded-container` by hand (same 12px theme radius, one less manual token).\n  - `svforge`: compatibility manifest refresh for the bumped add-ons.\n  \n  Addon-family audit for [#594](https://github.com/lelabdev/svforge/issues/594): OAuth buttons, FileUpload, Toaster, DnD, Graph, Blog, Audit and Chat were audited and left unchanged — their pointer states, specialized behaviors (grab cursors, dynamic graph sizing, native file input) and native-button capability contracts are intentional and already correct."
  },
  {
    "package": "@svforge/tiptap",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.\n\n- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style."
  },
  {
    "package": "@svforge/tiptap",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/tiptap",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Replace repeated toolbar buttons with Skeleton ToggleGroup controls and the base Button primitive.\n- Render headings semantically and use theme-aware Tailwind Typography styles, removing the preview-class lint exception.\n- Add safe link editing with Skeleton controls and reject unsafe link destinations.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/tiptap",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/ui_toast",
    "version": "2.3.0",
    "date": "",
    "body": "### Minor Changes\n\n- [#670](https://github.com/lelabdev/svforge/pull/670) [`6931824`](https://github.com/lelabdev/svforge/commit/69318241f104465ee1f00ae4a5b5b4628c246314) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/ui_toast` now ships its own interactive showcase page: `/showcase/ui-toast` fires the module's real toaster store for the success, error, info and warning variants, mounts its own `Toaster` group so it works before the root layout is wired, and keeps English/French copy in `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). The showcase index lists it automatically next to the existing DnD demo."
  },
  {
    "package": "@svforge/ui_toast",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.\n\n- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style."
  },
  {
    "package": "@svforge/ui_toast",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/ui_toast",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/uploads",
    "version": "2.3.0",
    "date": "",
    "body": "### Minor Changes\n\n- [#673](https://github.com/lelabdev/svforge/pull/673) [`c093e06`](https://github.com/lelabdev/svforge/commit/c093e068ce763ff17e4651e1b81cf56e3fe26c40) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/uploads` now ships its own showcase page: `/showcase/uploads` runs the module's **shared upload policy** (allowed MIME types + file-size limit) over a local file selection, shows the Skeleton progress affordance and the success/error states with English/French copy, and never contacts `/api/upload`, S3/R2 or storage — the real `FileUpload` flow stays documented on the page. The policy itself moved to `#lib/uploads/policy.ts` so the endpoint and any client pre-check cannot drift, with the module now declaring `ui.svforge` in addition to its auth/i18n requirements.\n\n### Patch Changes\n\n- [#661](https://github.com/lelabdev/svforge/pull/661) [`4cd437c`](https://github.com/lelabdev/svforge/commit/4cd437cc517d3d6e6284a50eb3b5f400244d9f1a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Dashboard projects that select the **uploads** module can now opt into local S3-compatible storage through the same `bash scripts/setup.sh --compose` flow ([#610](https://github.com/lelabdev/svforge/issues/610)):\n  \n  - a digest-pinned `adobe/s3mock` service (loopback-only, persistent `s3-data` volume, health check) joins the managed Compose project; projects without the uploads module never get a storage service or S3 configuration;\n  - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_PORT` are generated once in the Git-ignored `.env` and match the Compose configuration; reruns preserve them;\n  - an existing external S3/R2 configuration is preserved and no local S3 service starts;\n  - the generated S3 client now honours `S3_FORCE_PATH_STYLE=true` (required by S3Mock and other path-style backends) while keeping the virtual-host default for R2/production S3;\n  - generated docs explain host vs container endpoints, S3Mock's development-only scope, and that `docker compose down -v` deletes local objects.\n  - adding `uploads` to an existing PostgreSQL-only Dashboard evolves the managed Compose in place: the PostgreSQL service, named volume, port, password and project identity are preserved while the S3 service is appended and started; switching to an external S3/R2 provider (or dropping uploads) is refused with a non-destructive path instead of silently removing the managed S3 service or its data.\n\n- [#677](https://github.com/lelabdev/svforge/pull/677) [`c650710`](https://github.com/lelabdev/svforge/commit/c650710e958659d6c9099eab2362c1cf6cd113ea) Thanks [@LudoLoops](https://github.com/LudoLoops)! - One Vitest authority for every scaffold: the Dashboard no longer declares its own runner (it inherits Base's `^5.0.0`) and its reference manifest mirrors that, while the optional uploads testpack now declares the same version instead of downgrading to Vitest 4. The reusable Docker builder lockfile was regenerated with the documented Bun 1.3.14 procedure and validated by the builder smoke test. The Dashboard PostgreSQL suites (10 files / 46 tests) and the `dashboard-integrations` composition including the uploads security pack (11 files / 53 tests) were run green on Vitest 5 against a real PostgreSQL 17.2. The uploads showcase drop zone also gained an accessible `role=\"group\"`, and every showcase demo page is now guarded against compiler/a11y warnings."
  },
  {
    "package": "@svforge/uploads",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.\n\n- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style."
  },
  {
    "package": "@svforge/uploads",
    "version": "2.2.0",
    "date": "",
    "body": "No changes in this release."
  },
  {
    "package": "@svforge/uploads",
    "version": "2.0.2",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Contribute S3-compatible storage configuration keys to the composed `.env.example` with documented placeholders.\n\n### Deprecations\n- None."
  },
  {
    "package": "@svforge/uploads",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  },
  {
    "package": "svforge",
    "version": "5.0.0",
    "date": "",
    "body": "### Major Changes\n\n- [#685](https://github.com/lelabdev/svforge/pull/685) [`e403763`](https://github.com/lelabdev/svforge/commit/e403763e5caa4812afde3db4bb54c616feb549e0) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Release **SVForge 5.0.0** as a consolidated major release of Svelte 5 application foundations, Dashboard developer experience, internationalization, reusable scaffolding, and interactive module showcases. This is a substantial product release, **not just a version-number alignment**.\n  \n  Key improvements included in the accumulated, reviewed Changesets:\n  \n  - **Modern Svelte foundations:** explicitly support Svelte 5, SvelteKit 3, Skeleton UI v5, and Tailwind CSS v4 in new scaffolds, with the official `sv create` / `sv add` integrations owning their respective upstream foundations ([#657](https://github.com/lelabdev/svforge/pull/657), [#642](https://github.com/lelabdev/svforge/pull/642), [#643](https://github.com/lelabdev/svforge/pull/643)).\n  - **Safer, simpler Dashboard setup:** opt-in local PostgreSQL through Docker Compose, idempotent private environment and Better Auth secret generation, optional schema initialization and admin bootstrap, plus optional local S3-compatible storage for projects using uploads ([#660](https://github.com/lelabdev/svforge/pull/660), [#661](https://github.com/lelabdev/svforge/pull/661)).\n  - **Internationalization:** English as the default language for new projects, a reusable Paraglide locale switcher, and locale-preserving internal navigation ([#666](https://github.com/lelabdev/svforge/pull/666)).\n  - **Interactive showcases:** an extensible `/showcase` experience with installed-module demos for drag and drop, toast notifications, rich-text editing, graphs, and a non-uploading file-policy demonstration ([#667](https://github.com/lelabdev/svforge/pull/667), [#670](https://github.com/lelabdev/svforge/pull/670), [#671](https://github.com/lelabdev/svforge/pull/671), [#672](https://github.com/lelabdev/svforge/pull/672), [#673](https://github.com/lelabdev/svforge/pull/673)).\n  - **More consistent generated projects:** the Dashboard now reuses the canonical Base scaffold delivery, shares a single Vitest 5 version, and retains validated database and integration tests ([#676](https://github.com/lelabdev/svforge/pull/676), [#677](https://github.com/lelabdev/svforge/pull/677)).\n  \n  **Versioning and compatibility:** The distribution is deliberately numbered `svforge@5.0.0` to align its major version with **Svelte 5**, skipping unused distribution major numbers rather than publishing intermediate releases. This is only the numbering strategy, not the scope of the release. Optional `@svforge/*` modules continue to use independent versions, and the generated compatibility manifest pins the exact versions shipped together.\n  \n  **Upgrade considerations:** New scaffolds target the supported SvelteKit 3 / Svelte 5 stack and default to English. Existing consumer projects are not automatically migrated; `sv migrate` remains responsible for upstream Svelte/SvelteKit migrations, while `svforge upgrade` handles SVForge-owned recipes.\n\n### Minor Changes\n\n- [#660](https://github.com/lelabdev/svforge/pull/660) [`f946263`](https://github.com/lelabdev/svforge/commit/f946263456c795d8e8f8edbd8cc5b5cc173b71cc) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Dashboard projects now ship an explicit, safe local-development setup ([#589](https://github.com/lelabdev/svforge/issues/589)):\n  \n  - `bash scripts/setup.sh` still prepares only the private `.env` and a strong Better Auth secret by default; `--compose` generates a loopback-only `docker-compose.yml` (PostgreSQL 17, named volume, health check, per-project random password) and starts it, `--init-schema` generates the pending Better Auth schema and runs `db:push` **only** against that verified local Compose database, and `--admin` creates the first administrator from `ADMIN_NAME`/`ADMIN_EMAIL` (generating a password into the ignored `.env` when missing, never printing it; an existing admin is a no-op).\n  - Generated Dashboards expose `<pm> run dev:setup` and `<pm> run dev:local`; plain `dev` and project creation stay side-effect free, and `svforge create` offers the setup only interactively (headless runs print the exact command instead).\n  - Existing `docker-compose.yml` files are reused only when they carry the SVForge ownership marker and match the managed service exactly; anything else is refused before credentials are written or Compose runs. Schema initialization validates the effective Compose model (parsed by Compose, including interpolation), refuses override files and ambient `COMPOSE_*` controls, verifies the exact URL credentials/port, the running service's published port and its database identity, and runs `auth:schema`/`db:push`/`admin:create` with a sanitized environment so an exported `DATABASE_URL` can never redirect them away from the verified local `.env` connection. and `--admin` relies on a dedicated exit code (3 = already exists) instead of message text.\n  - `setup.sh` reruns preserve secrets, volumes and rows; `.env` stays Git-ignored with mode 600; external `DATABASE_URL` values are never replaced and never receive automatic migrations.\n\n- [#661](https://github.com/lelabdev/svforge/pull/661) [`4cd437c`](https://github.com/lelabdev/svforge/commit/4cd437cc517d3d6e6284a50eb3b5f400244d9f1a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Dashboard projects that select the **uploads** module can now opt into local S3-compatible storage through the same `bash scripts/setup.sh --compose` flow ([#610](https://github.com/lelabdev/svforge/issues/610)):\n  \n  - a digest-pinned `adobe/s3mock` service (loopback-only, persistent `s3-data` volume, health check) joins the managed Compose project; projects without the uploads module never get a storage service or S3 configuration;\n  - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_PORT` are generated once in the Git-ignored `.env` and match the Compose configuration; reruns preserve them;\n  - an existing external S3/R2 configuration is preserved and no local S3 service starts;\n  - the generated S3 client now honours `S3_FORCE_PATH_STYLE=true` (required by S3Mock and other path-style backends) while keeping the virtual-host default for R2/production S3;\n  - generated docs explain host vs container endpoints, S3Mock's development-only scope, and that `docker compose down -v` deletes local objects.\n  - adding `uploads` to an existing PostgreSQL-only Dashboard evolves the managed Compose in place: the PostgreSQL service, named volume, port, password and project identity are preserved while the S3 service is appended and started; switching to an external S3/R2 provider (or dropping uploads) is refused with a non-destructive path instead of silently removing the managed S3 service or its data.\n\n- [#666](https://github.com/lelabdev/svforge/pull/666) [`c92daa9`](https://github.com/lelabdev/svforge/commit/c92daa968bf5640243044401802f64ae7e70aafa) Thanks [@LudoLoops](https://github.com/LudoLoops)! - New projects now start in **English** (`baseLocale: \"en\"`, locales `[\"en\",\"fr\"]`) and ship a reusable `ui/LocaleSwitcher.svelte` in the Base navbar and the Dashboard shell. The switcher reads the project's configured Paraglide locales (adding a third language needs no component change), marks the active locale, keeps the current route, query string and fragment, and forces the document reload Paraglide needs to render the new copy and `<html lang>`. Its anchors stay in the server-rendered HTML, so prerendered localized routes keep being discovered without the previous hidden locale-link block. Internal navigation (navbar, footer, landing page, dashboard sidebar, audit pagination, chat list) now goes through `localizeHref()`, so navigating from `/fr/...` no longer silently returns to English.\n\n- [#667](https://github.com/lelabdev/svforge/pull/667) [`a12657a`](https://github.com/lelabdev/svforge/commit/a12657aa546471e6f2852aa3381f7b8fb3761ff3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - The design-system gallery moved from `/demo-ui` to `/showcase`, and the showcase is now the discovery surface for module demos. Each installed module can ship a self-contained demo route plus a `meta.ts` (`title`, optional `description`, optional `order`, as locale functions); the index lists them with a build-time glob, so a plain Base project imports no module code and renders no empty section. `@svforge/dnd` is the pilot: `/showcase/dnd` reorders a real `SortableList` with local fixture data and shows the resulting order, with English/French copy merged into `messages/*.json` on install (the module now declares `ui.svforge` + `i18n.messages`).\n\n### Patch Changes\n\n- [#657](https://github.com/lelabdev/svforge/pull/657) [`a6656de`](https://github.com/lelabdev/svforge/commit/a6656de55c05af981e330dd6b44a8c198dd6986a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Make SvelteKit 3 the explicit scaffold target: the reference template manifests now mirror the official Kit 3 minimums (`@sveltejs/kit ^3.0.0`, `@sveltejs/adapter-auto ^8.0.0`, `@sveltejs/vite-plugin-svelte ^7.2.0`, `svelte ^5.57.1`, `vite ^8.3.0`, `typescript ^6.0.3`, Skeleton `^5.0.1`) and declare `engines.node >=22.17`. The legacy `svelte.config.js` and Kit 2 `vite.config.ts`/`tsconfig.json` reference fixtures are replaced by the Kit 3 layout (configuration in `vite.config.ts`, `$app/tsconfig`), and the compatibility/deployment reports record the tested Kit 3 stack including `adapter-node` 6. Generated projects already received Kit 3 from `sv create` (pinned `sv@1.1.1`); fresh scaffolds need no `sv migrate`.\n\n- [#676](https://github.com/lelabdev/svforge/pull/676) [`9d650da`](https://github.com/lelabdev/svforge/commit/9d650daa2e2d3eefd59c0b01a3db6ff2ccf959cc) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Dashboard is now generated by the **canonical Base delivery** instead of replaying a filtered copy of the Base file map: `deliverBaseScaffold()` delivers the shared dependency declarations, project wiring, template/root files and vendored docs once, with explicit exclusions for the files the official Better Auth/Drizzle add-ons own and for the Dashboard-owned Vitest config. The Dashboard overlay then only adds its capabilities, and the upgrade baseline is computed once from the final delivered map. Generated output is unchanged (same files and dependency declarations; only the key order inside `.svforge-versions.json` differs, with identical checksums).\n\n- [#664](https://github.com/lelabdev/svforge/pull/664) [`1833ba9`](https://github.com/lelabdev/svforge/commit/1833ba958cf1a13ae07af889a18191dd119e4922) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Give form-field hint text its own theme token: `--field-placeholder` now resolves to `surface-600` in light mode and `surface-300` in dark mode, so an empty field's placeholder reads as a hint instead of looking like typed text, while staying AA-legible against the field surface. Nothing changes for entered or prefilled values, and the scaffolded guidance tells projects to adjust the theme token instead of adding per-page `placeholder:` colors.\n\n- [#665](https://github.com/lelabdev/svforge/pull/665) [`45467f7`](https://github.com/lelabdev/svforge/commit/45467f7584e7fcf81f9c3db4d4cbecd9a0f560b0) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Restore Skeleton UI v5's native form placeholder styling by removing the SVForge theme override of `--field-placeholder`. Input and Textarea continue to use Skeleton's standard utilities; individual forms distinguish example placeholders from actual field values semantically instead of via a global color override.\n\n- [#672](https://github.com/lelabdev/svforge/pull/672) [`a1b9b82`](https://github.com/lelabdev/svforge/commit/a1b9b82cca937de41fd900b01ebc181ec6d28dbd) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/graph` now ships its own interactive showcase page: `/showcase/graph` renders the module's real `KnowledgeGraph` over a local fixture, mirrors node selection in a live panel (`aria-live`) with keyboard-reachable node buttons next to the canvas interaction, and keeps English/French copy — including the fixture labels — in `messages/*.json` on install (the module now declares `ui.svforge` and `i18n.messages`). Nothing is fetched or persisted; the showcase index lists the demo automatically alongside the DnD, toast and Tiptap demos.\n\n- [#671](https://github.com/lelabdev/svforge/pull/671) [`bf24d6a`](https://github.com/lelabdev/svforge/commit/bf24d6a75dfa42c06f9e2947c6d9c4d5f32c3fc3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/tiptap` now ships its own interactive showcase page: `/showcase/tiptap` runs the module's real editor and toolbar over a local document and renders the sanitized preview of the same content as you type, with a reset control and English/French copy merged into `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). Nothing is sent or persisted; the showcase index lists the demo automatically next to the existing DnD and toast demos.\n\n- [#670](https://github.com/lelabdev/svforge/pull/670) [`6931824`](https://github.com/lelabdev/svforge/commit/69318241f104465ee1f00ae4a5b5b4628c246314) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/ui_toast` now ships its own interactive showcase page: `/showcase/ui-toast` fires the module's real toaster store for the success, error, info and warning variants, mounts its own `Toaster` group so it works before the root layout is wired, and keeps English/French copy in `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). The showcase index lists it automatically next to the existing DnD demo.\n\n- [#673](https://github.com/lelabdev/svforge/pull/673) [`c093e06`](https://github.com/lelabdev/svforge/commit/c093e068ce763ff17e4651e1b81cf56e3fe26c40) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/uploads` now ships its own showcase page: `/showcase/uploads` runs the module's **shared upload policy** (allowed MIME types + file-size limit) over a local file selection, shows the Skeleton progress affordance and the success/error states with English/French copy, and never contacts `/api/upload`, S3/R2 or storage — the real `FileUpload` flow stays documented on the page. The policy itself moved to `#lib/uploads/policy.ts` so the endpoint and any client pre-check cannot drift, with the module now declaring `ui.svforge` in addition to its auth/i18n requirements.\n\n- [#677](https://github.com/lelabdev/svforge/pull/677) [`c650710`](https://github.com/lelabdev/svforge/commit/c650710e958659d6c9099eab2362c1cf6cd113ea) Thanks [@LudoLoops](https://github.com/LudoLoops)! - One Vitest authority for every scaffold: the Dashboard no longer declares its own runner (it inherits Base's `^5.0.0`) and its reference manifest mirrors that, while the optional uploads testpack now declares the same version instead of downgrading to Vitest 4. The reusable Docker builder lockfile was regenerated with the documented Bun 1.3.14 procedure and validated by the builder smoke test. The Dashboard PostgreSQL suites (10 files / 46 tests) and the `dashboard-integrations` composition including the uploads security pack (11 files / 53 tests) were run green on Vitest 5 against a real PostgreSQL 17.2. The uploads showcase drop zone also gained an accessible `role=\"group\"`, and every showcase demo page is now guarded against compiler/a11y warnings."
  },
  {
    "package": "svforge",
    "version": "2.3.0",
    "date": "",
    "body": "### Minor Changes\n\n- [#642](https://github.com/lelabdev/svforge/pull/642) [`b768f57`](https://github.com/lelabdev/svforge/commit/b768f573483df35e8fa1ac8f166c9dd80af3d9c7) Thanks [@LudoLoops](https://github.com/LudoLoops)! - New Dashboard projects now use the official `sv add drizzle better-auth` integrations for the auth/DB foundation instead of SVForge-generated copies: the official add-ons run first in `svforge create`, and SVForge only extends their output (sign-up policy, `role`/`disabled` via Better Auth `additionalFields`, one composed disabled-identity guard, domain tables). `auth:schema` is now the official generator (configure `DATABASE_URL`, then run `auth:schema` and `db:push` before the first check), the legacy Better Auth pin/tooling and review-copy workflow are removed, and the security audit resolves the range declared by the installed `sv`. Base projects are unchanged; existing projects are not migrated.\n\n- [#643](https://github.com/lelabdev/svforge/pull/643) [`e581e7d`](https://github.com/lelabdev/svforge/commit/e581e7d73b8da35c8a71a33473454711fabb4fbf) Thanks [@LudoLoops](https://github.com/LudoLoops)! - New projects now use the official `sv add paraglide` integration for the i18n wiring: `svforge create` runs it first for Base and Dashboard (project.inlang, Vite plugin, `hooks.server.ts`/`hooks.ts`, html lang/dir placeholders), and Better Auth composes its handle after `handleParaglide`. SVForge keeps the FR/EN catalog content, the app shell (app.html icons/theme-init, Navbar/Footer +layout) and the `paraglide-js compile` step in `check`; it no longer ships the inlang project, hooks or hooks.ts. Hook composition now appends the disabled-identity guard to the official sequence.\n\n### Patch Changes\n\n- [#644](https://github.com/lelabdev/svforge/pull/644) [`861ef62`](https://github.com/lelabdev/svforge/commit/861ef62c8a6340a27d3cd1bd9f87534493a24683) Thanks [@LudoLoops](https://github.com/LudoLoops)! - A direct `sv add <svforge-addon>=template:<base|dashboard>` now fails closed before writing anything when the official Paraglide/Drizzle/Better Auth output is missing, and prints the exact supported manual sequence (or points to `svforge create`, which runs those add-ons first). Generated agent guidance documents the ordering. No generated project changes when the official add-ons are already present.\n\n- [#648](https://github.com/lelabdev/svforge/pull/648) [`288f21d`](https://github.com/lelabdev/svforge/commit/288f21d69256881d25bfa508f98539426bf8d856) Thanks [@LudoLoops](https://github.com/LudoLoops)! - - `@svforge/tiptap`: every toolbar `ToggleGroup` control now declares `cursor-pointer` (Skeleton's `btn` sets no cursor), matching the list/block and link buttons that already did.\n  - `@svforge/notifications`: the notification popover surface uses the Skeleton `card` radius utility instead of reapplying `rounded-container` by hand (same 12px theme radius, one less manual token).\n  - `svforge`: compatibility manifest refresh for the bumped add-ons.\n  \n  Addon-family audit for [#594](https://github.com/lelabdev/svforge/issues/594): OAuth buttons, FileUpload, Toaster, DnD, Graph, Blog, Audit and Chat were audited and left unchanged — their pointer states, specialized behaviors (grab cursors, dynamic graph sizing, native file input) and native-button capability contracts are intentional and already correct.\n\n- [#646](https://github.com/lelabdev/svforge/pull/646) [`0ad9460`](https://github.com/lelabdev/svforge/commit/0ad9460a8461735dacda1e4d23e5df21919ca73c) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Base primitives: `Checkbox` and `Toggle` now follow the project-wide pointer-affordance contract — an enabled control shows `cursor-pointer`, a disabled one shows `cursor-not-allowed` (Skeleton v5 sets neither for these controls). The `Checkbox` label no longer advertises clickability when the input is disabled, and the `Toggle` forwards the same states to its Skeleton `Switch` control and label. No API or behavior change beyond the cursor affordance.\n\n- [#647](https://github.com/lelabdev/svforge/pull/647) [`16f8cf0`](https://github.com/lelabdev/svforge/commit/16f8cf04bdd5849c5ed4ade29a324aad2a920553) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Dashboard `PasswordInput`: inline the single-use `toggleLabel` derivation into the reveal control's `aria-label` (same reactive behavior, one less intermediate). Dashboard family audit for [#594](https://github.com/lelabdev/svforge/issues/594): no other verified change — AdminLayout, AppDialog, AvatarInitial, Feedback and the dashboard routes already use Skeleton v5 components/shared primitives and satisfy the enabled/disabled pointer-cursor contract.\n\n- [#639](https://github.com/lelabdev/svforge/pull/639) [`f82c046`](https://github.com/lelabdev/svforge/commit/f82c0467e94c0887f2065535fc388ee8473d1bd2) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Polish the generated Dashboard admin experience: the shell now has a single information hierarchy (brand in the sidebar, no duplicated top-bar title, page header carries the personal greeting instead of repeating the nav label), a 64px top bar with sidebar/mobile control, user identity and sign-out, a tonal selected-navigation state with filled icons and accessible collapsed labels, a drawer with account utilities, aligned metric cards (label/number hierarchy, tonal icon accents, consistent baselines) and an intentional recent-users list with an explicit empty state. Existing real data, routes, FR/EN copy, theming and the collapse/mobile-drawer behaviour are preserved."
  },
  {
    "package": "svforge",
    "version": "2.2.6",
    "date": "",
    "body": "### Patch Changes\n\n- [#637](https://github.com/lelabdev/svforge/pull/637) [`d1e91e1`](https://github.com/lelabdev/svforge/commit/d1e91e1e6a153b0eae7dad2f519fe0bd17cc1e96) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Add a canonical `layout/PageHeader.svelte` to the Base/Dashboard templates and compose the Dashboard admin page headers with it, so equivalent primary actions share the shared Button defaults: the `Manage users` CTA no longer pins `size=\"sm\"` while `Add user` relies on the default. `svforge check` now warns (`pageHeaderActionSize`) when a page-header action pins its own size — table rows, toolbars and icon-only controls are never inspected. Generated AGENTS.md/`llms.txt` guidance and `svforge-catalog.json` document the default-first rule, the full-width-admin vs constrained-form policy and the optional decorative page-title icon policy."
  },
  {
    "package": "svforge",
    "version": "2.2.5",
    "date": "",
    "body": "### Patch Changes\n\n- [#626](https://github.com/lelabdev/svforge/pull/626) [`a135611`](https://github.com/lelabdev/svforge/commit/a13561141270edcc8fb2f3e5f1743b1c914ac870) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Ship the real SVForge brand favicon in Base and Dashboard scaffolds instead of the cyan-square/white-triangle placeholder: the canonical brand binaries are vendored once in `packages/svforge/brand/`, embedded as base64 by prebuild, and served by prerendered `/favicon.ico` and `/favicon/*.png` routes with correct `Content-Type`. `app.html` declares the same icons, and the generated-site browser smoke now verifies the served bytes."
  },
  {
    "package": "svforge",
    "version": "2.2.4",
    "date": "",
    "body": "### Patch Changes\n\n- [#614](https://github.com/lelabdev/svforge/pull/614) [`701ddad`](https://github.com/lelabdev/svforge/commit/701ddad1fdd0ed5326714947d5b4e5c17047514d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Add a shared `PasswordInput` field to the dashboard template: the login and setup screens compose one masked/unmasked field with an accessible Show/Hide control instead of re-implementing the eye toggle and local visibility state in each route. Generated agent guidance and `llms.txt` patterns now point at the shared field."
  },
  {
    "package": "svforge",
    "version": "2.2.3",
    "date": "",
    "body": "### Patch Changes\n\n- [#591](https://github.com/lelabdev/svforge/pull/591) [`746b5de`](https://github.com/lelabdev/svforge/commit/746b5deea1b1308718fa4ab065819b27eee5e5ee) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Use pointer and non-interactive cursors for enabled, disabled, and loading buttons.\n\n- [#596](https://github.com/lelabdev/svforge/pull/596) [`d9d2e71`](https://github.com/lelabdev/svforge/commit/d9d2e713845329e3a84683708f15e8a4809b6ae2) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on enabled dashboard dialog triggers.\n\n- [#599](https://github.com/lelabdev/svforge/pull/599) [`cf5ff96`](https://github.com/lelabdev/svforge/commit/cf5ff9607cac2a8fdec34a339ccac5f83377ee6a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Inline Dashboard avatar initials in the reactive markup without changing empty-name or variant behavior.\n\n- [#600](https://github.com/lelabdev/svforge/pull/600) [`3032aee`](https://github.com/lelabdev/svforge/commit/3032aee83c8d2df87891f3cd35419e45a0397ac7) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Give enabled OAuth provider buttons a pointer cursor and retain a not-allowed cursor while sign-in is pending.\n\n- [#598](https://github.com/lelabdev/svforge/pull/598) [`a7d9de6`](https://github.com/lelabdev/svforge/commit/a7d9de6ae192a67e2f8ba54ed0d5e2b787bc6a90) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Simplify the single-use class expressions in Base Badge, Alert, and Card components while preserving reactive variants.\n\n- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.\n\n- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style.\n\n- [#609](https://github.com/lelabdev/svforge/pull/609) [`e4e76e1`](https://github.com/lelabdev/svforge/commit/e4e76e10cb0351783b434ab5f4f38de5c00f8d2a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Make Dashboard local setup prepare a private, ignored .env idempotently, preserving existing credentials and valid Better Auth secrets. Refuse a .env that Git already tracks (staged or committed) instead of writing a generated secret into a committable file. Remove automatic forced schema pushes; report manual database steps and support deferring configuration.\n\n- [#612](https://github.com/lelabdev/svforge/pull/612) [`b40bc61`](https://github.com/lelabdev/svforge/commit/b40bc61ca26d951860e13c00214ec5e2a13919d7) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Add a shared `AppDialog` modal shell to the dashboard template: admin forms and confirmations compose one Skeleton dialog composition (title, size, controlled open state, accessible close control, focus trap/restore and the outside-click policy) instead of re-implementing `Dialog/Portal/Backdrop/Positioner` in each route. Generated agent guidance and `llms.txt` patterns now point at the shell, and the users Playwright suite asserts an opaque, hit-testable panel on desktop and mobile.\n\n- [#595](https://github.com/lelabdev/svforge/pull/595) [`617e895`](https://github.com/lelabdev/svforge/commit/617e895fff1d549259b7f6b92da3a1dab2538724) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Simplify the shared Button class derivation without changing its rendered behavior."
  },
  {
    "package": "svforge",
    "version": "2.2.2",
    "date": "",
    "body": "### Patch Changes\n\n- [#587](https://github.com/lelabdev/svforge/pull/587) [`fbe244f`](https://github.com/lelabdev/svforge/commit/fbe244f052890cf0d79fea2732fff92a58157faa) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Filter the interactive module picker by the chosen template's actual capabilities. Base stays simple with only compatible optional modules; All modules is available only on Dashboard, which already includes Better Auth and PostgreSQL."
  },
  {
    "package": "svforge",
    "version": "2.2.1",
    "date": "",
    "body": "### Patch Changes\n\n- [#579](https://github.com/lelabdev/svforge/pull/579) [`8d60efe`](https://github.com/lelabdev/svforge/commit/8d60efe2d811e80b643764ebac4f42acf4fe53c5) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Fix the interactive CLI menus: display human-readable choice labels and return the actual values for templates, testing profiles, package managers, hooks, and module selections instead of `[object Object]`."
  },
  {
    "package": "svforge",
    "version": "2.2.0",
    "date": "",
    "body": "### Minor Changes\n\n- [#566](https://github.com/lelabdev/svforge/pull/566) [`79967a6`](https://github.com/lelabdev/svforge/commit/79967a6f7d9cc9ee2f3b483bd2141cacd589bf6b) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Add side-effect-free, versioned JSON plans for `svforge create` and `svforge add`, including resolved capabilities, exact commands, and compatible package versions.\n\n### Patch Changes\n\n- [#561](https://github.com/lelabdev/svforge/pull/561) [`f855f77`](https://github.com/lelabdev/svforge/commit/f855f773287425fba704c00e6c2fefd25f2c23af) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Read package-scoped Changesets release notes when displaying `svforge upgrade` history."
  },
  {
    "package": "svforge",
    "version": "2.1.1",
    "date": "2026-10-09",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Remove the TipTap preview class exception from the generated strict styling lint configuration.\n- Add opt-in Graphify initialization and package-manager-aware dashboard CI to the distributed CLI.\n- Support registered user-selected UI libraries with constrained copy-in roots and scoped lint exemptions.\n- Keep generated Lix artifacts out of scaffold formatting while retaining lint diagnostics for unsupported classes and duplicate primitives.\n\n### Deprecations\n- None."
  },
  {
    "package": "svforge",
    "version": "2.1.0",
    "date": "2026-10-04",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Add Tailwind v4-aware ESLint validation against the scaffold's real Tailwind/Skeleton CSS design system.\n\n### Deprecations\n- None."
  },
  {
    "package": "svforge",
    "version": "2.0.1",
    "date": "2026-09-12",
    "body": "### Breaking changes\n- None.\n\n### Migrations\n- None.\n\n### Fixes\n- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.\n\n### Deprecations\n- None."
  }
];

function compareVersions(left: string, right: string): number {
	const parse = (version: string) => version.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number);
	}
	return 0;
}

export function entriesBetween(entries: ChangelogEntry[], packageName: string, fromVersion: string | null, toVersion: string): ChangelogEntry[] {
	return entries
		.filter((entry) => entry.package === packageName)
		.filter((entry) => (!fromVersion || compareVersions(entry.version, fromVersion) > 0) && compareVersions(entry.version, toVersion) <= 0)
		.sort((left, right) => compareVersions(left.version, right.version));
}
