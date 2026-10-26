import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, baseTemplateFile } from './helpers';
import { diskSv } from './helpers/fixtures';

const baseRoot = join(ROOT, 'packages/svforge/templates/base');

/**
 * Tests for #235 — the base template must ship with a runnable Vitest
 * baseline: vitest.config.ts actually delivered at the project root (prebuild
 * only embeds templates/base/src/**), an example test, and a working `test`
 * script. Option A of #235 (baseline in base) is the chosen decision.
 */
describe('base Vitest baseline (#235)', () => {
	describe('test infrastructure', () => {
		it('has a vitest config in the template source', () => {
			// The file lives under src/ so the prebuild embeds it; the mode
			// writes it at the PROJECT ROOT via ROOT_FILES.
			expect(existsSync(join(baseRoot, 'src', 'vitest.config.ts'))).toBe(true);
		});

		it('vitest config is embedded in the manifest', async () => {
			// Regression guard: vitest.config.ts must be part of the embedded
			// base manifest, otherwise it is never scaffolded (prebuild only
			// ships templates/base/src/**).
			const { baseFiles } = await import('../packages/svforge/src/templates');
			expect(Object.keys(baseFiles)).toContain('/vitest.config.ts');
		});

		it('base mode delivers vitest.config.ts at the project root (canonical resolver, #327)', async () => {
			// Behavioral: the mode writes '/vitest.config.ts' at the ROOT through
			// the shared destination resolver — and the upgrade recipe resolves
			// it to the same place (no install/upgrade drift).
			const { applyBaseMode } = await import('../packages/svforge/src/modes/base');
			const { BASE_ROOT_PATHS } = await import('../packages/svforge/src/destinations');
			const { resolveDestination } = await import('../packages/addon-kit/src/index');
			const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
			const { tmpdir } = await import('node:os');
			const dir = mkdtempSync(join(tmpdir(), 'sf-vitest-root-'));
			try {
				writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: {} }));
				const sv = diskSv(dir);
				applyBaseMode(sv as never, { '/vitest.config.ts': 'export default {};' }, {});
				expect(existsSync(join(dir, 'vitest.config.ts'))).toBe(true);
				expect(existsSync(join(dir, 'src/vitest.config.ts'))).toBe(false);
				expect(resolveDestination('/vitest.config.ts', BASE_ROOT_PATHS)).toBe('vitest.config.ts');
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it('defines a runnable test script in the base package template', () => {
			const pkg = readFileSync(join(baseRoot, 'package.json'), 'utf-8');
			expect(pkg).toMatch(/"test":\s*"vitest run"/);
			expect(pkg).toMatch(/"vitest":/);
		});
	});

	describe('example test', () => {
		it('has an example test shipped with the template', () => {
			expect(existsSync(baseTemplateFile('lib', 'example.test.ts'))).toBe(true);
		});

		it('covers a real base utility (cn)', () => {
			const content = readFileSync(baseTemplateFile('lib', 'example.test.ts'), 'utf-8');
			expect(content).toMatch(/describe\('cn utility'/);
		});
	});

	describe('scaffold guard (#235)', () => {
		it('test-scaffold.sh asserts root config and runs the baseline on base', () => {
			const script = readFileSync(join(ROOT, 'scripts', 'test-scaffold.sh'), 'utf-8');
			expect(script).toMatch(/TEMPLATE.*=.*"base"/s);
			expect(script).toMatch(/vitest\.config\.ts missing at project root/);
			expect(script).toMatch(/baseline vitest failed on \$TEMPLATE scaffold/);
		});
	});

	describe('svelte-check cleanliness (#271)', () => {
		it('base mode declares @types/node (Paraglide server.js imports async_hooks)', () => {
			const base = readFileSync(join(ROOT, 'packages/svforge/src/modes/base.ts'), 'utf-8');
			expect(base).toMatch(/devDependency\('@types\/node'/);
		});

		it('the generated check script compiles Paraglide before svelte-check', () => {
			const base = readFileSync(join(ROOT, 'packages/svforge/src/modes/base.ts'), 'utf-8');
			expect(base).toMatch(/paraglide-js compile --project \.\/project\.inlang --outdir \.\/src\/lib\/paraglide/);
			expect(base).toMatch(/svelte-check --tsconfig \.\/tsconfig\.json/);
			// #588: svelte-check must see the same URL-based locale strategy as the app.
			expect(base).toContain('--strategy url cookie baseLocale');
		});

		it('FR and EN catalogs declare home_title (used by +page.svelte)', () => {
			const fr = JSON.parse(
				readFileSync(join(baseRoot, 'root/messages/fr.json'), 'utf-8')
			);
			const en = JSON.parse(
				readFileSync(join(baseRoot, 'root/messages/en.json'), 'utf-8')
			);
			expect(fr.home_title).toBeTruthy();
			expect(en.home_title).toBeTruthy();
		});

		it('demo-ui code sample is a string constant, not a Svelte expression', () => {
			const demo = readFileSync(
				join(baseRoot, 'src/routes/demo-ui/+page.svelte'),
				'utf-8'
			);
			expect(demo).toMatch(/skeletonImportExample/);
			expect(demo).not.toContain('import {{ Accordion');
		});
	});
});
