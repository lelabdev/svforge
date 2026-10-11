import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildReleaseCandidates } from '../scripts/release-candidates.mjs';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, args: string[]) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'svforge-release-candidates-'));
	roots.push(root);
	git(root, ['init', '-b', 'main']);
	git(root, ['config', 'user.email', 'tests@example.com']);
	git(root, ['config', 'user.name', 'Release candidate test']);
	for (const [directory, name, version] of [
		['changed', '@svforge/changed', '1.0.0'],
		['unchanged', '@svforge/unchanged', '2.0.0']
	]) {
		const packageDir = join(root, 'packages', directory);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name, version }));
	}
	git(root, ['add', '.']);
	git(root, ['commit', '-m', 'before Version Packages']);
	writeFileSync(join(root, 'packages/changed/package.json'), JSON.stringify({ name: '@svforge/changed', version: '1.1.0' }));
	git(root, ['add', '.']);
	git(root, ['commit', '-m', 'Version Packages']);
	const commit = git(root, ['rev-parse', 'HEAD']);
	const plan = {
		commit,
		packages: [
			{ name: '@svforge/changed', version: '1.1.0', directory: 'packages/changed', registry: { published: false } },
			{ name: '@svforge/unchanged', version: '2.0.0', directory: 'packages/unchanged', registry: { published: false } }
		]
	};
	mkdirSync(join(root, '.changeset'), { recursive: true });
	writeFileSync(join(root, '.changeset/release-candidates.json'), JSON.stringify({
		schemaVersion: 1,
		packages: plan.packages.map(({ name, version, directory }) => ({ name, version, directory }))
	}));
	return { root, commit, plan };
}

describe('Changesets stable release candidate selection', () => {
	it('validates PR-bumped versions and first-time package versions from the reviewed manifest', () => {
		const { root, commit, plan } = fixture();

		const candidates = buildReleaseCandidates(plan, commit, root);

		expect(candidates).toEqual({
			commit,
			packages: plan.packages.map(({ name, version, directory }) => ({ name, version, directory }))
		});
	});

	it('blocks publication if Changesets would include an unpublished version omitted from the reviewed manifest', () => {
		const { root, commit, plan } = fixture();
		writeFileSync(join(root, '.changeset/release-candidates.json'), JSON.stringify({
			schemaVersion: 1,
			packages: [{ name: '@svforge/changed', version: '1.1.0', directory: 'packages/changed' }]
		}));

		expect(() => buildReleaseCandidates(plan, commit, root)).toThrow(/missing from the reviewed candidate manifest/);
	});

	it('blocks a changed Version Packages version missing from the reviewed manifest', () => {
		const { root, commit, plan } = fixture();
		writeFileSync(join(root, '.changeset/release-candidates.json'), JSON.stringify({
			schemaVersion: 1,
			packages: [{ name: '@svforge/unchanged', version: '2.0.0', directory: 'packages/unchanged' }]
		}));

		expect(() => buildReleaseCandidates(plan, commit, root)).toThrow(/Changed package version.*missing from/);
	});
});
