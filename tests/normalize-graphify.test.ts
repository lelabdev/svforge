import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const NORMALIZER = join(ROOT, 'scripts', 'normalize-graphify.mjs');
const temporaryRoots: string[] = [];

function slugPath(value: string): string {
	return value
		.split(/[\\/]/)
		.filter(Boolean)
		.join('_')
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.toLowerCase();
}

function createWorktree(parent: string, worktreeId: string): string {
	const root = join(parent, 'svforge-hub', 'svForge', '.worktrees', worktreeId);
	mkdirSync(join(root, 'scripts'), { recursive: true });
	mkdirSync(join(root, 'packages'), { recursive: true });
	mkdirSync(join(root, 'tests'), { recursive: true });
	copyFileSync(NORMALIZER, join(root, 'scripts', 'normalize-graphify.mjs'));
	mkdirSync(join(root, 'graphify-out'), { recursive: true });
	return root;
}

function normalizeFixture(root: string, graph: unknown): unknown {
	const output = join(root, 'graphify-out');
	writeFileSync(join(output, 'graph.json'), JSON.stringify(graph));
	writeFileSync(join(output, 'manifest.json'), JSON.stringify({
		'packages/jobs/index.ts': { mtime: 123, seen: 456, hash: 'stable-hash' }
	}));
	execFileSync('node', [join(root, 'scripts', 'normalize-graphify.mjs')], { cwd: root });
	return JSON.parse(readFileSync(join(output, 'graph.json'), 'utf8'));
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Graphify portability normalizer (#490)', () => {
	it('rewrites current and stale worktree path IDs identically without changing portable source links', () => {
		const cloneA = mkdtempSync(join(tmpdir(), 'sf490-clone-a-'));
		const cloneB = mkdtempSync(join(tmpdir(), 'sf490-clone-b-'));
		temporaryRoots.push(cloneA, cloneB);
		const worktreeA = createWorktree(cloneA, '474');
		const worktreeB = createWorktree(cloneB, '490');
		const staleId = `${slugPath(worktreeA)}_packages_jobs_templates_src_lib_server_test_db`;
		const currentId = `${slugPath(worktreeB)}_packages_jobs_templates_src_lib_server_runner`;
		const fixture = {
			nodes: [
				{
					id: staleId,
					label: staleId,
					file_type: 'concept',
					type: 'external',
					external: true,
					source_file: ''
				},
				{
					id: currentId,
					label: currentId,
					file_type: 'code',
					type: 'function',
					source_file: 'packages/jobs/templates/src/lib/server/runner.ts'
				}
			],
			links: [{ source: staleId, target: currentId, relation: 'CALLS', confidence: 'EXTRACTED' }]
		};

		const normalizedFromA = normalizeFixture(worktreeA, fixture) as typeof fixture;
		const normalizedFromB = normalizeFixture(worktreeB, fixture) as typeof fixture;

		expect(normalizedFromA).toEqual(normalizedFromB);
		expect(normalizedFromA.nodes.map((node) => node.id)).toEqual([
			'repo_packages_jobs_templates_src_lib_server_test_db',
			'repo_packages_jobs_templates_src_lib_server_runner'
		]);
		expect(normalizedFromA.nodes.map((node) => node.label)).toEqual(
			normalizedFromA.nodes.map((node) => node.id)
		);
		expect(JSON.stringify(normalizedFromA)).not.toMatch(/(?:sf490|worktrees_(?:474|490))/);
		expect(normalizedFromA.nodes[1].source_file).toBe('packages/jobs/templates/src/lib/server/runner.ts');
		expect(normalizedFromA.links).toEqual([{
			source: 'repo_packages_jobs_templates_src_lib_server_test_db',
			target: 'repo_packages_jobs_templates_src_lib_server_runner',
			relation: 'CALLS',
			confidence: 'EXTRACTED'
		}]);
	});
});
