import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildScope } from './helpers/build-scope';

const root = process.cwd();

/**
 * Regression test for #171 — each addon package build must produce dist/index.js.
 * These four packages had invalid tsdown configs (missing comma) that broke the
 * build with a TypeScript parse error.
 *
 * #656: the pipeline itself is the build (and fails on a broken tsdown config),
 * so this guard verifies the artifacts of the workspaces THIS run compiled
 * instead of spawning four extra builds. Full CI runs keep covering every
 * workspace.
 */
describe('addon package builds produce dist/index.js (#171)', () => {
	const addons = ['dnd', 'ui_toast', 'tiptap', 'graph'];

	it('every workspace in the run scope emitted its add-on entry', () => {
		const { mode, dirs } = buildScope();
		expect(dirs.length, `build scope (${mode}) must not be empty`).toBeGreaterThan(0);
		for (const dir of dirs) {
			expect(existsSync(join(root, 'packages', dir, 'dist', 'index.js')), `${dir} (build scope: ${mode})`).toBe(true);
		}
		// The four #171 add-ons are verified by name when they are in scope.
		for (const addon of addons.filter((entry) => dirs.includes(entry))) {
			expect(existsSync(join(root, 'packages', addon, 'dist', 'index.js')), addon).toBe(true);
		}
	});
});
