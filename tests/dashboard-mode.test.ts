import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SvApi } from 'sv';
import svforgeAddon from '../packages/svforge/src/index';
import {
	applyDashboardMode,
	DLX_RUNNERS,
	patchAuthConfig,
	patchDotEnv,
	patchEnvConfig,
	patchHooksServer,
	resolveDlxRunner
} from '../packages/svforge/src/modes/dashboard';
import { dashboardRootFiles } from '../packages/svforge/src/templates';
import { OFFICIAL_FOUNDATION_FILES, seedOfficialFoundation, seedOfficialFoundationOnDisk } from './helpers/official-foundation';

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
			// Accumulate like the real sv add: later transforms read what the
			// official add-ons (seeded here) or a previous mode wrote.
			const seed = this.files.get(path) ?? (path === 'package.json' ? '{"scripts":{}}' : '');
			this.files.set(path, transform(seed));
		}
	};
	// #547: the official integrations run before SVForge, so their files exist.
	seedOfficialFoundation(sv.files);
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
// Root files STILL delivered by SVForge. drizzle.config.ts and .env.example
// are now produced by the official integrations (#547).
const rootFiles = {
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
});

describe('official foundation ownership (#547)', () => {
	it('never declares the official auth/DB packages or their scripts', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest');

		for (const owned of ['better-auth', 'drizzle-orm', 'postgres', 'drizzle-kit']) {
			expect(sv.dependencies, owned).not.toContain(owned);
			expect(sv.devDependencies, owned).not.toContain(owned);
		}
		expect(sv.dependencies).toContain('zod');

		const scripts = JSON.parse(sv.files.get('package.json')!).scripts;
		for (const owned of ['db:push', 'db:generate', 'db:migrate', 'db:studio', 'auth:schema']) {
			expect(scripts[owned], owned).toBeUndefined();
		}
		expect(scripts['admin:create']).toBeDefined();
	});

	it('no longer ships the foundation files in the dashboard template', () => {
		// The official add-ons own these paths; SVForge must not deliver them.
		for (const path of [
			'/lib/server/auth.ts',
			'/lib/server/db/index.ts',
			'/lib/server/db/auth.schema.ts',
			'/lib/server/auth.schema.config.ts',
			'/hooks.server.ts',
			'/app.d.ts',
			'/drizzle.config.ts'
		]) {
			expect(Object.keys(dashboardFiles), path).not.toContain(path);
		}
	});

	it('extends the official files instead of replacing them', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest');

		const auth = sv.files.get('src/lib/server/auth.ts') ?? '';
		expect(auth).toContain('betterAuth({');
		expect(auth).toContain('...svforgeAuthPolicy,');
		const hooks = sv.files.get('src/hooks.server.ts') ?? '';
		expect(hooks).toContain('const handleBetterAuth');
		expect(hooks).toContain('sequence(handleParaglide, handleBetterAuth, handleSvforgePolicy)');
		// The base template's Paraglide-only hook must NOT overwrite the
		// official Better Auth hook (it is seeded by fakeSv).
		expect(sv.files.get('src/app.d.ts')).toContain("from 'better-auth'");
	});

	it('spreads the SVForge auth policy into the official config and keeps plugins last', () => {
		const auth = patchAuthConfig(OFFICIAL_FOUNDATION_FILES['src/lib/server/auth.ts']);
		expect(auth).toContain("import { signupMode, svforgeAuthPolicy } from '#lib/server/auth-policy.js';");
		expect(auth).toContain('...svforgeAuthPolicy,');
		expect(auth).toContain("disableSignUp: signupMode === 'closed'");
		expect(auth.indexOf('...svforgeAuthPolicy,')).toBeLessThan(auth.indexOf('plugins: ['));
		// Idempotent.
		expect(patchAuthConfig(auth)).toBe(auth);
	});

	it('appends the SVForge guard to the official Paraglide + Better Auth sequence', () => {
		// #547 phase B: the official add-ons already compose both handles.
		const hooks = patchHooksServer(OFFICIAL_FOUNDATION_FILES['src/hooks.server.ts']);
		expect(hooks).toContain("import { handleSvforgePolicy } from '#lib/server/auth-guard.js';");
		expect(hooks).toContain('sequence(handleParaglide, handleBetterAuth, handleSvforgePolicy)');
		// No duplicate paraglide handle definition.
		expect(hooks.match(/const handleParaglide/g)).toHaveLength(1);
		// Idempotent.
		expect(patchHooksServer(hooks)).toBe(hooks);
	});

	it('still composes both handles when only the auth foundation is present (legacy direct add)', () => {
		const authOnly = OFFICIAL_FOUNDATION_FILES['src/hooks.server.ts']
			.replace(/import \{ getTextDirection \}.*\n/, '')
			.replace(/import \{ paraglideMiddleware \}.*\n/, '')
			.replace(/const handleParaglide[\s\S]*?\n\};\n\n/, '')
			.replace('sequence(handleParaglide, handleBetterAuth)', 'handleBetterAuth')
			.replace("import { type Handle, sequence } from '@sveltejs/kit/hooks';", "import type { Handle } from '@sveltejs/kit/hooks';");
		const hooks = patchHooksServer(authOnly);
		expect(hooks).toContain('handleParaglide');
		expect(hooks).toContain('sequence(handleParaglide, handleBetterAuth, handleSvforgePolicy)');
	});

	it('declares SIGNUP_MODE in env.ts and appends it to both dotenv files', () => {
		const env = patchEnvConfig(OFFICIAL_FOUNDATION_FILES['src/env.ts']);
		expect(env).toContain('SIGNUP_MODE');
		expect(env).toContain("value ?? 'closed'");
		expect(patchEnvConfig(env)).toBe(env);

		for (const file of ['.env', '.env.example']) {
			const updated = patchDotEnv(OFFICIAL_FOUNDATION_FILES[file]);
			expect(updated, file).toContain('SIGNUP_MODE="closed"');
			expect(updated, file).toContain('DATABASE_URL');
			expect(patchDotEnv(updated), file).toBe(updated);
		}
	});

	it('fails loudly when the official output is missing (direct sv add without the official add-ons)', () => {
		expect(() => patchAuthConfig('')).toThrow(/better-auth\/minimal/);
		expect(() => patchHooksServer('')).toThrow(/hooks\.server\.ts/);
		expect(() => patchEnvConfig('')).toThrow(/defineEnvVars/);
	});
});

describe('delivered project files', () => {
	it('writes test configs at the project root, not under src/ (#186)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'playwright');

		expect(sv.files.has('playwright.config.ts')).toBe(true);
		expect(sv.files.has('vitest.config.ts')).toBe(true);
		expect(sv.files.has('e2e/auth.test.ts')).toBe(true);
		expect(sv.files.has('src/playwright.config.ts')).toBe(false);
		expect(sv.files.has('src/vitest.config.ts')).toBe(false);
		expect(sv.files.has('src/e2e/auth.test.ts')).toBe(false);
	});

	it('writes the remaining SVForge root-level files at the project root (#187)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', rootFiles);

		expect(sv.files.has('scripts/setup.sh')).toBe(true);
		expect(sv.files.has('static/robots.txt')).toBe(true);
		expect(sv.files.has('src/scripts/setup.sh')).toBe(false);
		expect(sv.files.has('src/static/robots.txt')).toBe(false);
	});

	it.each([
		{
			pm: 'bun',
			setup: 'oven-sh/setup-bun@v2',
			install: 'bun install --frozen-lockfile',
			run: 'bun run',
			drizzle: 'bunx drizzle-kit',
			foreignPm: /\b(npm|npx|pnpm|yarn|corepack)\b/
		},
		{
			pm: 'npm',
			setup: 'actions/setup-node@v4',
			install: 'npm ci',
			run: 'npm run',
			drizzle: 'npx --no-install drizzle-kit',
			foreignPm: /\b(bun|bunx|pnpm|yarn)\b/
		},
		{
			pm: 'pnpm@9',
			setup: 'pnpm/action-setup@v4',
			install: 'pnpm install --frozen-lockfile',
			run: 'pnpm run',
			drizzle: 'pnpm exec drizzle-kit',
			foreignPm: /\b(bun|bunx|npm|npx|yarn)\b/
		},
		{
			pm: 'yarn@1',
			setup: 'corepack enable',
			install: 'yarn install --frozen-lockfile',
			run: 'yarn run',
			drizzle: 'yarn run drizzle-kit',
			foreignPm: /\b(bun|bunx|npm|npx|pnpm)\b/
		},
		{
			pm: 'yarn@4.5.0',
			setup: 'corepack enable',
			install: 'yarn install --immutable',
			run: 'yarn run',
			drizzle: 'yarn run drizzle-kit',
			foreignPm: /\b(bun|bunx|npm|npx|pnpm)\b/
		}
	])('delivers PM-specific frozen CI commands for $pm (#406)', ({ pm, setup, install, run, drizzle, foreignPm }) => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', dashboardRootFiles, pm);

		const workflow = sv.files.get('.github/workflows/ci.yml')!;
		expect(workflow).toContain('pull_request:');
		expect(workflow).toContain('push:');
		expect(workflow).toContain(setup);
		expect(workflow).toContain(`run: ${install}`);
		expect(workflow).toContain(`run: ${run} check`);
		expect(workflow).toContain(`run: ${run} test`);
		expect(workflow).toContain(`run: ${run} build`);
		expect(workflow).toContain(`run: ${drizzle} push --force`);
		expect(workflow).toContain('DATABASE_URL:');
		expect(workflow).toContain('BETTER_AUTH_SECRET:');
		expect(workflow).toContain('TEST_DATABASE_URL:');
		expect(workflow).toContain('image: postgres:17');
		expect(workflow).not.toContain('{{');
		expect(workflow).not.toMatch(foreignPm);
	});

	it('uses npm CI commands when the package manager argument is omitted', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', dashboardRootFiles);

		const workflow = sv.files.get('.github/workflows/ci.yml')!;
		expect(workflow).toContain('run: npm ci');
		expect(workflow).toContain('run: npm run check');
		expect(workflow).not.toMatch(/\b(bun|bunx)\b/);
	});

	it.each([
		{ pm: 'yarn@4.5.0', setup: 'corepack prepare yarn@4.5.0 --activate', install: 'yarn install --immutable' },
		{ pm: 'pnpm@9.15.4', setup: 'version: 9.15.4', install: 'pnpm install --frozen-lockfile' },
		{ pm: 'bun@1.2.0', setup: 'bun-version: 1.2.0', install: 'bun install --frozen-lockfile' }
	])('preserves the versioned package manager through the addon run path ($pm)', async ({ pm, setup, install }) => {
		const sv = fakeSv();
		// #547 phase C: the add-on preflights the official output on disk.
		const dir = mkdtempSync(join(tmpdir(), 'sf-addon-run-'));
		writeFileSync(join(dir, 'package.json'), '{"name":"app","imports":{}}');
		seedOfficialFoundationOnDisk(dir);
		try {
			await svforgeAddon.run({
			sv: asSvApi(sv),
			cancel: () => {},
			cwd: dir,
			dependencyVersion: () => undefined,
			language: 'ts',
			file: {
				viteConfig: 'vite.config.ts',
				typeConfig: 'tsconfig.json',
				stylesheet: 'src/routes/layout.css',
				package: 'package.json',
				gitignore: '.gitignore',
				getRelative: ({ to }) => to,
				findUp: (filename) => filename
			},
			isKit: true,
			directory: { src: 'src', lib: 'src/lib', kitRoutes: 'src/routes' },
			packageManager: pm as Parameters<typeof svforgeAddon.run>[0]['packageManager'],
			options: { template: 'dashboard', testing: 'vitest', hooks: 'none' }
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}

		const workflow = sv.files.get('.github/workflows/ci.yml')!;
		expect(workflow).toContain(setup);
		expect(workflow).toContain(`run: ${install}`);
	});

	it('scaffolds AGENTS.md with dashboard golden references (#267)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest');

		const agents = sv.files.get('AGENTS.md') ?? '';
		expect(agents).toMatch(/Golden references \(#267\)/);
		expect(agents).toMatch(/\/admin\/users/);
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

	it('admin:create uses the selected manager runner, never another one', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', {}, 'pnpm');
		const pkg = JSON.parse(sv.files.get('package.json') ?? '{}') as Record<string, Record<string, string>>;
		expect(pkg.scripts['admin:create']).toContain('pnpm dlx');

		const svBun = fakeSv();
		applyDashboardMode(asSvApi(svBun), baseFiles, dashboardFiles, 'vitest', {}, 'bun');
		const pkgBun = JSON.parse(svBun.files.get('package.json') ?? '{}') as Record<string, Record<string, string>>;
		expect(pkgBun.scripts['admin:create']).toContain('bun');
	});

	it('ships explicit local-development entry points (#589)', () => {
		const sv = fakeSv();
		applyDashboardMode(asSvApi(sv), baseFiles, dashboardFiles, 'vitest', {}, 'npm');
		const scripts = JSON.parse(sv.files.get('package.json') ?? '{}').scripts as Record<string, string>;
		expect(scripts['dev:setup']).toBe('bash scripts/setup.sh --compose --init-schema --admin');
		expect(scripts['dev:local']).toBe('bash scripts/setup.sh --compose --init-schema --admin && vite dev');
	});
});
