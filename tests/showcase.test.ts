import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CONTRACTS } from '../packages/addon-kit/src/index';
import { ROOT, tempProject } from './helpers';
import { createBaseProject, diskSv } from './helpers/fixtures';

/**
 * #586 — the showcase is the design-system gallery at `/showcase`, and installed
 * modules contribute their own child demo (`/showcase/<module>`) as composable
 * route files plus a `meta.ts`. The index discovers them with a build-time glob,
 * so a plain Base project imports nothing and renders no empty section.
 */

const BASE = join(ROOT, 'packages/svforge/templates/base');
const INDEX = join(BASE, 'src/routes/showcase/+page.svelte');
const DND_TEMPLATE = join(ROOT, 'packages/dnd/templates/src/routes/showcase/dnd');

/** Every tracked source file that could reference the old gallery route. */
function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (['node_modules', 'dist', '.svelte-kit', '.worktrees', 'graphify-out'].includes(entry)) continue;
		// A changeset documents the rename and may name the previous path.
		if (entry === '.changeset') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (/\.(svelte|ts|js|mjs|json|sh|md)$/.test(entry)) out.push(full);
	}
	return out;
}

describe('showcase route convention (#586)', () => {
	it('renamed the gallery to /showcase without leaving the old path behind', () => {
		const offenders = sourceFiles(ROOT)
			.filter((file) => !file.endsWith('tests/showcase.test.ts'))
			.filter((file) => readFileSync(file, 'utf-8').includes('demo-ui'))
			.map((file) => file.slice(ROOT.length + 1));

		expect(offenders, `stale /demo-ui references: ${offenders.join(', ')}`).toEqual([]);
		expect(existsSync(join(BASE, 'src/routes/showcase/+page.svelte'))).toBe(true);
		expect(existsSync(join(BASE, 'src/routes/demo-ui'))).toBe(false);
	});

	it('keeps the design-system gallery and adds a module-demo section only when demos exist', () => {
		const index = readFileSync(INDEX, 'utf-8');

		// The gallery survives the rename: every primitive is still showcased.
		expect(index).toContain('<Alert');
		expect(index).toContain('<Table');
		expect(index).toContain('<ThemeToggle');
		// Discovery is build-time: uninstalled modules are never imported.
		expect(index).toMatch(/import\.meta\.glob<ModuleDemoMeta>\('\.\/\*\/meta\.ts'/);
		expect(index).toMatch(/\{#if moduleDemos\.length > 0\}/);
		expect(index).toContain("href: `/showcase/${");
	});

	it('documents demos as optional and how to exclude them from production (#586)', () => {
		const readme = readFileSync(join(ROOT, 'packages/svforge/README.md'), 'utf-8');
		const guidance = readFileSync(join(ROOT, 'packages/svforge/src/scaffolded-agents.ts'), 'utf-8');

		expect(readme).toMatch(/Demos are optional/i);
		expect(readme).toMatch(/Removing showcase pages from production/i);
		// The procedure must remove the routes AND the links, then verify the build.
		expect(readme).toMatch(/rm -rf src\/routes\/showcase/);
		expect(readme).toMatch(/grep -rn "\/showcase" src --exclude-dir=paraglide/);
		expect(readme).toMatch(/prerendered\/pages/);
		// No runtime-only claim: a prerendered page is part of the build.
		expect(readme).toMatch(/no runtime flag can hide a page that is already in the output/i);
		// The scaffolded guidance points at that procedure instead of demanding demos.
		expect(guidance).toMatch(/Showcase is optional/);
		// The exclusion is verified on a real scaffold (base-ui-modules profile).
		const harness = readFileSync(join(ROOT, 'scripts/test-scaffold.sh'), 'utf-8');
		expect(harness).toMatch(/showcase routes can be excluded from a production build/);
		expect(harness).toMatch(/still prerendered after the documented exclusion/);
	});

	it('a plain Base project ships no module demo and imports no module code', () => {
		const baseFiles = sourceFiles(join(BASE, 'src/routes'));
		expect(baseFiles.some((file) => file.includes('/showcase/dnd'))).toBe(false);
		for (const file of baseFiles) {
			expect(readFileSync(file, 'utf-8')).not.toMatch(/@thisux\/sveltednd|@svforge\/dnd/);
		}
	});
});

/** Run a module add-on against a temp project with the fake write surface. */
async function installModule(dir: string, pkg: 'dnd' | 'ui_toast' | 'tiptap') {
	const sv = diskSv(dir);
	const cancelled: string[] = [];
	const addon = (await import(`../packages/${pkg}/src/index`)).default;
	const workspace = { sv, cancel: (reason: string) => cancelled.push(reason), cwd: dir, options: {} };
	await addon.run(workspace as unknown as Parameters<typeof addon.run>[0]);
	return { cancelled, written: sv.written };
}

describe('module demo delivered by @svforge/ui_toast (#586, phase 2)', () => {
	let cleanup: (() => void) | undefined;
	afterEach(() => cleanup?.());

	const TEMPLATE = join(ROOT, 'packages/ui_toast/templates/src/routes/showcase/ui-toast');

	it('fires the real toaster for every variant and mounts its own group', () => {
		const page = readFileSync(join(TEMPLATE, '+page.svelte'), 'utf-8');
		const meta = readFileSync(join(TEMPLATE, 'meta.ts'), 'utf-8');

		expect(page).toContain("from '#lib/components/svforge/ui/toaster.js'");
		expect(page).toContain("from '#lib/components/svforge/ui/Toaster.svelte'");
		expect(page).toContain('toaster.create({ type');
		for (const variant of ['success', 'error', 'info', 'warning']) {
			expect(page).toContain(`type: '${variant}'`);
		}
		// Self-contained: the page mounts a Toaster and talks to no backend.
		expect(page).toContain('<Toaster />');
		expect(page).not.toMatch(/fetch\(|process\.env/);
		expect(page).toMatch(/m\.showcase_toast_/);
		expect(meta).toMatch(/order: \d+/);
		expect(meta).toMatch(/title: \(\) => m\.showcase_toast_title\(\)/);
		expect(meta).toMatch(/export default meta/);
	});

	it('delivers the route, the metadata and both catalogs on install', async () => {
		const { dir, cleanup: done } = tempProject('sf-showcase-toast-');
		cleanup = done;
		createBaseProject(dir);

		const { cancelled, written } = await installModule(dir, 'ui_toast');
		expect(cancelled).toEqual([]);
		expect(written).toEqual(
			expect.arrayContaining([
				'src/routes/showcase/ui-toast/+page.svelte',
				'src/routes/showcase/ui-toast/meta.ts',
				'messages/en.json',
				'messages/fr.json'
			])
		);

		const keys = (locale: string) =>
			Object.keys(JSON.parse(readFileSync(join(dir, `messages/${locale}.json`), 'utf-8')))
				.filter((key) => !key.startsWith('$'))
				.sort();
		expect(keys('en')).toEqual(keys('fr'));
		for (const locale of ['en', 'fr']) {
			const catalog = JSON.parse(readFileSync(join(dir, `messages/${locale}.json`), 'utf-8'));
			expect(catalog.showcase_toast_title, `${locale} title`).toBeTruthy();
			expect(catalog.showcase_toast_body, `${locale} body`).toBeTruthy();
		}
	});

	it('declares the capabilities its localized demo route needs', () => {
		expect(MODULE_CONTRACTS.ui_toast.requires).toEqual(
			expect.arrayContaining(['ui.skeleton', 'ui.svforge', 'i18n.messages'])
		);
	});
});

describe('module demo delivered by @svforge/tiptap (#586, phase 3)', () => {
	let cleanup: (() => void) | undefined;
	afterEach(() => cleanup?.());

	const TEMPLATE = join(ROOT, 'packages/tiptap/templates/src/routes/showcase/tiptap');

	it('drives the real editor, toolbar and preview over a local document', () => {
		const page = readFileSync(join(TEMPLATE, '+page.svelte'), 'utf-8');
		const meta = readFileSync(join(TEMPLATE, 'meta.ts'), 'utf-8');

		expect(page).toContain("from '#lib/components/svforge/tiptap/index.js'");
		expect(page).toContain('<TiptapEditor');
		expect(page).toContain('<TiptapPreview');
		// The consumer contract: the editor emits JSON, the page keeps it locally.
		expect(page).toMatch(/onUpdate=\{\(next\) => \(content = next\)\}/);
		expect(page).toMatch(/let content = \$state<JSONContent>/);
		// Reset re-initialises the editor from the sample through a keyed block.
		expect(page).toMatch(/\{#key revision\}/);
		// Local fixture only: no request, no persistence, all copy localized.
		expect(page).not.toMatch(/fetch\(|process\.env|localStorage/);
		expect(page).toMatch(/m\.showcase_tiptap_/);
		expect(meta).toMatch(/order: \d+/);
		expect(meta).toMatch(/title: \(\) => m\.showcase_tiptap_title\(\)/);
		expect(meta).toMatch(/export default meta/);
	});

	it('delivers the route, the metadata and both catalogs on install', async () => {
		const { dir, cleanup: done } = tempProject('sf-showcase-tiptap-');
		cleanup = done;
		createBaseProject(dir);

		const { cancelled, written } = await installModule(dir, 'tiptap');
		expect(cancelled).toEqual([]);
		expect(written).toEqual(
			expect.arrayContaining([
				'src/routes/showcase/tiptap/+page.svelte',
				'src/routes/showcase/tiptap/meta.ts',
				'messages/en.json',
				'messages/fr.json'
			])
		);

		const keys = (locale: string) =>
			Object.keys(JSON.parse(readFileSync(join(dir, `messages/${locale}.json`), 'utf-8')))
				.filter((key) => !key.startsWith('$'))
				.sort();
		expect(keys('en')).toEqual(keys('fr'));
		for (const locale of ['en', 'fr']) {
			const catalog = JSON.parse(readFileSync(join(dir, `messages/${locale}.json`), 'utf-8'));
			expect(catalog.showcase_tiptap_title, `${locale} title`).toBeTruthy();
			expect(catalog.showcase_tiptap_sample_heading, `${locale} fixture copy`).toBeTruthy();
			// The module's own toolbar copy is still merged by the same plan.
			expect(catalog.tiptap_bold, `${locale} toolbar copy`).toBeTruthy();
		}
	});

	it('declares the capabilities its localized demo route needs', () => {
		expect(MODULE_CONTRACTS.tiptap.requires).toEqual(
			expect.arrayContaining(['ui.skeleton', 'ui.svforge', 'i18n.messages'])
		);
	});
});

describe('pilot module demo delivered by @svforge/dnd (#586)', () => {
	let cleanup: (() => void) | undefined;
	afterEach(() => cleanup?.());

	// `diskSv` implements the write surface the add-ons use; the real `sv`
	// workspace adds fields (`isKit`, `language`…) they do not touch.
	const installDnd = (dir: string) => installModule(dir, 'dnd');

	it('ships a self-contained demo route plus its discovery metadata', () => {
		const page = readFileSync(join(DND_TEMPLATE, '+page.svelte'), 'utf-8');
		const meta = readFileSync(join(DND_TEMPLATE, 'meta.ts'), 'utf-8');

		// The demo uses the module's real component with local fixture data…
		expect(page).toContain('SortableList');
		expect(page).toMatch(/bind:items/);
		expect(page).toMatch(/aria-live="polite"/);
		expect(page).toContain('onclick={reset}');
		// …no backend, credentials or persistence, and no hard-coded copy.
		expect(page).not.toMatch(/fetch\(|onUpload|process\.env/);
		expect(page).toMatch(/m\.showcase_dnd_/);
		// Metadata is copy as functions so it follows the active locale.
		expect(meta).toMatch(/order: \d+/);
		expect(meta).toMatch(/title: \(\) => m\.showcase_dnd_title\(\)/);
		expect(meta).toMatch(/export default meta/);
	});

	it('delivers the route, the metadata and both catalogs on install', async () => {
		const { dir, cleanup: done } = tempProject('sf-showcase-dnd-');
		cleanup = done;
		createBaseProject(dir);

		const { cancelled, written } = await installDnd(dir);
		expect(cancelled).toEqual([]);

		expect(written).toEqual(
			expect.arrayContaining([
				'src/routes/showcase/dnd/+page.svelte',
				'src/routes/showcase/dnd/meta.ts',
				'messages/en.json',
				'messages/fr.json'
			])
		);
		for (const locale of ['en', 'fr']) {
			const catalog = JSON.parse(readFileSync(join(dir, `messages/${locale}.json`), 'utf-8'));
			expect(catalog.showcase_dnd_title, `${locale} title`).toBeTruthy();
			expect(catalog.showcase_dnd_description, `${locale} description`).toBeTruthy();
			expect(catalog.showcase_dnd_item_1, `${locale} fixture copy`).toBeTruthy();
		}
		// Key parity across configured locales is the platform rule.
		const keys = (locale: string) =>
			Object.keys(JSON.parse(readFileSync(join(dir, `messages/${locale}.json`), 'utf-8')))
				.filter((key) => !key.startsWith('$'))
				.sort();
		expect(keys('en')).toEqual(keys('fr'));

		const manifest = JSON.parse(readFileSync(join(dir, '.svforge.json'), 'utf-8'));
		expect(manifest.modules).toContain('dnd');
	});

	it('is idempotent: reinstalling keeps the user values and adds no duplicate keys', async () => {
		const { dir, cleanup: done } = tempProject('sf-showcase-dnd-twice-');
		cleanup = done;
		createBaseProject(dir);

		await installDnd(dir);
		const catalogPath = join(dir, 'messages/en.json');
		const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
		catalog.showcase_dnd_title = 'Custom title';
		writeJson(catalogPath, catalog);

		await installDnd(dir);
		const after = JSON.parse(readFileSync(catalogPath, 'utf-8'));
		expect(after.showcase_dnd_title).toBe('Custom title');
		expect(readFileSync(catalogPath, 'utf-8').match(/"showcase_dnd_title"/g)?.length).toBe(1);
	});

	it('declares the capabilities its localized demo route needs', () => {
		const contract = MODULE_CONTRACTS.dnd;
		expect(contract.requires).toEqual(expect.arrayContaining(['ui.svforge', 'i18n.messages']));
	});
});

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
