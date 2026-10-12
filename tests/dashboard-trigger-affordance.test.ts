import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dashboardTemplateFile } from './helpers';

function triggerClasses(source: string): string[] {
	return [...source.matchAll(/<Dialog\.(?:Trigger|CloseTrigger)\b(?:(?!>).)*\bclass="([^"]*)"(?:(?!>).)*>/gs)].map(
		(match) => match[1]
	);
}

describe('dashboard dialog trigger affordances (#594)', () => {
	it('gives enabled dialog triggers a pointer cursor without replacing Skeleton triggers', () => {
		const files = [
			dashboardTemplateFile('lib', 'components', 'svforge', 'layout', 'AdminLayout.svelte'),
			dashboardTemplateFile('routes', '(app)', 'admin', 'users', '+page.svelte')
		];
		const classes = files.flatMap((file) => triggerClasses(readFileSync(file, 'utf-8')));

		expect(classes.length).toBeGreaterThan(0);
		expect(classes.every((className) => className.split(/\s+/).includes('cursor-pointer'))).toBe(true);
	});
});
