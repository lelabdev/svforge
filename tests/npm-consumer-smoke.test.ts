import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { consumerInstallSpecs, consumerSource, consumerTsConfig, packageTypePath, validateInstalledTypes } = await import('../scripts/npm-consumer-smoke.mjs');

describe('npm consumer smoke test (#330)', () => {
	it('resolves the declared type entry for every exact package', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-consumer-fixture-'));
		try {
			const plan = {
				packages: [
					{ name: '@svforge/audit', version: '0.0.1' },
					{ name: 'svforge', version: '1.2.0' }
				]
			};
			for (const pkg of plan.packages) {
				const packageRoot = join(root, 'node_modules', ...pkg.name.split('/'));
				mkdirSync(join(packageRoot, 'dist'), { recursive: true });
				writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
					name: pkg.name,
					types: './dist/index.d.ts',
					exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }
				}));
				writeFileSync(join(packageRoot, 'dist/index.d.ts'), 'export {};\n');
			}

			expect(packageTypePath({ types: './dist/index.d.ts' })).toBe('./dist/index.d.ts');
			expect(validateInstalledTypes(plan, root)).toEqual([]);
			expect(consumerSource(plan)).toContain("import * as package0 from \"@svforge/audit\";");
			expect(consumerSource(plan)).toContain("import * as package1 from \"svforge\";");
			expect(consumerTsConfig().compilerOptions.moduleResolution).toBe('NodeNext');
			expect(consumerTsConfig().compilerOptions.noEmit).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('installs snapshot tarballs locally while pinning unchanged packages to exact stable versions', () => {
		const plan = {
			packages: [
				{ name: '@svforge/changed', version: '0.0.0-canary-sha-1', snapshot: true, tarball: '/tmp/changed.tgz' },
				{ name: '@svforge/unchanged', version: '2.4.0', snapshot: false }
			]
		};
		expect(consumerInstallSpecs(plan)).toEqual(['/tmp/changed.tgz', '@svforge/unchanged@2.4.0']);
		expect(consumerInstallSpecs(plan, { registryOnly: true })).toEqual([
			'@svforge/changed@0.0.0-canary-sha-1', '@svforge/unchanged@2.4.0'
		]);
	});

	it('reports a package with a missing declaration entry', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-consumer-missing-'));
		try {
			const packageRoot = join(root, 'node_modules', '@svforge', 'audit');
			mkdirSync(packageRoot, { recursive: true });
			writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
				name: '@svforge/audit',
				types: './dist/index.d.ts'
			}));
			expect(validateInstalledTypes({ packages: [{ name: '@svforge/audit', version: '0.0.1' }] }, root)).toEqual([
				'@svforge/audit: declared TypeScript entry point is missing'
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
