import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsInitialBaseline, prepareVersionPackages, readPackageVersions, runChangesetsVersion, selectReleaseCandidates } from '../scripts/version-packages.mjs';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Changesets release candidate manifest', () => {
	it('records changed versions and unchanged first-time packages for review', () => {
		const before = [
			{ name: 'svforge', version: '2.1.1' },
			{ name: '@svforge/addon', version: '2.0.2' },
			{ name: '@svforge/current', version: '1.4.0' }
		];
		const after = [
			{ name: 'svforge', version: '2.1.2', directory: 'packages/svforge' },
			{ name: '@svforge/addon', version: '2.0.2', directory: 'packages/addon', private: false },
			{ name: '@svforge/current', version: '1.4.0', directory: 'packages/current' },
			{ name: '@svforge/private', version: '1.0.0', directory: 'packages/private', private: true }
		];
		const published = new Set(['@svforge/current@1.4.0']);

		const candidates = selectReleaseCandidates(before, after, (name: string, version: string) => published.has(`${name}@${version}`));

		expect(candidates).toEqual([
			{ name: 'svforge', version: '2.1.2', directory: 'packages/svforge' },
			{ name: '@svforge/addon', version: '2.0.2', directory: 'packages/addon' }
		]);
	});

	it('writes the reviewed candidate manifest after Changesets versioning without publishing', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-version-packages-'));
		roots.push(root);
		mkdirSync(join(root, '.changeset'), { recursive: true });
		for (const [directory, name, version] of [
			['svforge', 'svforge', '1.0.0'],
			['addon', '@svforge/addon', '2.0.0'],
			['current', '@svforge/current', '3.0.0']
		]) {
			const packageDir = join(root, 'packages', directory);
			mkdirSync(packageDir, { recursive: true });
			writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name, version }));
		}
		const commands: string[] = [];
		const candidates = prepareVersionPackages(root, (command: string, args: string[]) => {
			commands.push(`${command} ${args.join(' ')}`);
			if (args[0] === 'x') {
				writeFileSync(join(root, 'packages/svforge/package.json'), JSON.stringify({ name: 'svforge', version: '1.1.0' }));
			}
			return Buffer.from('');
		}, (name: string, version: string) => name === '@svforge/current' && version === '3.0.0');

		expect(commands).toEqual([
			'bun x changeset version',
			'bun install --ignore-scripts',
			'bun run --filter svforge prebuild'
		]);
		expect(candidates).toEqual([
			{ name: '@svforge/addon', version: '2.0.0', directory: 'packages/addon' },
			{ name: 'svforge', version: '1.1.0', directory: 'packages/svforge' }
		]);
		expect(JSON.parse(readFileSync(join(root, '.changeset/release-candidates.json'), 'utf8')).packages).toEqual(candidates);
	});

	it('fails on duplicate package identities rather than producing an ambiguous manifest', () => {
		const duplicate = [
			{ name: '@svforge/dup', version: '1.0.0', directory: 'packages/one' },
			{ name: '@svforge/dup', version: '1.0.0', directory: 'packages/two' }
		];

		expect(() => selectReleaseCandidates([], duplicate, () => false)).toThrow(/duplicate package/);
	});
	it('temporarily fixes all 15 packages for the first 2.2.0 release, then restores independent config', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-first-release-'));
		roots.push(root);
		mkdirSync(join(root, '.changeset'), { recursive: true });
		const originalConfig = JSON.stringify({ fixed: [], linked: [], access: 'public' }, null, 2) + '\n';
		writeFileSync(join(root, '.changeset/config.json'), originalConfig);
		const names = ['svforge', ...Array.from({ length: 14 }, (_, index) => `@svforge/addon-${index}`)];
		for (const name of names) {
			const directory = name === 'svforge' ? 'svforge' : name.slice('@svforge/'.length);
			const location = join(root, 'packages', directory);
			mkdirSync(location, { recursive: true });
			writeFileSync(join(location, 'package.json'), JSON.stringify({
				name, version: name === 'svforge' ? '2.1.1' : '2.0.2'
			}));
		}
		const before = readPackageVersions(root);
		expect(needsInitialBaseline(before)).toBe(true);
		let sawTemporaryFixed = false;
		const isInitial = runChangesetsVersion(root, before, (command: string, args: string[]) => {
			expect([command, ...args]).toEqual(['bun', 'x', 'changeset', 'version']);
			const active = JSON.parse(readFileSync(join(root, '.changeset/config.json'), 'utf8'));
			sawTemporaryFixed = active.fixed.length === 1 &&
				active.fixed[0].slice().sort().join(',') === names.slice().sort().join(',');
			for (const pkg of before) {
				writeFileSync(join(root, pkg.directory, 'package.json'), JSON.stringify({ name: pkg.name, version: '2.2.0' }));
			}
		});
		expect(isInitial).toBe(true);
		expect(sawTemporaryFixed).toBe(true);
		expect(readPackageVersions(root).every((pkg) => pkg.version === '2.2.0')).toBe(true);
		expect(readFileSync(join(root, '.changeset/config.json'), 'utf8')).toBe(originalConfig);
	});

	it('restores independent configuration even if initial Changesets versioning fails', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-initial-failure-'));
		roots.push(root);
		mkdirSync(join(root, '.changeset'), { recursive: true });
		const originalConfig = JSON.stringify({ fixed: [], linked: [] });
		writeFileSync(join(root, '.changeset/config.json'), originalConfig);
		const before = [{ name: 'svforge', version: '2.1.1' },
			...Array.from({ length: 14 }, (_, index) => ({ name: `@svforge/addon-${index}`, version: '2.0.2' }))];
		expect(() => runChangesetsVersion(root, before, () => { throw new Error('simulated version failure'); }))
			.toThrow('simulated version failure');
		expect(readFileSync(join(root, '.changeset/config.json'), 'utf8')).toBe(originalConfig);
	});

	it('does not synchronize subsequent independent module releases', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-future-independent-'));
		roots.push(root);
		mkdirSync(join(root, 'packages/svforge'), { recursive: true });
		mkdirSync(join(root, 'packages/blog'), { recursive: true });
		writeFileSync(join(root, 'packages/svforge/package.json'), JSON.stringify({ name: 'svforge', version: '2.2.0' }));
		writeFileSync(join(root, 'packages/blog/package.json'), JSON.stringify({ name: '@svforge/blog', version: '2.2.0' }));
		let commands = 0;
		const initial = runChangesetsVersion(root, readPackageVersions(root), () => {
			commands++;
			writeFileSync(join(root, 'packages/blog/package.json'), JSON.stringify({ name: '@svforge/blog', version: '2.2.1' }));
		});
		expect(initial).toBe(false);
		expect(commands).toBe(1);
		expect(readPackageVersions(root).map((pkg) => [pkg.name, pkg.version])).toEqual([
			['@svforge/blog', '2.2.1'], ['svforge', '2.2.0']
		]);
	});

});
