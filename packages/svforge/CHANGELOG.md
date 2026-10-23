# svforge

## 2.2.6

### Patch Changes

- [#637](https://github.com/lelabdev/svforge/pull/637) [`d1e91e1`](https://github.com/lelabdev/svforge/commit/d1e91e1e6a153b0eae7dad2f519fe0bd17cc1e96) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Add a canonical `layout/PageHeader.svelte` to the Base/Dashboard templates and compose the Dashboard admin page headers with it, so equivalent primary actions share the shared Button defaults: the `Manage users` CTA no longer pins `size="sm"` while `Add user` relies on the default. `svforge check` now warns (`pageHeaderActionSize`) when a page-header action pins its own size — table rows, toolbars and icon-only controls are never inspected. Generated AGENTS.md/`llms.txt` guidance and `svforge-catalog.json` document the default-first rule, the full-width-admin vs constrained-form policy and the optional decorative page-title icon policy.

## 2.2.5

### Patch Changes

- [#626](https://github.com/lelabdev/svforge/pull/626) [`a135611`](https://github.com/lelabdev/svforge/commit/a13561141270edcc8fb2f3e5f1743b1c914ac870) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Ship the real SVForge brand favicon in Base and Dashboard scaffolds instead of the cyan-square/white-triangle placeholder: the canonical brand binaries are vendored once in `packages/svforge/brand/`, embedded as base64 by prebuild, and served by prerendered `/favicon.ico` and `/favicon/*.png` routes with correct `Content-Type`. `app.html` declares the same icons, and the generated-site browser smoke now verifies the served bytes.

## 2.2.4

### Patch Changes

- [#614](https://github.com/lelabdev/svforge/pull/614) [`701ddad`](https://github.com/lelabdev/svforge/commit/701ddad1fdd0ed5326714947d5b4e5c17047514d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Add a shared `PasswordInput` field to the dashboard template: the login and setup screens compose one masked/unmasked field with an accessible Show/Hide control instead of re-implementing the eye toggle and local visibility state in each route. Generated agent guidance and `llms.txt` patterns now point at the shared field.

## 2.2.3

### Patch Changes

- [#591](https://github.com/lelabdev/svforge/pull/591) [`746b5de`](https://github.com/lelabdev/svforge/commit/746b5deea1b1308718fa4ab065819b27eee5e5ee) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Use pointer and non-interactive cursors for enabled, disabled, and loading buttons.

- [#596](https://github.com/lelabdev/svforge/pull/596) [`d9d2e71`](https://github.com/lelabdev/svforge/commit/d9d2e713845329e3a84683708f15e8a4809b6ae2) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on enabled dashboard dialog triggers.

- [#599](https://github.com/lelabdev/svforge/pull/599) [`cf5ff96`](https://github.com/lelabdev/svforge/commit/cf5ff9607cac2a8fdec34a339ccac5f83377ee6a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Inline Dashboard avatar initials in the reactive markup without changing empty-name or variant behavior.

- [#600](https://github.com/lelabdev/svforge/pull/600) [`3032aee`](https://github.com/lelabdev/svforge/commit/3032aee83c8d2df87891f3cd35419e45a0397ac7) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Give enabled OAuth provider buttons a pointer cursor and retain a not-allowed cursor while sign-in is pending.

- [#598](https://github.com/lelabdev/svforge/pull/598) [`a7d9de6`](https://github.com/lelabdev/svforge/commit/a7d9de6ae192a67e2f8ba54ed0d5e2b787bc6a90) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Simplify the single-use class expressions in Base Badge, Alert, and Card components while preserving reactive variants.

- [#597](https://github.com/lelabdev/svforge/pull/597) [`6304081`](https://github.com/lelabdev/svforge/commit/6304081b92bdd1fa50c5167bf150544391eec19a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Replace deprecated SvelteKit alias configuration with explicit `#lib` package subpath imports while retaining Kit 2 compatibility.

- [#611](https://github.com/lelabdev/svforge/pull/611) [`a9bed6b`](https://github.com/lelabdev/svforge/commit/a9bed6b2e057abae4879e81ef1a3ef40e09ae58d) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Show a pointer cursor on the remaining scaffolded native controls — the notifications bell, Tiptap link and dismiss controls, toast dismiss, and the upload file input (not-allowed while busy) — and hide the locale helper links with the `hidden` utility instead of an inline style.

- [#609](https://github.com/lelabdev/svforge/pull/609) [`e4e76e1`](https://github.com/lelabdev/svforge/commit/e4e76e10cb0351783b434ab5f4f38de5c00f8d2a) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Make Dashboard local setup prepare a private, ignored .env idempotently, preserving existing credentials and valid Better Auth secrets. Refuse a .env that Git already tracks (staged or committed) instead of writing a generated secret into a committable file. Remove automatic forced schema pushes; report manual database steps and support deferring configuration.

- [#612](https://github.com/lelabdev/svforge/pull/612) [`b40bc61`](https://github.com/lelabdev/svforge/commit/b40bc61ca26d951860e13c00214ec5e2a13919d7) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Add a shared `AppDialog` modal shell to the dashboard template: admin forms and confirmations compose one Skeleton dialog composition (title, size, controlled open state, accessible close control, focus trap/restore and the outside-click policy) instead of re-implementing `Dialog/Portal/Backdrop/Positioner` in each route. Generated agent guidance and `llms.txt` patterns now point at the shell, and the users Playwright suite asserts an opaque, hit-testable panel on desktop and mobile.

- [#595](https://github.com/lelabdev/svforge/pull/595) [`617e895`](https://github.com/lelabdev/svforge/commit/617e895fff1d549259b7f6b92da3a1dab2538724) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Simplify the shared Button class derivation without changing its rendered behavior.

## 2.2.2

### Patch Changes

- [#587](https://github.com/lelabdev/svforge/pull/587) [`fbe244f`](https://github.com/lelabdev/svforge/commit/fbe244f052890cf0d79fea2732fff92a58157faa) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Filter the interactive module picker by the chosen template's actual capabilities. Base stays simple with only compatible optional modules; All modules is available only on Dashboard, which already includes Better Auth and PostgreSQL.

## 2.2.1

### Patch Changes

- [#579](https://github.com/lelabdev/svforge/pull/579) [`8d60efe`](https://github.com/lelabdev/svforge/commit/8d60efe2d811e80b643764ebac4f42acf4fe53c5) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Fix the interactive CLI menus: display human-readable choice labels and return the actual values for templates, testing profiles, package managers, hooks, and module selections instead of `[object Object]`.

## 2.2.0

### Minor Changes

- [#566](https://github.com/lelabdev/svforge/pull/566) [`79967a6`](https://github.com/lelabdev/svforge/commit/79967a6f7d9cc9ee2f3b483bd2141cacd589bf6b) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Add side-effect-free, versioned JSON plans for `svforge create` and `svforge add`, including resolved capabilities, exact commands, and compatible package versions.

### Patch Changes

- [#561](https://github.com/lelabdev/svforge/pull/561) [`f855f77`](https://github.com/lelabdev/svforge/commit/f855f773287425fba704c00e6c2fefd25f2c23af) Thanks [@LudoLoops](https://github.com/LudoLoops)! - Read package-scoped Changesets release notes when displaying `svforge upgrade` history.

## 2.1.1 — 2026-10-09

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Remove the TipTap preview class exception from the generated strict styling lint configuration.
- Add opt-in Graphify initialization and package-manager-aware dashboard CI to the distributed CLI.
- Support registered user-selected UI libraries with constrained copy-in roots and scoped lint exemptions.
- Keep generated Lix artifacts out of scaffold formatting while retaining lint diagnostics for unsupported classes and duplicate primitives.

### Deprecations
- None.

## 2.1.0 — 2026-10-04

### Breaking changes
- None.

### Migrations
- None.

### Fixes
- Add Tailwind v4-aware ESLint validation against the scaffold's real Tailwind/Skeleton CSS design system.

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
