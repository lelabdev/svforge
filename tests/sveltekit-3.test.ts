import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #608 — SvelteKit 3 is the scaffold target.
 *
 * `sv create` (pinned `sv@1.1.1`) emits Kit 3 with the framework configuration
 * in `vite.config.ts`; the SVForge reference manifests/fixtures must not drift
 * back to a Kit 2 shape or a `svelte.config.js`-based layout.
 */
const ROOT = process.cwd();
const TEMPLATES = ['base', 'dashboard'] as const;
const manifest = (template: (typeof TEMPLATES)[number]) =>
	JSON.parse(readFileSync(join(ROOT, 'packages/svforge/templates', template, 'package.json'), 'utf8')) as {
		engines?: { node?: string };
		devDependencies: Record<string, string>;
	};

/** Parse the lower bound of a caret/tilde/plain semver range. */
function minimum(range: string): [number, number, number] {
	const match = range.match(/(\d+)\.(\d+)\.(\d+)/);
	if (!match) throw new Error(`Unparsable range: ${range}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}
const atLeast = (range: string, major: number, minor: number, patch: number) => {
	const [a, b, c] = minimum(range);
	return a > major || (a === major && (b > minor || (b === minor && c >= patch)));
};

describe('SvelteKit 3 scaffold target (#608)', () => {
	it.each(TEMPLATES)('%s declares the Kit 3 minimum stack', (template) => {
		const dev = manifest(template).devDependencies;
		expect(dev['@sveltejs/kit'], '@sveltejs/kit').toMatch(/^\^3\./);
		expect(atLeast(dev['@sveltejs/adapter-auto'], 8, 0, 0), 'adapter-auto').toBe(true);
		expect(atLeast(dev['@sveltejs/vite-plugin-svelte'], 7, 2, 0), 'vite-plugin-svelte').toBe(true);
		expect(atLeast(dev.svelte, 5, 57, 1), 'svelte').toBe(true);
		expect(atLeast(dev.vite, 8, 0, 12), 'vite').toBe(true);
		expect(atLeast(dev.typescript, 6, 0, 3), 'typescript').toBe(true);
		expect(atLeast(dev['@skeletonlabs/skeleton'], 5, 0, 1), 'skeleton').toBe(true);
		expect(atLeast(dev['@skeletonlabs/skeleton-svelte'], 5, 0, 1), 'skeleton-svelte').toBe(true);
	});

	it.each(TEMPLATES)('%s requires Node >=22.17 (SvelteKit 3 requirement)', (template) => {
		expect(manifest(template).engines?.node).toBe('>=22.17');
	});

	it.each(TEMPLATES)('%s keeps the Kit 3 vite.config.ts layout and no svelte.config.js', (template) => {
		const root = join(ROOT, 'packages/svforge/templates', template);
		expect(existsSync(join(root, 'svelte.config.js')), 'svelte.config.js').toBe(false);
		expect(existsSync(join(root, 'svelte.config.ts')), 'svelte.config.ts').toBe(false);
	});

	it('reference vite.config.ts uses the Kit 3 sveltekit({ compilerOptions, adapter }) shape', () => {
		const config = readFileSync(join(ROOT, 'packages/svforge/templates/base/vite.config.ts'), 'utf8');
		expect(config).toContain("from '@sveltejs/adapter-auto'");
		expect(config).toMatch(/sveltekit\(\{/);
		expect(config).toContain('compilerOptions');
		expect(config).toContain('adapter: adapter()');
		expect(config).not.toContain('svelte.config');
	});

	it('reference tsconfig extends the Kit 3 generated config', () => {
		const tsconfig = readFileSync(join(ROOT, 'packages/svforge/templates/base/tsconfig.json'), 'utf8');
		expect(tsconfig).toContain('"extends": "$app/tsconfig"');
	});

	it('compatibility documentation records the tested Kit 3 stack', () => {
		const report = readFileSync(join(ROOT, 'packages/svforge/docs/sveltekit-compatibility.md'), 'utf8');
		expect(report).toMatch(/Kit 3/);
		expect(report).toContain('`@sveltejs/kit`');
		expect(report).toContain('3.1.0');
		expect(report).toContain('>=22.17');
		const deployment = readFileSync(join(ROOT, 'packages/svforge/docs/deployment-profiles.md'), 'utf8');
		expect(deployment).toMatch(/adapter-node.{0,20}6\.x/i);
	});
});
