import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT } from './helpers';

/**
 * #594 — the scaffolded Skeleton v5-first baseline.
 *
 * Every shipped `.svelte` under every package `templates/` tree must stay
 * Tailwind/Skeleton-only: no component `<style>` layer, no inline `style=`
 * standing in for a utility, and a recorded audited disposition in
 * `packages/svforge/docs/skeleton-baseline.md`. A new scaffolded component that
 * bypasses the audit fails here instead of silently drifting.
 */

const BASELINE_DOC = join(ROOT, 'packages', 'svforge', 'docs', 'skeleton-baseline.md');

/** The reviewed exception: canvas container sizing cannot be a static utility. */
const INLINE_STYLE_ALLOWLIST = [
	'packages/graph/templates/src/lib/components/svforge/graph/KnowledgeGraph.svelte'
];

function scaffoldedSvelteFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...scaffoldedSvelteFiles(full));
		else if (entry.endsWith('.svelte')) out.push(relative(ROOT, full).split(sep).join('/'));
	}
	return out;
}

const FILES = scaffoldedSvelteFiles(join(ROOT, 'packages'));

describe('scaffolded Skeleton baseline (#594)', () => {
	it('records an audited disposition for every scaffolded component', () => {
		const doc = readFileSync(BASELINE_DOC, 'utf-8');
		const undocumented = FILES.filter((file) => !doc.includes(file));
		expect(undocumented, `files missing from skeleton-baseline.md: ${undocumented.join(', ')}`).toEqual([]);
	});

	it('ships no component <style> block', () => {
		const offenders = FILES.filter((file) =>
			/<style[\s>]/.test(readFileSync(join(ROOT, file), 'utf-8'))
		);
		expect(offenders, `scaffolded components must use Tailwind/Skeleton, not <style>`).toEqual([]);
	});

	it('keeps inline style to the reviewed canvas-size exception', () => {
		const withInlineStyle = FILES.filter((file) =>
			/\bstyle=/.test(readFileSync(join(ROOT, file), 'utf-8'))
		);
		expect(withInlineStyle).toEqual(INLINE_STYLE_ALLOWLIST);

		// A stale allowlist is a silent hole: the exception must still be real.
		for (const file of INLINE_STYLE_ALLOWLIST) {
			expect(readFileSync(join(ROOT, file), 'utf-8')).toMatch(/\bstyle=/);
		}
	});
});
