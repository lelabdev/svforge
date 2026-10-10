# Upstream Svelte ownership and structural reuse

SVForge is a community addon for Svelte's `sv` CLI, not a competing SvelteKit generator or migration tool. The ownership rule is **official Svelte first, when its published addon meets the project's contract and composes safely**. This is a source-of-truth boundary, not a claim that every official addon can be layered over an existing SVForge project.

## Ownership boundary

| Responsibility | Owner | SVForge boundary |
| --- | --- | --- |
| Create a SvelteKit application and its baseline files | `sv create` | `svforge create` orchestrates the official CLI; it must not implement a second SvelteKit generator. |
| Generic, published Svelte integrations | Official `sv add` addons | Use an official addon when its output, supported package versions, options, and transforms satisfy the same contract and work in the actual composition order. |
| Svelte/SvelteKit code migrations | `sv migrate` | Do not duplicate framework migrations in `svforge upgrade`. |
| Skeleton theme/components, design-system checks, FR/EN product copy and locale behavior, project conventions/context, protected admin policy, optional `@svforge/*` capabilities | SVForge | Keep these differentiated overlays and security boundaries. |
| Updates to files owned by SVForge recipes | `svforge upgrade` | Plans and updates only its tracked recipes, reports user conflicts, and does not replace `sv migrate`. |

The concrete `sv create` contract is exercised by [`tests/cli-create.test.ts`](../../../tests/cli-create.test.ts): the orchestration calls official `sv create`, then one grouped `sv add`, and does not start a second project generator. The real-CLI coverage in [`tests/vite-config-modern-scaffold.test.ts`](../../../tests/vite-config-modern-scaffold.test.ts) uses the exact CLI pin from the root manifest; current compatibility evidence and policy are recorded in [`sveltekit-compatibility.md`](sveltekit-compatibility.md).

## Audited upstream addons and overlaps

This historical inventory is based on the **published [`sv@1.1.0`](https://www.npmjs.com/package/sv/v/1.1.0) package** and its shipped `packages/sv/src/addons` registry ([upstream source](https://github.com/sveltejs/cli/tree/main/packages/sv/src/addons)). The current pinned CLI is `sv@1.1.1`; see [`sveltekit-compatibility.md`](sveltekit-compatibility.md) for the dated real-project validation. The published IDs include `tailwindcss`, `eslint`, `prettier`, `vitest`, `playwright`, `drizzle`, `better-auth`, `paraglide`, `mdsvex`, `sveltekit-adapter`, `enhanced-img`, `storybook`, `ai-tools`, and `experimental`. Recheck the exact published package and generated output whenever the supported `sv` version changes; upstream `main` is not proof that an addon has been released.

| SVForge source and contract | Published upstream equivalent | Composition / overwrite risk observed or verified | Disposition |
| --- | --- | --- | --- |
| `packages/svforge/src/cli/create.ts`: bootstrap through `sv create --template minimal --no-add-ons --no-install`, then one `sv add` for SVForge and selected modules | `sv create` | Already uses the native generator and a single grouped addon call. | **Keep.** Do not add another SvelteKit generator or a parallel install pipeline. |
| Svelte/SvelteKit syntax updates | `sv migrate` | No Svelte/Kit migration engine is part of SVForge's recipes. | **Delegate.** Keep framework migrations upstream and keep `svforge upgrade` limited to SVForge recipes. |
| `packages/svforge/src/index.ts`, `src/modes/base.ts`, and `templates/base/src/routes/layout.css`: Tailwind v4/Vite wiring and forms/typography plugins, combined with Skeleton and the SVForge theme | `tailwindcss` (official options for `forms` and `typography`) | A real `sv@1.1.0` scaffold followed by `sv add tailwindcss=plugins:none` retained one Tailwind Vite plugin, one Tailwind stylesheet import, Skeleton CSS, and parseable Vite config. This tested additive order is covered by the real-CLI regression. Other option/order combinations still need to preserve the Skeleton/theme contract. | **Keep the product layer; delegate generic setup only after composition tests.** Do not remove Skeleton/theme wiring. |
| `packages/svforge/src/index.ts`, `templates/base/root/eslint.config.js`: ESLint, TypeScript/Svelte rules, Tailwind validation, and the SVForge design-system plugin | `eslint` | Both target `eslint.config.js` and package scripts. In the tested grouped composition, the final config was the SVForge config; order determines whether the upstream baseline or the richer product rules survive. | **Keep the SVForge rules.** Follow up separately on an additive config composition that proves neither baseline nor product rules disappear. |
| `packages/svforge/src/index.ts`, `templates/base/root/.prettierrc`: Prettier, Svelte/Tailwind plugins and stylesheet | `prettier` | Adding the official addon to an SVForge scaffold produced both `.prettierrc` and `prettier.config.js`; `prettier --find-config-path` selected `.prettierrc`. The second config is redundant and its options are not the active source of truth. | **Follow up separately** on one shared config path and idempotent Tailwind stylesheet integration. |
| `src/modes/base.ts`, `src/modes/dashboard.ts`, base/dashboard Vitest configs and test scripts | `vitest` | Both add the test runner, configs and scripts. In a real `sv@1.1.0` add-after run, the official addon changed the resolved Vitest range and composed `test`/`test:unit` scripts. SVForge also supplies a `$lib` alias and project-specific unit/server tests. | **Keep project-specific tests and aliases.** Prototype delegation of the generic runner/config separately; check all supported package managers and script ordering. |
| Dashboard `src/modes/dashboard.ts`, `templates/dashboard/src/playwright.config.ts`, `templates/dashboard/src/e2e/` | `playwright` | In a real dashboard add-after run, the official transform set `testMatch` to `**/*.e2e.{ts,js}` while SVForge's files remain named `*.test.ts`; Playwright then excludes the navigation, auth and users-dialog suites. It also modifies the `test`/`test:e2e` scripts. | **Keep the custom dashboard profile for now.** Separate follow-up: compose test discovery and CI scripts with the official transform, then verify `playwright test --list` and run the browser suite. |
| `src/modes/dashboard.ts` and `templates/dashboard/src/lib/server/{auth,db}/`: PostgreSQL/Drizzle and Better Auth dashboard foundation | `drizzle`, `better-auth` | Existing tests in both application orders found peer-version, duplicate-file, overwrite and signup-policy risks. The detailed reproducible findings and security contract are maintained in [`docs/better-auth-upgrades.md`](../../../docs/better-auth-upgrades.md). | **Track only in #547.** This audit does not duplicate or pre-empt that implementation. Preserve closed signup, admin roles, disabled-user checks, and schema safety. |
| `src/modes/base.ts`, `templates/base/root/project.inlang/settings.json`, messages, hooks and Vite plugin wiring: Paraglide integration with required FR/EN catalogs and locale context | `paraglide` | A real `sv@1.1.0` add-after composition with `languageTags:en,fr` produced two `paraglideVitePlugin({ ... })` calls and warned that automatic reroute-hook addition failed. The official default language list is not SVForge's FR/EN contract. | **Keep FR/EN and locale behavior.** Separate follow-up: make the plugin/hook/config transforms idempotent and test both add orders before delegating generic wiring. |
| `packages/blog/src/index.ts`: mdsvex dependency plus modern Vite/SvelteKit integration, routes, post transport and localized messages | `mdsvex` | The published addon edits Svelte config; the blog module also handles modern `vite.config.ts` projects and adds product routes/transport. Same dependency, but not the same complete contract. | **Keep blog behavior.** Evaluate only the generic preprocessor wiring separately against fresh modern and legacy projects. |
| `sv create`'s adapter-auto and the documented adapter selection | `sveltekit-adapter` | SVForge does not select/replace a deployment adapter in its modes. The package README already directs users to the official addon. | **Delegate** adapter choice and configuration to `sv add sveltekit-adapter`. |
| `packages/svforge/src/scaffolded-agents.ts`, `ai-context.ts`: product-specific `AGENTS.md`, manifest, and `llms.txt` | `ai-tools` | Official `ai-tools` adds editor/MCP/skill integrations and leaves an existing `AGENTS.md` untouched. Its provider/tool setup is not a replacement for SVForge's project contract. | **Keep the project context.** Users may add the official tooling addon where needed. |
| Skeleton dependencies, theme, Phosphor icon barrel, reusable components and business modules | No corresponding official Svelte CLI addon in the audited registry | These are product- or library-specific capabilities, not generic Svelte integrations. Skeleton remains the chosen UI system. | **Keep.** No alternative UI library or second component kit is implied by this policy. |
| Image enhancement, Storybook, experimental Svelte features | `enhanced-img`, `storybook`, `experimental` | No current generic configuration owner in the SVForge base/dashboard modes. | **Delegate** when a project opts into these features; do not add parallel SVForge implementations. |

### Reproducing the composition checks

The non-installing audit used the published `sv@1.1.0` CLI to create a fresh minimal project, apply the local SVForge addon, and then add official addons to that same project. The targeted Tailwind test now repeats the supported additive path against the real CLI and checks the resulting configuration and stylesheet. The Paraglide, Prettier, and Playwright findings above are deliberately recorded as **known composition gaps**, not as supported combinations.

Before proposing a new generic foundation, a contribution should:

1. Check the official addon IDs and option contract in the **published version** of `sv` supported by this repository.
2. Capture a fresh `sv create` result and the official addon's actual output, then apply the same addon before and after SVForge (or in the intended grouped `sv add`) without installing dependencies.
3. Compare generated files, package ranges/scripts, transforms, and both orders; parse/build/check the result and run the relevant behavior tests. A matching filename or green text-search assertion is not proof of composability.
4. Delegate only the portion that meets the product contract. Preserve SVForge-specific Skeleton/theme, i18n (FR/EN), authentication/security, admin, module, upgrade and agent-context behavior.
5. If an upstream extension point or version is insufficient, describe the concrete output and failure, propose a separate focused follow-up, and leave the working implementation intact until the new composition is validated.

## Structural-duplication check

An experimental, opt-in detector reports likely copies of existing SvelteForge or Skeleton components. It is **WARN-only** and does not change files or block a check.

Enable it for a generated project with:

```bash
SVFORGE_EXPERIMENTAL_STRUCTURAL_DUPLICATION=1 bun svforge-check.mjs
```

Programmatic callers can pass `{ experimentalStructuralDuplication: true }` to `checkDesignSystem`. Findings identify the component or Skeleton source to reuse. The detector is intentionally optional while false positives are reviewed; ordinary design-system checks remain available without it.
