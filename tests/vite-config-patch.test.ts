import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskSv } from './helpers/fixtures';

/**
 * Tests for #415 — the base mode re-renders the `plugins:` array of
 * vite.config.ts to keep it prettier-stable. Its old matcher
 * (`/plugins:\s*\[([^\]]*)\]/`) stopped at the FIRST `]` — which sv >= 0.17
 * now places INSIDE a regex literal of the scaffolded config:
 *
 *   runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ...
 *
 * The re-render then truncated the config mid-regex and inserted a newline
 * inside the character class — an unterminated regex, Vite cannot parse the
 * file, `bun run dev` dies on every fresh scaffold made with ecosystem sv.
 *
 * These tests feed the REAL sv@0.17.0 output through `applyBaseMode` and
 * PARSE the result with esbuild (via vite) — a source-text grep cannot catch
 * a newline inside a regex literal.
 */

const SV_0_17_VITE_CONFIG = `import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	]
});
`;

/** Legacy pinned-sv shape (0.15.x): single-line sveltekit() plugin entry. */
const SV_0_15_VITE_CONFIG = `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [sveltekit()] });
`;

async function patchConfig(content: string): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), 'sf-vite-config-415-'));
	try {
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: {} }));
		writeFileSync(join(dir, 'vite.config.ts'), content);
		const { applyBaseMode } = await import('../packages/svforge/src/modes/base');
		applyBaseMode(diskSv(dir) as never, {}, {});
		return readFileSync(join(dir, 'vite.config.ts'), 'utf8');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('vite.config.ts patch — nested brackets in the plugins array (#415)', () => {
	it('keeps the sv@0.17 runes config parseable after the plugins re-render', async () => {
		const patched = await patchConfig(SV_0_17_VITE_CONFIG);

		// A real parse — TypeScript reports the unterminated regex literal
		// (TS1005) that the old truncation produced.
		const ts = await import('typescript');
		const { diagnostics } = ts.transpileModule(patched, {
			fileName: 'vite.config.ts',
			reportDiagnostics: true,
			compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
		});
		const errors = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
		expect(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
	});

	it('the split regex stays equivalent to /[/\\\\]/ with no literal newline', async () => {
		const patched = await patchConfig(SV_0_17_VITE_CONFIG);

		const match = patched.match(/filename\.split\((\/.+?\/)\)\.includes/s);
		expect(match).not.toBeNull();
		const literal = match![1];
		// No newline may ever be inserted inside the character class.
		expect(literal).not.toMatch(/\r?\n/);
		// Behavioural equivalence with /[/\\]/: splits on both separators.
		const regex = eval(literal) as RegExp;
		expect(regex.test('/')).toBe(true);
		expect(regex.test('\\')).toBe(true);
		expect(regex.test('a')).toBe(false);
	});

	it('still injects the paraglide and design-system plugins into the sv@0.17 config', async () => {
		const patched = await patchConfig(SV_0_17_VITE_CONFIG);

		expect(patched).toContain("paraglideVitePlugin({ project: './project.inlang'");
		expect(patched).toContain('svforgeDesignSystemPlugin()');
		expect(patched).toMatch(/adapter: adapter\(\)/);
	});

	it('keeps the legacy pinned-sv single-line plugins array prettier-stable', async () => {
		const patched = await patchConfig(SV_0_15_VITE_CONFIG);

		// > 100 chars once injected: prettier's canonical multiline form.
		expect(patched).toMatch(
			/plugins: \[\n\t\tsvforgeDesignSystemPlugin\(\),\n\t\tparaglideVitePlugin\(\{ project: '\.\/project\.inlang', outdir: '\.\/src\/lib\/paraglide' \}\),\n\t\tsveltekit\(\)\n\t\]/
		);
	});
});
