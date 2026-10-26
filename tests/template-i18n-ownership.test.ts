import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SCAFFOLD_LOCALES } from '../packages/svforge/src/i18n';

const root = process.cwd();
const template = join(root, 'packages/svforge/templates/base');
const routesRoot = join(template, 'src/routes');
const messagesRoot = join(template, 'root/messages');

function routeFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? routeFiles(path) : entry.name.endsWith('.svelte') ? [path] : [];
	});
}

function messageReferences(source: string): string[] {
	return [...source.matchAll(/\bm\.([a-zA-Z][\w]*)\s*\(/g)].map((match) => match[1]);
}

// #547 phase B: the official Paraglide add-on owns the inlang project; the
// scaffolded locales live in src/i18n.ts.
const locales = [...SCAFFOLD_LOCALES];
const catalogs = Object.fromEntries(
	locales.map((locale) => [
		locale,
		JSON.parse(readFileSync(join(messagesRoot, `${locale}.json`), 'utf8')) as Record<string, string>
	])
) as Record<string, Record<string, string>>;

const files = routeFiles(routesRoot).map((path) => ({
	route: relative(routesRoot, path),
	references: messageReferences(readFileSync(path, 'utf8'))
}));

function assertReferencesResolve(removedPrefix: string, route: string) {
	const routeEntry = files.find((file) => file.route === route);
	expect(routeEntry, `expected template route ${route}`).toBeDefined();
	for (const [locale, catalog] of Object.entries(catalogs)) {
		const afterRemoval = Object.fromEntries(
			Object.entries(catalog).filter(([key]) => !key.startsWith(removedPrefix))
		);
		for (const key of routeEntry!.references) {
			expect(afterRemoval, `${locale}: ${route} references removed/missing message ${key}`).toHaveProperty(key);
		}
	}
}

describe('base template Paraglide message ownership', () => {
	it('resolves every template route message reference in every locale', () => {
		// Key parity itself is asserted by tests/paraglide.test.ts against the
		// scaffold contract; this test keeps the unique route-reference check.
		for (const file of files) {
			for (const [locale, catalog] of Object.entries(catalogs)) {
				for (const key of file.references) {
					expect(catalog, `${locale}: ${file.route} references missing message ${key}`).toHaveProperty(key);
				}
			}
		}
	});

	it('lets the showcase work without homepage messages and the homepage work without demo messages', () => {
		assertReferencesResolve('home_', 'showcase/+page.svelte');
		assertReferencesResolve('demo_', '+page.svelte');
	});
});
