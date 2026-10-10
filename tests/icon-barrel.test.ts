import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseFiles, dashboardFiles } from '../packages/svforge/src/templates';
import { MODULE_RECIPE_DATA } from '../packages/svforge/src/module-recipes';
import { ROOT } from './helpers';

const packagesRoot = join(ROOT, 'packages');
const directPhosphorImport = /^\s*(?:import\s+[^;\n]*?\sfrom|export\s+\{[^;\n]*?\}\s+from)\s*['"]phosphor-svelte\/lib\/[^'"]+['"]/m;

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? sourceFiles(path)
			: /\.(?:svelte|ts|js)$/.test(entry.name)
				? [path]
				: [];
	});
}

function iconDefinition(path: string): boolean {
	return /(?:^|[/\\])(?:src[/\\])?lib[/\\]icons[/\\](?!index\.ts$)[^/\\]+\.ts$/.test(path);
}

function exportNames(content: string): string[] {
	return [...content.matchAll(/export \{ default as (\w+) \} from /g)].map((match) => match[1]);
}

describe('generated Phosphor icon barrel (#545)', () => {
	it('keeps base and dashboard icon definitions scoped and imports consumers from the public barrel', () => {
		const baseGeneratedFiles = baseFiles as Record<string, string>;
		const dashboardGeneratedFiles = dashboardFiles as Record<string, string>;
		const notificationRecipeFiles = MODULE_RECIPE_DATA.notifications.files as Record<string, string>;
		const baseCore = baseGeneratedFiles['/lib/icons/core.ts'];
		const baseIndex = baseGeneratedFiles['/lib/icons/index.ts'];
		const dashboardCore = dashboardGeneratedFiles['/lib/icons/core.ts'];
		const dashboardIndex = dashboardGeneratedFiles['/lib/icons/index.ts'] ?? baseIndex;

		expect(baseCore).toBeDefined();
		expect(baseIndex).toBe("export * from './core';\n");
		expect(baseGeneratedFiles['/lib/icons/notifications.ts']).toBeUndefined();
		expect(baseIndex).not.toContain('notifications');
		expect(exportNames(baseCore)).toEqual(expect.arrayContaining(['Menu', 'X', 'SquaresFour', 'Sun', 'Moon']));

		expect(dashboardCore).toBeDefined();
		expect(exportNames(dashboardCore)).toEqual(
			expect.arrayContaining([
				...exportNames(baseCore),
				'Users', 'Gear', 'ChartBar', 'SignOut', 'UserPlus', 'EnvelopeSimple', 'Power', 'Pencil',
				'Check', 'Warning', 'Lock', 'Clock', 'Eye', 'EyeSlash'
			])
		);
		expect(dashboardIndex).toBe("export * from './core';\n");

		const notifications = notificationRecipeFiles;
		expect(notifications['/lib/icons/notifications.ts']).toContain("export { default as Bell } from 'phosphor-svelte/lib/Bell';");
		expect(notifications['/lib/components/svforge/ui/NotificationsBell.svelte']).toContain(
			"import { Bell } from '$lib/icons'"
		);

		const generatedFiles = [
			...Object.entries(baseFiles),
			...Object.entries(dashboardFiles),
			...Object.entries(notifications)
		];
		const violations = generatedFiles
			.filter(([path, content]) => directPhosphorImport.test(content) && !iconDefinition(path))
			.map(([path]) => path);
		expect(violations).toEqual([]);
	});

	it('confines source-template deep imports to icon definition modules', () => {
		const violations: string[] = [];
		for (const packageEntry of readdirSync(packagesRoot, { withFileTypes: true })) {
			if (!packageEntry.isDirectory()) continue;
			const templates = join(packagesRoot, packageEntry.name, 'templates');
			try {
				for (const file of sourceFiles(templates)) {
					const relative = file.slice(packagesRoot.length + 1);
					if (directPhosphorImport.test(readFileSync(file, 'utf8')) && !iconDefinition(relative)) {
						violations.push(relative);
					}
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
		expect(violations).toEqual([]);
	});
});
