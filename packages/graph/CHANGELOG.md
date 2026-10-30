# @svforge/graph

## 2.3.0

### Minor Changes

- [#672](https://github.com/lelabdev/svforge/pull/672) [`a1b9b82`](https://github.com/lelabdev/svforge/commit/a1b9b82cca937de41fd900b01ebc181ec6d28dbd) Thanks [@LudoLoops](https://github.com/LudoLoops)! - `@svforge/graph` now ships its own interactive showcase page: `/showcase/graph` renders the module's real `KnowledgeGraph` over a local fixture, mirrors node selection in a live panel (`aria-live`) with keyboard-reachable node buttons next to the canvas interaction, and keeps English/French copy — including the fixture labels — in `messages/*.json` on install (the module now declares `ui.svforge` and `i18n.messages`). Nothing is fetched or persisted; the showcase index lists the demo automatically alongside the DnD, toast and Tiptap demos.

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
- Remove an unused graph container class marker.
- Replace explicit `any` values in the force-graph adapter with a typed graph interface.

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
