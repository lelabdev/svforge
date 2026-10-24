# @svforge/tiptap

## 2.2.2

### Patch Changes

- [#648](https://github.com/lelabdev/svforge/pull/648) [`288f21d`](https://github.com/lelabdev/svforge/commit/288f21d69256881d25bfa508f98539426bf8d856) Thanks [@LudoLoops](https://github.com/LudoLoops)! - - `@svforge/tiptap`: every toolbar `ToggleGroup` control now declares `cursor-pointer` (Skeleton's `btn` sets no cursor), matching the list/block and link buttons that already did.
  - `@svforge/notifications`: the notification popover surface uses the Skeleton `card` radius utility instead of reapplying `rounded-container` by hand (same 12px theme radius, one less manual token).
  - `svforge`: compatibility manifest refresh for the bumped add-ons.
  
  Addon-family audit for [#594](https://github.com/lelabdev/svforge/issues/594): OAuth buttons, FileUpload, Toaster, DnD, Graph, Blog, Audit and Chat were audited and left unchanged — their pointer states, specialized behaviors (grab cursors, dynamic graph sizing, native file input) and native-button capability contracts are intentional and already correct.

## 2.2.1

### Patch Changes

- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.

- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style.

## 2.2.0

No changes in this release.

## 2.0.2 — 2026-10-09

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Replace repeated toolbar buttons with Skeleton ToggleGroup controls and the base Button primitive.
- Render headings semantically and use theme-aware Tailwind Typography styles, removing the preview-class lint exception.
- Add safe link editing with Skeleton controls and reject unsafe link destinations.

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
