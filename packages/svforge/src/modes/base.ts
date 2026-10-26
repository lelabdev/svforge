import type { SvApi } from 'sv';
import { resolveDestination, initTrackingJson } from '@svforge/addon-kit';
import { scaffoldedAgents } from '../scaffolded-agents';
import { buildManifest, renderLlmstxt } from '../ai-context';
import { BASE_ROOT_PATHS } from '../destinations';
import { SDFORGE_RECIPE_VERSION } from '../recipe-version';
import { scaffoldedLocalDocs } from '../local-docs';

// Files that must land at the PROJECT ROOT, not under src/ (#235):
// resolved through the ONE canonical resolver shared with the upgrade engine
// (#327) — BASE_ROOT_PATHS in destinations.ts.

const LEFTHOOK_CONFIG = `pre-commit:
  commands:
    svforge-check:
      glob: '*.{svelte,html,css,json}'
      run: node svforge-check.mjs --strict
`;

type HookMode = 'none' | 'lefthook';

const SVFORGE_LIB_IMPORT_MAPPING = './src/lib/*';

/** Return an actionable error when a project already routes #lib elsewhere. */
export function libImportMappingConflict(packageJsonContent: string): string | undefined {
	const pkg = JSON.parse(packageJsonContent) as { imports?: Record<string, unknown> };
	const existing = pkg.imports?.['#lib/*'];
	if (existing === undefined || existing === SVFORGE_LIB_IMPORT_MAPPING) return undefined;
	return `SVForge cannot be applied because package.json imports["#lib/*"] is ${JSON.stringify(existing)}; SVForge installs its library files under src/lib and requires "${SVFORGE_LIB_IMPORT_MAPPING}". Update or remove the conflicting mapping, then run sv add again. The existing mapping will not be overwritten.`;
}

/**
 * Split a plugins-array body on top-level commas only — commas inside call
 * args, object literals or strings must not split (#325).
 */
function splitTopLevel(input: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	let quote: string | null = null;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (quote) {
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') {
			quote = ch;
			continue;
		}
		if (ch === '(' || ch === '{' || ch === '[') depth++;
		else if (ch === ')' || ch === '}' || ch === ']') depth--;
		else if (ch === ',' && depth === 0) {
			parts.push(input.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(input.slice(start));
	return parts;
}

/**
 * Index of the `]` matching the `[` at `open` (string literals are skipped).
 * A naive `[^\]]*` stops at the FIRST `]` — which may belong to a regex
 * character class inside a plugin option (e.g. the runes matcher `/[/\\]/`
 * inside `sveltekit({ compilerOptions })`). Re-rendering then injected a
 * newline into that class and broke the generated config (#415).
 */
function matchBracket(input: string, open: number): number {
	let depth = 0;
	let quote: string | null = null;
	for (let i = open; i < input.length; i++) {
		const ch = input[i];
		if (quote) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') quote = ch;
		else if (ch === '[') depth++;
		else if (ch === ']' && --depth === 0) return i;
	}
	return -1;
}

/**
 * #588: the locale strategy the scaffold compiles into the Paraglide runtime.
 * `url` first so `/fr/...` resolves to French, then the cookie, then the base
 * locale for unprefixed (English) routes. Paraglide's own default omits `url`.
 */
const PARAGLIDE_STRATEGY = "strategy: ['url', 'cookie', 'baseLocale']";

/** The plugin call SVForge writes when the official add-on did not create one. */
const PARAGLIDE_PLUGIN_CALL = `paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			${PARAGLIDE_STRATEGY}
		})`;

/**
 * Wire the SVForge Vite plugins (Paraglide + the production design-system
 * gate) into the generated `vite.config.ts`, keeping the `plugins:` array
 * prettier-stable (#325). Bracket matching is BALANCED (#415) so a plugin
 * option containing `[`/`]` — a regex character class, an array — can never
 * truncate the array and corrupt the config.
 */
export function patchViteConfig(content: string): string {
	let updated = content;
	if (!updated.includes("from '@inlang/paraglide-js'")) {
		updated = `import { paraglideVitePlugin } from '@inlang/paraglide-js';\n${updated}`;
	}
	if (!updated.includes("from './svforge-design-system-vite-plugin.mjs'")) {
		updated = `import { svforgeDesignSystemPlugin } from './svforge-design-system-vite-plugin.mjs';\n${updated}`;
	}
	if (!updated.includes('paraglideVitePlugin({')) {
		updated = updated.replace(/plugins:\s*\[/, `plugins: [${PARAGLIDE_PLUGIN_CALL}, `);
	}
	// #588: Paraglide's default strategy is `['cookie', 'globalVariable',
	// 'baseLocale']` — it never reads the URL, so `/fr/...` would silently render
	// the base locale. The scaffold owns URL-based i18n: declare the strategy
	// explicitly, on the plugin call the official add-on already created too.
	if (!updated.includes(PARAGLIDE_STRATEGY)) {
		const multiline = /paraglideVitePlugin\(\{\r?\n(\s*)/;
		if (multiline.test(updated)) {
			updated = updated.replace(
				multiline,
				(_match, indent: string) => `paraglideVitePlugin({\n${indent}${PARAGLIDE_STRATEGY},\n${indent}`
			);
		} else if (updated.includes('paraglideVitePlugin({')) {
			updated = updated.replace(
				/paraglideVitePlugin\(\{\s*/,
				`paraglideVitePlugin({ ${PARAGLIDE_STRATEGY}, `
			);
		}
	}
	if (!updated.includes('svforgeDesignSystemPlugin()')) {
		updated = updated.replace(/plugins:\s*\[/, 'plugins: [svforgeDesignSystemPlugin(), ');
	}
	// #325: the scaffold ships `lint: prettier --check . && eslint .` — the
	// patched plugins array must be prettier-stable (printWidth 100). When the
	// single-line form no longer fits, render one plugin per line (exactly what
	// prettier would produce), so `prettier --check .` is green on a fresh
	// scaffold without reformatting user files.
	const pluginsStart = updated.search(/plugins:\s*\[/);
	if (pluginsStart !== -1) {
		const bracket = updated.indexOf('[', pluginsStart);
		const close = matchBracket(updated, bracket);
		if (close !== -1) {
			const items = splitTopLevel(updated.slice(bracket + 1, close))
				.map((item) => item.trim())
				.filter(Boolean);
			if (items.length > 0) {
				// The statement keeps ITS original indentation — only the array
				// body is re-rendered (items one level deeper, closing bracket
				// one level shallower) — exactly prettier's canonical output.
				const single = `plugins: [${items.join(', ')}]`;
				const rendered =
					single.length + 1 <= 100
						? single
						: `plugins: [\n${items.map((item) => `\t\t${item}`).join(',\n')}\n\t]`;
				updated = `${updated.slice(0, pluginsStart)}${rendered}${updated.slice(close + 1)}`;
			}
		}
	}
	return updated;
}

/**
 * Vitest's own config bypasses the Kit plugin options from vite.config.ts.
 * Give it the `#lib` package-subpath alias, while retaining a `$lib` fallback
 * for existing Kit 2 test code. Merge into an existing resolve.alias object
 * (including the one emitted by the official Vitest add-on) instead of adding
 * a duplicate resolve key.
 */
function ensureFileURLToPathImport(content: string): { content: string; binding: string } {
	const namedImports = /import\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*(['"])node:url\3\s*;?/g;
	for (const match of content.matchAll(namedImports)) {
		if (match[1]) continue;
		for (const rawBinding of match[2].split(',')) {
			const binding = rawBinding.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
			const [imported, local = imported] = binding.split(/\s+as\s+/);
			if (imported === 'fileURLToPath') return { content, binding: local };
		}
	}

	let binding = 'fileURLToPath';
	while (content.includes(binding)) binding = binding === 'fileURLToPath' ? 'svforgeFileURLToPath' : `${binding}2`;
	const alias = binding === 'fileURLToPath' ? '' : ` as ${binding}`;
	return {
		content: `import { fileURLToPath${alias} } from 'node:url';\n${content}`,
		binding
	};
}

export function patchVitestConfig(content: string): string {
	let updated = content;
	const aliases = ['#lib', '$lib'];
	const missingAliases = aliases.filter((key) =>
		key === '#lib' ? !/#lib["']?\s*:/.test(updated) : !/(?:["']\$lib["']|\$lib)\s*:/.test(updated)
	);
	if (missingAliases.length === 0) return updated;

	const fileUrlImport = ensureFileURLToPathImport(updated);
	updated = fileUrlImport.content;
	const entries = missingAliases.map(
		(key) => `'${key}': ${fileUrlImport.binding}(new URL('./src/lib', import.meta.url))`
	);
	if (/\balias\s*:\s*\{/.test(updated)) {
		updated = updated.replace(/\balias\s*:\s*\{/, (match) => `${match} ${entries.join(', ')},`);
	} else if (/\bresolve\s*:\s*\{/.test(updated)) {
		updated = updated.replace(/\bresolve\s*:\s*\{/, (match) => `${match} alias: { ${entries.join(', ')} },`);
	} else {
		updated = updated.replace(
			/export default defineConfig\(\s*\{/,
			(match) => `${match}\n\tresolve: { alias: { ${entries.join(', ')} } },`
		);
	}
	return updated;
}

// `sv add --install` is valid before `git init`. The conditional preserves an
// installation failure inside a repository while making the lifecycle script a
// successful no-op outside one.
const LEFTHOOK_PREPARE = 'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then lefthook install; fi';

/**
 * Apply Base mode files via sv.file()
 * Base = all UI components, layouts, styles, utils, schemas
 */
/**
 * Canonical Base delivery (#674).
 *
 * This is the ONE operation both modes use to obtain Base's shared substance:
 * the central dependency declarations, the project wiring (`package.json`,
 * `vite.config.ts`, optional hooks), the shared template files, the root files
 * and the vendored LLM references. It deliberately writes NO mode metadata
 * (`AGENTS.md`, `.svforge.json`, `.svforge-versions.json`, `llms.txt`): the
 * caller owns those, so the Dashboard mode never runs Base's tracking or
 * manifest pass.
 *
 * `exclude` lists template paths the caller delivers itself — the files the
 * official `sv` add-ons own (`hooks.server.ts`, `app.d.ts`) and files the mode
 * overrides on purpose (e.g. the Dashboard Vitest config).
 */
export interface BaseDelivery {
	/** Source-file map that was actually delivered (template path → content). */
	files: Record<string, string>;
	/** Root files that were actually delivered (root path → content). */
	rootFiles: Record<string, string>;
}

export interface BaseDeliveryOptions {
	files: Record<string, string>;
	rootFiles?: Record<string, string>;
	hooks?: HookMode;
	/** Template paths the caller delivers itself. */
	exclude?: ReadonlySet<string>;
}

export function deliverBaseScaffold(sv: SvApi, options: BaseDeliveryOptions): BaseDelivery {
	const { files, rootFiles = {}, hooks = 'none', exclude } = options;
	const deliveredFiles = Object.fromEntries(Object.entries(files).filter(([path]) => !exclude?.has(path)));
	const deliveredRootFiles = Object.fromEntries(Object.entries(rootFiles).filter(([path]) => !exclude?.has(path)));
	// Baseline Vitest (#235): deliver the runnable test baseline. The
	// devDependency + script mirror the template package.json (vitest ^5.0.0).
	sv.devDependency('vitest', '^5.0.0');

	// Node types (#271): the Paraglide server runtime (generated
	// src/lib/paraglide/server.js) imports async_hooks — svelte-check fails
	// without @types/node in the generated project (the template package.json
	// reference is not enough, the dependency must be declared at scaffold).
	sv.devDependency('@types/node', '^22');

	// Paraglide i18n (#239): compiler-first FR/EN messages, official Svelte
	// integration. The vite plugin generates src/lib/paraglide at build time.
	sv.dependency('@inlang/paraglide-js', '^2.24.0');

	// Add runnable test, type-check and lint/format scripts to the generated
	// project. The eslint + prettier devDependencies are injected by index.ts
	// and the configs ship in the root files — the scripts are what make the
	// lint/format promise REAL (#325).
	// `check` compiles Paraglide first: the vite plugin generates
	// src/lib/paraglide at build/dev time, but svelte-check needs the files
	// present (and their .d.ts) to type-check the generated messages (#271).
	// check:watch mirrors check (#325): without the compile step the watch
	// variant advertised by the template reference fails on the generated
	// Paraglide messages.
	sv.file('package.json', (content: string) => {
		const conflict = libImportMappingConflict(content);
		if (conflict) throw new Error(conflict);
		const pkg = JSON.parse(content);
		pkg.imports = {
			...(pkg.imports && typeof pkg.imports === 'object' ? pkg.imports : {}),
			'#lib/*': pkg.imports?.['#lib/*'] ?? SVFORGE_LIB_IMPORT_MAPPING
		};
		pkg.scripts = {
			...pkg.scripts,
			lint: 'prettier --check . && eslint .',
			format: 'prettier --write .',
			test: 'vitest run',
			'test:watch': 'vitest',
			// #343: the design-system check rides on `bun run check` —
			// self-contained local invocation (no network install). The checker
			// exits non-zero on ERROR and zero on WARN-only, so plain && keeps
			// "ERROR fails the command, WARN stays informational".
			check:
				'svelte-kit sync && paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide --strategy url cookie baseLocale && svelte-check --tsconfig ./tsconfig.json && node svforge-check.mjs',
			'check:watch':
				'svelte-kit sync && paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide --strategy url cookie baseLocale && svelte-check --tsconfig ./tsconfig.json --watch'
		};
		return `${JSON.stringify(pkg, null, '\t')}\n`;
	});

// Strict checks stay opt-in (#344): Lefthook only runs for commits with
	// staged relevant files, then checks the project because the checker has no
	// safe partial-file mode. Its prepare script installs the Git hook on install.
	if (hooks === 'lefthook') {
		sv.devDependency('lefthook', '^2.0.13');
		sv.file('.lefthook.yml', () => LEFTHOOK_CONFIG);
		sv.file('package.json', (content: string) => {
			const pkg = JSON.parse(content);
			const prepare = pkg.scripts?.prepare;
			pkg.scripts = {
				...pkg.scripts,
				prepare: prepare?.includes('lefthook install') ? prepare : prepare ? `${prepare} && ${LEFTHOOK_PREPARE}` : LEFTHOOK_PREPARE
			};
			return `${JSON.stringify(pkg, null, '\t')}\n`;
		});
	}

	// Paraglide (#239) and the production-only design-system gate (#350)
	// share vite.config.ts. The gate imports the scaffolded checker, so Vite
	// builds and `bun run check` produce the same diagnostics.
	sv.file('vite.config.ts', (content) => patchViteConfig(content));
	// Write all base template files — destinations come from the ONE canonical
	// resolver shared with the upgrade engine (#327): no install/upgrade drift.
	for (const [path, content] of Object.entries(deliveredFiles)) {
		sv.file(resolveDestination(path, BASE_ROOT_PATHS), () => content);
	}

	// Vitest resolves package imports independently from SvelteKit; add the
	// #lib path alias and retain $lib only as a compatibility fallback for
	// test files in existing Kit 2 projects. Only meaningful when THIS delivery
	// owns the Vitest config: a mode that ships its own config excludes it.
	if (deliveredFiles['/vitest.config.ts'] !== undefined) {
		sv.file('vitest.config.ts', (content) => patchVitestConfig(content));
	}

	// Write root-level project files (messages/, project.inlang/) at the
	// project root (#239) — same delivery model as the dashboard root files.
	for (const [path, content] of Object.entries(deliveredRootFiles)) {
		sv.file(path.slice(1), () => content);
	}

	// #317: ship the cached Skeleton/Svelte LLM references so agents search
	// local, version-matched docs before changing Skeleton UI/theme. These are
	// shared Base artifacts, not mode metadata.
	for (const [doc, content] of Object.entries(scaffoldedLocalDocs())) {
		sv.file(doc, () => content);
	}

	return { files: deliveredFiles, rootFiles: deliveredRootFiles };
}

export function applyBaseMode(
	sv: SvApi,
	files: Record<string, string>,
	rootFiles: Record<string, string> = {},
	hooks: HookMode = 'none',
	packageManager = 'npm'
): void {
	const delivered = deliverBaseScaffold(sv, { files, rootFiles, hooks });

	// Upgrade baseline (#327): initialize .svforge-versions.json at INSTALL
	// time — SHA-256 of every recipe-delivered file (src + root) — so the
	// FIRST upgrade already has a real baseline instead of treating every
	// divergence as a user modification (#283). Skipped when no shared files
	// are delivered (the Dashboard mode computes its own merged baseline).
	if (Object.keys(delivered.files).length > 0) {
		sv.file('.svforge-versions.json', () =>
			initTrackingJson(
				'base',
				SDFORGE_RECIPE_VERSION,
				{ ...delivered.files, ...delivered.rootFiles },
				BASE_ROOT_PATHS
			)
		);
	}

	// AI-ready: scaffold AGENTS.md at the project root (#203, #347) — the
	// sole agent convention of a SvelteForge project (#325: PM-aware commands).
	sv.file('AGENTS.md', () => scaffoldedAgents('base', packageManager));

	// AI context (#234): machine-readable manifest + llms.txt, derived from
	// the real scaffold state. The dashboard mode overrides with its template.
	const manifest = buildManifest('base', []);
	sv.file('.svforge.json', () => `${JSON.stringify(manifest, null, 2)}\n`);
	sv.file('llms.txt', () => renderLlmstxt(manifest));
}
