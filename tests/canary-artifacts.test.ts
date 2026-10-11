import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packCanaryCandidates } from '../scripts/canary-artifacts.mjs';

type PackedPackage = { name: string; version: string; directory: string; snapshot: boolean; tarball?: string };

describe('canary npm artifacts (#563)', () => {
	it('installs interdependent snapshot tarballs together in a clean offline consumer', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-canary-consumer-'));
		try {
			for (const [directory, name, source] of [
				['core', '@svforge/core', "module.exports = { core: 'snapshot' };\n"],
				['extension', '@svforge/extension', "module.exports = require('@svforge/core');\n"]
			] as const) {
				mkdirSync(join(root, 'packages', directory), { recursive: true });
				const manifest = {
					name,
					version: '0.0.0-canary-abcdef012345-1',
					main: 'index.js',
					...(directory === 'extension' ? { dependencies: { '@svforge/core': '0.0.0-canary-abcdef012345-1' } } : {})
				};
				writeFileSync(join(root, 'packages', directory, 'package.json'), JSON.stringify(manifest));
				writeFileSync(join(root, 'packages', directory, 'index.js'), source);
			}
			const plan = {
				packages: [
					{ name: '@svforge/core', version: '0.0.0-canary-abcdef012345-1', directory: 'packages/core', snapshot: true },
					{ name: '@svforge/extension', version: '0.0.0-canary-abcdef012345-1', directory: 'packages/extension', snapshot: true }
				],
				candidates: [
					{ name: '@svforge/core', version: '0.0.0-canary-abcdef012345-1', directory: 'packages/core', snapshot: true },
					{ name: '@svforge/extension', version: '0.0.0-canary-abcdef012345-1', directory: 'packages/extension', snapshot: true }
				]
			};
			const outputDir = join(root, 'tarballs');
			const packed = packCanaryCandidates(plan, root, outputDir);
			const consumer = join(root, 'consumer');
			mkdirSync(consumer);
			writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true }));
			execFileSync('npm', [
				'install', '--offline', '--ignore-scripts', '--no-package-lock', '--no-save',
				'--audit=false', '--fund=false', ...packed.candidates.map((pkg: PackedPackage) => pkg.tarball!)
			], { cwd: consumer, stdio: 'pipe' });
			const result = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("@svforge/extension").core)'], {
				cwd: consumer, encoding: 'utf8'
			});
			expect(result).toBe('snapshot');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('packs only selected snapshot candidates and records their exact tarballs for external consumers', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-canary-pack-'));
		try {
			for (const [directory, name, version] of [
				['cli', 'svforge', '0.0.0-canary-sha-1'],
				['addon', '@svforge/addon', '0.0.0-canary-sha-1'],
				['stable', '@svforge/stable', '2.3.0']
			]) {
				mkdirSync(join(root, 'packages', directory), { recursive: true });
				writeFileSync(join(root, 'packages', directory, 'package.json'), JSON.stringify({ name, version }));
			}
			const plan: { packages: PackedPackage[]; candidates: PackedPackage[] } = {
				packages: [
					{ name: 'svforge', version: '0.0.0-canary-sha-1', directory: 'packages/cli', snapshot: true },
					{ name: '@svforge/addon', version: '0.0.0-canary-sha-1', directory: 'packages/addon', snapshot: true },
					{ name: '@svforge/stable', version: '2.3.0', directory: 'packages/stable', snapshot: false }
				],
				candidates: [
					{ name: 'svforge', version: '0.0.0-canary-sha-1', directory: 'packages/cli', snapshot: true },
					{ name: '@svforge/addon', version: '0.0.0-canary-sha-1', directory: 'packages/addon', snapshot: true }
				]
			};
			const calls: string[] = [];
			const packed = packCanaryCandidates(plan, root, join(root, 'out'), (packageDir: string, outputDir: string) => {
				calls.push(packageDir);
				const filename = `${calls.length}.tgz`;
				writeFileSync(join(outputDir, filename), 'packed');
				const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
				return { name: manifest.name, version: manifest.version, filename };
			});
			expect(calls).toHaveLength(2);
			expect((packed.packages as PackedPackage[]).find((pkg) => pkg.name === 'svforge')?.tarball).toBe(join(root, 'out', '1.tgz'));
			expect((packed.packages as PackedPackage[]).find((pkg) => pkg.name === '@svforge/stable')).not.toHaveProperty('tarball');
			expect((packed.candidates as PackedPackage[]).every((pkg) => pkg.tarball)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
