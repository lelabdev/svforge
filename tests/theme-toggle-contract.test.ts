import { describe, expect, it } from 'vitest';
import { baseFiles, baseRootFiles } from '../packages/svforge/src/templates';

describe('base theme reuse contract (#354)', () => {
	it('delivers the catalogued ThemeToggle through the canonical Navbar and demo', () => {
		const catalog = JSON.parse(baseRootFiles['/svforge-catalog.json']);
		const navbar = baseFiles['/lib/components/svforge/layout/Navbar.svelte'];
		const demo = baseFiles['/routes/demo-ui/+page.svelte'];

		expect(catalog.designSystem.ui.ThemeToggle).toMatchObject({
			path: 'ui/ThemeToggle.svelte',
			useFor: [expect.stringContaining('reuse this ThemeToggle')]
		});
		expect(baseFiles['/lib/components/svforge/ui/ThemeToggle.svelte']).toContain('localStorage.setItem');
		expect(navbar).toContain("import ThemeToggle from '#lib/components/svforge/ui/ThemeToggle.svelte'");
		expect(navbar.match(/<ThemeToggle \/>/g)).toHaveLength(2);
		expect(demo).toContain("import { Alert, Card, Table, ThemeToggle }");
		expect(demo).toContain('<ThemeToggle />');
	});

	it('keeps the Navbar shared surface paired across light and dark modes', () => {
		const navbar = baseFiles['/lib/components/svforge/layout/Navbar.svelte'];
		expect(navbar).toContain('bg-surface-50-950');
		expect(navbar).toContain('text-surface-950-50');
		expect(navbar).toContain('border-surface-200-800');
	});
});
