import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const {
	addonSpec,
	assertPackagedEntrypoints,
	extractAddon,
	goldenPathCreateArgs,
	installSv,
	packLocalAddon,
	packModuleSet,
	parseUserJourneyArgs,
	resolveSource,
	resolveSvVersion
} = await import('../scripts/user-journey.mjs');

type Run = typeof import('node:child_process').execFileSync;
const noopRun = (() => {}) as unknown as Run;

/** Create a minimal addon package whose tarball only contains `files`. */
function fixtureAddon(pkg: string, { includeEntrypoints = true }: { includeEntrypoints?: boolean } = {}) {
	mkdirSync(join(pkg, 'dist'), { recursive: true });
	mkdirSync(join(pkg, 'bin'), { recursive: true });
	writeFileSync(join(pkg, 'bin', 'cli.mjs'), '#!/usr/bin/env node\n');
	if (includeEntrypoints) {
		writeFileSync(join(pkg, 'dist', 'index.js'), 'export {};\n');
		writeFileSync(join(pkg, 'dist', 'index.d.ts'), 'export {};\n');
	}
	writeFileSync(
		join(pkg, 'package.json'),
		`${JSON.stringify(
			{
				name: 'fixture-addon',
				version: '0.0.1',
				type: 'module',
				bin: { 'fixture-addon': './bin/cli.mjs' },
				exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
				files: includeEntrypoints ? ['dist/', 'bin/'] : ['bin/']
			},
			null,
			2
		)}\n`
	);
	return pkg;
}

/** A repository checkout with NO installed tooling (no node_modules). */
function journeyRoot(root: string) {
	writeFileSync(
		join(root, 'package.json'),
		`${JSON.stringify({ name: 'repo', private: true, devDependencies: { sv: '^0.15.3' } }, null, 2)}\n`
	);
	fixtureAddon(join(root, 'packages', 'svforge'));
	return root;
}

describe('external user journey smoke test (#462, #465)', () => {
	it('defaults to a local run of both journeys and keeps explicit selections', () => {
		expect(parseUserJourneyArgs([])).toEqual({ mode: 'local', version: null, templates: ['base', 'dashboard'] });
		expect(parseUserJourneyArgs(['--published', '2.0.1'])).toEqual({ mode: 'published', version: '2.0.1', templates: ['base', 'dashboard'] });
		expect(parseUserJourneyArgs(['--template', 'base'])).toEqual({ mode: 'local', version: null, templates: ['base'] });
		expect(parseUserJourneyArgs(['--published', '2.0.1', '--template', 'dashboard', '--template', 'base'])).toEqual({
			mode: 'published',
			version: '2.0.1',
			templates: ['dashboard', 'base']
		});
	});

	it('rejects an unknown argument instead of silently running the wrong journey', () => {
		expect(() => parseUserJourneyArgs(['--nope'])).toThrow(/Unknown argument/);
	});

	it('rejects --published without an exact version instead of falling back to latest', () => {
		expect(() => parseUserJourneyArgs(['--published'])).toThrow(/requires an exact version/);
		expect(() => parseUserJourneyArgs(['--published', '--template', 'base'])).toThrow(/requires an exact version/);

		const root = mkdtempSync(join(tmpdir(), 'svforge-journey-no-version-'));
		try {
			journeyRoot(root);
			expect(() => resolveSource(['--published', '--dest', join(root, 'scratch')], { root, run: noopRun })).toThrow(
				/requires an exact version/
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('builds the documented add-on specifier for a local tarball and an npm version', () => {
		expect(addonSpec({ source: 'file:/tmp/registry/svforge', template: 'base' })).toBe(
			'file:/tmp/registry/svforge=template:base+testing:vitest+hooks:none'
		);
		expect(addonSpec({ source: 'svforge@2.0.1', template: 'dashboard' })).toBe(
			'svforge@2.0.1=template:dashboard+testing:vitest+hooks:none'
		);
	});

	it('reads the pinned sv version instead of any checkout binary', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-sv-version-'));
		try {
			writeFileSync(join(root, 'package.json'), `${JSON.stringify({ devDependencies: { sv: '^0.15.3' } })}\n`);
			expect(resolveSvVersion(root)).toBe('0.15.3');
			expect(resolveSvVersion(root, { override: 'latest' })).toBe('latest');

			writeFileSync(join(root, 'package.json'), `${JSON.stringify({ devDependencies: {} })}\n`);
			expect(() => resolveSvVersion(root)).toThrow(/does not pin/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('acquires sv externally into the scratch prefix', () => {
		const scratch = mkdtempSync(join(tmpdir(), 'svforge-sv-scratch-'));
		try {
			const calls: { cmd: string; args: string[] }[] = [];
			const run = ((cmd: string, args: string[]) => {
				calls.push({ cmd, args });
			}) as unknown as Run;
			const bin = installSv(scratch, '0.15.4', { run });
			expect(calls).toHaveLength(1);
			expect(calls[0].cmd).toBe('npm');
			expect(calls[0].args).toContain('sv@0.15.4');
			expect(calls[0].args).toContain('--prefix');
			expect(bin).toBe(join(scratch, 'node_modules', '.bin', 'sv'));
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});

	it('packs a local addon and extracts the published file set from the tarball', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-journey-fixture-'));
		try {
			const pkg = fixtureAddon(join(root, 'addon'));
			const tarball = packLocalAddon(pkg, join(root, 'packs'));
			expect(tarball.endsWith('.tgz')).toBe(true);
			const extracted = extractAddon(tarball, join(root, 'registry', 'fixture-addon'));
			expect(assertPackagedEntrypoints(extracted)).toContain('bin/cli.mjs');
			expect(assertPackagedEntrypoints(extracted)).toContain('dist/index.js');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 30_000);

	it('fails when a declared entry point is missing from the packed tarball', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-journey-missing-'));
		try {
			const pkg = fixtureAddon(join(root, 'addon'), { includeEntrypoints: false });
			const tarball = packLocalAddon(pkg, join(root, 'packs'));
			const extracted = extractAddon(tarball, join(root, 'registry', 'fixture-addon'));
			expect(() => assertPackagedEntrypoints(extracted)).toThrow(/dist\/index\.js/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 30_000);

	it('resolves the local artifact from a scratch prefix without any checkout tooling', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-journey-root-'));
		try {
			journeyRoot(root);
			const scratch = join(root, 'scratch');
			expect(existsSync(join(root, 'node_modules'))).toBe(false);

			const source = resolveSource(['--dest', scratch], { root, run: noopRun });
			expect(source).toBe(`file:${join(scratch, 'registry', 'svforge')}`);
			expect(existsSync(join(scratch, 'registry', 'svforge', 'dist', 'index.js'))).toBe(true);
			// The repository checkout stays untouched: no node_modules is created there.
			expect(existsSync(join(root, 'node_modules'))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 30_000);

	it('tests the exact published version and never falls back to a checkout spec', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-journey-published-'));
		try {
			journeyRoot(root);
			const scratch = join(root, 'scratch');
			expect(resolveSource(['--published', '2.0.1', '--dest', scratch], { root, run: noopRun })).toBe('svforge@2.0.1');
			expect(resolveSource(['--published', '2.0.1', '--sv', 'latest', '--dest', scratch], { root, run: noopRun })).toBe('svforge@2.0.1');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('runs the local package gate before publication and the exact published version after it', () => {
		const publish = readFileSync(join(process.cwd(), '.github', 'workflows', 'publish.yml'), 'utf8');
		const local = publish.indexOf('scripts/test-user-journey.sh');
		const published = publish.indexOf('scripts/test-user-journey.sh --published');
		const publishStep = publish.indexOf('name: Publish release plan');

		expect(local).toBeGreaterThan(-1);
		expect(published).toBeGreaterThan(local);
		expect(local).toBeLessThan(publishStep);
		expect(published).toBeGreaterThan(publishStep);
		// Post-publish mode must read the exact version from the release plan.
		expect(publish).toMatch(/release-plan\.json/);
		expect(publish).toMatch(/--published "\$VERSION"/);
	});

	it('keeps the heavy journey out of the default PR pipeline (#413)', () => {
		const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
		expect(ci).not.toContain('test-user-journey.sh');
	});
});

describe('golden path one-command creator (#470)', () => {
	it('builds the exact non-interactive svforge create argv per template', () => {
		// A base project: an opt-in module, no runtime requirement.
		expect(goldenPathCreateArgs({ dir: 'app', template: 'base' })).toEqual([
			'create',
			'app',
			'--template',
			'base',
			'--pm',
			'bun',
			'--testing',
			'vitest',
			'--hooks',
			'none',
			'--modules',
			'ui_toast',
			'--yes'
		]);

		// A dashboard project: the complete canonical set implies the runtime.
		const dashboard = goldenPathCreateArgs({ dir: 'app', template: 'dashboard' });
		expect(dashboard).toEqual(expect.arrayContaining(['--modules', 'all', '--runtime', 'long-lived-node', '--yes']));
	});

	it('carries the explicit add-on source — packed artifacts or the exact published version', () => {
		const local = goldenPathCreateArgs({ dir: 'app', template: 'base', addonRoot: '/tmp/registry' });
		expect(local).toContain('--addon-root');
		expect(local).toContain('/tmp/registry');
		expect(local).not.toContain('--addon-version');

		const published = goldenPathCreateArgs({ dir: 'app', template: 'dashboard', addonVersion: '2.0.1' });
		expect(published).toContain('--addon-version');
		expect(published).toContain('2.0.1');
		// Post-publish must never fall back to an implicit `latest`.
		expect(published.join(' ')).not.toMatch(/@latest/);
	});

	it('carries the release compatibility manifest for post-publish validation', () => {
		const args = goldenPathCreateArgs({ dir: 'app', template: 'dashboard', compatManifest: '/tmp/svforge-compat.json' });
		expect(args).toContain('--compat-manifest');
		expect(args).toContain('/tmp/svforge-compat.json');
		expect(args).not.toContain('--addon-version');
	});

	it('packs and extracts every module add-on into the addon-root registry', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-golden-root-'));
		try {
			// A repository checkout with two module packages, no node_modules.
			writeFileSync(
				join(root, 'package.json'),
				`${JSON.stringify({ name: 'repo', private: true, devDependencies: { sv: '^0.15.3' } }, null, 2)}\n`
			);
			fixtureAddon(join(root, 'packages', 'svforge'));
			fixtureAddon(join(root, 'packages', 'dnd'));
			fixtureAddon(join(root, 'packages', 'ui_toast'));

			const registry = packModuleSet({ root, destination: join(root, 'scratch') });
			expect(registry).toBe(join(root, 'scratch', 'registry'));
			// svforge is packed separately by resolveSource — skipped here.
			expect(existsSync(join(registry, 'svforge'))).toBe(false);
			expect(existsSync(join(registry, 'dnd', 'bin', 'cli.mjs'))).toBe(true);
			expect(existsSync(join(registry, 'ui_toast', 'dist', 'index.js'))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);

	it('wires the pre-publish golden path before publication and the exact published version after it (#470)', () => {
		const publish = readFileSync(join(process.cwd(), '.github', 'workflows', 'publish.yml'), 'utf8');
		const prePublish = publish.indexOf('Golden path (local package)');
		const publishStep = publish.indexOf('name: Publish release plan');
		const postPublish = publish.indexOf('Golden path (published)');
		expect(prePublish).toBeGreaterThan(-1);
		expect(postPublish).toBeGreaterThan(-1);
		// Pre-publish must block the publish; post-publish asserts the registry.
		expect(prePublish).toBeLessThan(publishStep);
		expect(postPublish).toBeGreaterThan(publishStep);
		// Post-publish resolves the EXACT per-package versions from the release
		// plan's compatibility manifest — never a single shared version (#470).
		expect(publish).toContain('plan.compatibility');
		expect(publish).toContain('--compat-manifest /tmp/svforge-compat.json');
	});
});
