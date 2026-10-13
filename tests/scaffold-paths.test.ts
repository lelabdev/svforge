import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/**
 * Regression tests for #172 — dnd and ui_toast install at the documented paths.
 *
 * The template directories had an extra src/ level, causing the addon to install
 * files at src/src/lib/components/... instead of src/lib/components/....
 * Documentation imports from #lib/components/.../index.js.
 */
describe('dnd and ui_toast scaffold paths (#172)', () => {
	describe('dnd template directory structure', () => {
		const dndTemplates = join(ROOT, 'packages/dnd/templates');

		it('does NOT have a double src/src directory', () => {
			const srcDir = join(dndTemplates, 'src');
			expect(existsSync(srcDir)).toBe(true);
			// src/ should contain lib/ directly, NOT another src/
			expect(existsSync(join(srcDir, 'src'))).toBe(false);
		});

		it('has SortableList.svelte at src/lib/components/svforge/dnd/', () => {
			const expected = join(dndTemplates, 'src/lib/components/svforge/dnd/SortableList.svelte');
			expect(existsSync(expected)).toBe(true);
		});
	});

	describe('ui_toast template directory structure', () => {
		const toastTemplates = join(ROOT, 'packages/ui_toast/templates');

		it('does NOT have a double src/src directory', () => {
			const srcDir = join(toastTemplates, 'src');
			expect(existsSync(srcDir)).toBe(true);
			expect(existsSync(join(srcDir, 'src'))).toBe(false);
		});

		it('has Toaster.svelte at src/lib/components/svforge/ui/', () => {
			const expected = join(toastTemplates, 'src/lib/components/svforge/ui/Toaster.svelte');
			expect(existsSync(expected)).toBe(true);
		});

		it('has toaster.ts at src/lib/components/svforge/ui/', () => {
			const expected = join(toastTemplates, 'src/lib/components/svforge/ui/toaster.ts');
			expect(existsSync(expected)).toBe(true);
		});
	});

	describe('generated templates.ts has correct paths (no /src/src)', () => {
		it('dnd templates.ts does not contain /src/src/', () => {
			const dndTemplates = readFileSync(join(ROOT, 'packages/dnd/src/templates.ts'), 'utf-8');
			expect(dndTemplates).not.toMatch(/\/src\/src\//);
		});

		it('ui_toast templates.ts does not contain /src/src/', () => {
			const toastTemplates = readFileSync(join(ROOT, 'packages/ui_toast/src/templates.ts'), 'utf-8');
			expect(toastTemplates).not.toMatch(/\/src\/src\//);
		});
	});
});
