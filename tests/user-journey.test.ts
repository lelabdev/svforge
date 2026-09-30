import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { addonSpec, assertPackagedEntrypoints, extractAddon, packLocalAddon, parseUserJourneyArgs } =
	await import('../scripts/user-journey.mjs');

/** Create a minimal addon package whose tarball only contains `files`. */
function fixtureAddon(root: string, { includeEntrypoints = true }: { includeEntrypoints?: boolean } = {}) {
	const pkg = join(root, 'addon');
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

describe('published user journey smoke test (#462)', () => {
	it('defaults to a local run of both journeys and keeps explicit selections', () => {
		expect(parseUserJourneyArgs([])).toEqual({ mode: 'local', version: null, templates: ['base', 'dashboard'] });
		expect(parseUserJourneyArgs(['--published'])).toEqual({ mode: 'published', version: null, templates: ['base', 'dashboard'] });
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

	it('builds the documented add-on specifier for a local tarball and an npm version', () => {
		expect(addonSpec({ source: 'file:/tmp/registry/svforge', template: 'base' })).toBe(
			'file:/tmp/registry/svforge=template:base+testing:vitest+hooks:none'
		);
		expect(addonSpec({ source: 'svforge@2.0.1', template: 'dashboard' })).toBe(
			'svforge@2.0.1=template:dashboard+testing:vitest+hooks:none'
		);
	});

	it('packs a local addon and extracts the published file set from the tarball', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-journey-fixture-'));
		try {
			const pkg = fixtureAddon(root);
			const tarball = packLocalAddon(pkg, join(root, 'packs'));
			expect(tarball.endsWith('.tgz')).toBe(true);
			const extracted = extractAddon(tarball, join(root, 'registry', 'fixture-addon'));
			// The extracted directory is the tarball contents, NOT the repo source.
			expect(assertPackagedEntrypoints(extracted)).toContain('bin/cli.mjs');
			expect(assertPackagedEntrypoints(extracted)).toContain('dist/index.js');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails when a declared entry point is missing from the packed tarball', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-journey-missing-'));
		try {
			const pkg = fixtureAddon(root, { includeEntrypoints: false });
			const tarball = packLocalAddon(pkg, join(root, 'packs'));
			const extracted = extractAddon(tarball, join(root, 'registry', 'fixture-addon'));
			expect(() => assertPackagedEntrypoints(extracted)).toThrow(/dist\/index\.js/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('runs the local package gate before publication and the published run after it', () => {
		const publish = readFileSync(join(process.cwd(), '.github', 'workflows', 'publish.yml'), 'utf8');
		const local = publish.indexOf('scripts/test-user-journey.sh');
		const published = publish.indexOf('scripts/test-user-journey.sh --published');
		const publishStep = publish.indexOf('name: Publish release plan');

		expect(local).toBeGreaterThan(-1);
		expect(published).toBeGreaterThan(local);
		expect(local).toBeLessThan(publishStep);
		expect(published).toBeGreaterThan(publishStep);
	});
});
