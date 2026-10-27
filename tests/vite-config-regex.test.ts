import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importGenerated } from './helpers/generated-module';

const { patchVitestConfig, patchViteConfig } = await import('../packages/svforge/src/modes/base');

/**
 * The REAL `vite.config.ts` emitted by `sv create --template minimal` on
 * sv@0.17.1 (modern layout: no svelte.config.js, the runes matcher lives in
 * `sveltekit({ compilerOptions })` INSIDE the plugins array).
 */
const SV_0_17_VITE_CONFIG = [
	"import adapter from '@sveltejs/adapter-auto';",
	"import { sveltekit } from '@sveltejs/kit/vite';",
	"import { defineConfig } from 'vite';",
	'',
	'export default defineConfig({',
	'\tplugins: [',
	'\t\tsveltekit({',
	'\t\t\tcompilerOptions: {',
	'\t\t\t\t// Force runes mode for the project, except for libraries. Can be removed in svelte 6.',
	'\t\t\t\trunes: ({ filename }) =>',
	"\t\t\t\t\tfilename.split(/[/\\\\]/).includes('node_modules') ? undefined : true",
	'\t\t\t},',
	'',
	'\t\t\t// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.',
	'\t\t\t// If your environment is not supported, or you settled on a specific environment, switch out the adapter.',
	'\t\t\t// See https://svelte.dev/docs/kit/adapters for more information about adapters.',
	'\t\t\tadapter: adapter()',
	'\t\t})',
	'\t]',
	'});',
	''
].join('\n');

describe('vite/Vitest config patches keep imports and runes valid (#415, #584)', () => {
	it('never injects a newline into a regex character class', () => {
		const patched = patchViteConfig(SV_0_17_VITE_CONFIG);

		// The path-separator regex survives byte-for-byte…
		expect(patched).toContain("filename.split(/[/\\\\]/)");
		// …and no literal newline lands inside the character class.
		expect(patched).not.toMatch(/split\(\/\[\/\\\\\n/);
	});

	it('produces a loadable module (syntax-level guarantee)', async () => {
		const patched = patchViteConfig(SV_0_17_VITE_CONFIG);
		const ts = await import('typescript');
		const { diagnostics } = ts.transpileModule(patched, {
			fileName: 'vite.config.ts',
			reportDiagnostics: true
		});
		const errors = (diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
		expect(errors.map((diagnostic) => diagnostic.messageText)).toEqual([]);
	});

	it('keeps the SVForge plugins and the original sveltekit options', () => {
		const patched = patchViteConfig(SV_0_17_VITE_CONFIG);

		expect(patched).toContain('svforgeDesignSystemPlugin()');
		expect(patched).toContain('paraglideVitePlugin({');
		expect(patched).toContain('sveltekit({');
		expect(patched).not.toContain("alias: { $lib: 'src/lib' }");
		expect(patched).toContain('adapter: adapter()');
		expect(patched).toContain('compilerOptions: {');
	});

	it('leaves the SvelteKit plugin free of the deprecated Kit 3 alias option', () => {
		const config = "import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };\n";
		const patched = patchViteConfig(config);
		expect(patched).not.toContain('alias:');
		expect(patchViteConfig(patched)).toBe(patched);
	});

	it('re-applying the patch is idempotent', () => {
		const once = patchViteConfig(SV_0_17_VITE_CONFIG);
		expect(patchViteConfig(once)).toBe(once);
	});

	it('adds #lib resolution and keeps the legacy $lib test alias idempotently', () => {
		const config = "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ plugins: [] });\n";
		const once = patchVitestConfig(config);
		expect(once).toContain("import { fileURLToPath } from 'node:url';");
		expect(once).toContain("'#lib': fileURLToPath(new URL('./src/lib', import.meta.url))");
		expect(once).toContain("'$lib': fileURLToPath(new URL('./src/lib', import.meta.url))");
		expect(patchVitestConfig(once)).toBe(once);
	});

	it('adds fileURLToPath when node:url already imports another utility and loads', async () => {
		const config = `import { defineConfig } from 'vitest/config';
import { pathToFileURL } from 'node:url';
export default defineConfig({ plugins: [] });`;
		const patched = patchVitestConfig(config);
		const directory = mkdtempSync(join(process.cwd(), 'tests', '.vitest-config-'));
		const configPath = join(directory, 'vitest.config.mjs');
		try {
			writeFileSync(configPath, patched);
			expect(patched).toContain("import { fileURLToPath } from 'node:url';");
			expect(patchVitestConfig(patched)).toBe(patched);

			const loaded = await importGenerated(configPath, { bust: true });
			expect(loaded.default.resolve.alias).toMatchObject({
				'#lib': expect.any(String),
				'$lib': expect.any(String)
			});
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('merges #lib into the official Vitest alias without duplicating resolve', () => {
		const config = `import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
	resolve: { alias: { $lib: resolve('src/lib') } },
	test: { environment: 'node' }
});`;
		const patched = patchVitestConfig(config);
		expect(patched.match(/\bresolve\s*:/g)).toHaveLength(1);
		expect(patched).toContain("'#lib': fileURLToPath(new URL('./src/lib', import.meta.url))");
		expect(patched).toContain("$lib: resolve('src/lib')");
		expect(patched).not.toContain("'$lib': fileURLToPath(new URL('./src/lib', import.meta.url))");
		expect(patchVitestConfig(patched)).toBe(patched);
	});
});
