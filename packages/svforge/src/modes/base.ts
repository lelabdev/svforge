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

// `sv add --install` is valid before `git init`. The conditional preserves an
// installation failure inside a repository while making the lifecycle script a
// successful no-op outside one.
const LEFTHOOK_PREPARE = 'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then lefthook install; fi';

/**
 * Apply Base mode files via sv.file()
 * Base = all UI components, layouts, styles, utils, schemas
 */
export function applyBaseMode(
	sv: SvApi,
	files: Record<string, string>,
	rootFiles: Record<string, string> = {},
	hooks: HookMode = 'none',
	packageManager = 'npm'
): void {
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
		const pkg = JSON.parse(content);
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
				'svelte-kit sync && paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide && svelte-check --tsconfig ./tsconfig.json && node svforge-check.mjs',
			'check:watch':
				'svelte-kit sync && paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide && svelte-check --tsconfig ./tsconfig.json --watch'
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
	sv.file('vite.config.ts', (content) => {
		let updated = content;
		if (!updated.includes("from '@inlang/paraglide-js'")) {
			updated = `import { paraglideVitePlugin } from '@inlang/paraglide-js';\n${updated}`;
		}
		if (!updated.includes("from './svforge-design-system-vite-plugin.mjs'")) {
			updated = `import { svforgeDesignSystemPlugin } from './svforge-design-system-vite-plugin.mjs';\n${updated}`;
		}
		if (!updated.includes('paraglideVitePlugin({')) {
			updated = updated.replace(
				/plugins:\s*\[/,
				'plugins: [paraglideVitePlugin({ project: \'./project.inlang\', outdir: \'./src/lib/paraglide\' }), '
			);
		}
		if (!updated.includes('svforgeDesignSystemPlugin()')) {
			updated = updated.replace(/plugins:\s*\[/, 'plugins: [svforgeDesignSystemPlugin(), ');
		}
		// #325: the scaffold ships `lint: prettier --check . && eslint .` —
		// the patched plugins array must be prettier-stable (printWidth 100).
		// When the single-line form no longer fits, render one plugin per line
		// (exactly what prettier would produce), so `prettier --check .` is
		// green on a fresh scaffold without reformatting user files.
	const pluginsStart = updated.search(/plugins:\s*\[/);
	if (pluginsStart !== -1) {
		// #415: find the MATCHING close bracket with a depth-aware scan. The old
		// matcher (`/plugins:\s*\[([^\]]*)\]/`) stopped at the first `]` — which
		// sv >= 0.17 now places INSIDE the scaffolded `runes` regex
		// (`filename.split(/[/\\]/)…`) — so the re-render truncated the config
		// mid-regex and inserted a newline inside the character class, leaving
		// vite.config.ts unparsable (`bun run dev` died on fresh scaffolds).
		const open = updated.indexOf('[', pluginsStart);
		let depth = 0;
		let close = -1;
		for (let i = open; i < updated.length; i++) {
			if (updated[i] === '[') depth++;
			else if (updated[i] === ']') {
				depth--;
				if (depth === 0) {
					close = i;
					break;
				}
			}
		}
		if (close !== -1) {
			const items = splitTopLevel(updated.slice(open + 1, close))
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
				updated = updated.slice(0, pluginsStart) + rendered + updated.slice(close + 1);
			}
		}
	}
		return updated;
	});

	// Write all base template files — destinations come from the ONE canonical
	// resolver shared with the upgrade engine (#327): no install/upgrade drift.
	for (const [path, content] of Object.entries(files)) {
		sv.file(resolveDestination(path, BASE_ROOT_PATHS), () => content);
	}

	// Write root-level project files (messages/, project.inlang/) at the
	// project root (#239) — same delivery model as the dashboard root files.
	for (const [path, content] of Object.entries(rootFiles)) {
		sv.file(path.slice(1), () => content);
	}

	// Upgrade baseline (#327): initialize .svforge-versions.json at INSTALL
	// time — SHA-256 of every recipe-delivered file (src + root) — so the
	// FIRST upgrade already has a real baseline instead of treating every
	// divergence as a user modification (#283). Skipped when no recipe files
	// are delivered (the dashboard flow reuses the base mode with an empty
	// file set; the dashboard mode initializes its own merged baseline).
	if (Object.keys(files).length > 0) {
		sv.file('.svforge-versions.json', () =>
			initTrackingJson('base', SDFORGE_RECIPE_VERSION, { ...files, ...rootFiles }, BASE_ROOT_PATHS)
		);
	}

	// AI-ready: scaffold AGENTS.md at the project root (#203, #347) — the
	// sole agent convention of a SvelteForge project (#325: PM-aware commands).
	sv.file('AGENTS.md', () => scaffoldedAgents('base', packageManager));

	// #317: ship the cached Skeleton/Svelte LLM references so agents search
	// local, version-matched docs before changing Skeleton UI/theme.
	for (const [doc, content] of Object.entries(scaffoldedLocalDocs())) {
		sv.file(doc, () => content);
	}

	// AI context (#234): machine-readable manifest + llms.txt, derived from
	// the real scaffold state. The dashboard mode overrides with its template.
	const manifest = buildManifest('base', []);
	sv.file('.svforge.json', () => `${JSON.stringify(manifest, null, 2)}\n`);
	sv.file('llms.txt', () => renderLlmstxt(manifest));
}
