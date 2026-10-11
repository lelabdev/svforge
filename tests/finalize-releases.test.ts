import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { finalizeReleases } from '../scripts/finalize-releases.mjs';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, args: string[]) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'svforge-finalize-releases-'));
	roots.push(root);
	git(root, ['init', '-b', 'main']);
	git(root, ['config', 'user.email', 'tests@example.com']);
	git(root, ['config', 'user.name', 'Release finalization test']);
	const packages = [
		{ name: '@svforge/first', version: '1.1.0', directory: 'packages/first' },
		{ name: '@svforge/second', version: '2.1.0', directory: 'packages/second' }
	];
	for (const pkg of packages) {
		const directory = join(root, pkg.directory);
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version }));
		writeFileSync(join(directory, 'CHANGELOG.md'), `## ${pkg.version}\n\n- Verified release notes for ${pkg.name}.\n`);
	}
	git(root, ['add', '.']);
	git(root, ['commit', '-m', 'release commit']);
	const commit = git(root, ['rev-parse', 'HEAD']);
	const plan = { commit, compatibility: {}, packages };
	const candidates = { commit, packages };
	const registry = new Map([[packages[0].name, packages[0].version]]);
	const remoteTags = new Map<string, string>();
	const localTags = new Map<string, string>();
	const releases = new Map<string, string>();
	let pushes = 0;
	let created = 0;
	const operations = {
		verifyRegistryVersion: (name: string) => registry.get(name) ?? null,
		remoteTagTarget: (tag: string) => remoteTags.get(tag) ?? null,
		gitObjectTarget: (tag: string) => localTags.get(tag) ?? null,
		createLocalTag: (tag: string, sha: string) => localTags.set(tag, sha),
		pushTag: (tag: string) => {
			pushes++;
			remoteTags.set(tag, localTags.get(tag)!);
		},
		getRelease: (tag: string) => releases.get(tag) ?? null,
		createRelease: (tag: string) => {
			created++;
			releases.set(tag, tag);
		}
	};
	return { root, packages, commit, plan, candidates, registry, remoteTags, releases, operations, get pushes() { return pushes; }, get created() { return created; } };
}

describe('verified stable release finalization', () => {
	it('does not create tags or releases for a partial npm publication, then safely resumes', () => {
		const state = fixture();

		expect(() => finalizeReleases({ ...state, root: state.root, operations: state.operations })).toThrow(/unpublished versions/);
		expect(state.remoteTags.size).toBe(0);
		expect(state.releases.size).toBe(0);

		state.registry.set(state.packages[1].name, state.packages[1].version);
		const completed = finalizeReleases({ plan: state.plan, candidates: state.candidates, commit: state.commit, root: state.root, operations: state.operations });
		expect(completed).toHaveLength(2);
		expect(state.remoteTags.size).toBe(2);
		expect(state.releases.size).toBe(2);

		const retried = finalizeReleases({ plan: state.plan, candidates: state.candidates, commit: state.commit, root: state.root, operations: state.operations });
		expect(retried.every((result) => !result.created)).toBe(true);
		expect(state.pushes).toBe(2);
		expect(state.created).toBe(2);
	});

	it('creates a missing release on retry without pushing an existing tag or duplicating releases', () => {
		const state = fixture();
		state.registry.set(state.packages[1].name, state.packages[1].version);
		const tag = `${state.packages[0].name}@${state.packages[0].version}`;
		state.remoteTags.set(tag, state.commit);
		state.releases.set(tag, tag);

		const result = finalizeReleases({ plan: state.plan, candidates: state.candidates, commit: state.commit, root: state.root, operations: state.operations });

		expect(result.filter((item) => item.created)).toHaveLength(1);
		expect(state.pushes).toBe(1);
		expect(state.created).toBe(1);
	});
});
