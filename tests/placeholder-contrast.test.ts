import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers';

const theme = readFileSync(join(ROOT, 'packages/svforge/templates/base/src/lib/styles/svelteforge-theme.css'), 'utf8');
const skeletonRoot = join(ROOT, 'node_modules/@skeletonlabs/skeleton/src');

describe('Skeleton native placeholder behavior (#602)', () => {
	it('does not override Skeleton’s built-in placeholder theme token', () => {
		expect(theme).not.toMatch(/--field-placeholder\s*:/);
	});

	it('keeps the official placeholder token and native field styling', () => {
		const globals = readFileSync(join(skeletonRoot, 'base/globals.css'), 'utf8');
		expect(globals).toMatch(/--field-placeholder:\s*var\(--color-surface-700-300\)/);
		for (const filename of ['form-inputs.css', 'form-textareas.css']) {
			const css = readFileSync(join(skeletonRoot, 'utilities', filename), 'utf8');
			expect(css).toMatch(/&::placeholder\s*\{[^}]*color:\s*var\(--field-placeholder\)/);
		}
	});
});
