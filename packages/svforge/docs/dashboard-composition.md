# Dashboard = Base + additive capabilities (#674)

Dashboard is meant to be **the canonical Base scaffold plus Dashboard-only capabilities**, not a second hand-maintained copy of Base. This page is the ownership map for that contract and the reference for the automated audit in `tests/dashboard-base-composition.test.ts`.

Scope note: this documents the **composition and ownership** work of #674. The reference templates still exist as the delivery sources; what matters here is that the generated Dashboard cannot silently diverge from Base on shared artifacts or shared dependency versions.

Since phase 2 the composition itself is canonical: `deliverBaseScaffold()` in `modes/base.ts` is the single Base delivery operation (shared dependency declarations, project wiring, shared template/root files, vendored LLM docs). Base mode calls it and adds Base's metadata; Dashboard mode calls it with the mode-owned exclusions below and then only adds its own capabilities. Neither mode replays the other's file map, and the upgrade baseline is computed **once** from the final delivered map.

## Ownership matrix

| Artifact | Owner | Notes |
| --- | --- | --- |
| Skeleton v5 theme (`src/lib/styles/svelteforge-theme.css`), Tailwind entrypoint (`src/routes/layout.css`) | **Base** | Delivered unchanged to Dashboard. |
| Shared components (`src/lib/components/svforge/primitives/**`, `ui/**`, `layout/**`) | **Base** | Dashboard receives the same files; its barrel/icon exports are additive overrides (below). |
| Shared utilities, types, icons, SEO/sitemap, Paraglide catalogs and wiring | **Base** | Same content in both modes. |
| Shared scripts (`check`, `lint`, `format`, `test`, `dev`, `build`, `preview`) and common dependencies | **Base** | Dashboard adds its own scripts/dependencies on top. |
| `src/app.d.ts`, `src/hooks.server.ts`, `project.inlang/settings.json` | **Official `sv` add-ons** (#547) | Owned by the Better Auth/Drizzle/Paraglide integrations; SVForge only *extends* `hooks.server.ts` (policy) and never re-emits the Base copies. |
| Better Auth, Drizzle/PostgreSQL, admin routes, guards/permissions, local setup, DB test profile | **Dashboard** | Additive capabilities only. |
| `AGENTS.md`, `llms.txt`, `.svforge.json`, `.svforge-versions.json`, `package.json` | **Mode** | Intentionally mode-specific (guidance, manifest, upgrade baseline, scripts/deps). |
| `vitest.config.ts` | **Dashboard** | Sequential DB test execution, root destination (#186). Mode-owned: the canonical Base delivery skips it, so Base's config/patching is never emitted into a Dashboard project. |

## Shared files the Dashboard delivers differently

The audit renders both modes and requires this list to match **exactly**; any new difference fails the test until it is classified here.

| File | Why it differs | Classification |
| --- | --- | --- |
| `.svforge-versions.json` | Upgrade baseline records what THIS mode delivered (#327). | Mode artifact |
| `.svforge.json` | Project manifest: template + module list differ by mode. | Mode artifact |
| `AGENTS.md` | Dashboard guidance adds auth/DB/admin contracts. | Mode artifact |
| `llms.txt` | Dashboard component/pattern map adds its own routes. | Mode artifact |
| `package.json` | Dashboard adds auth/DB/setup scripts and dependencies. | Additive |
| `src/app.d.ts` | Official Better Auth add-on owns the `App` namespace. | Official-owned |
| `src/lib/components/svforge/ui/index.ts` | Dashboard barrel adds `AppDialog`, `PasswordInput`, `Feedback`, `AvatarInitial` (+ shared `LocaleSwitcher`). | Additive |
| `src/lib/icons/core.ts` | Dashboard icon barrel adds the admin icons. | Additive |
| `src/routes/+layout.svelte` | Dashboard root layout replaces the Base navbar/footer shell. | Intentional override |
| `src/routes/+layout.ts` | Dashboard disables prerendering (#439). | Intentional override |
| `vitest.config.ts` | Sequential DB test execution at the project root (#186). | Intentional override |

Two behaviours are asserted separately because they are the risky ones: the official `hooks.server.ts` must keep the Better Auth handler **and** gain the SVForge policy (extension, not replacement), and `src/app.d.ts` must stay byte-identical to the official output.

## Dependency authority

Shared runtime packages are declared by Base once; Dashboard must not re-declare them with a different range. The audit compares the declarations each mode makes and fails on any divergence that is not listed here.

### Known divergence to remove (phase 3)

| Package | Base | Dashboard | Why it still diverges |
| --- | --- | --- | --- |
| `vitest` | `^5.0.0` | `^4.1.5` | Dashboard's DB test profile (and the optional uploads testpack, which mirrors it) still pins Vitest 4. Harmonisation is not a JSON edit: the sequential PostgreSQL suites must be validated on the Base version first. |

Everything else — Skeleton (`@skeletonlabs/skeleton`, `-svelte`), Svelte, SvelteKit, Vite, Paraglide, Tailwind, TypeScript — is declared by Base and consumed unchanged by Dashboard. The audit also checks that the hand-maintained reference manifests (`packages/svforge/templates/{base,dashboard}/package.json`) agree with what the composer declares for that mode, so they cannot become a silent second source of truth.

## Audit

`tests/dashboard-base-composition.test.ts` renders both modes into disposable projects (Dashboard with the official foundation seeded) and asserts:

1. every Base-delivered file exists in the Dashboard project;
2. the set of files whose content differs equals the table above;
3. the dependency-declaration divergence map equals the single known exception;
4. this document explains every override and records the known divergence;
5. the reference manifests and the uploads testpack agree with their mode's declarations;
6. the official-owned `src/app.d.ts` is untouched and `hooks.server.ts` is *extended* (official handler + SVForge policy);
7. every Base dependency declaration reaches Dashboard (a dropped dependency fails, not just a changed version);
8. the upgrade baseline is computed from the delivered files: every tracked path exists and its recorded SHA-256 matches, and the official-owned files are not tracked as ours.

## Phases of #674

1. **Done — map ownership and audit the generated output.** Documentation + deterministic audit (PR #675).
2. **Done — refactor the composition (PR #676).** `deliverBaseScaffold()` is the one canonical Base delivery: central dependency declarations, project wiring (`package.json`, `vite.config.ts`, optional hooks), shared template/root files and the vendored LLM docs. Dashboard invokes it with the official-owned exclusions plus its own `vitest.config.ts`, then overlays its capabilities and computes the manifest/baseline once. The generated Dashboard was verified byte-equivalent to the pre-refactor output (same 120 files, same dependency declarations; only the key order inside the upgrade baseline JSON differs, with identical path→SHA-256 pairs).
3. **Next — harmonise and validate.** Remove the `vitest` divergence (DB tests on the shared version, templates/testpack aligned, lockfile/Docker builder refreshed) and run the real generated Base + Dashboard scaffolds, including the PostgreSQL integration profile.

The issue stays open until all three phases are done; this page is updated with each phase.
