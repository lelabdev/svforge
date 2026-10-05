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

function normalizeFixture(root: string, graph: unknown): { json: string; graph: GraphFixture } {
	const output = join(root, 'graphify-out');
	writeFileSync(join(output, 'graph.json'), JSON.stringify(graph));
	writeFileSync(join(output, 'manifest.json'), JSON.stringify({
		'packages/jobs/index.ts': { mtime: 123, seen: 456, hash: 'stable-hash' }
	}));
	execFileSync('node', [join(root, 'scripts', 'normalize-graphify.mjs')], { cwd: root });
	const json = readFileSync(join(output, 'graph.json'), 'utf8');
	return { json, graph: JSON.parse(json) as GraphFixture };
}

function normalizeAgain(root: string): string {
	execFileSync('node', [join(root, 'scripts', 'normalize-graphify.mjs')], { cwd: root });
	return readFileSync(join(root, 'graphify-out', 'graph.json'), 'utf8');
}

type GraphNode = { id: string; label: string; [key: string]: unknown };
type GraphLink = { source: string; target: string; [key: string]: unknown };
type GraphFixture = { nodes: GraphNode[]; links: GraphLink[] };

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
		const currentId = `${slugPath(worktreeB)}_packages_jobs_templates_src_lib_server_test_db`;
		const runnerId = 'packages_jobs_templates_src_lib_server_runner';
		const canonicalId = 'repo_packages_jobs_templates_src_lib_server_test_db';
		const fixture: GraphFixture = {
			nodes: [
				{
					id: staleId,
					label: staleId,
					file_type: 'concept',
					type: 'external',
					external: true,
					source_file: '',
					_origin: 'semantic'
				},
				{
					id: currentId,
					label: currentId,
					file_type: 'concept',
					type: 'external',
					external: true,
					source_file: 'packages/jobs/templates/src/lib/server/test-db.ts',
					description: 'Jobs test database helper',
					tags: ['jobs', 'database']
				},
				{
					id: runnerId,
					label: 'runner',
					file_type: 'code',
					type: 'function',
					source_file: 'packages/jobs/templates/src/lib/server/runner.ts'
				}
			],
			links: [
				{ source: staleId, target: runnerId, relation: 'DOCUMENTS', confidence: 'EXTRACTED' },
				{ source: runnerId, target: currentId, relation: 'CALLS', confidence: 'INFERRED' }
			]
		};

		const normalizedFromA = normalizeFixture(worktreeA, fixture);
		const normalizedFromB = normalizeFixture(worktreeB, fixture);
		const normalizedNodes = normalizedFromA.graph.nodes;
		const mergedNode = normalizedNodes.find((node) => node.id === canonicalId);

		expect(normalizedFromA.json).toBe(normalizedFromB.json);
		expect(normalizeAgain(worktreeA)).toBe(normalizedFromA.json);
		expect(normalizedNodes.filter((node) => node.id === canonicalId)).toHaveLength(1);
		expect(new Set(normalizedNodes.map((node) => node.id)).size).toBe(normalizedNodes.length);
		expect(mergedNode).toMatchObject({
			label: canonicalId,
			file_type: 'concept',
			type: 'external',
			external: true,
			source_file: 'packages/jobs/templates/src/lib/server/test-db.ts',
			_origin: 'semantic',
			description: 'Jobs test database helper',
			tags: ['jobs', 'database']
		});
		expect(JSON.stringify(normalizedFromA.graph)).not.toMatch(/(?:sf490|worktrees_(?:474|490))/);
		expect(normalizedFromA.graph.links).toEqual([
			{ source: canonicalId, target: runnerId, relation: 'DOCUMENTS', confidence: 'EXTRACTED' },
			{ source: runnerId, target: canonicalId, relation: 'CALLS', confidence: 'INFERRED' }
		]);
		const normalizedIds = new Set(normalizedNodes.map((node) => node.id));
		expect(normalizedFromA.graph.links.every((link) => normalizedIds.has(link.source) && normalizedIds.has(link.target))).toBe(true);

		const reversed = normalizeFixture(worktreeA, { ...fixture, nodes: [...fixture.nodes].reverse() });
		expect(reversed.graph.nodes.find((node) => node.id === canonicalId)).toEqual(mergedNode);
	});
});
