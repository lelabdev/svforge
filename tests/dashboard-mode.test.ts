import { describe, it, expect } from 'vitest';
import type { SvApi } from 'sv';
import { applyDashboardMode, DLX_RUNNERS, resolveDlxRunner } from '../packages/svforge/src/modes/dashboard';
import { dashboardRootFiles } from '../packages/svforge/src/templates';

type FakeSv = {
	dependencies: string[];
	devDependencies: string[];
	files: Map<string, string>;
	dependency: (name: string, version: string) => void;
	devDependency: (name: string, version: string) => void;
	file: (path: string, transform: (content: string) => string) => void;
};

function fakeSv(): FakeSv {
	const sv: FakeSv = {
		dependencies: [],
		devDependencies: [],
		files: new Map(),
		dependency(name) {
			this.dependencies.push(name);
		},
		devDependency(name) {
			this.devDependencies.push(name);
		},
		file(path, transform) {
			this.files.set(path, transform(path === 'package.json' ? '{"scripts":{}}' : ''));
		}
	};
	return sv;
}

// FakeSv implements the SvApi surface applyDashboardMode actually uses; the
// unused required SvApi members are stubbed out at this single boundary.
const asSvApi = (sv: FakeSv): SvApi => sv as unknown as SvApi;

const baseFiles = { '/lib/base.ts': 'base' };
const dashboardFiles = {
	'/routes/(app)/+layout.server.test.ts': 'vitest',
	'/playwright.config.ts': 'playwright',
	'/vitest.config.ts': 'vitest-config',
	'/e2e/auth.test.ts': 'e2e'
};
const rootFiles = {
	'/drizzle.config.ts': 'drizzle-config',
	'/.env.example': 'env-example',
	'/scripts/setup.sh': 'setup-script',
	'/static/robots.txt': 'robots'
};

describe('dashboard testing profiles', () => {
	it('includes Vitest and excludes Playwright files by default', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest');

		expect(sv.devDependencies).toContain('vitest');
		expect(sv.devDependencies).not.toContain('@playwright/test');
		expect(sv.files.has('src/routes/(app)/+layout.server.test.ts')).toBe(true);
		expect(sv.files.has('playwright.config.ts')).toBe(false);
		expect(sv.files.has('e2e/auth.test.ts')).toBe(false);
		expect(JSON.parse(sv.files.get('package.json')!).scripts.test).toBe('vitest run');
	});

	it('adds Playwright files, dependency, and script only when selected', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'playwright');

		expect(sv.devDependencies).toContain('vitest');
		expect(sv.devDependencies).toContain('@playwright/test');
		expect(sv.files.has('playwright.config.ts')).toBe(true);
		expect(sv.files.has('e2e/auth.test.ts')).toBe(true);
		expect(JSON.parse(sv.files.get('package.json')!).scripts['test:e2e']).toBe('playwright test');
	});

	it('adds the PostgreSQL driver and never libsql (#255)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest');

		expect(sv.dependencies).toContain('postgres');
		expect(sv.dependencies).not.toContain('@libsql/client');
		expect(sv.dependencies).toContain('drizzle-orm');
	});

	it('writes test configs at the project root, not under src/ (#186)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'playwright');

		// Playwright and Vitest discover their config only at the project root,
		// and playwright.config.ts references testDir './e2e' relative to root.
		expect(sv.files.has('playwright.config.ts')).toBe(true);
		expect(sv.files.has('vitest.config.ts')).toBe(true);
		expect(sv.files.has('e2e/auth.test.ts')).toBe(true);
		expect(sv.files.has('src/playwright.config.ts')).toBe(false);
		expect(sv.files.has('src/vitest.config.ts')).toBe(false);
		expect(sv.files.has('src/e2e/auth.test.ts')).toBe(false);
	});

	it('writes root-level files at the project root (#187)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', rootFiles);

		// drizzle.config.ts, .env.example, scripts/setup.sh, static/robots.txt
		// must land at the project root — prebuild only ships templates/src/**,
		// so without the root/ embed they were never scaffolded (#187).
		expect(sv.files.has('drizzle.config.ts')).toBe(true);
		expect(sv.files.has('.env.example')).toBe(true);
		expect(sv.files.has('scripts/setup.sh')).toBe(true);
		expect(sv.files.has('static/robots.txt')).toBe(true);
		expect(sv.files.has('src/drizzle.config.ts')).toBe(false);
		expect(sv.files.has('src/.env.example')).toBe(false);
	});

	it('delivers the dashboard CI workflow with checks and required build env (#406)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);

		const workflow = sv.files.get('.github/workflows/ci.yml');
		expect(workflow).toContain('pull_request:');
		expect(workflow).toContain('push:');
		expect(workflow).toContain('bun install');
		expect(workflow).toContain('bun run check');
		expect(workflow).toContain('bun run test');
		expect(workflow).toContain('bun run build');
		expect(workflow).toContain('DATABASE_URL:');
		expect(workflow).toContain('BETTER_AUTH_SECRET:');
		expect(workflow).toContain('TEST_DATABASE_URL:');
		expect(workflow).toContain('image: postgres:17');
		expect(workflow).toContain('bunx drizzle-kit push --force');
	});

	it('scaffolds AGENTS.md with dashboard golden references (#267)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest');

		const agents = sv.files.get('AGENTS.md') ?? '';
		expect(agents).toMatch(/Golden references \(#267\)/);
		expect(agents).toMatch(/\/admin\/users/);
		// #322: parity is defined over every configured locale, not a hard-coded pair.
		expect(agents).toMatch(/EVERY catalog under .messages\//);
		expect(agents).toMatch(/never hard-code user-visible text/);
	});
});

describe('on-demand PM runners (#325 review) — exact commands, supported managers only', () => {
	it('maps every supported manager to its exact dlx command', () => {
		expect(DLX_RUNNERS).toEqual({
			npm: 'npx --yes',
			bun: 'bunx',
			pnpm: 'pnpm dlx'
		});
	});

	it('resolves the selected manager, version-qualified names included', () => {
		expect(resolveDlxRunner('npm')).toBe('npx --yes');
		expect(resolveDlxRunner('bun')).toBe('bunx');
		expect(resolveDlxRunner('pnpm')).toBe('pnpm dlx');
		expect(resolveDlxRunner('pnpm@9')).toBe('pnpm dlx');
		expect(resolveDlxRunner('bun@1.2')).toBe('bunx');
	});

	it('falls back to npx for yarn and unknown agents (documented behavior)', () => {
		expect(resolveDlxRunner('yarn')).toBe('npx --yes');
		expect(resolveDlxRunner('yarn@4')).toBe('npx --yes');
		expect(resolveDlxRunner('exotic-pm')).toBe('npx --yes');
		expect(resolveDlxRunner('')).toBe('npx --yes');
	});

	it('never advertises untested runtimes (Deno is out of scope, #325 review)', () => {
		expect(Object.keys(DLX_RUNNERS).map((k) => k.toLowerCase())).not.toContain('deno');
		expect(resolveDlxRunner('deno')).toBe('npx --yes'); // unknown → npx fallback
	});

	it('generated scripts use the selected manager runner, never another one', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', {}, 'pnpm');
		const pkg = JSON.parse(sv.files.get('package.json') ?? '{}') as Record<string, Record<string, string>>;
		expect(pkg.scripts['auth:schema']).toContain('pnpm dlx');
		expect(pkg.scripts['auth:schema']).not.toMatch(/\b(bunx|npx)\b/);
		expect(pkg.scripts['admin:create']).toContain('pnpm dlx');

		const svBun = fakeSv();
		applyDashboardMode(asSvApi(svBun), baseFiles, dashboardFiles, 'vitest', {}, 'bun');
		const pkgBun = JSON.parse(svBun.files.get('package.json') ?? '{}') as Record<string, Record<string, string>>;
		expect(pkgBun.scripts['auth:schema']).toContain('bunx');
		expect(pkgBun.scripts['auth:schema']).not.toMatch(/\b(npx|pnpm dlx)\b/);
	});
});
