---
"svforge": major
---

Release **SVForge 5.0.0** as a consolidated major release of Svelte 5 application foundations, Dashboard developer experience, internationalization, reusable scaffolding, and interactive module showcases. This is a substantial product release, **not just a version-number alignment**.

Key improvements included in the accumulated, reviewed Changesets:

- **Modern Svelte foundations:** explicitly support Svelte 5, SvelteKit 3, Skeleton UI v5, and Tailwind CSS v4 in new scaffolds, with the official `sv create` / `sv add` integrations owning their respective upstream foundations ([#657](https://github.com/lelabdev/svforge/pull/657), [#642](https://github.com/lelabdev/svforge/pull/642), [#643](https://github.com/lelabdev/svforge/pull/643)).
- **Safer, simpler Dashboard setup:** opt-in local PostgreSQL through Docker Compose, idempotent private environment and Better Auth secret generation, optional schema initialization and admin bootstrap, plus optional local S3-compatible storage for projects using uploads ([#660](https://github.com/lelabdev/svforge/pull/660), [#661](https://github.com/lelabdev/svforge/pull/661)).
- **Internationalization:** English as the default language for new projects, a reusable Paraglide locale switcher, and locale-preserving internal navigation ([#666](https://github.com/lelabdev/svforge/pull/666)).
- **Interactive showcases:** an extensible `/showcase` experience with installed-module demos for drag and drop, toast notifications, rich-text editing, graphs, and a non-uploading file-policy demonstration ([#667](https://github.com/lelabdev/svforge/pull/667), [#670](https://github.com/lelabdev/svforge/pull/670), [#671](https://github.com/lelabdev/svforge/pull/671), [#672](https://github.com/lelabdev/svforge/pull/672), [#673](https://github.com/lelabdev/svforge/pull/673)).
- **More consistent generated projects:** the Dashboard now reuses the canonical Base scaffold delivery, shares a single Vitest 5 version, and retains validated database and integration tests ([#676](https://github.com/lelabdev/svforge/pull/676), [#677](https://github.com/lelabdev/svforge/pull/677)).

**Versioning and compatibility:** The distribution is deliberately numbered `svforge@5.0.0` to align its major version with **Svelte 5**, skipping unused distribution major numbers rather than publishing intermediate releases. This is only the numbering strategy, not the scope of the release. Optional `@svforge/*` modules continue to use independent versions, and the generated compatibility manifest pins the exact versions shipped together.

**Upgrade considerations:** New scaffolds target the supported SvelteKit 3 / Svelte 5 stack and default to English. Existing consumer projects are not automatically migrated; `sv migrate` remains responsible for upstream Svelte/SvelteKit migrations, while `svforge upgrade` handles SVForge-owned recipes.
