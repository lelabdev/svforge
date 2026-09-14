import type { SvApi } from 'sv';
import { resolveDestination, initTrackingJson } from '@svforge/addon-kit';
import { scaffoldedAgents } from '../scaffolded-agents';
import { buildManifest, renderLlmstxt } from '../ai-context';
import { DASHBOARD_ROOT_PATHS } from '../destinations';
import { SDFORGE_RECIPE_VERSION } from '../recipe-version';
import { baseRootFiles } from '../templates';

/**
 * Apply Dashboard mode files via sv.file()
 * Dashboard = base + admin dashboard + auth + DB
 */

/**
 * On-demand package runners per package manager (#325). The scaffolded
 * scripts must never invoke a PM the user did not select, so the runner is
 * derived from the `sv` install selection (Workspace.packageManager).
 *
 * Only PMs the generator actually supports and tests are listed: npm, bun,
 * pnpm — plus yarn, which falls back to npx (documented behavior: yarn
 * classic has no `dlx`, and every Node environment ships npx). No other
 * runtime is advertised (#325 review: Deno support is out of scope).
 *
 * `@better-auth/cli` must stay on-demand (NEVER a scaffold dependency — its
 * bundled @better-auth/core hoists over the runtime's copy and breaks the
 * SSR build, docs/better-auth-upgrades.md), which is why the dlx runner
 * exists at all.
 */
export const DLX_RUNNERS: Record<string, string> = {
	npm: 'npx --yes',
	bun: 'bunx',
	pnpm: 'pnpm dlx'
};

/** Normalize an agent name ("bun", "pnpm@9"…) to its dlx runner (#325). */
export function resolveDlxRunner(packageManager: string): string {
	const agent = packageManager.split('@')[0] || 'npm';
	return DLX_RUNNERS[agent] ?? DLX_RUNNERS.npm;
}

export function applyDashboardMode(
	sv: SvApi,
	baseFiles: Record<string, string>,
	dashboardFiles: Record<string, string>,
	testing: 'vitest' | 'playwright' = 'vitest',
	rootFiles: Record<string, string> = {},
	packageManager = 'npm'
): void {
	// PM-specific runners (#325): the advertised auth/admin commands must work
	// with the package manager the user actually selected in `sv`.
	const dlx = resolveDlxRunner(packageManager);
	// create-admin.ts is TypeScript: bun runs it natively, every other PM
	// gets tsx through its own on-demand runner (same download policy as the
	// better-auth CLI — never a scaffold dependency).
	const runTs = packageManager.split('@')[0] === 'bun' ? 'bun' : `${dlx} tsx`;
	// Dashboard-specific runtime dependencies
	sv.dependency('drizzle-orm', '^0.45.2');
	sv.dependency('zod', '^4.3.5'); // schemas.ts — explicit, not transitive via better-auth (#192)
	sv.dependency('postgres', '^3.4.5'); // PostgreSQL driver (drizzle-orm/postgres-js) (#255)
	// Pinned, never floating (#197). The stack carries security fixes only up
	// to the pinned minor — #319 migrated 1.4.21 → 1.7.3 to cover
	// GHSA-g38m-r43w-p2q7 (OAuth auto-link account takeover, fixed 1.6.11).
	// Upgrades are automated by .github/workflows/better-auth-upgrade.yml
	// (policy + gate: docs/better-auth-upgrades.md).
	sv.dependency('better-auth', '~1.7.4');

	// Dashboard-specific dev dependencies
	sv.devDependency('drizzle-kit', '^0.31.10');
	sv.devDependency('@types/node', '^22');

	// Dashboard-specific Vitest baseline (#180)
	sv.devDependency('@testing-library/jest-dom', '^6.9.1');
	sv.devDependency('@testing-library/svelte', '^5.3.1');
	sv.devDependency('jsdom', '^29.1.1');
	sv.devDependency('vitest', '^4.1.5');

	if (testing === 'playwright') {
		// Full browser profile is explicitly opt-in (#181)
		sv.devDependency('@playwright/test', '^1.52.0');
	}

	// Add the advertised scripts to the generated dashboard (#325): the DB
	// commands are plain node_modules/.bin invocations (identical for npm,
	// bun, pnpm and yarn), while auth:schema + admin:create go through the
	// SELECTED package manager's on-demand runner.
	sv.file('package.json', (content: string) => {
		const pkg = JSON.parse(content);
		pkg.scripts = {
			...pkg.scripts,
			test: 'vitest run',
			'db:push': 'drizzle-kit push',
			'db:generate': 'drizzle-kit generate',
			'db:migrate': 'drizzle-kit migrate',
			'db:studio': 'drizzle-kit studio',
			'admin:create': `${runTs} scripts/create-admin.ts`,
			// The CLI's bundled schema knowledge LAGS the runtime (1.4.x vs 1.7.x
			// — it omits runtime columns like user.role/disabled), so a blind
			// overwrite of the committed auth.schema.ts breaks the app. The
			// regeneration lands in a REVIEW copy instead: diff it against the
			// runtime-gated src/lib/server/db/auth.schema.ts and port deliberate
			// changes manually (#325, policy in docs/better-auth-upgrades.md).
			'auth:schema': `${dlx} @better-auth/cli@1.4.21 generate --config src/lib/server/auth.ts --output auth-schema.review.ts --yes`,
			...(testing === 'playwright' ? { 'test:e2e': 'playwright test' } : {})
		};
		return `${JSON.stringify(pkg, null, '\t')}\n`;
	});

	// Write all base files first — same canonical resolver as the overlay
	// (#327): base '/vitest.config.ts' lands at the root where the dashboard
	// overlay then overwrites it with the dashboard version (no stray copy).
	for (const [path, content] of Object.entries(baseFiles)) {
		sv.file(resolveDestination(path, DASHBOARD_ROOT_PATHS), () => content);
	}

	// Then overlay dashboard-specific files (routes, admin components).
	// Destinations come from the ONE canonical resolver shared with the
	// upgrade engine (#327): test configs + e2e/ at the root (#186), the rest
	// src-relative.
	const deliveredFiles: Record<string, string> = {};
	for (const [path, content] of Object.entries(dashboardFiles)) {
		const isPlaywrightFile = path === '/playwright.config.ts' || path.startsWith('/e2e/');
		if (isPlaywrightFile && testing !== 'playwright') continue;
		sv.file(resolveDestination(path, DASHBOARD_ROOT_PATHS), () => content);
		deliveredFiles[path] = content;
	}

	// Finally, write root-level project files (drizzle.config.ts, .env.example,
	// scripts/setup.sh, static/robots.txt) at the project root (#187).
	for (const [path, content] of Object.entries(rootFiles)) {
		sv.file(path.slice(1), () => content);
	}

	// Upgrade baseline (#327): initialize .svforge-versions.json for the
	// dashboard recipe — the FULL merged delivery (base src + overlay + base
	// root files + dashboard root files) — so the first upgrade already has a
	// real SHA-256 baseline (#283 preserved).
	sv.file('.svforge-versions.json', () =>
		initTrackingJson(
			'dashboard',
			SDFORGE_RECIPE_VERSION,
			{ ...baseFiles, ...baseRootFiles, ...deliveredFiles, ...rootFiles },
			DASHBOARD_ROOT_PATHS
		)
	);

	// AI-ready: scaffold AGENTS.md at the project root (#203, #347) — the
	// sole agent convention of a SvelteForge project (#325: PM-aware commands).
	sv.file('AGENTS.md', () => scaffoldedAgents('dashboard', packageManager));

	// AI context (#234): override the base manifest with the dashboard state.
	const manifest = buildManifest('dashboard', []);
	sv.file('.svforge.json', () => `${JSON.stringify(manifest, null, 2)}\n`);
	sv.file('llms.txt', () => renderLlmstxt(manifest));
}
