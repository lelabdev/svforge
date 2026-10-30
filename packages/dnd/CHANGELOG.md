# @svforge/dnd

## 2.3.0

### Minor Changes

- [#667](https://github.com/lelabdev/svforge/pull/667) [`a12657a`](https://github.com/lelabdev/svforge/commit/a12657aa546471e6f2852aa3381f7b8fb3761ff3) Thanks [@LudoLoops](https://github.com/LudoLoops)! - The design-system gallery moved from `/demo-ui` to `/showcase`, and the showcase is now the discovery surface for module demos. Each installed module can ship a self-contained demo route plus a `meta.ts` (`title`, optional `description`, optional `order`, as locale functions); the index lists them with a build-time glob, so a plain Base project imports no module code and renders no empty section. `@svforge/dnd` is the pilot: `/showcase/dnd` reorders a real `SortableList` with local fixture data and shows the resulting order, with English/French copy merged into `messages/*.json` on install (the module now declares `ui.svforge` + `i18n.messages`).

## 2.2.1

### Patch Changes

- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.

## 2.2.0

No changes in this release.

## 2.0.2 — 2026-10-04

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Use generated Tailwind utilities for sortable drag states instead of custom classes.

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
