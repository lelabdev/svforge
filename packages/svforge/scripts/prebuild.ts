import { readDirRecursively } from '../../../scripts/prebuild-utils';
import { AVOID_PATTERNS } from '../src/design-system';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { readPackageChangelogs } from '../../../scripts/changelog.mjs';
import { buildCompatManifest } from '../../../scripts/compat-manifest.mjs';
import { buildAddonComponents, buildSkeletonInventory } from './generate-skeleton-inventory';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Canonical recipe version (#283): derived from the package.json of the
// addon itself, so the version announced by `svforge upgrade` cannot drift
// from the actually shipped package.
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const baseFiles = readDirRecursively(join(__dirname, '../templates/base/src'));
const dashboardOverlay = readDirRecursively(join(__dirname, '../templates/dashboard/src'));
// Dashboard = base + overlay (dashboard files override base if same path)
const dashboardFiles = dashboardOverlay;
// Skeleton inventory (#335): generated from the installed @skeletonlabs
// packages. The scaffolded checker (svforge-check.mjs) receives it injected
// so its Skeleton knowledge can never drift from the shipped version.
const skeletonInventory = buildSkeletonInventory(join(__dirname, '../../..'));

// Catalog guidance fix (#320): svforge-catalog.json must list ONLY the real
// @skeletonlabs/skeleton-svelte exports. The hand-written list presented CSS
// recipes (Card, Badge, Table…) and v2 leftovers (Breadcrumb, Drawer,
// Stepper…) as importable components. Rewritten from the generated inventory
// so the guidance can never drift from the installed packages again.
{
	const catalogPath = join(__dirname, '../templates/base/root/svforge-catalog.json');
	const catalogSource = readFileSync(catalogPath, 'utf-8');
	if (!/"skeletonPrimitives"\s*:\s*\[/.test(catalogSource)) {
		throw new Error('svforge-catalog.json is missing the skeletonPrimitives array.');
	}
	const corrected = catalogSource.replace(
		/("skeletonPrimitives"\s*:\s*)\[[\s\S]*?\]/,
		`$1${JSON.stringify(skeletonInventory.primitives)}`
	);
	JSON.parse(corrected); // never deliver a catalog that stopped being valid JSON
	writeFileSync(catalogPath, corrected);
}

// Approved addon component paths (#335): the EXACT .svelte paths the addons
// deliver under src/lib/components/svforge/. Exemption is per precise path —
// never per addon directory — so a new local component matching a Skeleton
// primitive is still rejected. Generated with SORTED enumeration (#361):
// unsorted readdir made both artifacts drift on CI clean checkouts.
const addonComponents = buildAddonComponents(join(__dirname, '../../..'));
const baseRootFilesRaw = readDirRecursively(join(__dirname, '../templates/base/root'));
// Read EARLY: the generated .prettierignore (#325) needs its keys below.
// Root-level files (drizzle.config.ts, .env.example, scripts/setup.sh,
// static/robots.txt) are embedded here and written at the PROJECT ROOT by
// the dashboard mode (#187).
const dashboardRootFiles = readDirRecursively(join(__dirname, '../templates/dashboard/root'));
const skeletonCheckerPath = '/svforge-check.mjs';
if (!baseRootFilesRaw[skeletonCheckerPath]) {
	throw new Error('svforge-check.mjs missing from base root template — inventory cannot be injected.');
}
if (!baseRootFilesRaw[skeletonCheckerPath].includes('/*__SKELETON_INVENTORY__*/')) {
	throw new Error('svforge-check.mjs is missing the /*__SKELETON_INVENTORY__*/ placeholder.');
}

// ── .prettierignore (#325) ────────────────────────────────────────────
// The scaffold ships `lint: prettier --check . && eslint .` and
// `format: prettier --write .`. Both must govern ONLY user-owned code:
// every SVForge-delivered file is upgrade-baseline tracked (SHA-256), so a
// user running `prettier --write .` would silently rewrite them and fake
// "user modifications" at the next upgrade. The delivered-file list below is
// DERIVED from the manifests — it cannot drift from what is shipped.
// The test-config trio mirrors BASE_ROOT_PATHS/DASHBOARD_ROOT_PATHS in
// src/destinations.ts (whose dynamic part — the root-file keys — is exactly
// what this prebuild embeds; the exact/prefix entries are fixed by #186/#235).
const ROOT_DELIVERED_EXACT = ['/vitest.config.ts', '/playwright.config.ts'];
const ROOT_DELIVERED_PREFIX = '/e2e/';
function deliveredIgnorePath(manifestPath: string): string {
	if (ROOT_DELIVERED_EXACT.includes(manifestPath) || manifestPath.startsWith(ROOT_DELIVERED_PREFIX)) {
		return manifestPath.slice(1);
	}
	return `src${manifestPath}`;
}
const prettierIgnoredDelivered = [
	...Object.keys({ ...baseFiles, ...dashboardOverlay }).map(deliveredIgnorePath),
	...Object.keys(baseRootFilesRaw).map((p) => p.slice(1)),
	...Object.keys(dashboardRootFiles).map((p) => p.slice(1))
]
	.filter((p) => p !== '.prettierignore')
	.sort();
const PRETTIER_STATIC_IGNORES = [
	'.svelte-kit',
	'.svforge-backup',
	'build',
	'dist',
	'docs',
	'node_modules',
	'src/lib/paraglide',
	'project.inlang/.meta.json',
	'project.inlang/.lix',
	'project.inlang/cache',
	'project.inlang/README.md',
	'package-lock.json',
	'bun.lock',
	'bun.lockb',
	'pnpm-lock.yaml',
	'yarn.lock',
	'.svforge.json',
	'.svforge-versions.json',
	'auth-schema.review.ts',
	'AGENTS.md',
	'llms.txt'
];
writeFileSync(
	join(__dirname, '../templates/base/root/.prettierignore'),
	`# Generated by packages/svforge/scripts/prebuild.ts — DO NOT EDIT.
# prettier must only govern USER-owned code: every SVForge-delivered file is
# upgrade-baseline tracked (SHA-256), and \`prettier --write .\` rewriting them
# would fake user modifications at the next upgrade (#325).

# Machine outputs & dependency artifacts
${PRETTIER_STATIC_IGNORES.join('\n')}

# SVForge-delivered files
${prettierIgnoredDelivered.join('\n')}
`
);
// Re-read: the freshly generated .prettierignore is itself a delivered root
// file and must be part of the embedded manifest (only the new key is taken —
// every other file on disk is unchanged).
baseRootFilesRaw['/.prettierignore'] = readDirRecursively(join(__dirname, '../templates/base/root'))['/.prettierignore'];

baseRootFilesRaw[skeletonCheckerPath] = baseRootFilesRaw[skeletonCheckerPath].replace(
	/\/\*__SKELETON_INVENTORY__\*\/.*/,
	`/*__SKELETON_INVENTORY__*/ ${JSON.stringify(skeletonInventory)}`
);
baseRootFilesRaw[skeletonCheckerPath] = baseRootFilesRaw[skeletonCheckerPath]
	.replace(
		/\/\*__ADDON_COMPONENTS__\*\/.*/,
		`/*__ADDON_COMPONENTS__*/ ${JSON.stringify(addonComponents)}`
	)
	.replace(
		/\/\*__AVOID_PATTERNS__\*\/.*/,
		`/*__AVOID_PATTERNS__*/ ${JSON.stringify(AVOID_PATTERNS)}`
	);
const baseRootFiles = baseRootFilesRaw;
// Base root-level files (Paraglide: messages/, project.inlang/) written at the
// PROJECT ROOT by the base mode (#239) — same delivery model as dashboard root.
// (baseRootFiles with the injected inventory is built above; the dashboard
// root files were read early for the .prettierignore generation.)
void baseRootFiles;

const output = `// AUTO-GENERATED - DO NOT EDIT
// Run bun run prebuild to regenerate

export const baseFiles = ${JSON.stringify(baseFiles, null, 2)};

export const dashboardFiles = ${JSON.stringify(dashboardFiles, null, 2)};

export const dashboardRootFiles = ${JSON.stringify(dashboardRootFiles, null, 2)};

export const baseRootFiles = ${JSON.stringify(baseRootFiles, null, 2)};
`;

writeFileSync(join(__dirname, '../src/templates.ts'), output);

// Generated Skeleton inventory (#335) — single canonical source for primitive
// protection and markup checks. Committed; the freshness gate (#329) fails if
// it no longer matches the installed @skeletonlabs packages.
writeFileSync(
	join(__dirname, '../src/skeleton-inventory.ts'),
	`// AUTO-GENERATED - DO NOT EDIT\n// Generated from installed @skeletonlabs packages (css ${skeletonInventory.versions.css}, svelte ${skeletonInventory.versions.svelte}).\n// Run bun run prebuild to regenerate.\n\nexport const SKELETON_VERSIONS = ${JSON.stringify(skeletonInventory.versions)};\n\nexport const SKELETON_PRIMITIVES: string[] = ${JSON.stringify(skeletonInventory.primitives)};\n\nexport const SKELETON_UTILITIES: string[] = ${JSON.stringify(skeletonInventory.utilities)};\n\nexport const SKELETON_UTILITY_PREFIXES: string[] = ${JSON.stringify(skeletonInventory.utilityPrefixes)};\n`
);

// Generated version module — single canonical source for the recipe version.
writeFileSync(
	join(__dirname, '../src/recipe-version.ts'),
	`// AUTO-GENERATED - DO NOT EDIT\n// Run bun run prebuild to regenerate (canonical version = package.json)\n\nexport const SDFORGE_RECIPE_VERSION = ${JSON.stringify(pkg.version)};\n`
);

// ── Release compatibility manifest (#470) ───────────────────────────────
// svforge keeps INDEPENDENT package versions; the unscoped `svforge` package
// carries the public distribution version. This manifest embeds the exact
// compatible version of every package so `svforge create --modules all`
// installs the versions that shipped with the user's `svforge` release —
// never an implicit `latest`. DERIVED from the package manifests.
const compatManifest = buildCompatManifest(join(__dirname, '../../..'));
writeFileSync(
	join(__dirname, '../src/compat-manifest.ts'),
	`// AUTO-GENERATED - DO NOT EDIT
// Run bun run prebuild to regenerate from the actual package manifests (#470).
// Exact compatible version of every package in this SVForge distribution.

export interface CompatManifest {
	schema: 1;
	template: { name: 'svforge'; version: string };
	packages: Record<string, string>;
}

export const COMPAT_MANIFEST: CompatManifest = ${JSON.stringify(compatManifest, null, 2)};
`
);

writeFileSync(
	join(__dirname, '../src/addon-components.ts'),
	`// AUTO-GENERATED - DO NOT EDIT\n// Exact component paths each SVForge addon delivers under src/lib/components/svforge/,\n// keyed by addon id. An addon's paths are only exemptions while that addon is\n// installed (.svforge.json modules). Run bun run prebuild to regenerate.\n\nexport const ADDON_COMPONENTS: Record<string, string[]> = ${JSON.stringify(addonComponents)};\n`
);

// ── Module upgrade recipes (#327) ───────────────────────────────────────
// The 13 standalone modules participate in the SAME upgrade protocol as
// base/dashboard: their owned files + dependency migrations are extracted
// here by mock-running each addon's real run() against a capability-complete
// fixture project, then embedded into src/module-recipes.ts. The extraction
// is the REAL install path (gates, deps, sv.file writes) — it cannot drift
// from what `sv add` actually delivers.
const MODULE_DIRS = [
	'audit', 'blog', 'chat', 'dnd', 'email', 'graph',
	'jobs', 'notifications', 'oauth', 'realtime', 'tiptap', 'ui_toast', 'uploads'
];

function makeExtractionFixture(): string {
	const fixture = mkdtempSync(join(tmpdir(), 'svforge-recipe-extract-'));
	// package.json proving every dependency-detected capability (#323 fast path:
	// SVForge origin + the dependency list IS the structural guarantee).
	writeFileSync(join(fixture, 'package.json'), JSON.stringify({
		name: 'recipe-extraction-fixture',
		private: true,
		dependencies: {
			'@skeletonlabs/skeleton': '^5.0.0',
			'@inlang/paraglide-js': '^2.24.0',
			'better-auth': '~1.7.3',
			'drizzle-orm': '^0.45.2',
			'postgres': '^3.4.5',
			'@aws-sdk/client-s3': '^3.1111.0'
		},
		devDependencies: {}
	}));
	// Valid schema-1 manifest listing every capability token — satisfies the
	// install gates and gives planAddonContext a valid merge base.
	writeFileSync(join(fixture, '.svforge.json'), JSON.stringify({
		schema: 1,
		template: 'dashboard',
		stack: { framework: 'sveltekit', ui: 'skeleton', i18n: 'paraglide', test: 'vitest', auth: 'better-auth', orm: 'drizzle', database: 'postgresql' },
		modules: [],
		capabilities: [
			'ui.skeleton', 'ui.svforge', 'i18n.messages', 'auth.currentUser', 'auth.admin',
			'database.drizzle.postgres', 'storage.object', 'runtime.longLivedWorker', 'runtime.websocket'
		],
		patterns: {},
		moduleCapabilities: {},
		generatedBy: 'svforge'
	}));
	mkdirSync(join(fixture, 'messages'), { recursive: true });
	writeFileSync(join(fixture, 'messages/en.json'), '{}\n');
	writeFileSync(join(fixture, 'messages/fr.json'), '{}\n');
	writeFileSync(join(fixture, 'llms.txt'), '');
	mkdirSync(join(fixture, 'src'), { recursive: true });
	writeFileSync(join(fixture, 'src/hooks.ts'), 'export const transport = {};\n');
	writeFileSync(join(fixture, 'src/hooks.server.ts'), 'export const handle = async ({ event, resolve }) => resolve(event);\n');
	mkdirSync(join(fixture, 'src/lib/components/svforge'), { recursive: true });
	mkdirSync(join(fixture, 'src/lib/server/db'), { recursive: true });
	writeFileSync(join(fixture, 'drizzle.config.ts'), '');
	writeFileSync(join(fixture, 'src/lib/server/admin.ts'), 'export const isAdmin = () => false;\n');
	return fixture;
}

interface ExtractedRecipe {
	id: string;
	package: string;
	version: string;
	dependencies: { name: string; range: string; dev: boolean }[];
	files: Record<string, string>;
}

async function extractModuleRecipe(moduleDir: string, fixture: string): Promise<ExtractedRecipe> {
	const pkg = JSON.parse(readFileSync(join(__dirname, `../../${moduleDir}/package.json`), 'utf-8'));
	const addon = await import(pathToFileURL(join(__dirname, `../../${moduleDir}/src/index.ts`)).href);
	const templates = await import(pathToFileURL(join(__dirname, `../../${moduleDir}/src/templates.ts`)).href);
	const collected = new Map<string, string>();
	const dependencies: { name: string; range: string; dev: boolean }[] = [];
	const sv = {
		dependency: (name: string, range: string) => dependencies.push({ name, range, dev: false }),
		devDependency: (name: string, range: string) => dependencies.push({ name, range, dev: true }),
		file: (path: string, init: (content: string) => string) => {
			collected.set(path, init(''));
		}
	};
	const cancel = (message: string) => {
		throw new Error(`Recipe extraction for ${moduleDir} hit an install gate — the fixture is stale: ${message}`);
	};
	await addon.default.run({ sv, cancel, cwd: fixture, options: {} });
	// OWNED files = exactly the module's templates (delivered wholesale via
	// `sv.file('src' + path)`); consumer-file patches (hooks.ts, vite.config…)
	// are project-owned and NEVER part of an upgrade recipe.
	const files: Record<string, string> = {};
	for (const [manifestPath] of Object.entries(templates.files as Record<string, string>)) {
		const dest = `src${manifestPath}`;
		const content = collected.get(dest);
		if (content === undefined) {
			// Option-gated template files (e.g. uploads `testpack`) are not part
			// of a DEFAULT install — the recipe mirrors the default delivery.
			console.warn(`   ⚠ ${moduleDir}: template file ${dest} not delivered by default — excluded from the upgrade recipe.`);
			continue;
		}
		files[manifestPath] = content;
	}
	return {
		id: moduleDir,
		package: `@svforge/${moduleDir}`,
		version: pkg.version,
		dependencies: dependencies.sort((a, b) => a.name.localeCompare(b.name)),
		files
	};
}

const extractionFixture = makeExtractionFixture();
const moduleRecipes: Record<string, ExtractedRecipe> = {};
try {
	for (const moduleDir of MODULE_DIRS) {
		moduleRecipes[moduleDir] = await extractModuleRecipe(moduleDir, extractionFixture);
	}
} finally {
	rmSync(extractionFixture, { recursive: true, force: true });
}

writeFileSync(
	join(__dirname, '../src/module-recipes.ts'),
	`// AUTO-GENERATED - DO NOT EDIT
// Extracted from the real @svforge/* addon run() implementations (#327):
// owned files, dependency migrations and package versions of the 13 standalone
// modules — the same upgrade protocol as base/dashboard. Run bun run prebuild
// to regenerate.

export interface ModuleRecipeData {
	id: string;
	/** npm package name (changelog package, e.g. "@svforge/blog"). */
	package: string;
	version: string;
	dependencies: { name: string; range: string; dev: boolean }[];
	/** Manifest path ("/x/y") → delivered content. All module files are src-relative. */
	files: Record<string, string>;
}

export const MODULE_RECIPE_DATA: Record<string, ModuleRecipeData> = ${JSON.stringify(moduleRecipes, null, 2)};
`
);

const changelogEntries = readPackageChangelogs(join(__dirname, '../../..'));
writeFileSync(
	join(__dirname, '../src/changelog.ts'),
	`// AUTO-GENERATED - DO NOT EDIT\n// Run bun run prebuild to regenerate from package CHANGELOG.md files\n\nexport interface ChangelogEntry {\n\tpackage: string;\n\tversion: string;\n\tdate: string;\n\tbody: string;\n}\n\nexport const RELEASE_NOTES: ChangelogEntry[] = ${JSON.stringify(changelogEntries, null, 2)};

function compareVersions(left: string, right: string): number {
\tconst parse = (version: string) => version.split(/[.-]/).map((part) => (/^\\d+$/.test(part) ? Number(part) : part));
\tconst a = parse(left);
\tconst b = parse(right);
\tfor (let index = 0; index < 3; index++) {
\t\tif (a[index] !== b[index]) return (a[index] as number) - (b[index] as number);
\t}
\treturn 0;
}

export function entriesBetween(entries: ChangelogEntry[], packageName: string, fromVersion: string | null, toVersion: string): ChangelogEntry[] {
\treturn entries
\t\t.filter((entry) => entry.package === packageName)
\t\t.filter((entry) => (!fromVersion || compareVersions(entry.version, fromVersion) > 0) && compareVersions(entry.version, toVersion) <= 0)
\t\t.sort((left, right) => compareVersions(left.version, right.version));
}
`
);

console.log('✅ Generated src/templates.ts + src/recipe-version.ts + src/compat-manifest.ts + src/changelog.ts + src/skeleton-inventory.ts + src/module-recipes.ts');
console.log(`   approved addon components: ${Object.keys(addonComponents).length} addons`);
console.log(`   ${Object.keys(baseFiles).length} base files`);
console.log(`   ${Object.keys(dashboardFiles).length} dashboard files`);
console.log(`   ${Object.keys(dashboardRootFiles).length} dashboard root files`);
console.log(`   ${Object.keys(baseRootFiles).length} base root files`);
console.log(`   module upgrade recipes (#327): ${Object.keys(moduleRecipes).length} modules (${Object.entries(moduleRecipes).map(([id, recipe]) => `${id}:${Object.keys(recipe.files).length}f`).join(', ')})`);
console.log(`   skeleton inventory: ${skeletonInventory.primitives.length} primitives, ${skeletonInventory.utilities.length} utilities (${skeletonInventory.versions.css})`);
