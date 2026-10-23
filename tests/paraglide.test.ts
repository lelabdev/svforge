import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OFFICIAL_FOUNDATION_FILES } from './helpers/official-foundation';
import { PARAGLIDE_ADD_SPEC, SCAFFOLD_BASE_LOCALE, SCAFFOLD_LOCALES } from '../packages/svforge/src/i18n';
import { patchHooksServer } from '../packages/svforge/src/modes/dashboard';

const ROOT = process.cwd();
const BASE_ROOT = join(ROOT, 'packages/svforge/templates/base/root');

/**
 * Tests for #239 — Paraglide is a structural foundation of the base template.
 * Catalogs must exist and stay in sync, and the files must be embedded by the
 * prebuild (delivered to the project root).
 *
 * #322 — defaults vs constraints: the locale list is read from the ACTUAL
 * configuration (project.inlang/settings.json), never hard-coded. Key parity
 * must hold across EVERY configured locale, whatever the languages are; the
 * scaffolded fr/en defaults are documented by a dedicated test.
 */
describe('Paraglide baseline (#239, #322)', () => {
	// #547 phase B: the OFFICIAL add-on owns project.inlang/settings.json; the
	// scaffold requests these locales (single source: src/i18n.ts).
	const settings = { baseLocale: SCAFFOLD_BASE_LOCALE, locales: [...SCAFFOLD_LOCALES] };

	const readCatalog = (locale: string): Record<string, unknown> =>
		JSON.parse(readFileSync(join(BASE_ROOT, `messages/${locale}.json`), 'utf-8'));

	const messageKeys = (catalog: Record<string, unknown>): string[] =>
		Object.keys(catalog).filter((k) => !k.startsWith('$')).sort();

	describe('catalogs exist and are in sync', () => {
		it('every configured locale has a catalog at messages/<locale>.json', () => {
			expect(settings.locales.length).toBeGreaterThan(0);
			for (const locale of settings.locales) {
				expect(readCatalog(locale), `messages/${locale}.json`).toBeDefined();
			}
		});

		it('key parity holds across EVERY configured locale (derived from settings.json)', () => {
			const reference = JSON.stringify(messageKeys(readCatalog(settings.locales[0])));
			for (const locale of settings.locales) {
				expect(JSON.stringify(messageKeys(readCatalog(locale))), `locale "${locale}" key parity`).toBe(reference);
			}
		});

		it('uses semantic key names, not render-bound ones', () => {
			for (const key of messageKeys(readCatalog(settings.baseLocale))) {
				expect(key).toMatch(/^[a-z]+_[a-z_]+$/); // common_save, nav_home…
				expect(key).not.toMatch(/button_text|_button$|big_title/);
			}
		});

		it('scaffold ships fr (baseLocale) + en as INITIAL locales — a default, not a constraint', () => {
			expect(settings.baseLocale).toBe('fr');
			expect(settings.locales).toEqual(['fr', 'en']);
		});
	});

	describe('delivery', () => {
		it('SVForge ships the catalogs, the official add-on owns the inlang project', async () => {
			const { baseRootFiles } = await import('../packages/svforge/src/templates');
			expect(Object.keys(baseRootFiles)).toContain('/messages/fr.json');
			expect(Object.keys(baseRootFiles)).toContain('/messages/en.json');
			expect(Object.keys(baseRootFiles)).not.toContain('/project.inlang/settings.json');
			expect(Object.keys(baseRootFiles)).not.toContain('/hooks.server.ts');
		});

		it('requests the same locales from the official Paraglide add-on', () => {
			const create = readFileSync(join(ROOT, 'packages/svforge/src/cli/create.ts'), 'utf-8');
			expect(create).toContain('PARAGLIDE_ADD_SPEC');
			expect(PARAGLIDE_ADD_SPEC).toBe('paraglide=languageTags:fr,en+demo:no');
			// Scaffold matrix drift guard: the shell harness uses the same spec.
			const scaffold = readFileSync(join(ROOT, 'scripts/test-scaffold.sh'), 'utf-8');
			expect(scaffold).toContain(PARAGLIDE_ADD_SPEC);
		});

		it('base mode writes root files to the project root', () => {
			const mode = readFileSync(join(ROOT, 'packages/svforge/src/modes/base.ts'), 'utf-8');
			expect(mode).toMatch(/paraglideVitePlugin/);
			expect(mode).toMatch(/@inlang\/paraglide-js/);
			expect(mode).toMatch(/rootFiles/);
		});

		it('layout is wired for Paraglide (official add-on owns the hooks)', () => {
			const hooks = patchHooksServer(OFFICIAL_FOUNDATION_FILES['src/hooks.server.ts']);
			expect(hooks).toMatch(/paraglideMiddleware/);
			const layout = readFileSync(
				join(ROOT, 'packages/svforge/templates/base/src/routes/+layout.svelte'),
				'utf-8'
			);
			expect(layout).toMatch(/localizeHref/);
		});

		it('app.html uses paraglide lang placeholders', () => {
			const appHtml = readFileSync(
				join(ROOT, 'packages/svforge/templates/base/src/app.html'),
				'utf-8'
			);
			expect(appHtml).toMatch(/%paraglide\.lang%/);
			expect(appHtml).toMatch(/%paraglide\.dir%/);
		});

		it('dashboard composes paraglide + better-auth hooks', () => {
			// #547: the official Better Auth add-on owns hooks.server.ts.
			const hooks = patchHooksServer(OFFICIAL_FOUNDATION_FILES['src/hooks.server.ts']);
			expect(hooks).toMatch(/paraglideMiddleware/);
			expect(hooks).toMatch(/handleBetterAuth/);
		});

		it('dashboard handle keeps the Paraglide html transform (#280)', () => {
			const hooks = patchHooksServer(OFFICIAL_FOUNDATION_FILES['src/hooks.server.ts']);
			// The exported handle must rewrite the i18n placeholders in the final
			// HTML — the #268 composition dropped transformPageChunk and left
			// %paraglide.lang% / %paraglide.dir% in the rendered output.
			expect(hooks).toMatch(/transformPageChunk/);
			expect(hooks).toMatch(/%paraglide\.lang%/);
			expect(hooks).toMatch(/%paraglide\.dir%/);
			expect(hooks).toMatch(/getTextDirection/);
			// Paraglide runs FIRST so Better Auth sees the localized request.
			expect(hooks).toContain('sequence(handleParaglide, handleBetterAuth, handleSvforgePolicy)');
		});

		it('scaffold guard asserts paraglide files on base scaffold', () => {
			const script = readFileSync(join(ROOT, 'scripts/test-scaffold.sh'), 'utf-8');
			expect(script).toMatch(/messages\/fr\.json/);
		});
	});
});
