# @svforge/addon-kit

## 2.2.2

### Patch Changes

- [#672](https://github.com/lelabdev/svforge/pull/672) [`a1b9b82`](https://github.com/lelabdev/svforge/commit/a1b9b82cca937de41fd900b01ebc181ec6d28dbd) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/graph` now ships its own interactive showcase page: `/showcase/graph` renders the module's real `KnowledgeGraph` over a local fixture, mirrors node selection in a live panel (`aria-live`) with keyboard-reachable node buttons next to the canvas interaction, and keeps English/French copy — including the fixture labels — in `messages/*.json` on install (the module now declares `ui.svforge` and `i18n.messages`). Nothing is fetched or persisted; the showcase index lists the demo automatically alongside the DnD, toast and Tiptap demos.

- [#667](https://github.com/lelabdev/svforge/pull/667) [`a12657a`](https://github.com/lelabdev/svforge/commit/a12657aa546471e6f2852aa3381f7b8fb3761ff3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - The design-system gallery moved from `/demo-ui` to `/showcase`, and the showcase is now the discovery surface for module demos. Each installed module can ship a self-contained demo route plus a `meta.ts` (`title`, optional `description`, optional `order`, as locale functions); the index lists them with a build-time glob, so a plain Base project imports no module code and renders no empty section. `@svforge/dnd` is the pilot: `/showcase/dnd` reorders a real `SortableList` with local fixture data and shows the resulting order, with English/French copy merged into `messages/*.json` on install (the module now declares `ui.svforge` + `i18n.messages`).

- [#671](https://github.com/lelabdev/svforge/pull/671) [`bf24d6a`](https://github.com/lelabdev/svforge/commit/bf24d6a75dfa42c06f9e2947c6d9c4d5f32c3fc3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/tiptap` now ships its own interactive showcase page: `/showcase/tiptap` runs the module's real editor and toolbar over a local document and renders the sanitized preview of the same content as you type, with a reset control and English/French copy merged into `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). Nothing is sent or persisted; the showcase index lists the demo automatically next to the existing DnD and toast demos.

- [#670](https://github.com/lelabdev/svforge/pull/670) [`6931824`](https://github.com/lelabdev/svforge/commit/69318241f104465ee1f00ae4a5b5b4628c246314) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/ui_toast` now ships its own interactive showcase page: `/showcase/ui-toast` fires the module's real toaster store for the success, error, info and warning variants, mounts its own `Toaster` group so it works before the root layout is wired, and keeps English/French copy in `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). The showcase index lists it automatically next to the existing DnD demo.

- [#673](https://github.com/lelabdev/svforge/pull/673) [`c093e06`](https://github.com/lelabdev/svforge/commit/c093e068ce763ff17e4651e1b81cf56e3fe26c40) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/uploads` now ships its own showcase page: `/showcase/uploads` runs the module's **shared upload policy** (allowed MIME types + file-size limit) over a local file selection, shows the Skeleton progress affordance and the success/error states with English/French copy, and never contacts `/api/upload`, S3/R2 or storage — the real `FileUpload` flow stays documented on the page. The policy itself moved to `#lib/uploads/policy.ts` so the endpoint and any client pre-check cannot drift, with the module now declaring `ui.svforge` in addition to its auth/i18n requirements.

## 2.2.1

### Patch Changes

- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.

## 2.2.0

No changes in this release.

## 2.0.2 — 2026-10-09

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Compose addon `.env.example` contributions deterministically and reject duplicate keys or invalid values.
- Validate and atomically update registered UI-library configuration; keep module capabilities consistent with generated blog files.

### Deprecations
- None.

## 2.0.1 — 2026-09-12

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.

### Deprecations
- None.
