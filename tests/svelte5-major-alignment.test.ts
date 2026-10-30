import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	alignSvelte5GeneratedVersion,
	alignSvelte5ProspectiveReleases,
	assertSvelte5AlignmentBaseline,
	hasSvelte5AlignmentChangeset
} from '../scripts/svelte5-major-alignment.mjs';
import { readPackageVersions, runChangesetsVersion } from '../scripts/version-packages.mjs';

const roots: string[] = [];

function fixture(version = '2.3.0') {
	const root = mkdtempSync(join(tmpdir(), 'svforge-svelte5-major-'));
	roots.push(root);
	mkdirSync(join(root, '.changeset'), { recursive: true });
	mkdirSync(join(root, 'packages/svforge'), { recursive: true });
	mkdirSync(join(root, 'packages/addon'), { recursive: true });
	writeFileSync(join(root, '.changeset/svforge-svelte5-alignment.md'), '---\n"svforge": major\n---\n\nSvelte 5 alignment.\n');
	writeFileSync(join(root, 'packages/svforge/package.json'), JSON.stringify({ name: 'svforge', version }, null, '\t') + '\n');
	writeFileSync(join(root, 'packages/addon/package.json'), JSON.stringify({ name: '@svforge/addon', version: '2.2.1' }, null, '\t') + '\n');
	writeFileSync(join(root, 'packages/svforge/CHANGELOG.md'), '# svforge\n\n## 2.3.0\n\nExisting release.\n');
	return root;
}

function writeCalculatedVersion(root: string, version: string) {
	writeFileSync(join(root, 'packages/svforge/package.json'), JSON.stringify({ name: 'svforge', version }, null, '\t') + '\n');
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('one-time Svelte 5 distribution major alignment', () => {
	it('converts the generated major 3.0.0 into a reviewed 5.0.0 without touching addon versions', () => {
		const root = fixture();
		const before = readPackageVersions(root);
		expect(hasSvelte5AlignmentChangeset(root)).toBe(true);
		let called = 0;
		expect(runChangesetsVersion(root, before, (_command: string, args: string[]) => {
			expect(args).toEqual(['x', 'changeset', 'version']);
			called++;
			writeCalculatedVersion(root, '3.0.0');
			writeFileSync(join(root, 'packages/svforge/CHANGELOG.md'),
				'# svforge\n\n## 3.0.0\n\n### Major Changes\n\n- Svelte 5 alignment.\n\n## 2.3.0\n\nExisting release.\n');
		})).toBe(false);
		expect(called).toBe(1);
		expect(readPackageVersions(root).map(({ name, version }) => [name, version])).toEqual([
			['@svforge/addon', '2.2.1'], ['svforge', '5.0.0']
		]);
		const notes = readFileSync(join(root, 'packages/svforge/CHANGELOG.md'), 'utf8');
		expect(notes).toContain('## 5.0.0');
		expect(notes).not.toContain('## 3.0.0');
		expect(notes).toContain('## 2.3.0');
	});

	it('aligns calculated prospective canary version before choosing a shared iteration', () => {
		const input = [
			{ name: '@svforge/addon', type: 'patch', newVersion: '2.2.2' },
			{ name: 'svforge', type: 'major', newVersion: '3.0.0' }
		];
		expect(alignSvelte5ProspectiveReleases(input, false)).toBe(input);
		expect(alignSvelte5ProspectiveReleases(input, true)).toEqual([
			input[0], { ...input[1], newVersion: '5.0.0' }
		]);
		expect(input[1].newVersion).toBe('3.0.0');
		const root = fixture();
		writeCalculatedVersion(root, '3.0.0-canary.2');
		expect(alignSvelte5GeneratedVersion(root, { iteration: 2 })).toBe('5.0.0-canary.2');
		expect(JSON.parse(readFileSync(join(root, 'packages/svforge/package.json'), 'utf8')).version)
			.toBe('5.0.0-canary.2');
		expect(readFileSync(join(root, 'packages/svforge/CHANGELOG.md'), 'utf8')).not.toContain('5.0.0');
	});

	it('fails closed for a different baseline, a missing major, or an unexpected calculated version', () => {
		expect(() => assertSvelte5AlignmentBaseline([{ name: 'svforge', version: '2.4.0' }])).toThrow(/2\.3\.0/);
		expect(() => alignSvelte5ProspectiveReleases([
			{ name: 'svforge', type: 'minor', newVersion: '2.4.0' }
		], true)).toThrow(/major Changeset/);
		const root = fixture();
		expect(() => runChangesetsVersion(root, readPackageVersions(root), () => {
			writeCalculatedVersion(root, '2.4.0');
		})).toThrow(/expected svforge@3\.0\.0/);
	});

	it('does not write a half-aligned release when the generated changelog is wrong', () => {
		const root = fixture();
		writeCalculatedVersion(root, '3.0.0');
		expect(() => alignSvelte5GeneratedVersion(root)).toThrow(/changelog entry/);
		expect(JSON.parse(readFileSync(join(root, 'packages/svforge/package.json'), 'utf8')).version).toBe('3.0.0');
	});
});
