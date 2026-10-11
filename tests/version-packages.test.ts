import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareVersionPackages, selectReleaseCandidates } from '../scripts/version-packages.mjs';

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
});
