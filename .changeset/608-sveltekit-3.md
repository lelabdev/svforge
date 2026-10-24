---
"svforge": patch
---

Make SvelteKit 3 the explicit scaffold target: the reference template manifests now mirror the official Kit 3 minimums (`@sveltejs/kit ^3.0.0`, `@sveltejs/adapter-auto ^8.0.0`, `@sveltejs/vite-plugin-svelte ^7.2.0`, `svelte ^5.57.1`, `vite ^8.3.0`, `typescript ^6.0.3`, Skeleton `^5.0.1`) and declare `engines.node >=22.17`. The legacy `svelte.config.js` and Kit 2 `vite.config.ts`/`tsconfig.json` reference fixtures are replaced by the Kit 3 layout (configuration in `vite.config.ts`, `$app/tsconfig`), and the compatibility/deployment reports record the tested Kit 3 stack including `adapter-node` 6. Generated projects already received Kit 3 from `sv create` (pinned `sv@1.1.1`); fresh scaffolds need no `sv migrate`.
