import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { doctor } from '../packages/svforge/src';

/**
 * Behavioral tests for #178/#189 (doctor runs real diagnostics) and
 * #326 (doctor checks the INSTALLED capabilities, not a fixed list).
 *
 * Previous tests were grep-only; the svelte.config.js check was obsolete
 * (modern sv create has no svelte.config.js — it would report ERROR on a
 * healthy project). These tests call the real doctor() on temp projects.
 */

// ── Fixtures ────────────────────────────────────────────────────────

/** Capability env vars — snapshotted and cleared so the host env cannot leak into assertions. */
const CAPABILITY_ENV_VARS = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ORIGIN', 'S3_ENDPOINT', 'S3_BUCKET'];

function isolateEnv(): () => void {
	const saved = new Map<string, string | undefined>();
	for (const name of CAPABILITY_ENV_VARS) {
		saved.set(name, process.env[name]);
		delete process.env[name];
	}
	return () => {
		for (const [name, value] of saved) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	};
}

const BASE_MANIFEST = {
	schema: 1,
	template: 'base',
	stack: { framework: 'sveltekit', ui: 'skeleton', i18n: 'paraglide', test: 'vitest' },
	modules: [] as string[],
	capabilities: ['skeleton-ui'],
	patterns: {},
	generatedBy: 'svforge test'
};

const BASE_DEPS = {
	devDependencies: {
		svelte: '^5.0.0',
		'@skeletonlabs/skeleton-svelte': '^5.0.0',
		'@sveltejs/kit': '^2.0.0'
	}
};

const DASHBOARD_DEPS = {
	dependencies: {
		'better-auth': '~1.7.4',
		'drizzle-orm': '^0.45.2'
	},
	devDependencies: { ...BASE_DEPS.devDependencies, 'drizzle-kit': '^0.31.10' }
};

function makeProject(files: Record<string, unknown>, dirs: string[] = []): string {
	const dir = mkdtempSync(join(tmpdir(), 'sf-doc-'));
	for (const d of dirs) mkdirSync(join(dir, d), { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		writeFileSync(join(dir, path), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
	}
	return dir;
}

/** Healthy base project: manifest (base, no modules) + deps + scaffold dirs. */
function baseProject(files: Record<string, unknown> = {}, deps: Record<string, unknown> = BASE_DEPS): string {
	return makeProject(
		{
			'vite.config.ts': 'export default {};',
			'package.json': deps,
			'.svforge.json': BASE_MANIFEST,
			...files
		},
		['src/lib/components/svforge']
	);
}

/** Healthy dashboard project: manifest (dashboard) + Better Auth/Drizzle deps. */
function dashboardProject(files: Record<string, unknown> = {}): string {
	return makeProject(
		{
			'vite.config.ts': 'export default {};',
			'package.json': DASHBOARD_DEPS,
			'.svforge.json': { ...BASE_MANIFEST, template: 'dashboard', capabilities: [...BASE_MANIFEST.capabilities, 'auth', 'db', 'admin'] },
			...files
		},
		['src/lib/components/svforge']
	);
}

const DASHBOARD_VARS = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ORIGIN'];

// ── #178/#189 — original behavioral contract ────────────────────────

describe('svforge doctor behavioral (#178/#189)', () => {
	it('is read-only — never creates or modifies files', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-doc-ro-'));
		try {
			await doctor(dir);
			// Temp dir must stay empty
			const { readdirSync } = await import('node:fs');
			expect(readdirSync(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('detects SvelteKit via vite.config.ts (modern format)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-doc-vite-'));
		try {
			writeFileSync(join(dir, 'vite.config.ts'), 'export default {};');
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2.0.0' } })
			);
			const report = await doctor(dir);
			const kit = report.results.find((r) => r.module === 'sveltekit');
			expect(kit?.status).toBe('ok');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('still detects SvelteKit via legacy svelte.config.js', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-doc-svelte-'));
		try {
			writeFileSync(join(dir, 'svelte.config.js'), 'export default {};');
			const report = await doctor(dir);
			const kit = report.results.find((r) => r.module === 'sveltekit');
			expect(kit?.status).toBe('ok');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('reports a missing svforge components dir as warn (not error)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-doc-warn-'));
		try {
			writeFileSync(join(dir, 'vite.config.ts'), 'export default {};');
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2.0.0' } })
			);
			const report = await doctor(dir);
			const svforge = report.results.find((r) => r.module === 'svforge');
			expect(svforge?.status).toBe('warn');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('checks env vars from .env — only for installed capabilities', async () => {
		const restore = isolateEnv();
		const dir = dashboardProject({
			'.env': 'DATABASE_URL="file:local.db"\n'
		});
		try {
			const report = await doctor(dir);
			const db = report.results.find((r) => r.message.includes('DATABASE_URL'));
			expect(db?.status).toBe('ok');
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('warns only when an installed module conflicts with the declared deployment profile', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-doc-deployment-'));
		try {
			writeFileSync(join(dir, '.svforge.json'), JSON.stringify({
				template: 'base',
				modules: ['realtime'],
				deployment: { profile: 'serverless' }
			}));
			const serverless = await doctor(dir);
			expect(serverless.results).toContainEqual(expect.objectContaining({
				module: 'realtime',
				status: 'warn'
			}));

			writeFileSync(join(dir, '.svforge.json'), JSON.stringify({
				template: 'base',
				modules: ['realtime'],
				deployment: { profile: 'long-lived-node' }
			}));
			const node = await doctor(dir);
			expect(node.results.some((result) => result.module === 'realtime')).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('reports dependency checks from package.json', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-doc-dep-'));
		try {
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({
					devDependencies: { svelte: '^5.0.0', '@skeletonlabs/skeleton-svelte': '^5.0.0' }
				})
			);
			const report = await doctor(dir);
			expect(report.results.some((r) => r.module === 'svelte' && r.status === 'ok')).toBe(true);
			expect(report.results.some((r) => r.module === 'skeleton' && r.status === 'ok')).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── #326 — capability-driven diagnostics ────────────────────────────

describe('svforge doctor capabilities (#326)', () => {
	it('a healthy base project gets NO database/auth/S3 warnings', async () => {
		const dir = baseProject();
		try {
			const report = await doctor(dir);
			const envModules = report.results.filter((r) => r.module === 'dashboard' || r.module === 'uploads');
			expect(envModules).toEqual([]);
			const capabilityVars = report.results.filter((r) =>
				DASHBOARD_VARS.concat(['S3_ENDPOINT', 'S3_BUCKET']).some((v) => r.message.includes(v))
			);
			expect(capabilityVars).toEqual([]);
			expect(report.healthy).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('without a manifest, capabilities are detected from package.json deps', async () => {
		const restore = isolateEnv();
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': DASHBOARD_DEPS
		});
		try {
			const report = await doctor(dir);
			const checked = report.results.filter((r) => r.module === 'dashboard').map((r) => r.message);
			for (const name of DASHBOARD_VARS) {
				expect(checked.some((m) => m.includes(name))).toBe(true);
			}
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('without a manifest, plain base deps trigger NO env checks', async () => {
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': BASE_DEPS
		});
		try {
			const report = await doctor(dir);
			const envResults = report.results.filter((r) => r.module === 'dashboard' || r.module === 'uploads');
			expect(envResults).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a dashboard project checks DATABASE_URL, BETTER_AUTH_SECRET and ORIGIN (not AUTH_SECRET, not S3)', async () => {
		const restore = isolateEnv();
		const dir = dashboardProject();
		try {
			const report = await doctor(dir);
			const dashboardMessages = report.results.filter((r) => r.module === 'dashboard').map((r) => r.message);
			for (const name of DASHBOARD_VARS) {
				expect(dashboardMessages.some((m) => m.includes(name))).toBe(true);
			}
			// Not configured yet → warn, not ok
			for (const result of report.results.filter((r) => r.module === 'dashboard')) {
				expect(result.status).toBe('warn');
			}
			expect(dashboardMessages.some((m) => m.includes('AUTH_SECRET') && !m.includes('BETTER_AUTH_SECRET'))).toBe(false);
			expect(report.results.some((r) => r.module === 'uploads')).toBe(false);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a fully configured dashboard project reports all env vars as ok', async () => {
		const restore = isolateEnv();
		const dir = dashboardProject({
			'.env': [
				'DATABASE_URL="postgres://postgres:postgres@localhost:5432/sf_dashboard"',
				'ORIGIN=http://localhost:5173',
				'BETTER_AUTH_SECRET=2f9c81ff8f5f43cc9b12e0a63d7fae52'
			].join('\n')
		});
		try {
			const report = await doctor(dir);
			const dashboardResults = report.results.filter((r) => r.module === 'dashboard');
			expect(dashboardResults).toHaveLength(3);
			for (const result of dashboardResults) expect(result.status).toBe('ok');
			expect(report.healthy).toBe(true);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('S3 vars are checked ONLY when the uploads module is installed', async () => {
		const restore = isolateEnv();
		const dir = makeProject(
			{
				'vite.config.ts': 'export default {};',
				'package.json': BASE_DEPS,
				'.svforge.json': { ...BASE_MANIFEST, modules: ['uploads'] }
			}
		);
		try {
			const report = await doctor(dir);
			const uploads = report.results.filter((r) => r.module === 'uploads').map((r) => r.message);
			expect(uploads.some((m) => m.includes('S3_ENDPOINT'))).toBe(true);
			expect(uploads.some((m) => m.includes('S3_BUCKET'))).toBe(true);
			expect(report.results.some((r) => r.module === 'dashboard')).toBe(false);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('commented (# VAR=x) or empty (VAR=) vars are NOT configured', async () => {
		const restore = isolateEnv();
		const dir = dashboardProject({
			'.env': [
				'# DATABASE_URL="postgres://postgres:postgres@localhost:5432/sf_dashboard"',
				'#DATABASE_URL="postgres://also-a-comment"',
				'BETTER_AUTH_SECRET=',
				'ORIGIN=""'
			].join('\n')
		});
		try {
			const report = await doctor(dir);
			const byVar = (name: string) => report.results.find((r) => r.module === 'dashboard' && r.message.includes(name));
			expect(byVar('DATABASE_URL')?.status).toBe('warn');
			expect(byVar('BETTER_AUTH_SECRET')?.status).toBe('warn');
			expect(byVar('ORIGIN')?.status).toBe('warn');
			expect(report.healthy).toBe(false);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a placeholder value (BETTER_AUTH_SECRET=changeme) is flagged, not counted as configured', async () => {
		const restore = isolateEnv();
		const dir = dashboardProject({
			'.env': [
				'DATABASE_URL="postgres://postgres:postgres@localhost:5432/sf_dashboard"',
				'ORIGIN=http://localhost:5173',
				'BETTER_AUTH_SECRET=changeme'
			].join('\n')
		});
		try {
			const report = await doctor(dir);
			const secret = report.results.find((r) => r.module === 'dashboard' && r.message.includes('BETTER_AUTH_SECRET'));
			expect(secret?.status).toBe('warn');
			expect(secret?.message).toMatch(/placeholder/i);
			expect(report.healthy).toBe(false);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a var provided via process.env counts as configured even without .env', async () => {
		const restore = isolateEnv();
		const dir = dashboardProject();
		process.env.DATABASE_URL = 'postgres://from-process-env';
		try {
			const report = await doctor(dir);
			const db = report.results.find((r) => r.module === 'dashboard' && r.message.includes('DATABASE_URL'));
			expect(db?.status).toBe('ok');
			// Others are still missing
			const secret = report.results.find((r) => r.module === 'dashboard' && r.message.includes('BETTER_AUTH_SECRET'));
			expect(secret?.status).toBe('warn');
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('real SemVer comparison — Svelte/skeleton-svelte < 5 is an error, >= 5 is ok', async () => {
		const restore = isolateEnv();
		const old = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': {
				dependencies: { svelte: '^4.2.1', '@skeletonlabs/skeleton-svelte': '~4.0.7' }
			},
			'.svforge.json': BASE_MANIFEST
		});
		try {
			const report = await doctor(old);
			expect(report.results.find((r) => r.module === 'svelte')?.status).toBe('error');
			expect(report.results.find((r) => r.module === 'skeleton')?.status).toBe('error');
			expect(report.healthy).toBe(false);
		} finally {
			restore();
			rmSync(old, { recursive: true, force: true });
		}

		const modern = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': {
				devDependencies: { svelte: '>=5.0.0', '@skeletonlabs/skeleton-svelte': '5.38.2' }
			},
			'.svforge.json': BASE_MANIFEST
		});
		try {
			const report = await doctor(modern);
			expect(report.results.find((r) => r.module === 'svelte')?.status).toBe('ok');
			expect(report.results.find((r) => r.module === 'skeleton')?.status).toBe('ok');
		} finally {
			rmSync(modern, { recursive: true, force: true });
		}
	});

	it('an invalid .svforge.json yields a clear diagnostic, falls back to deps, and is never rewritten', async () => {
		const restore = isolateEnv();
		const broken = '{ "template": "dashboard", "modules": [ NOT VALID JSON';
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': DASHBOARD_DEPS,
			'.svforge.json': broken
		});
		try {
			const report = await doctor(dir);
			const manifest = report.results.find((r) => r.module === 'svforge-manifest');
			expect(manifest?.status).toBe('error');
			expect(manifest?.message.length).toBeGreaterThan(0);
			// Fallback: dashboard capability detected from deps → env checks run
			const dashboardMessages = report.results.filter((r) => r.module === 'dashboard').map((r) => r.message);
			expect(dashboardMessages.some((m) => m.includes('DATABASE_URL'))).toBe(true);
			// No crash, no write
			expect(readFileSync(join(dir, '.svforge.json'), 'utf-8')).toBe(broken);
			expect(readdirSync(dir).sort()).toEqual(['.svforge.json', 'package.json', 'vite.config.ts'].sort());
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a malformed manifest shape (valid JSON, wrong type) is also rejected without crashing', async () => {
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': BASE_DEPS,
			'.svforge.json': ['not', 'an', 'object']
		});
		try {
			const report = await doctor(dir);
			const manifest = report.results.find((r) => r.module === 'svforge-manifest');
			expect(manifest?.status).toBe('error');
			// No dashboard/uploads checks were derived from the broken manifest
			expect(report.results.some((r) => r.module === 'dashboard' || r.module === 'uploads')).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── Review fixes — bounds, env classification, S3 deps, manifest ────

/** Fake node_modules carrying installed svelte 5.x + skeleton-svelte 5.x. */
const NODE_MODULES_SVELTE5 = {
	'node_modules/svelte/package.json': { name: 'svelte', version: '5.38.2' },
	'node_modules/@skeletonlabs/skeleton-svelte/package.json': { name: '@skeletonlabs/skeleton-svelte', version: '5.38.2' }
};
const NODE_MODULES_DIRS = ['node_modules/svelte', 'node_modules/@skeletonlabs/skeleton-svelte'];

/**
 * Project with a declared svelte range and (optionally) an installed svelte
 * version — used by the semver-compliance tests. skeleton-svelte is always
 * the healthy pair, so assertions can target the `svelte` result alone.
 */
function semverProject(svelteRange: string, installedVersion: string | null): string {
	const files: Record<string, unknown> = {
		'vite.config.ts': 'export default {};',
		'package.json': {
			devDependencies: {
				svelte: svelteRange,
				'@skeletonlabs/skeleton-svelte': '^5.0.0'
			}
		},
		'node_modules/@skeletonlabs/skeleton-svelte/package.json': {
			name: '@skeletonlabs/skeleton-svelte',
			version: '5.38.2'
		}
	};
	if (installedVersion !== null) {
		files['node_modules/svelte/package.json'] = { name: 'svelte', version: installedVersion };
	}
	return makeProject(files, NODE_MODULES_DIRS);
}

describe('svforge doctor review fixes (#326)', () => {
	// FINDING 1 — bounded/compound semver ranges honour BOTH bounds.

	it('bounded range ">=4.0.0 <5.0.0" with installed svelte 5.x is NOT compatible', async () => {
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': {
				devDependencies: {
					svelte: '>=4.0.0 <5.0.0',
					'@skeletonlabs/skeleton-svelte': '^5.0.0'
				}
			},
			...NODE_MODULES_SVELTE5
		}, NODE_MODULES_DIRS);
		try {
			const report = await doctor(dir);
			const svelte = report.results.find((r) => r.module === 'svelte');
			expect(svelte?.status).toBe('error');
			expect(report.healthy).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('an installed version inside a bounded range (frontend >=5.0.0 <6.0.0) is ok', async () => {
		const dir = makeProject(
			{
				'vite.config.ts': 'export default {};',
				'package.json': {
					devDependencies: {
						svelte: '>=5.0.0 <6.0.0',
						'@skeletonlabs/skeleton-svelte': '>=5.0.0 <6.0.0'
					}
				},
				...NODE_MODULES_SVELTE5
			},
			['src/lib/components/svforge', ...NODE_MODULES_DIRS]
		);
		try {
			const report = await doctor(dir);
			expect(report.results.find((r) => r.module === 'svelte')?.status).toBe('ok');
			expect(report.results.find((r) => r.module === 'skeleton')?.status).toBe('ok');
			expect(report.healthy).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('prerelease exact matches: a pin satisfies an identical installed RC, a plain ^5.0.0 does not', async () => {
		const exact = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': {
				devDependencies: { svelte: '5.2.0-rc.1', '@skeletonlabs/skeleton-svelte': '^5.0.0' }
			},
			'node_modules/svelte/package.json': { name: 'svelte', version: '5.2.0-rc.1' },
			'node_modules/@skeletonlabs/skeleton-svelte/package.json': { name: '@skeletonlabs/skeleton-svelte', version: '5.38.2' }
		}, NODE_MODULES_DIRS);
		try {
			const report = await doctor(exact);
			const svelte = report.results.find((r) => r.module === 'svelte');
			expect(svelte?.status).toBe('ok');
		} finally {
			rmSync(exact, { recursive: true, force: true });
		}

		const caret = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': {
				devDependencies: { svelte: '^5.0.0', '@skeletonlabs/skeleton-svelte': '^5.0.0' }
			},
			'node_modules/svelte/package.json': { name: 'svelte', version: '5.2.0-rc.1' },
			'node_modules/@skeletonlabs/skeleton-svelte/package.json': { name: '@skeletonlabs/skeleton-svelte', version: '5.38.2' }
		}, NODE_MODULES_DIRS);
		try {
			const report = await doctor(caret);
			// Per semver prerelease rules the RC does not satisfy ^5.0.0
			expect(report.results.find((r) => r.module === 'svelte')?.status).toBe('error');
		} finally {
			rmSync(caret, { recursive: true, force: true });
		}
	});

	// FINDING 2 — existing-but-empty / placeholder process.env values.

	it('an existing-but-empty process.env var is "empty", not "missing" (no .env)', async () => {
		const restore = isolateEnv();
		const dir = dashboardProject();
		process.env.DATABASE_URL = '';
		try {
			const report = await doctor(dir);
			const db = report.results.find((r) => r.module === 'dashboard' && r.message.includes('DATABASE_URL'));
			expect(db?.status).toBe('warn');
			expect(db?.message).toMatch(/empty/i);
			expect(db?.message).not.toMatch(/not set/i);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('placeholder process.env values are flagged as placeholder (before considering .env)', async () => {
		for (const value of ['changeme', 'your-secret-here', 'xxx', 'placeholder']) {
			const restore = isolateEnv();
			const dir = dashboardProject();
			process.env.BETTER_AUTH_SECRET = value;
			try {
				const report = await doctor(dir);
				const secret = report.results.find((r) => r.module === 'dashboard' && r.message.includes('BETTER_AUTH_SECRET'));
				expect(secret?.status, `value: ${value}`).toBe('warn');
				expect(secret?.message, `value: ${value}`).toMatch(/placeholder/i);
			} finally {
				restore();
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	// FINDING 3 — only S3-specific deps imply uploads; unrelated AWS deps do not.

	it('@aws-sdk/client-s3 implies the uploads capability (S3 vars are checked)', async () => {
		const restore = isolateEnv();
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': {
				dependencies: { '@aws-sdk/client-s3': '^3.700.0' },
				devDependencies: BASE_DEPS.devDependencies
			}
		});
		try {
			const report = await doctor(dir);
			const uploads = report.results.filter((r) => r.module === 'uploads').map((r) => r.message);
			expect(uploads.some((m) => m.includes('S3_ENDPOINT'))).toBe(true);
			expect(uploads.some((m) => m.includes('S3_BUCKET'))).toBe(true);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('unrelated AWS deps (@aws-sdk/client-ses, DynamoDB) do NOT imply uploads — no S3 warnings', async () => {
		const restore = isolateEnv();
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': {
				dependencies: { '@aws-sdk/client-ses': '^3.700.0', '@aws-sdk/client-dynamodb': '^3.700.0' },
				devDependencies: BASE_DEPS.devDependencies
			}
		});
		try {
			const report = await doctor(dir);
			expect(report.results.some((r) => r.module === 'uploads')).toBe(false);
			expect(report.results.some((r) => r.message.includes('S3_ENDPOINT') || r.message.includes('S3_BUCKET'))).toBe(false);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// FINDING 4 — non-string manifest module entries must not be silently dropped.

	it('a modules array with non-string entries yields a clear invalid-manifest diagnostic', async () => {
		const restore = isolateEnv();
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': BASE_DEPS,
			'.svforge.json': { ...BASE_MANIFEST, modules: ['uploads', 42] }
		});
		try {
			const report = await doctor(dir);
			const manifestError = report.results.find((r) => r.module === 'svforge-manifest' && r.status === 'error');
			expect(manifestError).toBeDefined();
			expect(manifestError?.message).toMatch(/modules/i);
			// The broken manifest must not silently enable uploads checks
			expect(report.results.some((r) => r.module === 'uploads')).toBe(false);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('unknown string module ids and unknown top-level fields stay accepted', async () => {
		const restore = isolateEnv();
		const dir = makeProject({
			'vite.config.ts': 'export default {};',
			'package.json': BASE_DEPS,
			'.svforge.json': { ...BASE_MANIFEST, modules: ['uploads', 'brand-new-module'], futureField: { ok: true } }
		});
		try {
			const report = await doctor(dir);
			const manifest = report.results.find((r) => r.module === 'svforge-manifest');
			expect(manifest?.status).toBe('ok');
			expect(report.results.some((r) => r.module === 'uploads')).toBe(true);
		} finally {
			restore();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── Semver compliance — tilde expansion, prerelease minimum (#326 R3) ──

describe('svforge doctor semver compliance (#326 review round 3)', () => {
	it('tilde locks the minor: ~5.1 means >=5.1.0 <5.2.0, so 5.38.2 does NOT satisfy it', async () => {
		const cases: Array<[installed: string, expected: 'ok' | 'error']> = [
			['5.1.3', 'ok'], // inside the range
			['5.1.9', 'ok'], // top of the range
			['5.2.0', 'error'], // exclusive upper bound
			['5.38.2', 'error'], // reviewer counter-example: 5.38.2 ∉ ~5.1
			['5.0.3', 'error'] // below the lower bound
		];
		for (const [installed, expected] of cases) {
			const dir = semverProject('~5.1', installed);
			try {
				const report = await doctor(dir);
				expect(report.results.find((r) => r.module === 'svelte')?.status, `~5.1 vs installed ${installed}`).toBe(expected);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it('tilde with no minor still covers the whole major: ~5 means >=5.0.0 <6.0.0', async () => {
		const cases: Array<[installed: string, expected: 'ok' | 'error']> = [
			['5.9.9', 'ok'],
			['5.0.0', 'ok'],
			['6.0.0', 'error'],
			['4.9.9', 'error']
		];
		for (const [installed, expected] of cases) {
			const dir = semverProject('~5', installed);
			try {
				const report = await doctor(dir);
				expect(report.results.find((r) => r.module === 'svelte')?.status, `~5 vs installed ${installed}`).toBe(expected);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it('caret ranges: ^5.0.0 admits 5.9.9, rejects 6.0.0', async () => {
		const ok = semverProject('^5.0.0', '5.9.9');
		try {
			const report = await doctor(ok);
			expect(report.results.find((r) => r.module === 'svelte')?.status).toBe('ok');
		} finally {
			rmSync(ok, { recursive: true, force: true });
		}

		const tooHigh = semverProject('^5.0.0', '6.0.0');
		try {
			const report = await doctor(tooHigh);
			const svelte = report.results.find((r) => r.module === 'svelte');
			expect(svelte?.status).toBe('error');
			expect(svelte?.message).toMatch(/does not satisfy/);
		} finally {
			rmSync(tooHigh, { recursive: true, force: true });
		}
	});

	it('a prerelease is NOT >= 5.0.0: 5.0.0-rc.1 fails both the >=5.0.0 range and the minimum', async () => {
		// Range path: the RC is lower than 5.0.0, so ">=5.0.0" cannot hold.
		const viaRange = semverProject('>=5.0.0', '5.0.0-rc.1');
		try {
			const report = await doctor(viaRange);
			const svelte = report.results.find((r) => r.module === 'svelte');
			expect(svelte?.status).toBe('error');
			expect(svelte?.message).toMatch(/does not satisfy/);
		} finally {
			rmSync(viaRange, { recursive: true, force: true });
		}

		// Pure minimum path: the exact pin satisfies the range, but the version
		// itself is still below the required 5.0.0 — must NOT be waved through
		// on major equality alone.
		const viaMinimum = semverProject('5.0.0-rc.1', '5.0.0-rc.1');
		try {
			const report = await doctor(viaMinimum);
			const svelte = report.results.find((r) => r.module === 'svelte');
			expect(svelte?.status).toBe('error');
			expect(svelte?.message).toMatch(/incompatible/);
		} finally {
			rmSync(viaMinimum, { recursive: true, force: true });
		}
	});

	it('partial comparators (x-ranges) are supported and behave per spec', async () => {
		const cases: Array<[range: string, installed: string, expected: 'ok' | 'error']> = [
			['5.x', '5.38.2', 'ok'],
			['5.x', '6.0.0', 'error'],
			['5.1.x', '5.1.9', 'ok'],
			['5.1.x', '5.2.0', 'error'],
			['*', '5.38.2', 'ok']
		];
		for (const [range, installed, expected] of cases) {
			const dir = semverProject(range, installed);
			try {
				const report = await doctor(dir);
				expect(report.results.find((r) => r.module === 'svelte')?.status, `${range} vs installed ${installed}`).toBe(expected);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it('hyphen ranges are explicitly unsupported — warn "could not interpret", never a guessed verdict', async () => {
		const dir = semverProject('5.0.0 - 6.0.0', '5.38.2');
		try {
			const report = await doctor(dir);
			const svelte = report.results.find((r) => r.module === 'svelte');
			expect(svelte?.status).toBe('warn');
			expect(svelte?.message).toMatch(/could not interpret/i);
			expect(report.healthy).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// FINDING — ordered comparators on partial versions round UP per SemVer:
	// `>X.Y` means `>=X.(Y+1).0` (nothing inside X.Y qualifies) and `<=X.Y`
	// means `<X.(Y+1).0` (everything inside X.Y qualifies). Zero-filling the
	// missing patch instead flips both verdicts.

	it('ordered ">5.1" rounds up to >=5.2.0: 5.1.9 is an error, 5.2.0 is ok', async () => {
		const cases: Array<[installed: string, expected: 'ok' | 'error']> = [
			['5.1.9', 'error'], // naive ">5.1.0" zero-fill would wrongly admit it
			['5.2.0', 'ok'], // first version past the 5.1 line
			['5.1.0', 'error'] // inside the excluded 5.1 line
		];
		for (const [installed, expected] of cases) {
			const dir = semverProject('>5.1', installed);
			try {
				const report = await doctor(dir);
				expect(report.results.find((r) => r.module === 'svelte')?.status, `>5.1 vs installed ${installed}`).toBe(expected);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it('ordered "<=5.1" means <5.2.0: 5.1.9 is ok, 5.2.0 is an error', async () => {
		const cases: Array<[installed: string, expected: 'ok' | 'error']> = [
			['5.1.9', 'ok'], // naive "<=5.1.0" zero-fill would wrongly reject it
			['5.1.0', 'ok'], // inside the included 5.1 line
			['5.2.0', 'error'] // first version past the 5.1 line
		];
		for (const [installed, expected] of cases) {
			const dir = semverProject('<=5.1', installed);
			try {
				const report = await doctor(dir);
				expect(report.results.find((r) => r.module === 'svelte')?.status, `<=5.1 vs installed ${installed}`).toBe(expected);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it('ordered ">5" rounds up to >=6.0.0: 5.9.9 is an error, 6.0.0 is ok', async () => {
		const cases: Array<[installed: string, expected: 'ok' | 'error']> = [
			['5.9.9', 'error'], // naive ">5.0.0" zero-fill would wrongly admit it
			['6.0.0', 'ok'] // first version of the next major
		];
		for (const [installed, expected] of cases) {
			const dir = semverProject('>5', installed);
			try {
				const report = await doctor(dir);
				expect(report.results.find((r) => r.module === 'svelte')?.status, `>5 vs installed ${installed}`).toBe(expected);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it('ordered "<=5" means <6.0.0: 5.9.9 is ok, 6.0.0 is an error', async () => {
		const cases: Array<[installed: string, expected: 'ok' | 'error']> = [
			['5.9.9', 'ok'], // naive "<=5.0.0" zero-fill would wrongly reject it
			['6.0.0', 'error'] // first version of the next major
		];
		for (const [installed, expected] of cases) {
			const dir = semverProject('<=5', installed);
			try {
				const report = await doctor(dir);
				expect(report.results.find((r) => r.module === 'svelte')?.status, `<=5 vs installed ${installed}`).toBe(expected);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});
});
