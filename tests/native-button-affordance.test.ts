import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers';

/**
 * #594 — project-wide pointer affordance for native controls.
 *
 * Skeleton v5 `btn`/`btn-icon` never set `cursor: pointer`, and only the
 * disabled state gets `cursor: not-allowed` from its global styles. Controls
 * that do not go through the shared `Button` primitive (which owns the
 * enabled/disabled cursor policy) must therefore declare the affordance
 * themselves.
 */
function templateSources(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...templateSources(full));
		else if (entry.endsWith('.svelte')) out.push(full);
	}
	return out;
}

const CURSOR_AFFORDANCE = /cursor-(pointer|not-allowed)/;

describe('native button affordance (#594)', () => {
	it('never leaves a Skeleton btn/btn-icon native button without a cursor affordance', () => {
		const offenders: string[] = [];
		for (const file of templateSources(join(ROOT, 'packages'))) {
			const source = readFileSync(file, 'utf-8');
			for (const match of source.matchAll(/<button\b[^>]*>/g)) {
				const tag = match[0];
				if (!/\bbtn(-|\b)/.test(tag)) continue;
				if (CURSOR_AFFORDANCE.test(tag)) continue;
				offenders.push(`${file}: ${tag.replace(/\s+/g, ' ')}`);
			}
		}

		expect(offenders).toEqual([]);
	});
});
