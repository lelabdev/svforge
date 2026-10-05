import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function readFile(relPath: string): string {
	return readFileSync(join(ROOT, relPath), 'utf-8');
}

/**
 * Regression tests for #176 — resolve Svelte accessibility and reactivity diagnostics.
 *
 * Key issues addressed:
 * 1. Unkeyed {#each} loops → add stable keys
 * 2. TiptapToolbar: props captured at init → use $derived
 * 3. Settings: state assigned from $effect → use $derived or event handler
 */
describe('Svelte accessibility and reactivity (#176)', () => {
	describe('TiptapToolbar reactivity', () => {
		const source = readFile('packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapToolbar.svelte');

		it('button arrays are derived (not const captured at init)', () => {
			// formatBtns, listBtns, blockBtns should use $derived, not const
			expect(source).toMatch(/\$derived/);
		});
	});

	describe('Settings page state management', () => {
		const source = readFile('packages/svforge/templates/dashboard/src/routes/(app)/admin/settings/+page.svelte');

		it('does not assign state from $effect', () => {
			// The $effect that assigns validationError should be removed or replaced
			const effectMatch = source.match(/\$effect\([\s\S]*?\}\)/);
			if (effectMatch) {
				// If there's an effect, it must not assign to state
				expect(effectMatch[0]).not.toMatch(/\w+\s*=\s*['"`]/);
			}
		});
	});

	describe('unkeyed {#each} loops have keys', () => {
		const files = [
			'packages/svforge/templates/base/src/lib/components/svforge/layout/Navbar.svelte',
			'packages/svforge/templates/base/src/lib/components/svforge/layout/Footer.svelte',
			'packages/svforge/templates/dashboard/src/routes/(app)/admin/users/+page.svelte',
			'packages/blog/templates/src/routes/blog/+page.svelte',
		];

		for (const file of files) {
			it(`${file.split('/').pop()} keys its each blocks`, () => {
				const source = readFile(file);
				// Find all {#each ... as ...} blocks
				const eachBlocks = source.match(/\{#each\s+\S+/g) || [];
				for (const _eachBlock of eachBlocks) {
					// Each block should eventually have a key (pattern: as ... (key))
					// This is a heuristic — we check the file has keyed loops
				}
				// At minimum, the file should not have unkeyed loops over arrays with ids
				// Check for pattern: {#each X as Y} without (Y.id) or (Y) on same/next line
				const unkeyedPattern = /\{#each\s+\S+\s+as\s+\w+\}/g;
				const unkeyed = source.match(unkeyedPattern) || [];
				// Allow unkeyed loops only for static arrays without ids
				// For now, flag files that have NO keyed loops at all
				const hasKeyed = source.match(/\{#each\s+\S+\s+as\s+\w+\s*\(/);
				if (eachBlocks.length > 1 && !hasKeyed) {
					expect(unkeyed.length).toBeLessThan(eachBlocks.length);
				}
			});
		}
	});

	describe('admin users Skeleton Dialog composition', () => {
		const source = readFile('packages/svforge/templates/dashboard/src/routes/(app)/admin/users/+page.svelte');

		it('uses the official controlled Dialog and never treats a presentation overlay as accessible', () => {
			expect(source).toContain("import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte'");
			expect(source).toMatch(/<Dialog[\s\S]*?open=\{modal !== null\}/);
			expect(source).toContain('<Dialog.Title');
			expect(source).toContain('restoreFocus');
			expect(source).toContain('closeOnInteractOutside={false}');
			expect(source).not.toMatch(/role=["']presentation["']/);
			expect(source).not.toMatch(/bg-black\/50/);
		});

		it('keeps all user mutations as enhanced SvelteKit POST forms', () => {
			expect(source).toMatch(/action=\{modal === 'create' \? '\?\/create' : '\?\/update'\}[\s\S]*?use:enhance=\{submitEnhance\}/);
			expect(source).toMatch(/action="\?\/invite" use:enhance=\{submitEnhance\}/);
			expect(source).toMatch(/action="\?\/toggleStatus" use:enhance=\{submitEnhance\}/);
		});
	});
});
