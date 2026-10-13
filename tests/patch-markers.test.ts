import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasPatchApplied, svforgePatchMarker } from '../packages/addon-kit/src/patch';
import { ROOT } from './helpers';

/**
 * #331 — named patch markers. Addon patches used to guard idempotence with
 * loose `content.includes('keyword')` checks: a consumer comment merely
 * containing the keyword silently skipped the patch (false negative). Every
 * patch now carries a `svforge:patch:<id>` marker, with legacy patterns kept
 * for installs made before the convention.
 */
describe('named patch markers (#331)', () => {
	const schemaBarrelModules = [
		['notifications', 'notifications-schema'],
		['audit', 'audit-schema'],
		['jobs', 'jobs-schema'],
		['chat', 'chat-schema'],
		['blog', 'vite-mdsvex'],
		['blog', 'svelte-config-mdsvex'],
		['blog', 'posts-hooks']
	] as const;

	it('marker round-trips: applied content is detected', () => {
		const marker = svforgePatchMarker('jobs-schema');
		expect(marker).toBe('svforge:patch:jobs-schema');
		expect(hasPatchApplied(`import x; // ${marker}\nexport {}`, 'jobs-schema')).toBe(true);
	});

	it('no content → no-op (true), missing marker and legacy → false', () => {
		expect(hasPatchApplied(undefined, 'jobs-schema')).toBe(true);
		expect(hasPatchApplied('', 'jobs-schema')).toBe(true);
		expect(hasPatchApplied('export {};', 'jobs-schema')).toBe(false);
		// Pre-marker Kit 2 installs keep their legacy import; new Kit 3 installs
		// use the explicit-extension package subpath. Both remain idempotent.
		expect(
			hasPatchApplied("import { jobs } from '$lib/server/jobs/schema';", 'jobs-schema', [
				"from '$lib/server/jobs/schema'"
			])
		).toBe(true);
		expect(
			hasPatchApplied("import { jobs } from '#lib/server/jobs/schema.js';", 'jobs-schema', [
				"from '#lib/server/jobs/schema.js'",
				"from '$lib/server/jobs/schema'"
			])
		).toBe(true);
	});

	it('a consumer comment mentioning the keyword no longer skips the patch', () => {
		// OLD behavior: content.includes('jobs') → true → patch skipped forever.
		const consumerSchema = `// TODO: audit how the jobs queue could hook here.\nexport {};\n`;
		expect(hasPatchApplied(consumerSchema, 'jobs-schema', ["from '$lib/server/jobs/schema'"])).toBe(false);
	});

	it('blog legacy patterns are structural fragments, not bare keywords (#331 review)', () => {
		// a TODO mentioning mdsvex / mdx-post must NOT count as "already patched"…
		expect(hasPatchApplied('// TODO: evaluate mdsvex for markdown', 'vite-mdsvex', ['mdsvex({ extensions'])).toBe(false);
		expect(hasPatchApplied('// TODO: evaluate mdsvex for markdown', 'svelte-config-mdsvex', ['mdsvex({ extensions'])).toBe(false);
		expect(hasPatchApplied('// TODO: migrate the mdx-post transport', 'posts-hooks', ["'mdx-post': {"])).toBe(false);
		// …while a pre-marker install still matches the exact injected fragment.
		const injectedVite = "sveltekit({ extensions: ['.svelte', '.md'], preprocess: mdsvex({ extensions: ['.md'] }) })";
		expect(hasPatchApplied(injectedVite, 'vite-mdsvex', ['mdsvex({ extensions'])).toBe(true);
		const injectedConfig = "preprocess: [mdsvex({ extensions: ['.md'] })]";
		expect(hasPatchApplied(injectedConfig, 'svelte-config-mdsvex', ['mdsvex({ extensions'])).toBe(true);
		const injectedHook = "const transport: Transport = { 'mdx-post': { encode: (v) => [v.slug] } };";
		expect(hasPatchApplied(injectedHook, 'posts-hooks', ["'mdx-post': {"])).toBe(true);
	});

	it('every migrated addon patch uses the shared guard (#331)', () => {
		for (const [module, patchId] of schemaBarrelModules) {
			const index = readFileSync(join(ROOT, `packages/${module}/src/index.ts`), 'utf-8');
			expect(index, `${module} imports hasPatchApplied`).toContain('hasPatchApplied');
			expect(index, `${module} guards ${patchId}`).toContain(`'${patchId}'`);
		}
		// uploads migrated to a real JSON transformation (scripts.test), not a
		// string includes on `"test"`.
		const uploads = readFileSync(join(ROOT, 'packages/uploads/src/index.ts'), 'utf-8');
		expect(uploads).not.toMatch(/content\.includes\('"test"'\)/);
		expect(uploads).toMatch(/pkg\.scripts\?\.test/);
	});
});
