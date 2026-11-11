import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	applyPlan,
	computeBaseline,
	initTrackingJson,
	isSha256,
	loadTrackingFile,
	planUpgrade,
	readPackageJson,
	resolveDestination,
	safeProjectPath,
	sha256,
	TRACKING_FILE,
	defineModuleRecipe
} from '../packages/addon-kit/src/index';
import type { UpgradeRecipe } from '../packages/addon-kit/src/index';

/**
 * Behavioral tests for #327 — the diffable upgrade engine.
 *
 * The engine is exercised through SYNTHETIC recipes so every migration kind
 * (add, modify, delete, move, dependency, script, JSON transformation) is
 * proven on its own terms, independent of the shipped template data.
 */

function makeRecipe(partial: Partial<UpgradeRecipe> & { id?: string }): UpgradeRecipe {
	return {
		id: partial.id ?? 'test-recipe',
		version: '2.0.0',
		files: {},
		rootPaths: [],
		...partial
	};
}

describe('upgrade engine primitives (#327)', () => {
	it('sha256 produces 64-char hex digests and differs from the legacy 32-bit hash', () => {
		const digest = sha256('hello\n');
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(isSha256(digest)).toBe(true);
		expect(isSha256('1a2b3c')).toBe(false);
		// Digests are stable and content-sensitive.
		expect(sha256('hello\n')).toBe(digest);
		expect(sha256('hello\n ')).not.toBe(digest);
	});

	it('resolveDestination routes src and root files through ONE rule', () => {
		expect(resolveDestination('/lib/ui/Button.svelte')).toBe('src/lib/ui/Button.svelte');
		expect(resolveDestination('/vitest.config.ts', ['/vitest.config.ts'])).toBe('vitest.config.ts');
		expect(resolveDestination('/e2e/auth.test.ts', ['/e2e/'])).toBe('e2e/auth.test.ts');
		expect(resolveDestination('/messages/fr.json', ['/vitest.config.ts', '/messages/fr.json'])).toBe('messages/fr.json');
		// Non-root paths keep the src prefix even when a rootPaths list exists.
		expect(resolveDestination('/lib/base.ts', ['/vitest.config.ts'])).toBe('src/lib/base.ts');
		expect(() => resolveDestination('lib/base.ts')).toThrow(/must start with/);
	});
});

describe('baseline initialization on fresh install (#327)', () => {
	let project: string;

	beforeEach(() => {
		project = mkdtempSync(join(tmpdir(), 'sf-engine-'));
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify({ name: 'app', dependencies: {}, devDependencies: {}, scripts: {} }, null, 2) + '\n'
		);
	});

	afterEach(() => rmSync(project, { recursive: true, force: true }));

	it('initTrackingJson produces the tracking file written at install time with SHA-256 baselines', () => {
		const files = { '/lib/a.ts': 'export const a = 1;\n', '/vitest.config.ts': 'export default {};\n' };
		const json = initTrackingJson('base', '1.2.0', files, ['/vitest.config.ts']);
		const state = JSON.parse(json);
		expect(state.base.version).toBe('1.2.0');
		// Root file keyed by its PROJECT path, src file by its src path.
		expect(state.base.fileChecksums['vitest.config.ts']).toBe(sha256('export default {};\n'));
		expect(state.base.fileChecksums['src/lib/a.ts']).toBe(sha256('export const a = 1;\n'));
		expect(Object.values(state.base.fileChecksums).every(isSha256)).toBe(true);
	});

	it('a file modified AFTER install conflicts; an untouched file upgrades — the first upgrade has a real baseline', async () => {
		// Simulate an install: write the delivered files + the baseline.
		const files = { '/lib/a.ts': 'v1\n', '/lib/b.ts': 'v1\n' };
		mkdirSync(join(project, 'src/lib'), { recursive: true });
		writeFileSync(join(project, 'src/lib/a.ts'), 'v1\n');
		writeFileSync(join(project, 'src/lib/b.ts'), 'v1\n');
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson('demo', '1.0.0', files));

		// The user edits one file after the install.
		writeFileSync(join(project, 'src/lib/b.ts'), 'v1 + user edit\n');

		// The template moves on.
		const recipe = makeRecipe({ id: 'demo', files: { '/lib/a.ts': 'v2\n', '/lib/b.ts': 'v2\n' } });
		const plan = planUpgrade(recipe, project);

		const a = plan.operations.find((op) => op.path === 'src/lib/a.ts');
		const b = plan.operations.find((op) => op.path === 'src/lib/b.ts');
		expect(a?.resolution).toBe('apply'); // untouched since install → safe update
		expect(b?.resolution).toBe('conflict'); // modified after install → preserved
		expect(b?.reason).toMatch(/user modification/i);

		const result = applyPlan(recipe, plan, project);
		expect(result.rolledBack).toBe(false);
		expect(readFileSync(join(project, 'src/lib/a.ts'), 'utf-8')).toBe('v2\n');
		expect(readFileSync(join(project, 'src/lib/b.ts'), 'utf-8')).toBe('v1 + user edit\n'); // preserved
	});

	it('preserves a project-owned theme and its import during upgrades without --force', () => {
		const templateTheme = '/* template theme */\n';
		const templateLayout = "@import '../lib/styles/svelteforge-theme.css';\n";
		const installed = {
			'/lib/styles/svelteforge-theme.css': templateTheme,
			'/routes/layout.css': templateLayout
		};
		mkdirSync(join(project, 'src/lib/styles'), { recursive: true });
		mkdirSync(join(project, 'src/routes'), { recursive: true });
		writeFileSync(join(project, 'src/lib/styles/svelteforge-theme.css'), templateTheme);
		writeFileSync(join(project, 'src/routes/layout.css'), templateLayout);
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson('base', '1.0.0', installed));

		// Consumer owns their own CSS theme; the template does not track that path.
		const customTheme = '[data-theme="denden"] { --color-primary-500: red; }\n';
		writeFileSync(join(project, 'src/lib/styles/denden-theme.css'), customTheme);
		const customLayout = templateLayout + "@import '../lib/styles/denden-theme.css';\n";
		writeFileSync(join(project, 'src/routes/layout.css'), customLayout);

		const recipe = makeRecipe({
			id: 'base',
			files: {
				'/lib/styles/svelteforge-theme.css': '/* updated template */\n',
				'/routes/layout.css': templateLayout + '/* updated */\n'
			}
		});
		const plan = planUpgrade(recipe, project);
		expect(plan.operations.find((op) => op.path === 'src/routes/layout.css')?.resolution).toBe('conflict');
		expect(plan.operations.some((op) => op.path === 'src/lib/styles/denden-theme.css')).toBe(false);
		const result = applyPlan(recipe, plan, project);
		expect(result.rolledBack).toBe(false);
		expect(readFileSync(join(project, 'src/lib/styles/denden-theme.css'), 'utf8')).toBe(customTheme);
		expect(readFileSync(join(project, 'src/routes/layout.css'), 'utf8')).toBe(customLayout);
		expect(readFileSync(join(project, 'src/lib/styles/svelteforge-theme.css'), 'utf8')).toBe('/* updated template */\n');

		// A directly edited template theme also conflicts instead of getting replaced.
		writeFileSync(join(project, 'src/lib/styles/svelteforge-theme.css'), '/* user edits */\n');
		const next = makeRecipe({
			id: 'base',
			version: '3.0.0',
			files: { '/lib/styles/svelteforge-theme.css': '/* template v3 */\n' }
		});
		const nextPlan = planUpgrade(next, project);
		expect(nextPlan.operations[0]?.resolution).toBe('conflict');
		applyPlan(next, nextPlan, project);
		expect(readFileSync(join(project, 'src/lib/styles/svelteforge-theme.css'), 'utf8')).toBe('/* user edits */\n');
	});

	it('a LEGACY 32-bit baseline degrades to "no baseline" — the file is preserved, never silently overwritten', () => {
		mkdirSync(join(project, 'src/lib'), { recursive: true });
		writeFileSync(join(project, 'src/lib/a.ts'), 'old installed content\n');
		// Pre-#327 tracking: 32-bit hash values.
		writeFileSync(
			join(project, TRACKING_FILE),
			JSON.stringify({ demo: { version: '1.0.0', fileChecksums: { 'src/lib/a.ts': '3f2a93bc' } } })
		);
		const recipe = makeRecipe({ id: 'demo', files: { '/lib/a.ts': 'new content\n' } });
		const plan = planUpgrade(recipe, project);
		expect(plan.operations[0]?.resolution).toBe('conflict');
		expect(plan.operations[0]?.reason).toMatch(/no install baseline/i);
	});

	it('computeBaseline keys checksums by destination, not manifest path', () => {
		const baseline = computeBaseline({ '/lib/a.ts': 'A', '/x.config.ts': 'X' }, ['/x.config.ts']);
		expect(baseline).toEqual({ 'src/lib/a.ts': sha256('A'), 'x.config.ts': sha256('X') });
	});
});

describe('plan + diff BEFORE any write (#327)', () => {
	let project: string;
	let snapshot: () => Record<string, string>;

	const snap = (root: string): Record<string, string> => {
		const out: Record<string, string> = {};
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) walk(full);
				else out[full] = readFileSync(full, 'utf-8');
			}
		};
		walk(root);
		return out;
	};

	beforeEach(() => {
		project = mkdtempSync(join(tmpdir(), 'sf-plan-'));
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify({ name: 'app', dependencies: {}, devDependencies: {}, scripts: {} }, null, 2) + '\n'
		);
		snapshot = () => snap(project);
	});

	afterEach(() => rmSync(project, { recursive: true, force: true }));

	it('planning writes NOTHING and produces the full operation list with readable diffs', () => {
		mkdirSync(join(project, 'src/lib'), { recursive: true });
		writeFileSync(join(project, 'src/lib/a.ts'), 'old\ncontent\n');
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson('demo', '1.0.0', { '/lib/a.ts': 'old\ncontent\n' }));

		const recipe = makeRecipe({
			id: 'demo',
			files: { '/lib/new.ts': 'brand new\n', '/lib/a.ts': 'new\ncontent\ntoo\n' },
			deletions: ['/lib/gone.ts'],
			dependencies: [{ name: 'mdsvex', range: '^0.12.8' }],
			scripts: { test: 'vitest run' },
			jsonTransforms: [{ file: 'package.json', set: { 'stack.demo': 'on' } }]
		});

		const before = snapshot();
		const plan = planUpgrade(recipe, project);

		expect(snapshot()).toEqual(before); // planning is read-only
		expect(plan.fromVersion).toBe('1.0.0');
		expect(plan.toVersion).toBe('2.0.0');

		const byPath = Object.fromEntries(plan.operations.map((op) => [op.path, op]));
		expect(byPath['src/lib/new.ts'].action).toBe('add');
		expect(byPath['src/lib/new.ts'].resolution).toBe('apply');
		expect(byPath['src/lib/a.ts'].action).toBe('modify');
		expect(byPath['src/lib/a.ts'].diff).toContain('--- a/src/lib/a.ts');
		expect(byPath['src/lib/a.ts'].diff).toContain('-old');
		expect(byPath['src/lib/a.ts'].diff).toContain('+new');
		expect(byPath['src/lib/gone.ts'].action).toBe('delete');
		expect(byPath['src/lib/gone.ts'].resolution).toBe('unchanged'); // already absent
		// Both a dependency and a JSON transformation target package.json —
		// find by action, the path alone cannot disambiguate.
		const depOp = plan.operations.find((op) => op.action === 'dependency');
		expect(depOp?.dependency?.name).toBe('mdsvex');
		expect(plan.summary.dependency).toBe(1);
		expect(plan.operations.some((op) => op.action === 'json')).toBe(true);
		// The whole plan is machine-readable (JSON round-trips).
		expect(() => JSON.parse(JSON.stringify(plan))).not.toThrow();
	});

	it('dry run writes nothing at all — not even the tracking file', () => {
		mkdirSync(join(project, 'src/lib'), { recursive: true });
		writeFileSync(join(project, 'src/lib/a.ts'), 'v1\n');
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson('demo', '1.0.0', { '/lib/a.ts': 'v1\n' }));

		const recipe = makeRecipe({ id: 'demo', files: { '/lib/a.ts': 'v2\n' }, dependencies: [{ name: 'x', range: '^1' }] });
		const plan = planUpgrade(recipe, project);
		const before = snapshot();
		const result = applyPlan(recipe, plan, project, { dryRun: true });

		expect(result.dryRun).toBe(true);
		expect(result.applied).toBe(0);
		expect(snapshot()).toEqual(before);
		// And through the same path the CLI uses: upgrade(dryRun) is covered in
		// upgrade-behavioral.test.ts; here the engine contract is what matters.
	});
});

describe('migration model: delete, move, dependency, script, JSON transformation (#327)', () => {
	let project: string;

	beforeEach(() => {
		project = mkdtempSync(join(tmpdir(), 'sf-migrate-'));
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify(
				{ name: 'app', dependencies: { old: '^1.0.0' }, devDependencies: {}, scripts: { test: 'jest', keep: 'keep' } },
				null,
				2
			) + '\n'
		);
		mkdirSync(join(project, 'src/lib'), { recursive: true });
	});

	afterEach(() => rmSync(project, { recursive: true, force: true }));

	function installBaseline(recipeId: string, files: Record<string, string>, rootPaths: string[] = []) {
		for (const [manifestPath, content] of Object.entries(files)) {
			const dest = resolveDestination(manifestPath, rootPaths);
			mkdirSync(join(project, dest, '..'), { recursive: true });
			writeFileSync(join(project, dest), content);
		}
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson(recipeId, '1.0.0', files, rootPaths));
	}

	it('deletes an unmodified file and keeps the user-modified one', () => {
		installBaseline('demo', { '/lib/gone.ts': 'generated\n', '/lib/mine.ts': 'generated\n' });
		writeFileSync(join(project, 'src/lib/mine.ts'), 'user content\n');
		const recipe = makeRecipe({ id: 'demo', deletions: ['/lib/gone.ts', '/lib/mine.ts'] });
		const plan = planUpgrade(recipe, project);
		const byPath = Object.fromEntries(plan.operations.map((op) => [op.path, op]));
		expect(byPath['src/lib/gone.ts'].resolution).toBe('apply');
		expect(byPath['src/lib/mine.ts'].resolution).toBe('conflict');

		applyPlan(recipe, plan, project);
		expect(existsSync(join(project, 'src/lib/gone.ts'))).toBe(false);
		expect(readFileSync(join(project, 'src/lib/mine.ts'), 'utf-8')).toBe('user content\n');
		// The deleted file's baseline entry is gone; the conflicting one stays.
		const tracking = loadTrackingFile(project);
		expect(tracking.demo.fileChecksums['src/lib/gone.ts']).toBeUndefined();
		expect(tracking.demo.fileChecksums['src/lib/mine.ts']).toBeDefined();
	});

	it('moves (renames) a file preserving content, and rekeys the baseline', () => {
		installBaseline('demo', { '/lib/old.ts': 'export const x = 1;\n' });
		// A pure rename: the target is NOT in files — its content comes from
		// the source file on disk.
		const recipe = makeRecipe({ id: 'demo', moves: { '/lib/old.ts': '/lib/new.ts' } });
		const plan = planUpgrade(recipe, project);
		const move = plan.operations.find((op) => op.action === 'move');
		expect(move?.resolution).toBe('apply');

		applyPlan(recipe, plan, project);
		expect(existsSync(join(project, 'src/lib/old.ts'))).toBe(false);
		expect(readFileSync(join(project, 'src/lib/new.ts'), 'utf-8')).toBe('export const x = 1;\n');
		const tracking = loadTrackingFile(project);
		expect(tracking.demo.fileChecksums['src/lib/old.ts']).toBeUndefined();
		expect(tracking.demo.fileChecksums['src/lib/new.ts']).toBe(sha256('export const x = 1;\n'));
	});

	it('refuses a rename that would lose user content (conflict), and never overwrites an existing target', () => {
		installBaseline('demo', { '/lib/old.ts': 'generated\n' });
		writeFileSync(join(project, 'src/lib/old.ts'), 'user edited\n');
		writeFileSync(join(project, 'src/lib/occupied.ts'), 'already here\n');

		const recipe = makeRecipe({
			id: 'demo',
			moves: { '/lib/old.ts': '/lib/occupied.ts' }
		});
		const plan = planUpgrade(recipe, project);
		const move = plan.operations.find((op) => op.action === 'move');
		// The source is user-modified → the rename is refused first.
		expect(move?.resolution).toBe('conflict');
		expect(move?.reason).toMatch(/user content/i);
		expect(readFileSync(join(project, 'src/lib/old.ts'), 'utf-8')).toBe('user edited\n');
	});

	it('migrates dependencies (add + version bump) without touching other package.json keys', () => {
		const recipe = makeRecipe({
			id: 'demo',
			dependencies: [
				{ name: 'mdsvex', range: '^0.12.8' },
				{ name: 'ws', range: '^8.21.3', dev: true }
			]
		});
		const plan = planUpgrade(recipe, project);
		expect(plan.operations.filter((op) => op.action === 'dependency').every((op) => op.resolution === 'apply')).toBe(true);

		applyPlan(recipe, plan, project);
		const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf-8'));
		expect(pkg.dependencies.mdsvex).toBe('^0.12.8');
		expect(pkg.devDependencies.ws).toBe('^8.21.3');
		expect(pkg.dependencies.old).toBe('^1.0.0'); // user deps preserved
		expect(pkg.scripts.keep).toBe('keep');
	});

	it('migrates scripts (set, bump, remove) preserving the rest', () => {
		const recipe = makeRecipe({
			id: 'demo',
			scripts: { test: 'vitest run', lint: 'eslint .', legacy: null }
		});
		const plan = planUpgrade(recipe, project);
		applyPlan(recipe, plan, project);
		const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf-8'));
		expect(pkg.scripts.test).toBe('vitest run');
		expect(pkg.scripts.lint).toBe('eslint .');
		expect(pkg.scripts.legacy).toBeUndefined();
		expect(pkg.scripts.keep).toBe('keep');
	});

	it('applies JSON transformations and refuses invalid JSON', () => {
		const recipe = makeRecipe({
			id: 'demo',
			jsonTransforms: [{ file: 'package.json', set: { 'stack.database': 'postgresql', 'deep.nested.key': true } }]
		});
		const plan = planUpgrade(recipe, project);
		const jsonOp = plan.operations.find((op) => op.action === 'json');
		expect(jsonOp?.resolution).toBe('apply');

		applyPlan(recipe, plan, project);
		const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf-8'));
		expect(pkg.stack.database).toBe('postgresql');
		expect(pkg.deep.nested.key).toBe(true);

		// Invalid JSON → conflict, never a destructive reset (#324 spirit).
		writeFileSync(join(project, 'broken.json'), '{ not json');
		const bad = planUpgrade(makeRecipe({ id: 'demo', jsonTransforms: [{ file: 'broken.json', set: { a: 1 } }] }), project);
		expect(bad.operations[0]?.resolution).toBe('conflict');
		expect(bad.operations[0]?.reason).toMatch(/not valid JSON/i);
	});
});

describe('versioned backups + atomicity (#327)', () => {
	let project: string;

	beforeEach(() => {
		project = mkdtempSync(join(tmpdir(), 'sf-backup-'));
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify({ name: 'app', dependencies: {}, devDependencies: {}, scripts: {} }, null, 2) + '\n'
		);
		mkdirSync(join(project, 'src/lib'), { recursive: true });
	});

	afterEach(() => rmSync(project, { recursive: true, force: true }));

	it('two successive upgrades retain TWO distinct backups, never overwriting the first', () => {
		writeFileSync(join(project, 'src/lib/a.ts'), 'v1\n');
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson('demo', '1.0.0', { '/lib/a.ts': 'v1\n' }));

		const recipeV2 = makeRecipe({ id: 'demo', version: '2.0.0', files: { '/lib/a.ts': 'v2\n' } });
		applyPlan(recipeV2, planUpgrade(recipeV2, project), project, { now: new Date('2026-01-01T10:00:00Z') });

		const recipeV3 = makeRecipe({ id: 'demo', version: '3.0.0', files: { '/lib/a.ts': 'v3\n' } });
		applyPlan(recipeV3, planUpgrade(recipeV3, project), project, { now: new Date('2026-02-02T10:00:00Z') });

		const backupRoot = join(project, '.svforge-backup', 'demo');
		const runs = readdirSync(backupRoot).sort();
		expect(runs).toHaveLength(2);
		expect(runs[0]).toContain('-2.0.0');
		expect(runs[1]).toContain('-3.0.0');
		// The FIRST backup still holds the ORIGINAL user-era content.
		expect(readFileSync(join(backupRoot, runs[0], 'src/lib/a.ts'), 'utf-8')).toBe('v1\n');
		expect(readFileSync(join(backupRoot, runs[1], 'src/lib/a.ts'), 'utf-8')).toBe('v2\n');
	});

	it('same-second upgrades get distinct backup directories (collision-safe)', () => {
		writeFileSync(join(project, 'src/lib/a.ts'), 'v1\n');
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson('demo', '1.0.0', { '/lib/a.ts': 'v1\n' }));
		const sameNow = new Date('2026-01-01T10:00:00Z');
		const recipeV2 = makeRecipe({ id: 'demo', version: '2.0.0', files: { '/lib/a.ts': 'v2\n' } });
		applyPlan(recipeV2, planUpgrade(recipeV2, project), project, { now: sameNow });
		const recipeV3 = makeRecipe({ id: 'demo', version: '3.0.0', files: { '/lib/a.ts': 'v3\n' } });
		applyPlan(recipeV3, planUpgrade(recipeV3, project), project, { now: sameNow });
		const runs = readdirSync(join(project, '.svforge-backup', 'demo'));
		expect(runs).toHaveLength(2);
	});

	it('force + same-second collision: rollback restores from — and removes — the SELECTED suffixed dir', () => {
		writeFileSync(join(project, 'src/lib/a.ts'), 'v1\n');
		writeFileSync(join(project, 'src/lib/b.ts'), 'v1\n');
		writeFileSync(
			join(project, TRACKING_FILE),
			initTrackingJson('demo', '1.0.0', { '/lib/a.ts': 'v1\n', '/lib/b.ts': 'v1\n' })
		);

		const sameNow = new Date('2026-01-01T10:00:00Z');
		// First apply claims the unsuffixed directory `…-2.0.0`.
		const v2 = makeRecipe({ id: 'demo', version: '2.0.0', files: { '/lib/a.ts': 'v2\n', '/lib/b.ts': 'v2\n' } });
		applyPlan(v2, planUpgrade(v2, project), project, { now: sameNow });

		// The user edits a.ts; re-applying the SAME version at the SAME
		// timestamp with --force collides → the SELECTED dir is the SUFFIXED
		// `…-2.0.0-1`. A sabotaged op then forces a mid-apply rollback.
		writeFileSync(join(project, 'src/lib/a.ts'), 'user v2 edit\n');
		const plan = planUpgrade(v2, project, { force: true });
		expect(plan.operations.find((op) => op.path === 'src/lib/a.ts')?.resolution).toBe('apply');
		const sabotaged = {
			...plan,
			operations: [
				...plan.operations,
				{ action: 'add' as const, path: 'src/lib/z.ts', resolution: 'apply' as const, reason: 'sabotage' }
			]
		};
		mkdirSync(join(project, 'src/lib/z.ts')); // write to it must fail (EISDIR)
		const result = applyPlan(v2, sabotaged, project, { now: sameNow });

		expect(result.rolledBack).toBe(true);
		expect(result.error).toBeTruthy();
		// Restored from the SELECTED suffixed dir: the user's collision-era
		// content — reading backupBase instead would restore the FIRST run's
		// v1 content and lose the user edit.
		expect(readFileSync(join(project, 'src/lib/a.ts'), 'utf-8')).toBe('user v2 edit\n');
		expect(readFileSync(join(project, 'src/lib/b.ts'), 'utf-8')).toBe('v2\n');
		// The suffixed dir is GONE — only the first apply's backup remains.
		const runs = readdirSync(join(project, '.svforge-backup', 'demo')).sort();
		expect(runs).toHaveLength(1);
		expect(runs[0]).toContain('-2.0.0');
		expect(runs[0]).not.toContain('-2.0.0-1');
		// A rolled-back apply reports no backup dir (it no longer exists).
		expect(result.backupDir).toBeUndefined();
		// Tracking was never advanced by the failed apply.
		expect(loadTrackingFile(project).demo.version).toBe('2.0.0');
	});

	it('rollback after a move restores the source — recreating its PRUNED parent dirs (#327)', () => {
		// Install: the module owns a NESTED file; its baseline proves it is ours.
		mkdirSync(join(project, 'src/lib/old/nested'), { recursive: true });
		writeFileSync(join(project, 'src/lib/old/nested/thing.ts'), 'ORIGINAL\n');
		writeFileSync(join(project, 'src/lib/keeper.ts'), 'kept\n'); // keeps src/lib alive for pruning
		writeFileSync(
			join(project, TRACKING_FILE),
			initTrackingJson('demo', '1.0.0', { '/lib/old/nested/thing.ts': 'ORIGINAL\n' })
		);

		// The new recipe version RENAMES the file out of its nested directory —
		// the apply prunes the then-empty `src/lib/old/nested` (and `src/lib/old`).
		const recipe = makeRecipe({
			id: 'demo',
			version: '2.0.0',
			moves: { '/lib/old/nested/thing.ts': '/lib/new/thing.ts' }
		});
		const plan = planUpgrade(recipe, project);
		expect(plan.operations.find((op) => op.action === 'move')?.resolution).toBe('apply');

		// Force a TRACKING failure: the move applies, THEN the last write — the
		// tracking file — fails (read-only → EACCES; tests run as non-root
		// locally and on CI).
		chmodSync(join(project, TRACKING_FILE), 0o444);

		const result = applyPlan(recipe, plan, project);
		expect(result.rolledBack).toBe(true);
		expect(result.error).toBeTruthy();

		// The source MUST be back at its original path with its original
		// content — the rollback had to RECREATE the pruned `src/lib/old/nested`
		// first, or this write dies with ENOENT and the file is lost (#327).
		expect(readFileSync(join(project, 'src/lib/old/nested/thing.ts'), 'utf-8')).toBe('ORIGINAL\n');
		expect(existsSync(join(project, 'src/lib/old/nested'))).toBe(true);
		// The move target is gone again, pruned with its now-empty directory.
		expect(existsSync(join(project, 'src/lib/new/thing.ts'))).toBe(false);
		expect(existsSync(join(project, 'src/lib/new'))).toBe(false);
		// The untouched neighbor survived, and tracking was never advanced.
		expect(readFileSync(join(project, 'src/lib/keeper.ts'), 'utf-8')).toBe('kept\n');
		expect(loadTrackingFile(project).demo.version).toBe('1.0.0');
	});

	it('mid-move failure leaves the project unchanged — the move journals BEFORE mutating (#327)', () => {
		// Install: the module owns a file NESTED in its own directory — that dir
		// can be made read-only WITHOUT blocking writes elsewhere in the project.
		mkdirSync(join(project, 'src/lib/old'), { recursive: true });
		writeFileSync(join(project, 'src/lib/old/thing.ts'), 'ORIGINAL\n');
		writeFileSync(
			join(project, TRACKING_FILE),
			initTrackingJson('demo', '1.0.0', { '/lib/old/thing.ts': 'ORIGINAL\n' })
		);

		// The new recipe version MOVES the file. The apply sequence is: write
		// the target, then rm the source. Make the rm FAIL mid-move — clearing
		// the source dir's write bit makes rmSync die with EACCES (tests run as
		// non-root locally and on CI) AFTER the target was already written.
		const recipe = makeRecipe({
			id: 'demo',
			version: '2.0.0',
			moves: { '/lib/old/thing.ts': '/lib/new/thing.ts' }
		});
		const plan = planUpgrade(recipe, project);
		expect(plan.operations.find((op) => op.action === 'move')?.resolution).toBe('apply');
		chmodSync(join(project, 'src/lib/old'), 0o555);

		const result = applyPlan(recipe, plan, project);
		expect(result.rolledBack).toBe(true);
		expect(result.error).toBeTruthy();

		// Restore perms FIRST so afterEach can clean the temp project up even
		// if an assertion below fails.
		chmodSync(join(project, 'src/lib/old'), 0o755);

		// ATOMIC-OR-UNCHANGED: the half-applied move must leave NO trace.
		// The new target is gone again, pruned with its now-empty directory.
		expect(existsSync(join(project, 'src/lib/new/thing.ts'))).toBe(false);
		expect(existsSync(join(project, 'src/lib/new'))).toBe(false);
		// The source is intact at its original path with its original content
		// (the failed rm never touched it; the rollback must not lose it).
		expect(existsSync(join(project, 'src/lib/old/thing.ts'))).toBe(true);
		expect(readFileSync(join(project, 'src/lib/old/thing.ts'), 'utf-8')).toBe('ORIGINAL\n');
		// Tracking was never advanced by the failed apply.
		expect(loadTrackingFile(project).demo.version).toBe('1.0.0');
	});

	it('rollback after a DELETE restores the file — recreating its PRUNED parent dirs (#327)', () => {
		// Install: the module owns a NESTED file; its baseline proves it is ours.
		mkdirSync(join(project, 'src/lib/legacy/deep'), { recursive: true });
		writeFileSync(join(project, 'src/lib/legacy/deep/old.ts'), 'ORIGINAL\n');
		writeFileSync(join(project, 'src/lib/keeper.ts'), 'kept\n'); // keeps src/lib alive for pruning
		writeFileSync(
			join(project, TRACKING_FILE),
			initTrackingJson('demo', '1.0.0', { '/lib/legacy/deep/old.ts': 'ORIGINAL\n' })
		);

		// The new recipe version DELETES the nested file — the apply prunes the
		// then-empty `src/lib/legacy/deep` (and `src/lib/legacy`).
		const recipe = makeRecipe({
			id: 'demo',
			version: '2.0.0',
			deletions: ['/lib/legacy/deep/old.ts']
		});
		const plan = planUpgrade(recipe, project);
		expect(plan.operations.find((op) => op.action === 'delete')?.resolution).toBe('apply');

		// Force a TRACKING failure: the delete applies, THEN the last write — the
		// tracking file — fails (read-only → EACCES).
		chmodSync(join(project, TRACKING_FILE), 0o444);

		const result = applyPlan(recipe, plan, project);
		expect(result.rolledBack).toBe(true);
		expect(result.error).toBeTruthy();

		// The deleted file MUST be back at its FULL original path with its
		// original content — the rollback had to RECREATE the pruned
		// `src/lib/legacy/deep` first, or this restore dies with ENOENT and the
		// file is silently lost (same class as the move rollback above).
		expect(readFileSync(join(project, 'src/lib/legacy/deep/old.ts'), 'utf-8')).toBe('ORIGINAL\n');
		expect(existsSync(join(project, 'src/lib/legacy/deep'))).toBe(true);
		// The untouched neighbor survived, and tracking was never advanced.
		expect(readFileSync(join(project, 'src/lib/keeper.ts'), 'utf-8')).toBe('kept\n');
		expect(loadTrackingFile(project).demo.version).toBe('1.0.0');
	});

	it('a mid-apply failure rolls EVERYTHING back — the project is left unchanged', () => {
		writeFileSync(join(project, 'src/lib/a.ts'), 'v1\n');
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson('demo', '1.0.0', { '/lib/a.ts': 'v1\n' }));
		const recipe = makeRecipe({
			id: 'demo',
			files: { '/lib/a.ts': 'v2\n', '/lib/z.ts': 'boom\n' }
		});
		const plan = planUpgrade(recipe, project);
		// Sabotage AFTER planning (a directory where the second write must go
		// → EISDIR mid-apply).
		mkdirSync(join(project, 'src/lib/z.ts'));
		const result = applyPlan(recipe, plan, project);

		expect(result.rolledBack).toBe(true);
		expect(result.error).toBeTruthy();
		// a.ts was written BEFORE the failure — it must be back to v1.
		expect(readFileSync(join(project, 'src/lib/a.ts'), 'utf-8')).toBe('v1\n');
		// The tracking file was never advanced by a failed apply.
		expect(loadTrackingFile(project).demo.version).toBe('1.0.0');
	});

	it('skips nothing silently: skipped operations (profile gating) are never applied', () => {
		writeFileSync(join(project, 'src/lib/a.ts'), 'v1\n');
		writeFileSync(join(project, TRACKING_FILE), initTrackingJson('demo', '1.0.0', { '/lib/a.ts': 'v1\n' }));
		const recipe = makeRecipe({ id: 'demo', files: { '/lib/a.ts': 'v2\n', '/lib/extra.ts': 'extra\n' } });
		const plan = planUpgrade(recipe, project, {
			exclusions: [{ manifestPath: '/lib/extra.ts', reason: 'profile not installed' }]
		});
		const skipped = plan.operations.find((op) => op.path === 'src/lib/extra.ts');
		expect(skipped?.resolution).toBe('skipped');

		applyPlan(recipe, plan, project);
		expect(readFileSync(join(project, 'src/lib/a.ts'), 'utf-8')).toBe('v2\n');
		expect(existsSync(join(project, 'src/lib/extra.ts'))).toBe(false);
	});
});

describe('module recipe factory (#327)', () => {
	it('defineModuleRecipe defaults to src-only delivery', () => {
		const recipe = defineModuleRecipe({ id: 'blog', version: '0.0.2', files: { '/lib/utils/posts.ts': 'x' } });
		expect(recipe.rootPaths).toEqual([]);
		expect(resolveDestination('/lib/utils/posts.ts', recipe.rootPaths)).toBe('src/lib/utils/posts.ts');
	});
});

describe('standalone module baselines — identical files are recorded (#327)', () => {
	let project: string;

	beforeEach(() => {
		project = mkdtempSync(join(tmpdir(), 'sf-baseline-'));
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify({ name: 'app', dependencies: {}, devDependencies: {}, scripts: {} }, null, 2) + '\n'
		);
		mkdirSync(join(project, 'src/lib'), { recursive: true });
	});

	afterEach(() => rmSync(project, { recursive: true, force: true }));

	it('a first module upgrade baselines ALREADY-IDENTICAL files — not just applied ones (non-vacuous)', () => {
		// Standalone module: files on disk, NO install-time tracking at all.
		writeFileSync(join(project, 'src/lib/a.ts'), 'same\n'); // identical to the recipe
		writeFileSync(join(project, 'src/lib/b.ts'), 'user edit\n'); // user-modified → conflict
		const recipe = makeRecipe({ id: 'blog', version: '0.0.2', files: { '/lib/a.ts': 'same\n', '/lib/b.ts': 'new\n' } });

		const plan = planUpgrade(recipe, project);
		expect(plan.operations.find((op) => op.path === 'src/lib/a.ts')?.resolution).toBe('unchanged');
		expect(plan.operations.find((op) => op.path === 'src/lib/b.ts')?.resolution).toBe('conflict');

		const result = applyPlan(recipe, plan, project);
		expect(result.rolledBack).toBe(false);

		// NON-VACUOUS: the checksum map must actually CONTAIN the identical
		// file — an empty map would satisfy any `every()` assertion for free.
		const checksums = loadTrackingFile(project).blog?.fileChecksums ?? {};
		expect(Object.keys(checksums)).toContain('src/lib/a.ts');
		expect(checksums['src/lib/a.ts']).toBe(sha256('same\n'));
		// The conflicted file keeps NO baseline — it is not ours.
		expect(checksums['src/lib/b.ts']).toBeUndefined();

		// The payoff: the NEXT upgrade trusts that baseline — a recipe change
		// applies cleanly instead of inventing a "no baseline" conflict.
		const next = planUpgrade(makeRecipe({ id: 'blog', version: '0.0.3', files: { '/lib/a.ts': 'v3\n' } }), project);
		expect(next.operations[0]?.resolution).toBe('apply');
		expect(next.operations[0]?.reason).not.toMatch(/no install baseline/i);
	});
});

describe('path containment — every recipe path stays inside the project root (#386)', () => {
	let project: string;
	/** Sibling of the project — an attacker-placed target OUTSIDE the root. */
	let outside: string;

	beforeEach(() => {
		project = mkdtempSync(join(tmpdir(), 'sf-guard-'));
		outside = mkdtempSync(join(tmpdir(), 'sf-guard-outside-'));
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify({ name: 'app', dependencies: {}, devDependencies: {}, scripts: {} }, null, 2) + '\n'
		);
	});

	afterEach(() => {
		rmSync(project, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});

	it('resolveDestination rejects ".." traversal segments and absolute escapes', () => {
		expect(() => resolveDestination('/../../evil.txt')).toThrow(/#386/);
		expect(() => resolveDestination('/lib/../../../evil.txt')).toThrow(/#386/);
		expect(() => resolveDestination('/lib/../..\\evil.txt')).toThrow(/#386/);
	});

	it('planUpgrade rejects a traversal manifest path with a readable error — nothing is read or written', () => {
		const recipe = makeRecipe({ id: 'escapee', files: { '/../../evil.txt': 'pwned\n' } });
		expect(() => planUpgrade(recipe, project)).toThrow(/evil\.txt/);
		expect(() => planUpgrade(recipe, project)).toThrow(/#386/);
		// Nothing landed next to the project either.
		expect(existsSync(join(dirname(project), 'evil.txt'))).toBe(false);
		expect(existsSync(join(project, 'src'))).toBe(false);
	});

	it('planUpgrade rejects traversal in a move target and a deletion', () => {
		expect(() =>
			planUpgrade(makeRecipe({ id: 'mover', files: {}, moves: { '/lib/old.ts': '/../escape.ts' } }), project)
		).toThrow(/escape\.ts/);
		expect(() =>
			planUpgrade(makeRecipe({ id: 'deleter', files: {}, deletions: ['/../../victim.txt'] }), project)
		).toThrow(/victim\.txt/);
	});

	it('planUpgrade rejects absolute and traversal jsonTransform targets', () => {
		expect(() =>
			planUpgrade(
				makeRecipe({ id: 'jsonabs', files: {}, jsonTransforms: [{ file: '/etc/passwd', set: { x: 1 } }] }),
				project
			)
		).toThrow(/\/etc\/passwd/);
		expect(() =>
			planUpgrade(
				makeRecipe({ id: 'jsonrel', files: {}, jsonTransforms: [{ file: '../../../escaped.json', set: { x: 1 } }] }),
				project
			)
		).toThrow(/escaped\.json/);
	});

	it('planUpgrade rejects a symlinked directory pointing outside the root', () => {
		mkdirSync(join(outside, 'payload'), { recursive: true });
		symlinkSync(join(outside, 'payload'), join(project, 'link'), 'dir');
		const recipe = makeRecipe({
			id: 'linker',
			files: { '/link/evil.txt': 'pwned\n' },
			rootPaths: ['/link/']
		});
		expect(() => planUpgrade(recipe, project)).toThrow(/#386/);
		expect(existsSync(join(outside, 'payload', 'evil.txt'))).toBe(false);
	});

	it('rejects a DANGLING symlink pointing outside the root — lstat, never existsSync (#386)', () => {
		// The link TARGET does not exist: existsSync(link) reads "absent", so an
		// existsSync-based ancestor walk would skip PAST the link — and the
		// later writeFileSync would follow it OUTSIDE the root. lstat must see
		// the symlink itself.
		mkdirSync(join(project, 'src/lib'), { recursive: true });
		symlinkSync(join(outside, 'payload', 'evil.txt'), join(project, 'src/lib/dangling.ts'));
		expect(() => safeProjectPath(project, 'src/lib/dangling.ts', 'test')).toThrow(/DANGLING symlink/);
		expect(() => safeProjectPath(project, 'src/lib/dangling.ts', 'test')).toThrow(/#386/);

		const recipe = makeRecipe({ id: 'dangling', files: { '/lib/dangling.ts': 'pwned\n' } });
		expect(() => planUpgrade(recipe, project)).toThrow(/#386/);
		// Nothing was created through the link — the outside target is absent.
		expect(existsSync(join(outside, 'payload', 'evil.txt'))).toBe(false);
		expect(existsSync(join(outside, 'payload'))).toBe(false);
	});

	it('rejects a symlinked .svforge-backup directory and a symlinked tracking file (#386)', () => {
		mkdirSync(join(outside, 'exfil'), { recursive: true });
		const recipe = makeRecipe({ id: 'demo', files: { '/lib/a.ts': 'v2\n' } });

		// a) symlinked tracking file: both the READ (planning) and the WRITE
		//    (apply) are containment-checked before touching the filesystem.
		symlinkSync(join(outside, 'exfil', 'tracking.json'), join(project, TRACKING_FILE));
		expect(() => planUpgrade(recipe, project)).toThrow(/#386/);
		const planA = planUpgrade(recipe, project, { tracking: {} });
		expect(() => applyPlan(recipe, planA, project)).toThrow(/#386/);
		// Nothing was written through the link.
		expect(existsSync(join(outside, 'exfil', 'tracking.json'))).toBe(false);
		rmSync(join(project, TRACKING_FILE));

		// b) symlinked backup root: applyPlan validates the BACKUP destination
		//    before taking any backup — nothing may land in the outside dir.
		symlinkSync(join(outside, 'exfil'), join(project, '.svforge-backup'), 'dir');
		const planB = planUpgrade(recipe, project, { tracking: {} });
		expect(() => applyPlan(recipe, planB, project)).toThrow(/#386/);
		expect(readdirSync(join(outside, 'exfil'))).toEqual([]);
	});

	it('readPackageJson refuses a package.json symlink pointing outside the root — planning never reads it (#386)', () => {
		mkdirSync(join(outside, 'payload'), { recursive: true });
		const outsidePkg = join(outside, 'payload', 'package.json');
		writeFileSync(outsidePkg, JSON.stringify({ name: 'outside-app', dependencies: { exfiltrated: '^9.9.9' } }));
		// The attacker REPLACES the project's real manifest with the symlink.
		rmSync(join(project, 'package.json'));
		symlinkSync(outsidePkg, join(project, 'package.json'));

		// Planning (and the exported reader) refuse — the read is
		// containment-checked like every other project path.
		expect(() => readPackageJson(project)).toThrow(/package\.json/);
		expect(() => readPackageJson(project)).toThrow(/#386/);
		expect(() => planUpgrade(makeRecipe({ id: 'peeker', files: {} }), project)).toThrow(/#386/);

		// The outside file was never consumed as the project manifest — and it
		// was left untouched.
		expect(readFileSync(outsidePkg, 'utf-8')).toContain('outside-app');
		expect(existsSync(join(outside, 'payload', 'src'))).toBe(false);
	});

	it('applyPlan fails CLOSED on a poisoned plan — no write, no backup, project untouched', () => {
		// A hand-built plan (not produced by planUpgrade) tries to escape.
		const recipe = makeRecipe({ id: 'poisoner', files: {} });
		const plan = planUpgrade(makeRecipe({ id: 'poisoner', files: { '/lib/ok.ts': 'ok\n' } }), project);
		const poisoned = {
			...plan,
			operations: [
				{ action: 'add' as const, path: '../../poisoned.txt', resolution: 'apply' as const, reason: 'x' },
				...plan.operations
			]
		};
		let message = '';
		try {
			applyPlan(recipe, poisoned, project);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toMatch(/#386/);
		expect(message).toContain('poisoned.txt');
		// Nothing was written — not the file, not a backup directory.
		expect(existsSync(join(dirname(project), 'poisoned.txt'))).toBe(false);
		expect(existsSync(join(project, '.svforge-backup'))).toBe(false);
		expect(existsSync(join(project, 'src/lib/ok.ts'))).toBe(false);
	});

	it('valid nested paths still work end-to-end — deep src files, root delivery, jsonTransform', () => {
		const recipe = makeRecipe({
			id: 'legit',
			version: '2.0.0',
			files: {
				'/lib/deep/nested/module.ts': 'export const deep = true;\n',
				'/e2e/smoke.test.ts': 'import { test } from "vitest";\n'
			},
			rootPaths: ['/e2e/'],
			jsonTransforms: [{ file: 'package.json', set: { name: 'renamed-app' } }]
		});
		const plan = planUpgrade(recipe, project);
		expect(plan.summary.conflicts).toBe(0);
		const result = applyPlan(recipe, plan, project);
		expect(result.rolledBack).toBe(false);
		expect(readFileSync(join(project, 'src/lib/deep/nested/module.ts'), 'utf-8')).toContain('deep = true');
		expect(readFileSync(join(project, 'e2e/smoke.test.ts'), 'utf-8')).toContain('vitest');
		expect(JSON.parse(readFileSync(join(project, 'package.json'), 'utf-8')).name).toBe('renamed-app');
		// The backup stayed inside the project.
		if (result.backupDir) {
			expect(result.backupDir.startsWith('.svforge-backup/')).toBe(true);
			expect(existsSync(join(project, result.backupDir, 'package.json'))).toBe(true);
		}
	});
});
