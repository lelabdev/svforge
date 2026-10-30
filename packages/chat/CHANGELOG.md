# @svforge/chat

## 2.2.2

### Patch Changes

- [#666](https://github.com/lelabdev/svforge/pull/666) [`c92daa9`](https://github.com/lelabdev/svforge/commit/c92daa968bf5640243044401802f64ae7e70aafa) Thanks [@LudoLoops](https://github.com/LudoLoops)! - New projects now start in **English** (`baseLocale: "en"`, locales `["en","fr"]`) and ship a reusable `ui/LocaleSwitcher.svelte` in the Base navbar and the Dashboard shell. The switcher reads the project's configured Paraglide locales (adding a third language needs no component change), marks the active locale, keeps the current route, query string and fragment, and forces the document reload Paraglide needs to render the new copy and `<html lang>`. Its anchors stay in the server-rendered HTML, so prerendered localized routes keep being discovered without the previous hidden locale-link block. Internal navigation (navbar, footer, landing page, dashboard sidebar, audit pagination, chat list) now goes through `localizeHref()`, so navigating from `/fr/...` no longer silently returns to English.

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
- Replace the invalid Skeleton surface hover pairing with a generated utility.
- Integrate the shared Skeleton-based NotificationsBell in the chat route.

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
