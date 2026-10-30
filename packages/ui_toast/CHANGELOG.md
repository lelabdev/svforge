# @svforge/ui_toast

## 2.3.0

### Minor Changes

- [#670](https://github.com/lelabdev/svforge/pull/670) [`6931824`](https://github.com/lelabdev/svforge/commit/69318241f104465ee1f00ae4a5b5b4628c246314) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/ui_toast` now ships its own interactive showcase page: `/showcase/ui-toast` fires the module's real toaster store for the success, error, info and warning variants, mounts its own `Toaster` group so it works before the root layout is wired, and keeps English/French copy in `messages/*.json` on install (the module now declares `ui.skeleton`, `ui.svforge` and `i18n.messages`). The showcase index lists it automatically next to the existing DnD demo.

## 2.2.1

### Patch Changes

- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.

- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style.

## 2.2.0

No changes in this release.

## 2.0.1 — 2026-09-12

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Repository metadata republished against the renamed GitHub repo (`lelabdev/svforge`): `repository`, `homepage`, and `bugs` URLs corrected on npm.

### Deprecations
- None.
