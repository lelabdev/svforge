import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
	upgrade,
	hasPlaywright,
	doctor,
	MODULE_RECIPES,
	BASE_RECIPE,
	changelogPackageOf,
	sha256,
	resolveDestination,
	TRACKING_FILE
} from '../packages/svforge/src';
import { applyBaseMode } from '../packages/svforge/src/modes/base';
import { applyDashboardMode } from '../packages/svforge/src/modes/dashboard';
import { baseFiles, baseRootFiles } from '../packages/svforge/src/templates';
import { diskSv } from './helpers/fixtures';
import { SDFORGE_RECIPE_VERSION } from '../packages/svforge/src/recipe-version';
import { RELEASE_NOTES } from '../packages/svforge/src/changelog';

/**
 * Behavioral tests for #189/#283/#327 — the upgrade command against the REAL
 * shipped recipes: base, dashboard AND the standalone modules (same protocol),
 * with the install-time baseline, plan/diff, dry-run, SHA-256 tracking and
 * versioned backups.
 */
describe('svforge upgrade — shipped recipes (#327)', () => {
	let project: string;
	let cleanup: () => void;

	beforeEach(() => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-upgrade-'));
		project = dir;
		// A SvelteKit project root needs a package.json for dependency migrations.
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify({ name: 'app', private: true, dependencies: {}, devDependencies: {}, scripts: {} }, null, 2) + '\n'
		);
		cleanup = () => rmSync(dir, { recursive: true, force: true });
	});

	afterEach(() => cleanup());

	it('has real recipes: base, dashboard AND the 13 standalone modules', () => {
		expect(Object.keys(MODULE_RECIPES)).toEqual(
			expect.arrayContaining(['base', 'dashboard', 'blog', 'dnd', 'email', 'oauth', 'uploads', 'realtime', 'audit', 'notifications', 'jobs', 'chat', 'tiptap', 'graph', 'ui_toast'])
		);
		expect(Object.keys(MODULE_RECIPES.base.files).length).toBeGreaterThan(10);
		expect(Object.keys(MODULE_RECIPES.dashboard.files).length).toBeGreaterThan(
			Object.keys(MODULE_RECIPES.base.files).length
		);
		// Each module recipe mirrors its own package version (extraction at prebuild).
		for (const [id, recipe] of Object.entries(MODULE_RECIPES)) {
			if (id === 'base' || id === 'dashboard') continue;
			const pkg = JSON.parse(readFileSync(join(process.cwd(), `packages/${id}/package.json`), 'utf-8'));
			expect(recipe.version, `module ${id}`).toBe(pkg.version);
		}
	});

	it('recipe versions of base/dashboard match the shipped package version (#283)', () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), 'packages/svforge/package.json'), 'utf-8'));
		expect(MODULE_RECIPES.base.version).toBe(pkg.version);
		expect(MODULE_RECIPES.dashboard.version).toBe(pkg.version);
		expect(SDFORGE_RECIPE_VERSION).toBe(pkg.version);
	});

	it('root-delivered files land at the project ROOT through the canonical resolver', () => {
		// The vitest config and the Paraglide messages are ROOT files — never src/.
		expect(resolveDestination('/vitest.config.ts', BASE_RECIPE.rootPaths)).toBe('vitest.config.ts');
		expect(resolveDestination('/messages/fr.json', BASE_RECIPE.rootPaths)).toBe('messages/fr.json');
		expect(resolveDestination('/svforge-check.mjs', BASE_RECIPE.rootPaths)).toBe('svforge-check.mjs');
		// The resolver decision is shared with the mode writers (destinations.ts).
		expect(BASE_RECIPE.rootPaths).toContain('/vitest.config.ts');
		expect(BASE_RECIPE.rootPaths).toEqual(expect.arrayContaining(Object.keys(baseRootFiles)));
	});

	it('writes src AND root files on first upgrade, with changelog release notes (#348)', async () => {
		const result = await upgrade('base', project);
		expect(result.updatedCount).toBeGreaterThan(0);
		expect(result.changes.map((change) => change.version)).toEqual(
			RELEASE_NOTES.filter((entry) => entry.package === changelogPackageOf('base'))
				.map((entry) => entry.version)
				.reverse()
		);
		expect(changelogPackageOf('base')).toBe('svforge');

		// A src file AND a root file exist at their canonical destinations.
		const anySrc = Object.keys(baseFiles).find((path) => !BASE_RECIPE.rootPaths.includes(path))!;
		expect(existsSync(join(project, `src${anySrc}`))).toBe(true);
		expect(existsSync(join(project, 'svforge-check.mjs'))).toBe(true);

		// Version tracking written.
		expect(existsSync(join(project, TRACKING_FILE))).toBe(true);
		const state = JSON.parse(readFileSync(join(project, TRACKING_FILE), 'utf-8'));
		expect(state.base.version).toBe(SDFORGE_RECIPE_VERSION);
		// SHA-256 checksums (#327), keyed by project-relative destinations.
		const firstSrcChecksum = state.base.fileChecksums[`src${anySrc}`];
		expect(firstSrcChecksum).toMatch(/^[0-9a-f]{64}$/);
		expect(firstSrcChecksum).toBe(sha256((baseFiles as Record<string, string>)[anySrc]));
	});

	it('conflicts on a file modified AFTER the baseline install; preserves it', async () => {
		await upgrade('base', project);
		// User modifies a file post-install.
		const target = Object.keys(baseFiles)[0];
		const targetPath = BASE_RECIPE.rootPaths.includes(target) ? target.slice(1) : `src${target}`;
		writeFileSync(join(project, targetPath), '// USER EDIT\n');

		const result = await upgrade('base', project);
		const file = result.files.find((f) => f.path === targetPath);
		expect(file?.status).toBe('conflict');
		expect(file?.message).toMatch(/user modification/i);
		// The conflict comes with a READABLE diff (#327).
		expect(file?.diff).toContain('--- a/');
		expect(file?.diff).toContain('+');
		expect(result.skippedCount).toBeGreaterThan(0);
		// User edit preserved.
		expect(readFileSync(join(project, targetPath), 'utf-8')).toContain('USER EDIT');
	});

	it('an identical file is reported unchanged, not rewritten (#283)', async () => {
		await upgrade('base', project);
		const target = Object.keys(baseFiles).filter((p) => !BASE_RECIPE.rootPaths.includes(p))[0];
		const before = readFileSync(join(project, `src${target}`), 'utf-8');
		const result = await upgrade('base', project);
		const file = result.files.find((f) => f.path === `src${target}`);
		expect(file?.status).toBe('unchanged');
		expect(readFileSync(join(project, `src${target}`), 'utf-8')).toBe(before);
	});

	it('a diverging file WITHOUT a baseline is skipped, never overwritten (#283 preserved)', async () => {
		const target = Object.keys(baseFiles)[0];
		const template = (baseFiles as Record<string, string>)[target];
		const destPath = BASE_RECIPE.rootPaths.includes(target) ? target.slice(1) : `src${target}`;
		mkdirSync(join(project, dirname(destPath)), { recursive: true });
		writeFileSync(join(project, destPath), template + '\n// USER EDIT BEFORE FIRST UPGRADE\n');
		const result = await upgrade('base', project);
		const file = result.files.find((f) => f.path === destPath);
		expect(file?.status).toBe('conflict');
		expect(file?.message).toMatch(/no install baseline/i);
		expect(readFileSync(join(project, destPath), 'utf-8')).toContain('USER EDIT BEFORE FIRST UPGRADE');
		// --force overwrites it — with a versioned backup.
		const forced = await upgrade('base', project, { force: true });
		expect(forced.files.find((f) => f.path === destPath)?.status).toBe('updated');
		expect(forced.backupDir).toMatch(/^\.svforge-backup\/base\//);
	});

	it('overwrites with --force and backs up under a VERSIONED, timestamped directory (#327)', async () => {
		await upgrade('base', project);
		const target = Object.keys(baseFiles)[0];
		const targetPath = BASE_RECIPE.rootPaths.includes(target) ? target.slice(1) : `src${target}`;
		writeFileSync(join(project, targetPath), '// USER EDIT\n');

		const result = await upgrade('base', project, { force: true });
		expect(result.files.find((f) => f.path === targetPath)?.status).toBe('updated');
		expect(result.backupDir).toMatch(/^\.svforge-backup\/base\/\d{4}-\d{2}-\d{2}T/);
		expect(readFileSync(join(project, targetPath), 'utf-8')).not.toContain('USER EDIT');

		// The backup holds the USER's content, at its project-relative path.
		const backupRoot = join(project, result.backupDir!);
		const backedUp = readdirSync(backupRoot, { recursive: true }).map(String);
		expect(backedUp).toContain(targetPath);
	});

	it('two successive forced upgrades retain TWO backups (#327)', async () => {
		await upgrade('base', project);
		const target = Object.keys(baseFiles).filter((p) => !BASE_RECIPE.rootPaths.includes(p))[0];
		writeFileSync(join(project, `src${target}`), '// EDIT 1\n');
		await upgrade('base', project, { force: true });
		writeFileSync(join(project, `src${target}`), '// EDIT 2\n');
		await upgrade('base', project, { force: true });

		const runs = readdirSync(join(project, '.svforge-backup', 'base'));
		expect(runs.length).toBeGreaterThanOrEqual(2);
	});

	it('--dry-run plans and diffs but writes NOTHING, not even tracking (#327)', async () => {
		const before = existsSync(join(project, TRACKING_FILE));
		const result = await upgrade('base', project, { dryRun: true });

		expect(result.dryRun).toBe(true);
		expect(result.applied).toBe(0);
		expect(result.updatedCount).toBeGreaterThan(0); // the plan WOULD write
		expect(result.operations.every((op) => op.resolution !== 'conflict')).toBe(true);
		expect(result.operations.some((op) => op.diff && op.diff.length > 0)).toBe(true);
		// Nothing written: no files, no tracking.
		expect(existsSync(join(project, TRACKING_FILE))).toBe(before);
		const srcAny = Object.keys(baseFiles).filter((p) => !BASE_RECIPE.rootPaths.includes(p))[0];
		expect(existsSync(join(project, `src${srcAny}`))).toBe(false);
		// The result is machine-readable end to end.
		const json = JSON.parse(JSON.stringify(result));
		expect(json.summary.add).toBeGreaterThan(0);
		expect(json.changes[0].version).toBe('2.0.1');
	});

	it('dashboard upgrade never delivers playwright files to a vitest project (#186)', async () => {
		const result = await upgrade('dashboard', project, { dryRun: true });
		const e2eOps = result.operations.filter((op) => op.path.startsWith('e2e/') || op.path === 'playwright.config.ts');
		expect(e2eOps.length).toBeGreaterThan(0);
		expect(e2eOps.every((op) => op.resolution === 'skipped')).toBe(true);
		// src files are still planned normally.
		expect(result.operations.some((op) => op.path.startsWith('src/') && op.resolution === 'apply')).toBe(true);
	});

	it('profile detection refuses a package.json symlink pointing outside the root (#386)', async () => {
		// The attacker replaces the project manifest with a link to an outside
		// package.json that HAS @playwright/test — profile detection must not
		// follow it: every manifest read goes through the containment guard,
		// same as the engine's readPackageJson.
		const outside = mkdtempSync(join(tmpdir(), 'sf-outside-'));
		const outsidePkg = join(outside, 'package.json');
		writeFileSync(outsidePkg, JSON.stringify({ name: 'outside-app', devDependencies: { '@playwright/test': '^1.0.0' } }));
		rmSync(join(project, 'package.json'));
		symlinkSync(outsidePkg, join(project, 'package.json'));

		// The predicate REFUSES: the linked manifest has @playwright/test, so
		// reading through the link would yield true — containment yields false.
		expect(hasPlaywright(project)).toBe(false);

		// End to end, the upgrade refuses outright — the same containment error
		// planning hits — instead of planning against the outside manifest.
		await expect(upgrade('dashboard', project, { dryRun: true })).rejects.toThrow(/#386/);

		// The outside manifest was never consumed as the project's — untouched,
		// and nothing was delivered into the outside directory either.
		expect(readFileSync(outsidePkg, 'utf-8')).toContain('outside-app');
		expect(readdirSync(outside)).toEqual(['package.json']);
		rmSync(outside, { recursive: true, force: true });
	});

	it('rejects unknown modules with the full registry', async () => {
		await expect(upgrade('nope', project)).rejects.toThrow(/Unknown module.*blog/s);
	});
});

describe('standalone modules participate in the SAME upgrade protocol (#327)', () => {
	let project: string;
	let cleanup: () => void;

	beforeEach(() => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-module-up-'));
		project = dir;
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify({ name: 'app', private: true, dependencies: { mdsvex: '^0.12.8' }, devDependencies: {}, scripts: {} }, null, 2) + '\n'
		);
		cleanup = () => rmSync(dir, { recursive: true, force: true });
	});

	afterEach(() => cleanup());

	it('first module upgrade baselines identical files and conflicts on user-modified ones (protocol parity)', async () => {
		// Simulate a real `sv add @svforge/blog` delivery: files on disk, no baseline.
		for (const [manifestPath, content] of Object.entries(MODULE_RECIPES.blog.files)) {
			const dest = `src${manifestPath}`;
			mkdirSync(join(project, dest, '..'), { recursive: true });
			writeFileSync(join(project, dest), content);
		}
		// The user customized one delivered file.
		const userFile = 'src/lib/utils/posts.ts';
		writeFileSync(join(project, userFile), '// USER BLOG CUSTOMIZATION\n');

		const result = await upgrade('blog', project);
		// Identical delivered files → unchanged + baselined (not conflicts).
		const unchanged = result.files.filter((f) => f.status === 'unchanged');
		expect(unchanged.length).toBeGreaterThan(0);
		// The customized file → conflict, content preserved.
		const conflict = result.files.find((f) => f.path === userFile);
		expect(conflict?.status).toBe('conflict');
		expect(readFileSync(join(project, userFile), 'utf-8')).toContain('USER BLOG CUSTOMIZATION');
		// The tracking file now has a blog entry with SHA-256 checksums.
		const state = JSON.parse(readFileSync(join(project, TRACKING_FILE), 'utf-8'));
		expect(state.blog.version).toBe(MODULE_RECIPES.blog.version);
		expect(Object.values(state.blog.fileChecksums).every((v: unknown) => /^[0-9a-f]{64}$/.test(String(v)))).toBe(true);
	});

	it('module upgrade migrates its dependency migrations through package.json', async () => {
		// No mdsvex yet — the blog recipe carries the dependency migration.
		writeFileSync(
			join(project, 'package.json'),
			JSON.stringify({ name: 'app', private: true, dependencies: {}, devDependencies: {}, scripts: {} }, null, 2) + '\n'
		);
		const result = await upgrade('blog', project);
		const depOps = result.operations.filter((op) => op.action === 'dependency');
		expect(depOps.map((op) => op.dependency?.name)).toContain('mdsvex');
		expect(depOps.every((op) => op.resolution === 'apply')).toBe(true);
		const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf-8'));
		expect(pkg.dependencies.mdsvex).toBe('^0.12.8');
	});

	it('module release notes reuse the structured changelog (@svforge/blog, #348)', async () => {
		const result = await upgrade('blog', project, { dryRun: true });
		expect(changelogPackageOf('blog')).toBe('@svforge/blog');
		expect(result.changes.every((change) => change.package === '@svforge/blog')).toBe(true);
	});

	it('every module recipe is deliverable: files resolve, deps are well-formed', () => {
		for (const [id, recipe] of Object.entries(MODULE_RECIPES)) {
			if (id === 'base' || id === 'dashboard') continue;
			expect(Object.keys(recipe.files).length, `${id} files`).toBeGreaterThan(0);
			for (const dependency of recipe.dependencies ?? []) {
				expect(dependency.name, `${id} dep`).toMatch(/^[@a-z]/);
				expect(dependency.range, `${id} dep range`).toMatch(/^[\^~]?\d/);
			}
		}
	});
});

describe('install-time baseline initialization (#327 scaffold)', () => {
	function scaffoldDir(prefix: string): string {
		const dir = mkdtempSync(join(tmpdir(), prefix));
		// The modes patch package.json — the fixture project has one.
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: {} }, null, 2) + '\n');
		return dir;
	}

	it('base scaffold writes .svforge-versions.json with SHA-256 baselines of delivered files', () => {
		const dir = scaffoldDir('sf-scaffold-base-');
		try {
			const sv = diskSv(dir);
			applyBaseMode(sv as never, { '/lib/a.ts': 'A\n', '/vitest.config.ts': 'V\n' }, { '/messages/fr.json': 'F\n' });
			const state = JSON.parse(readFileSync(join(dir, TRACKING_FILE), 'utf-8'));
			expect(state.base.version).toBe(SDFORGE_RECIPE_VERSION);
			expect(state.base.fileChecksums['src/lib/a.ts']).toBe(sha256('A\n'));
			// The root-delivered files are keyed by their ROOT paths.
			expect(state.base.fileChecksums['vitest.config.ts']).toBe(sha256('V\n'));
			expect(state.base.fileChecksums['messages/fr.json']).toBe(sha256('F\n'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('dashboard scaffold baselines the MERGED delivery; the empty base pass writes nothing', () => {
		const dir = scaffoldDir('sf-scaffold-dash-');
		try {
			const sv = diskSv(dir);
			// Real scaffold order: base mode with an EMPTY file set, then the dashboard overlay.
			applyBaseMode(sv as never, {}, {});
			expect(existsSync(join(dir, TRACKING_FILE))).toBe(false);
			applyDashboardMode(
				sv as never,
				{ '/lib/base.ts': 'B\n', '/vitest.config.ts': 'V\n' },
				{ '/routes/admin/x.ts': 'D\n' },
				'vitest',
				{}
			);
			const state = JSON.parse(readFileSync(join(dir, TRACKING_FILE), 'utf-8'));
			expect(state.dashboard.version).toBe(SDFORGE_RECIPE_VERSION);
			// Base src file + dashboard overlay file + root vitest config.
			expect(state.dashboard.fileChecksums['src/lib/base.ts']).toBe(sha256('B\n'));
			expect(state.dashboard.fileChecksums['src/routes/admin/x.ts']).toBe(sha256('D\n'));
			expect(state.dashboard.fileChecksums['vitest.config.ts']).toBe(sha256('V\n'));
			// The base '/vitest.config.ts' was NOT delivered as a stray src copy.
			expect(existsSync(join(dir, 'src/vitest.config.ts'))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a fresh install + immediate upgrade is a clean no-op: zero conflicts, all unchanged', async () => {
		const dir = scaffoldDir('sf-scaffold-e2e-');
		try {
			// 1. Install: deliver the REAL base recipe + its baseline.
			const sv = diskSv(dir);
			applyBaseMode(sv as never, baseFiles, baseRootFiles);
			// 2. Upgrade immediately: the baseline proves everything is ours.
			const result = await upgrade('base', dir);
			expect(result.operations.filter((op) => op.resolution === 'conflict')).toHaveLength(0);
			// Every recipe file (src AND root-delivered) is unchanged.
			expect(result.files.filter((f) => f.status === 'unchanged').length).toBe(Object.keys(BASE_RECIPE.files).length);
			expect(result.applied).toBe(0);
			// The state on disk is untouched.
			const state = JSON.parse(readFileSync(join(dir, TRACKING_FILE), 'utf-8'));
			expect(state.base.version).toBe(SDFORGE_RECIPE_VERSION);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('svforge doctor behavioral (#189, unchanged contract)', () => {
	it('detects a SvelteKit project via vite.config.ts (modern format, no svelte.config.js)', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-doctor-'));
		try {
			writeFileSync(join(dir, 'vite.config.ts'), 'export default {};');
			writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2.0.0' } }));
			const report = await doctor(dir);
			const sveltekit = report.results.find((r) => r.module === 'sveltekit');
			expect(sveltekit?.status).toBe('ok');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('never modifies project files', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-doctor3-'));
		try {
			const before = readdirRecursive(dir);
			await doctor(dir);
			expect(readdirRecursive(dir)).toEqual(before);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

function readdirRecursive(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...readdirRecursive(full));
		else out.push(full);
	}
	return out;
}
