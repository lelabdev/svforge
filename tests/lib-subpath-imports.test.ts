import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyBaseMode, libImportMappingConflict } from '../packages/svforge/src/modes/base';

const PACKAGES = join(process.cwd(), 'packages');

function templateSourceFiles(): string[] {
	const files: string[] = [];
	function visit(directory: string): void {
		for (const name of readdirSync(directory)) {
			const path = join(directory, name);
			if (statSync(path).isDirectory()) visit(path);
			else if (/\.(?:svelte|ts|js|mjs)$/.test(name)) files.push(path);
		}
	}

	for (const pkg of readdirSync(PACKAGES)) {
		const templates = join(PACKAGES, pkg, 'templates');
		if (existsSync(templates)) visit(templates);
	}
	return files;
}

function captureBasePackageTransform(): (content: string) => string {
	let transform: ((content: string) => string) | undefined;
	const target = {
		dependency: () => {},
		devDependency: () => {},
		file: (path: string, apply: (content: string) => string) => {
			if (path === 'package.json') transform = apply;
		}
	};
	applyBaseMode(target as unknown as Parameters<typeof applyBaseMode>[0], {});
	if (!transform) throw new Error('base mode did not register its package.json transform');
	return transform;
}

describe('Kit 3 #lib package subpath imports (#584)', () => {
	it('uses explicit-extension #lib imports throughout scaffold and addon templates', () => {
		const unresolved: string[] = [];
		for (const file of templateSourceFiles()) {
			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(/\b(?:from\s*|import\s*\(\s*)['"](\$lib|#lib)\/([^'"]+)['"]/g)) {
				const [, alias, specifier] = match;
				if (alias === '$lib' || !/\.(?:js|svelte)$/.test(specifier)) unresolved.push(`${file}: ${match[0]}`);
			}
		}
		for (const pkg of readdirSync(PACKAGES)) {
			const entry = join(PACKAGES, pkg, 'src/index.ts');
			if (!existsSync(entry)) continue;
			const source = readFileSync(entry, 'utf8');
			for (const match of source.matchAll(/['"](\$lib|#lib)\/([^'"]+)['"]/g)) {
				const [, alias, specifier] = match;
				if (alias === '#lib' && !/\.(?:js|svelte)$/.test(specifier)) unresolved.push(`${entry}: ${match[0]}`);
			}
		}
		expect(unresolved, `legacy or extensionless imports: ${unresolved.join('; ')}`).toEqual([]);
	});

	it('adds the #lib package import map while preserving consumer imports', () => {
		const patchPackage = captureBasePackageTransform();
		const pkg = JSON.parse(
			patchPackage(JSON.stringify({ imports: { '#custom/*': './custom/*' }, scripts: { dev: 'vite dev' } }))
		);

		expect(pkg.imports).toEqual({
			'#custom/*': './custom/*',
			'#lib/*': './src/lib/*'
		});
		expect(pkg.scripts.dev).toBe('vite dev');

		const expectedMapping = JSON.stringify({ imports: { '#lib/*': './src/lib/*' } });
		expect(libImportMappingConflict(expectedMapping)).toBeUndefined();
		expect(JSON.parse(patchPackage(expectedMapping)).imports['#lib/*']).toBe('./src/lib/*');

		const conflictingMapping = JSON.stringify({ imports: { '#lib/*': './custom/lib/*' } });
		expect(libImportMappingConflict(conflictingMapping)).toMatch(/#lib\/\*.*\.\/custom\/lib\/\*/);
		expect(() => patchPackage(conflictingMapping)).toThrow(/#lib\/\*.*\.\/custom\/lib\/\*/);
	});
});
