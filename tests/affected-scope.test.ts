import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	buildOrderFor,
	changedFiles,
	classifyPath,
	computeAffectedScope,
	deriveTestOwners,
	detectorFailureScope,
	formatScope,
	loadWorkspaces,
	reverseDependencies,
	runCli
} from '../scripts/affected-scope.mjs';

/**
 * #570 Phase A — affected-scope resolver.
 *
 * The resolver must be inspectable and fail closed: fixtures cover isolated
 * add-ons, shared `addon-kit`, template consumers, release metadata, docs-only,
 * tests-only, unknown paths and detector failures. CI still runs the full
 * pipeline in this phase, so these tests protect the resolver contract that
 * later phases will rely on.
 */

const ROOT = process.cwd();
const workspaces = loadWorkspaces(ROOT);
const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
const testOwners = deriveTestOwners(ROOT, workspaces);

function scope(paths: string[], options: { forceFull?: boolean } = {}) {
	return computeAffectedScope({
		changes: paths.map((path) => ({ status: 'M', paths: [path] })),
		workspaces,
		testOwners,
		forceFull: options.forceFull
	});
}

describe('workspace dependency graph (#570)', () => {
	it('derives every @svforge workspace and its reverse dependents', () => {
		expect(workspaces.length).toBeGreaterThanOrEqual(14);
		expect(byName.has('svforge')).toBe(true);
		expect(byName.has('@svforge/addon-kit')).toBe(true);

		const reverse = reverseDependencies(workspaces);
		// addon-kit is the shared foundation: every package depends on it.
		const kitDependents = reverse.get('@svforge/addon-kit') ?? new Set();
		for (const workspace of workspaces) {
			if (workspace.name !== '@svforge/addon-kit') {
				expect(kitDependents.has(workspace.name), workspace.name).toBe(true);
			}
		}
		// Add-on recipes are extracted into the svforge build.
		expect(reverse.get('@svforge/dnd') ?? new Set()).toContain('svforge');
	});

	it('derives test ownership from real imports, not directory globs', () => {
		const dndOwners = [...testOwners].filter(([, owners]) => owners.has('@svforge/dnd'));
		expect(dndOwners.length).toBeGreaterThan(0);
		expect(dndOwners.every(([file]) => file.startsWith('tests/'))).toBe(true);
		// A test that imports nothing from packages/ is global-only.
		for (const [file, owners] of testOwners) {
			expect(file.endsWith('.test.ts')).toBe(true);
			expect(owners instanceof Set).toBe(true);
		}
	});
});

describe('path classification (#570)', () => {
	it.each([
		['packages/dnd/templates/src/lib/components/svforge/dnd/SortableList.svelte', 'workspace'],
		['packages/addon-kit/src/env.ts', 'workspace'],
		['packages/svforge/src/cli/create.ts', 'workspace'],
		['tests/cli-create.test.ts', 'tests'],
		['docs/RELEASE.md', 'docs'],
		['graphify-out/graph.json', 'artifact'],
		['README.md', 'docs'],
		['packages/svforge/docs/structural-duplication.md', 'docs'],
		['packages/svforge/CHANGELOG.md', 'release-metadata'],
		['packages/dnd/package.json', 'release-metadata'],
		['.changeset/bright-dialog.md', 'release-metadata'],
		['bun.lock', 'global'],
		['package.json', 'global'],
		['vitest.config.ts', 'global'],
		['.github/workflows/ci.yml', 'global'],
		['scripts/test-scaffold.sh', 'global'],
		['docs/../mystery/path.ts', 'unknown'],
		['packages/not-a-workspace/file.ts', 'unknown']
	])('classifies %s as %s', (path, kind) => {
		expect(classifyPath(path, workspaces).kind).toBe(kind);
	});
});

describe('build order and mode (#570 phase B)', () => {
	it('includes forward dependencies, topologically ordered, for a scoped build', () => {
		expect(buildOrderFor(['@svforge/dnd', 'svforge'], workspaces)).toEqual([
			{ name: '@svforge/addon-kit', dir: 'addon-kit' },
			{ name: '@svforge/dnd', dir: 'dnd' },
			{ name: 'svforge', dir: 'svforge' }
		]);
		// svforge's recipe extraction depends on the add-on, not the reverse.
		const svforgeOnly = buildOrderFor(['svforge'], workspaces).map((entry: { name: string }) => entry.name);
		expect(svforgeOnly).toEqual(['@svforge/addon-kit', 'svforge']);
	});

	it('classifies the plan mode for every scope family', () => {
		expect(scope(['packages/dnd/src/index.ts']).mode).toBe('targeted');
		expect(scope(['docs/RELEASE.md']).mode).toBe('none');
		expect(scope(['graphify-out/graph.json']).mode).toBe('none');
		expect(scope(['tests/cli-create.test.ts']).mode).toBe('tests');
		expect(scope(['bun.lock']).mode).toBe('full');
		expect(scope(['packages/dnd/src/index.ts']).buildOrder.map((entry: { dir: string }) => entry.dir)).toEqual([
			'addon-kit',
			'dnd',
			'svforge'
		]);
	});

	it('derives ownership from package-name imports too, and leaves unrelated tests global', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-owners-'));
		try {
			mkdirSync(join(dir, 'packages', 'foo'), { recursive: true });
			writeFileSync(join(dir, 'packages', 'foo', 'package.json'), JSON.stringify({ name: '@x/foo', version: '1.0.0' }));
			mkdirSync(join(dir, 'tests'), { recursive: true });
			writeFileSync(join(dir, 'tests', 'named.test.ts'), "import('@x/foo');\n");
			writeFileSync(join(dir, 'tests', 'global.test.ts'), "import './helpers';\n");
			const owners = deriveTestOwners(dir, loadWorkspaces(dir));
			expect([...(owners.get('tests/named.test.ts') ?? [])]).toEqual(['@x/foo']);
			expect([...(owners.get('tests/global.test.ts') ?? [])]).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('affected scope computation (#570)', () => {
	it('keeps an isolated add-on change scoped to that add-on and its build consumers', () => {
		const result = scope(['packages/dnd/templates/src/lib/components/svforge/dnd/SortableList.svelte']);
		const names = result.packages.map((pkg: { name: string }) => pkg.name);
		expect(names).toContain('@svforge/dnd');
		// The svforge build embeds add-on recipes, so it is a real consumer.
		expect(names).toContain('svforge');
		// Unrelated add-ons are NOT rebuilt.
		for (const unrelated of ['@svforge/chat', '@svforge/uploads', '@svforge/tiptap', '@svforge/graph']) {
			expect(names, unrelated).not.toContain(unrelated);
		}
		expect(result.global).toBe(false);
		expect(result.tests.mode).toBe('selected');
		// Tests are owned by the imports they make, not by their filename.
		expect(result.tests.files).toContain('tests/scaffold-paths.test.ts');
	});

	it('fans a shared addon-kit change out to every dependent workspace', () => {
		const result = scope(['packages/addon-kit/src/env.ts']);
		const names = new Set(result.packages.map((pkg: { name: string }) => pkg.name));
		for (const workspace of workspaces) expect(names.has(workspace.name), workspace.name).toBe(true);
		expect(result.tests.mode).toBe('selected');
		expect(result.tests.files.length).toBeGreaterThan(50);
	});

	it('treats lockfile, root config, workflow, scripts and release metadata as full scope', () => {
		for (const path of [
			'bun.lock',
			'package.json',
			'.github/workflows/ci.yml',
			'scripts/release-plan.mjs',
			'.changeset/version.md',
			'packages/svforge/CHANGELOG.md',
			'packages/chat/package.json'
		]) {
			const result = scope([path]);
			expect(result.global, path).toBe(true);
			expect(result.packages.length, path).toBe(workspaces.length);
			expect(result.tests.mode, path).toBe('all');
		}
		expect(scope(['.changeset/version.md']).releaseSensitive).toBe(true);
	});

	it('fails closed for unknown paths', () => {
		const result = scope(['mystery/file.ts']);
		expect(result.global).toBe(true);
		expect(result.reasons.some((reason: { kind: string }) => reason.kind === 'unknown')).toBe(true);
	});

	it('selects no build or test for documentation-only changes', () => {
		const result = scope(['docs/RELEASE.md', 'README.md', 'packages/svforge/docs/structural-duplication.md']);
		expect(result.docsOnly).toBe(true);
		expect(result.global).toBe(false);
		expect(result.packages).toEqual([]);
		expect(result.tests).toEqual({ mode: 'none', files: [] });
	});

	it('treats committed graphify outputs as artifacts, not full-scope triggers', () => {
		const result = scope(['graphify-out/graph.json', 'graphify-out/manifest.json']);
		expect(result.global).toBe(false);
		expect(result.packages).toEqual([]);
		expect(result.tests).toEqual({ mode: 'none', files: [] });
		expect(formatScope(result)).toContain('No build/test scope');
	});

	it('runs exactly the changed test file for tests-only changes', () => {
		const result = scope(['tests/cli-create.test.ts']);
		expect(result.packages).toEqual([]);
		expect(result.tests).toEqual({ mode: 'selected', files: ['tests/cli-create.test.ts'] });
	});

	it('honours --force-full and reports detector failures as full scope', () => {
		expect(scope(['packages/dnd/package.json'], { forceFull: true }).global).toBe(true);
		const failure = detectorFailureScope(new Error('git merge-base failed'), workspaces);
		expect(failure.global).toBe(true);
		expect(failure.fallback).toContain('git merge-base failed');
		expect(failure.packages).toHaveLength(workspaces.length);
	});
});

describe('human report (#570)', () => {
	it('explains why each package and test is included', () => {
		const report = formatScope(scope(['packages/dnd/src/index.ts']));
		expect(report).toContain('@svforge/dnd');
		expect(report).toContain('changed directly');
		expect(report).toContain('depends on @svforge/dnd');
		expect(report).toContain('**Tests** — selected');
	});

	it('states full-scope triggers and documentation-only scope', () => {
		expect(formatScope(scope(['bun.lock']))).toContain('**Full scope**');
		expect(formatScope(scope(['docs/RELEASE.md']))).toContain('No build/test scope');
	});
});

describe('git integration (#570)', () => {
	it('diffs from the merge-base, so rebased branches compare against their base', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-affected-git-'));
		const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
		try {
			git('init', '-q', '-b', 'main');
			git('config', 'user.email', 'test@example.com');
			git('config', 'user.name', 'Test');
			mkdirSync(join(dir, 'packages', 'dnd'), { recursive: true });
			writeFileSync(join(dir, 'packages', 'dnd', 'a.txt'), 'base\n');
			git('add', '.');
			git('commit', '-q', '-m', 'base');
			const base = git('rev-parse', 'HEAD').trim();

			// Diverge main and the PR branch (a rebase keeps the merge-base stable).
			writeFileSync(join(dir, 'main-only.txt'), 'main\n');
			git('add', '.');
			git('commit', '-q', '-m', 'main work');
			git('checkout', '-q', '-b', 'pr', base);
			writeFileSync(join(dir, 'packages', 'dnd', 'b.txt'), 'pr\n');
			git('add', '.');
			git('commit', '-q', '-m', 'pr work');

			const changes = changedFiles({ root: dir, base, head: 'HEAD' });
			expect(changes.map((change: { paths: string[] }) => change.paths[0])).toEqual(['packages/dnd/b.txt']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('returns a detector-failure full scope when the base ref is unusable', () => {
		const previous = process.exitCode;
		try {
			const scopeResult = runCli(['--base', 'does-not-exist', '--root', ROOT]);
			expect(scopeResult.global).toBe(true);
			expect(scopeResult.fallback).toBeTruthy();
			expect(process.exitCode).toBe(2);
		} finally {
			process.exitCode = previous;
		}
	});
});
