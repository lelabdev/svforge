/**
 * SVForge Upgrade — the diffable upgrade engine entry (#327).
 *
 * One protocol for base, dashboard AND the 13 standalone modules:
 *
 *   1. PLAN    — planUpgrade() reads the project and produces a complete
 *                operation list (add / modify / delete / move / dependency /
 *                script / JSON transformation) with readable diffs, BEFORE
 *                any write. Conflicts come from the actual installed baseline
 *                (.svforge-versions.json, SHA-256) — never from a guess.
 *   2. DIFF    — the plan is inspectable (printable or JSON) and a --dry-run
 *                writes nothing at all.
 *   3. APPLY   — applyPlan() backs up every overwritten file under a
 *                versioned, timestamped directory and rolls everything back
 *                on failure: applied atomically or not at all.
 *
 * Version inputs are the structured changelog (#348) and the recipe version
 * derived from the package (#283, #330): release notes between the installed
 * and target versions are attached to every result.
 *
 * The engine itself lives in @svforge/addon-kit so the 13 standalone modules
 * share the exact same protocol (extraction at prebuild → module-recipes.ts).
 */

import { baseFiles, dashboardFiles, baseRootFiles, dashboardRootFiles } from './templates';
import { BASE_ROOT_PATHS, DASHBOARD_ROOT_PATHS } from './destinations';
import { MODULE_RECIPE_DATA } from './module-recipes';
import { SDFORGE_RECIPE_VERSION } from './recipe-version';
import { RELEASE_NOTES, entriesBetween } from './changelog';
import type { ChangelogEntry } from './changelog';
import {
	applyPlan,
	loadTrackingFile,
	planUpgrade,
	readPackageJson
} from '@svforge/addon-kit';
import type {
	ApplyResult,
	PlannedOperation,
	UpgradePlan,
	UpgradeRecipe
} from '@svforge/addon-kit';

// Re-export the shared protocol types so consumers import upgrade concerns
// from one place.
export type { ApplyResult, PlannedOperation, UpgradePlan, UpgradeRecipe } from '@svforge/addon-kit';
export { planUpgrade, applyPlan, sha256, resolveDestination, assertSafeRelativePath, safeProjectPath, TRACKING_FILE } from '@svforge/addon-kit';

/** A single file in an upgrade result (stable, human-oriented view). */
export interface UpgradeFile {
	/** Project-relative path. */
	path: string;
	/** Upgrade status for this file. */
	status: 'updated' | 'unchanged' | 'skipped' | 'conflict';
	/** Human-readable detail. */
	message: string;
	/** Readable diff when content changes are involved. */
	diff?: string;
}

/** Result of an upgrade operation (also the machine-readable --json payload). */
export interface UpgradeResult {
	/** Recipe that was upgraded (base, dashboard or a module id). */
	module: string;
	/** Recipe version installed before the upgrade. */
	fromVersion: string | null;
	/** Recipe version applied by the upgrade. */
	toVersion: string;
	/** Full operation plan (add/modify/delete/move/dependency/script/json). */
	operations: PlannedOperation[];
	/** Per-file summary (back-compatible view over the operations). */
	files: UpgradeFile[];
	/** Number of file operations actually applied. */
	updatedCount: number;
	/** Number of files skipped (conflicts or profile-gated). */
	skippedCount: number;
	/** Release notes between the installed and target versions (#348). */
	changes: ChangelogEntry[];
	/** True when nothing was written (dry run). */
	dryRun: boolean;
	/** Number of operations applied on disk. */
	applied: number;
	/** Versioned backup directory (project-relative), when backups were made. */
	backupDir?: string;
	/** True when a mid-apply failure reverted every write (#327 atomicity). */
	rolledBack: boolean;
	/** Error message when rolledBack. */
	error?: string;
	/** Aggregate plan summary. */
	summary: UpgradePlan['summary'];
}

/** The base recipe: src/** plus the root-delivered files (vitest config, Paraglide, checker…). */
export const BASE_RECIPE: UpgradeRecipe = {
	id: 'base',
	version: SDFORGE_RECIPE_VERSION,
	files: { ...baseFiles, ...baseRootFiles },
	rootPaths: BASE_ROOT_PATHS
};

/** The dashboard recipe: base + overlay + root files, with root-delivered test configs (#186). */
export const DASHBOARD_RECIPE: UpgradeRecipe = {
	id: 'dashboard',
	version: SDFORGE_RECIPE_VERSION,
	files: { ...baseFiles, ...baseRootFiles, ...dashboardFiles, ...dashboardRootFiles },
	rootPaths: DASHBOARD_ROOT_PATHS
};

/**
 * Known recipes: base + dashboard + the 13 standalone modules (#327).
 * Recipe versions are derived at prebuild time (#283) and cannot drift from
 * the actually shipped packages.
 */
export const MODULE_RECIPES: Record<string, UpgradeRecipe> = {
	base: BASE_RECIPE,
	dashboard: DASHBOARD_RECIPE,
	...Object.fromEntries(
		Object.values(MODULE_RECIPE_DATA).map((data) => [
			data.id,
			{
				id: data.id,
				version: data.version,
				files: data.files,
				rootPaths: [] as string[],
				dependencies: data.dependencies
			} satisfies UpgradeRecipe
		])
	)
};

/** Changelog package name of a recipe (#348: 'svforge' | '@svforge/<module>'). */
export function changelogPackageOf(moduleName: string): string {
	return moduleName === 'base' || moduleName === 'dashboard' ? 'svforge' : `@svforge/${moduleName}`;
}

/** Manifest paths of the dashboard playwright profile (#181, known broken on vitest projects — #186). */
const PLAYWRIGHT_MANIFEST_PATHS = Object.keys(dashboardFiles).filter(
	(path) => path === '/playwright.config.ts' || path.startsWith('/e2e/')
);

/**
 * Upgrade an SVForge recipe (base, dashboard or one of the 13 modules) in a
 * project. Plans first, prints nothing, writes only after the plan succeeds.
 *
 * @param moduleName - Recipe id (e.g. "base", "dashboard", "blog").
 * @param projectRoot - Absolute path to the project root.
 * @param options - force: overwrite user-modified files (backed up).
 *                  targetVersion: validate an explicit target.
 *                  dryRun: plan + diff only — write NOTHING.
 */
export async function upgrade(
	moduleName: string,
	projectRoot: string = process.cwd(),
	options: { force?: boolean; targetVersion?: string; dryRun?: boolean } = {}
): Promise<UpgradeResult> {
	const recipe = MODULE_RECIPES[moduleName];
	if (!recipe) {
		throw new Error(
			`Unknown module: "${moduleName}". Available: ${Object.keys(MODULE_RECIPES).join(', ')}`
		);
	}

	const targetVersion = options.targetVersion ?? recipe.version;
	if (targetVersion !== recipe.version) {
		throw new Error(
			`Target version ${targetVersion} is not available in this svforge package (current: ${recipe.version}).`
		);
	}

	// Profile gating (#186): the playwright files are only delivered to a
	// project that actually has @playwright/test — a vitest project keeps its
	// profile, the files appear as skipped in the plan.
	const exclusions: { manifestPath: string; reason: string }[] = [];
	if (moduleName === 'dashboard' && !hasPlaywright(projectRoot)) {
		for (const manifestPath of PLAYWRIGHT_MANIFEST_PATHS) {
			exclusions.push({
				manifestPath,
				reason: 'Playwright testing profile not installed (#186) — file not delivered.'
			});
		}
	}

	const tracking = loadTrackingFile(projectRoot);
	const fromVersion = tracking[moduleName]?.version ?? null;
	const plan = planUpgrade(recipe, projectRoot, { force: options.force, tracking, exclusions });
	const changes = entriesBetween(RELEASE_NOTES, changelogPackageOf(moduleName), fromVersion, targetVersion);

	if (options.dryRun) {
		return toResult(moduleName, targetVersion, plan, changes, { dryRun: true, applied: 0, rolledBack: false });
	}

	const applied = applyPlan(recipe, plan, projectRoot, { dryRun: false });
	return toResult(moduleName, targetVersion, plan, changes, { ...applied, dryRun: false });
}

/**
 * True when the project actually depends on @playwright/test. Exported for
 * tests: the read is containment-guarded (#386) — a symlinked manifest must
 * be REFUSED (false), never followed outside the project root.
 */
export function hasPlaywright(projectRoot: string): boolean {
	try {
		// Containment-checked like every other project manifest read (#386):
		// a symlink planted at `<root>/package.json` must not redirect this
		// read outside the root during profile detection.
		const { json: pkg } = readPackageJson(projectRoot);
		const dev = pkg.devDependencies as Record<string, string> | undefined;
		const prod = pkg.dependencies as Record<string, string> | undefined;
		return Boolean(dev?.['@playwright/test'] ?? prod?.['@playwright/test']);
	} catch {
		return false;
	}
}

function toResult(
	module: string,
	toVersion: string,
	plan: UpgradePlan,
	changes: ChangelogEntry[],
	applied: Pick<ApplyResult, 'dryRun' | 'applied' | 'rolledBack' | 'error' | 'backupDir'>
): UpgradeResult {
	const files: UpgradeFile[] = plan.operations.map((op) => ({
		path: op.path,
		status:
			op.resolution === 'apply' ? 'updated'
			: op.resolution === 'unchanged' ? 'unchanged'
			: op.resolution === 'skipped' ? 'skipped'
			: 'conflict',
		message: op.reason,
		...(op.diff ? { diff: op.diff } : {})
	}));
	return {
		module,
		fromVersion: plan.fromVersion,
		toVersion,
		operations: plan.operations,
		files,
		updatedCount: files.filter((f) => f.status === 'updated').length,
		skippedCount: files.filter((f) => f.status === 'skipped' || f.status === 'conflict').length,
		changes,
		dryRun: applied.dryRun,
		applied: applied.applied,
		rolledBack: applied.rolledBack,
		...(applied.error ? { error: applied.error } : {}),
		...(applied.backupDir ? { backupDir: applied.backupDir } : {}),
		summary: plan.summary
	};
}

/** Print a plan/result to the console, conflicts with their readable diff. */
export function printUpgradeResult(result: UpgradeResult): void {
	console.log(`\n SVForge Upgrade: ${result.module}\n`);
	console.log(`  Version: ${result.fromVersion ?? 'none'} → ${result.toVersion}${result.dryRun ? '  (dry run — nothing written)' : ''}\n`);

	if (result.changes.length) {
		console.log('  Release notes:');
		for (const change of result.changes) console.log(`    ${change.version}${change.date ? ` (${change.date})` : ''}\n${change.body}`);
		console.log('');
	}

	for (const op of result.operations) {
		const icon =
			op.resolution === 'apply' ? '✓'
			: op.resolution === 'unchanged' ? '='
			: op.resolution === 'skipped' ? '⚠'
			: '✗';
		console.log(`  ${icon} [${op.action}] ${op.path} — ${op.reason}`);
		if (op.resolution === 'conflict' && op.diff) {
			console.log(op.diff.split('\n').map((line) => `      ${line}`).join('\n'));
		}
	}

	const conflicts = result.operations.filter((op) => op.resolution === 'conflict').length;
	console.log(
		`\n  ${result.applied} operation(s) applied, ${result.operations.filter((op) => op.resolution === 'unchanged').length} unchanged, ${conflicts} conflict(s), ${result.operations.filter((op) => op.resolution === 'skipped').length} skipped.`
	);
	if (result.backupDir) console.log(`  Backups: ${result.backupDir}`);
	if (result.rolledBack) console.log(`  ✗ FAILED, rolled back: ${result.error}`);
	console.log('');
}
