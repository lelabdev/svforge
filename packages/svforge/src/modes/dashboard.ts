import type { SvApi } from 'sv';
import { resolveDestination, initTrackingJson } from '@svforge/addon-kit';
import { scaffoldedAgents } from '../scaffolded-agents';
import { buildManifest, renderLlmstxt } from '../ai-context';
import { DASHBOARD_CI_WORKFLOW_PATH, renderDashboardCiWorkflow } from '../dashboard-ci';
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

/**
 * #547 — SVForge extends the official foundation instead of shipping its own.
 *
 * Each transform is anchored, idempotent and fails loudly when the upstream
 * output changed: a silent no-op would ship a dashboard without the security
 * policy. They are exported for behavioural tests.
 */

/** Spread SVForge's auth policy into the official Better Auth configuration. */
export function patchAuthConfig(content: string): string {
	if (content.includes('svforgeAuthPolicy')) return content;
	const importAnchor = "import { betterAuth } from 'better-auth/minimal';";
	if (!content.includes(importAnchor)) {
		throw new Error('auth.ts no longer imports betterAuth from better-auth/minimal; review the official integration output before scaffolding.');
	}
	const withImport = content.replace(
		importAnchor,
		`${importAnchor}\nimport { signupMode, svforgeAuthPolicy } from '#lib/server/auth-policy.js';`
	);
	// Signup modes belong on the official emailAndPassword entry (rewriting it
	// in place avoids a duplicate key, which TypeScript rejects on a spread).
	const passwordAnchor = '\temailAndPassword: { enabled: true },';
	if (!withImport.includes(passwordAnchor)) {
		throw new Error('auth.ts no longer declares `emailAndPassword: { enabled: true }`; review the official integration output before scaffolding.');
	}
	const withPolicy = withImport.replace(
		passwordAnchor,
		"\temailAndPassword: { enabled: true, disableSignUp: signupMode === 'closed' },"
	);
	const pluginsAnchor = '\tplugins: [';
	if (!withPolicy.includes(pluginsAnchor)) {
		throw new Error('auth.ts no longer declares a plugins array; review the official integration output before scaffolding.');
	}
	// Spread BEFORE plugins: SVForge adds user columns and signup hooks, while
	// the official sveltekitCookies plugin must stay last.
	return withPolicy.replace(pluginsAnchor, `\t...svforgeAuthPolicy,\n${pluginsAnchor}`);
}

/** Compose the SVForge guard (and Paraglide) around the official auth handle. */
export function patchHooksServer(content: string): string {
	if (content.includes('handleSvforgePolicy')) return content;
	const handleImport = "import type { Handle } from '@sveltejs/kit/hooks';";
	const svelteKitHandlerImport = "import { svelteKitHandler } from 'better-auth/svelte-kit';";
	const handleExport = 'export const handle: Handle = handleBetterAuth;';
	for (const anchor of [handleImport, svelteKitHandlerImport, handleExport]) {
		if (!content.includes(anchor)) {
			throw new Error(`hooks.server.ts is missing the expected official anchor: ${anchor}`);
		}
	}
	let updated = content.replace(handleImport, "import { sequence, type Handle } from '@sveltejs/kit/hooks';");
	updated = updated.replace(
		svelteKitHandlerImport,
		`${svelteKitHandlerImport}\nimport { getTextDirection } from '#lib/paraglide/runtime.js';\nimport { paraglideMiddleware } from '#lib/paraglide/server.js';\nimport { handleSvforgePolicy } from '#lib/server/auth-guard.js';`
	);
	return updated.replace(
		handleExport,
		`const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) =>
		resolve(
			{ ...event, request },
			{
				transformPageChunk: ({ html }) =>
					html
						.replace('%paraglide.lang%', locale)
						.replace('%paraglide.dir%', getTextDirection(locale))
			}
		)
	);

// Official Better Auth handler, Paraglide locale transform, then SVForge's
// disabled-identity guard (which must run after the session is populated).
export const handle: Handle = sequence(handleParaglide, handleBetterAuth, handleSvforgePolicy);`
	);
}

/** Declare SIGNUP_MODE next to the official env variables. */
export function patchEnvConfig(content: string): string {
	if (content.includes('SIGNUP_MODE')) return content;
	const closing = content.lastIndexOf('});');
	if (closing === -1 || !content.includes('defineEnvVars')) {
		throw new Error('env.ts no longer declares defineEnvVars({...}); review the official integration output before scaffolding.');
	}
	// Keep the official formatting: the comma lands right after the previous
	// property, and the scaffold's Prettier config uses trailingComma: none.
	const head = content.slice(0, closing).replace(/\s+$/, '');
	const tail = content.slice(closing);
	const entry = `,\n\tSIGNUP_MODE: {\n\t\tdescription: 'Sign-up policy: closed, invite-only, or self-service',\n\t\tschema: (value) => value ?? 'closed'\n\t}`;
	return `${head}${entry}\n${tail}`;
}

/** Append SVForge's sign-up policy to the official dotenv files. */
export function patchDotEnv(content: string): string {
	if (content.includes('SIGNUP_MODE')) return content;
	const signup = '# SVForge sign-up policy: closed (default) | invite-only | self-service';
	const testDb =
		'# Dedicated TEST database for the shipped integration suites — its name must contain "test"\n# TEST_DATABASE_URL="postgres://user:password@host:port/app_test"';
	const separator = content === '' || content.endsWith('\n') ? '' : '\n';
	return `${content}${separator}${content === '' ? '' : '\n'}${signup}\nSIGNUP_MODE="closed"\n\n${testDb}\n`;
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
	// Auth/DB foundation (#547): the official `sv add drizzle better-auth`
	// integrations own the packages, the schema generation script and their
	// versions. SVForge only declares what its own domain code needs.
	sv.dependency('zod', '^4.3.5'); // schemas.ts — explicit, not transitive via better-auth (#192)

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
			// db:*, auth:schema and the Drizzle/Better Auth packages are owned by
			// the official integrations (#547). Only SVForge-specific commands
			// are added here.
			'admin:create': `${runTs} scripts/create-admin.ts`,
			...(testing === 'playwright' ? { 'test:e2e': 'playwright test' } : {})
		};
		return `${JSON.stringify(pkg, null, '\t')}\n`;
	});

	// Write all base files first — same canonical resolver as the overlay
	// (#327): base '/vitest.config.ts' lands at the root where the dashboard
	// overlay then overwrites it with the dashboard version (no stray copy).
	//
	// #547: the official Drizzle/Better Auth integrations own `app.d.ts` and
	// `hooks.server.ts` for the dashboard; SVForge only extends them below.
	const OFFICIAL_DASHBOARD_FILES = new Set(['/hooks.server.ts', '/app.d.ts']);
	const dashboardBaseFiles = Object.fromEntries(
		Object.entries(baseFiles).filter(([path]) => !OFFICIAL_DASHBOARD_FILES.has(path))
	);
	for (const [path, content] of Object.entries(dashboardBaseFiles)) {
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

	// Render the generated CI workflow for the selected package manager before
	// writing files or recording the upgrade baseline.
	const renderedRootFiles = { ...rootFiles };
	const ciWorkflow = renderedRootFiles[DASHBOARD_CI_WORKFLOW_PATH];
	if (ciWorkflow) {
		renderedRootFiles[DASHBOARD_CI_WORKFLOW_PATH] = renderDashboardCiWorkflow(ciWorkflow, packageManager);
	}

	// Finally, write root-level project files (drizzle.config.ts, .env.example,
	// scripts/setup.sh, static/robots.txt) at the project root (#187).
	for (const [path, content] of Object.entries(renderedRootFiles)) {
		sv.file(path.slice(1), () => content);
	}

	// #547: extend the official foundation (never replace it) — auth policy,
	// request guard composition, env declaration and signup mode.
	sv.file('src/lib/server/auth.ts', (content) => patchAuthConfig(content));
	sv.file('src/hooks.server.ts', (content) => patchHooksServer(content));
	sv.file('src/env.ts', (content) => patchEnvConfig(content));
	for (const dotenv of ['.env', '.env.example']) {
		sv.file(dotenv, (content) => patchDotEnv(content));
	}

	// Upgrade baseline (#327): initialize .svforge-versions.json for the
	// dashboard recipe — the FULL merged delivery (base src + overlay + base
	// root files + dashboard root files) — so the first upgrade already has a
	// real SHA-256 baseline (#283 preserved).
	sv.file('.svforge-versions.json', () =>
		initTrackingJson(
			'dashboard',
			SDFORGE_RECIPE_VERSION,
			{ ...dashboardBaseFiles, ...baseRootFiles, ...deliveredFiles, ...renderedRootFiles },
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
