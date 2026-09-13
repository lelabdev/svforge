import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planAddonContext, hasPatchApplied } from '@svforge/addon-kit';
import { svforgePatchMarker } from '@svforge/addon-kit';
import { files } from './templates';


/**
 * Find the end of a `export const transport = <expr>;` declaration: returns
 * the index just past the terminating ';' (nesting-aware; strings, template
 * literals and comments are ignored). Used to compose the MDsveX codec with
 * a consumer-owned transport without rewriting arbitrary code (#306).
 */
function findTransportDeclEnd(src: string, start: number): number {
	let depth = 0;
	let interpDepth = 0;
	let inString: string | null = null;
	let inTemplate = false;
	let inInterp = false;
	let lineComment = false;
	let blockComment = false;
	let i = start;
	while (i < src.length) {
		const ch = src[i];
		const next = src[i + 1];
		if (lineComment) {
			if (ch === '\n') lineComment = false;
			i++;
			continue;
		}
		if (blockComment) {
			if (ch === '*' && next === '/') blockComment = false;
			i++;
			continue;
		}
		if (inString) {
			if (ch === '\\') {
				i += 2;
				continue;
			}
			if (ch === inString) inString = null;
			i++;
			continue;
		}
		if (inTemplate) {
			if (ch === '\\') {
				i += 2;
				continue;
			}
			if (ch === '$' && next === '{') {
				inTemplate = false;
				inInterp = true;
				interpDepth = 0;
				i += 2;
				continue;
			}
			if (ch === '`') inTemplate = false;
			i++;
			continue;
		}
		if (inInterp) {
			if (ch === '"' || ch === "'") {
				inString = ch;
				i++;
				continue;
			}
			if (ch === '{' || ch === '(' || ch === '[') {
				interpDepth++;
				i++;
				continue;
			}
			if (ch === '}' || ch === ')' || ch === ']') {
				if (ch === '}' && interpDepth === 0) {
					inInterp = false;
					inTemplate = true;
				} else {
					interpDepth--;
				}
				i++;
				continue;
			}
			i++;
			continue;
		}
		if (ch === '/' && next === '/') {
			lineComment = true;
			i += 2;
			continue;
		}
		if (ch === '/' && next === '*') {
			blockComment = true;
			i += 2;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = ch;
			i++;
			continue;
		}
		if (ch === '`') {
			inTemplate = true;
			i++;
			continue;
		}
		if (ch === '{' || ch === '(' || ch === '[') {
			depth++;
			i++;
			continue;
		}
		if (ch === '}' || ch === ')' || ch === ']') {
			depth--;
			i++;
			continue;
		}
		if (ch === ';' && depth === 0) return i + 1;
		i++;
	}
	return src.length;
}

/**
 * Legacy projects carry a svelte.config.js (pinned sv 0.15.4 still emits
 * one). The mdsvex import is inserted right after the leading patch marker —
 * position-independent: the previous export-lookahead regex missed the
 * runes layout (#426 review) and left `mdsvex(...)` called without its
 * import, crashing every tool that loads the config.
 */
export function patchSvelteConfigMdsvex(content: string): string {
	if (hasPatchApplied(content, 'svelte-config-mdsvex', ['mdsvex({ extensions'])) return content;
	let updated = `// ${svforgePatchMarker('svelte-config-mdsvex')}\n${content}`;
	if (!updated.includes("from 'mdsvex'")) {
		updated = updated.replace(/^(\/\/[^\n]*\n)/, `$1import { mdsvex } from 'mdsvex';\n`);
	}
	// Add extensions to the config object and mdsvex to preprocess
	return updated
		.replace(/compilerOptions:/, "extensions: ['.svelte', '.md'],\n\tcompilerOptions:")
		.replace(/preprocess:\s*\[/, "preprocess: [mdsvex({ extensions: ['.md'] })]")
		.replace(/preprocess:\s*undefined,?/, 'preprocess: [mdsvex({ extensions: [".md"] })]')
		.replace(/kit:\s*\{/, "preprocess: [mdsvex({ extensions: ['.md'] })],\n\tkit: {");
}

export default defineAddon({
	id: 'svforge-blog',
	alias: 'forge-blog',
	shortDescription: 'SVForge Blog — MDsveX blog with posts list and article pages',
	homepage: 'https://github.com/lelabdev/svelteforge',
	// Empty options are required: sv >= 0.15 crashes on addons without an
	// options object (Object.entries(undefined) in promptAddonQuestions).
	options: defineAddonOptions().build(),
	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Blog requires SvelteKit');
	},
	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): blog imports Card/Badge from the SVForge base
		// UI kit ($lib/components/svforge) — the project must provide it.
		const gate = checkModuleCapabilities(cwd, 'blog');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}

		sv.dependency('mdsvex', '^0.12.8');

		// ── mdsvex integration ──
		// Modern `sv create` (Kit 2.63 / vite-plugin-svelte 7) no longer
		// generates svelte.config.js — the config lives in vite.config.ts via
		// sveltekit({...}). mdsvex must be wired there (extensions + preprocess).
		// Old projects still have svelte.config.js — patch both when present.
		const context = planAddonContext(cwd, { moduleId: 'blog', capability: 'blog (MDsveX)', pattern: 'src/routes/blog/' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		sv.file('vite.config.ts', (content) => {
			// legacy fragment = the exact integration this patch injects; a bare
			// keyword ("mdsvex" in a consumer TODO) must NOT skip the patch (#331)
			if (hasPatchApplied(content, 'vite-mdsvex', ['mdsvex({ extensions'])) return content;
			let updated = `// ${svforgePatchMarker('vite-mdsvex')}\n${content}`;
			if (!updated.includes("from 'mdsvex'")) {
				updated = updated.replace(
					/import\s+\{[^}]+\}\s+from\s+'@sveltejs\/kit\/vite';/,
					"import { mdsvex } from 'mdsvex';\n$&"
				);
			}
			const integration = "extensions: ['.svelte', '.md'], preprocess: mdsvex({ extensions: ['.md'] })";
			if (/sveltekit\(\)/.test(updated)) {
				// sveltekit() without options (single-line plugin entry)
				updated = updated.replace(
					/sveltekit\(\)/,
					`sveltekit({ ${integration} })`
				);
			} else if (/sveltekit\(\{/.test(updated)) {
				// sveltekit({ ... }) already has options — inject after the opening brace
				updated = updated.replace(
					/sveltekit\(\{\s*\n?/,
					`sveltekit({\n\t\t\textensions: ['.svelte', '.md'],\n\t\t\tpreprocess: mdsvex({ extensions: ['.md'] }),\n\t\t\t`
				);
			}
			return updated;
		});

		sv.file('svelte.config.js', (content) => patchSvelteConfigMdsvex(content));

		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// AI context (#234): planned in memory first (#324) — an invalid
		// .svforge.json cancels the install instead of resetting the file.
		for (const write of context.writes) {
			sv.file(write.path, () => write.content);
		}

		// Transport hook (#293): MDsveX posts are Svelte components (functions)
		// which SvelteKit cannot serialize through the data boundary. The
		// transport encodes a post as its slug server-side and re-imports the
		// compiled component client-side. Patches the consumer's hooks.ts
		// (which already exports the Paraglide reroute) without touching it.
				sv.file('src/hooks.ts', (content) => {
			if (hasPatchApplied(content, 'posts-hooks', ["'mdx-post': {"])) return content;
			// Add our imports only when the consumer does not already provide
			// them (a project with its own transport usually imports the
			// Transport type from '@sveltejs/kit' already).
			const hasKitTransportImport = /import\s+[^;]*\bTransport\b[^;]*from\s*'@sveltejs\/kit'/.test(content);
			const imports =
				(content.includes('loadPostComponent') ? '' : "import { loadPostComponent, PostComponent } from '$lib/utils/posts';\n") +
				(hasKitTransportImport ? '' : "import type { Transport } from '@sveltejs/kit';\n");
			const mdxPostCodec =
				"'mdx-post': {" +
				'\n\tencode: (value: unknown) =>' +
				"\n\t\tvalue && typeof value === 'object' && (value as { __brand?: string }).__brand === 'mdx-post'" +
				'\n\t\t\t? [(value as { slug: string }).slug]' +
				'\n\t\t\t: null,' +
				'\n\tdecode: async ([slug]: [string]) => {' +
				'\n\t\tconst component = await loadPostComponent(slug);' +
				"\n\t\tif (!component) throw new Error('Post component not found: ' + slug);" +
				'\n\t\treturn new PostComponent(component, slug);' +
				'\n\t}' +
				'\n}';
			// Insert the imports after the first import line (the whole patch
			// bails on 'mdx-post', so imports are never duplicated).
			const withImports = content.replace(/^(import[^\n]*\n)/m, (match) => match + imports);
			const decl = /export\s+const\s+transport\b/.exec(withImports);
			if (!decl) {
				// No pre-existing transport: append a fresh export after the
				// last export statement (keeps the reroute intact).
				const transport = '\n\nexport const transport: Transport = {\n' + mdxPostCodec + '\n};\n';
				const lastExport = withImports.lastIndexOf('export ');
				if (lastExport === -1) return withImports + transport;
				return withImports.slice(0, lastExport) + transport + withImports.slice(lastExport);
			}
			// The consumer already exports its own transport: add ONLY the
			// mdx-post codec, preserving every existing codec and the exact
			// declaration shape.
			const eq = withImports.indexOf('=', decl.index);
			const end = findTransportDeclEnd(withImports, eq + 1);
			let rhsStart = eq + 1;
			while (rhsStart < end && /\s/.test(withImports[rhsStart])) rhsStart++;
			const rhs = withImports.slice(rhsStart, end - 1).trim();
			if (rhs.startsWith('{')) {
				// Object literal: inject the codec as one more property.
				const inner = rhs.slice(1, -1).trim();
				if (!inner) {
					const empty = '{\n\t' + mdxPostCodec + '\n}';
					return withImports.slice(0, rhsStart) + empty + withImports.slice(end - 1);
				}
				const joined = inner.trimEnd().endsWith(',') ? inner.trimEnd() : inner.trimEnd() + ',';
				const merged = '{ ' + joined + '\n\t' + mdxPostCodec + '\n}';
				return withImports.slice(0, rhsStart) + merged + withImports.slice(end - 1);
			}
			// Non-literal expression (identifier, call, ternary…): wrap in an
			// IIFE that spreads the existing transport and adds our codec.
			const wrapped =
				'export const transport: Transport = (() => {\n' +
				'\tconst existingTransport = ' + rhs + ';\n' +
				'\treturn { ...existingTransport, ' + mdxPostCodec + ' };\n' +
				'})();';
			return withImports.slice(0, decl.index) + wrapped + withImports.slice(end);
		});
	},
	nextSteps: () => [
		'@svforge/blog installed!',
		'Create posts as .md files in src/posts/',
		'Posts use frontmatter: title, date, excerpt, tags',
		'Routes: /blog (list) and /blog/[slug] (article)'
	]
});
