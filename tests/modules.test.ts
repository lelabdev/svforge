import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { buildScope } from './helpers/build-scope';

const ROOT = join(import.meta.dirname, '..');

describe('ui_toast module', () => {
	const dir = join(ROOT, 'packages/ui_toast');

	it('has Toaster component', () => {
		expect(existsSync(join(dir, 'templates/src/lib/components/svforge/ui/Toaster.svelte'))).toBe(true);
	});

	it('has toaster utility', () => {
		expect(existsSync(join(dir, 'templates/src/lib/components/svforge/ui/toaster.ts'))).toBe(true);
	});

});

describe('dnd module', () => {
	const dir = join(ROOT, 'packages/dnd');

	it('has SortableList component', () => {
		expect(existsSync(join(dir, 'templates/src/lib/components/svforge/dnd/SortableList.svelte'))).toBe(true);
	});

});

describe('tiptap module', () => {
	const dir = join(ROOT, 'packages/tiptap');

	it('has TiptapEditor component', () => {
		expect(existsSync(join(dir, 'templates/src/lib/components/svforge/tiptap/TiptapEditor.svelte'))).toBe(true);
	});

	it('has TiptapPreview component', () => {
		expect(existsSync(join(dir, 'templates/src/lib/components/svforge/tiptap/TiptapPreview.svelte'))).toBe(true);
	});

	it('has TiptapToolbar component', () => {
		expect(existsSync(join(dir, 'templates/src/lib/components/svforge/tiptap/TiptapToolbar.svelte'))).toBe(true);
	});

	it('has extensions', () => {
		expect(existsSync(join(dir, 'templates/src/lib/components/svforge/tiptap/tiptap-extensions.ts'))).toBe(true);
	});

});

describe('graph module', () => {
	const dir = join(ROOT, 'packages/graph');

	it('has KnowledgeGraph component', () => {
		expect(existsSync(join(dir, 'templates/src/lib/components/svforge/graph/KnowledgeGraph.svelte'))).toBe(true);
	});

});

describe('blog module', () => {
const dir = join(ROOT, 'packages/blog');

it('has posts utility', () => {
expect(existsSync(join(dir, 'templates/src/lib/utils/posts.ts'))).toBe(true);
});

it('has welcome post', () => {
expect(existsSync(join(dir, 'templates/src/posts/welcome.md'))).toBe(true);
});

it('has blog list page', () => {
expect(existsSync(join(dir, 'templates/src/routes/blog/+page.svelte'))).toBe(true);
});

it('has blog article page', () => {
expect(existsSync(join(dir, 'templates/src/routes/blog/[slug]/+page.svelte'))).toBe(true);
});

});

describe('module dist artifacts (#656)', () => {
	it('every module built in this run emitted its add-on entry', () => {
		// #656: verify the run's declared build set (all workspaces when CI does
		// not scope the build), so targeted PR runs stay meaningful without
		// demanding artifacts they intentionally did not compile.
		const { mode, dirs } = buildScope();
		expect(dirs.length, `build scope (${mode}) must not be empty`).toBeGreaterThan(0);
		for (const dir of dirs) {
			expect(existsSync(join(ROOT, 'packages', dir, 'dist/index.js')), `${dir} (build scope: ${mode})`).toBe(true);
		}
	});
});
