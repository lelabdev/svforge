import { describe, it, expect, afterEach } from 'vitest';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CONTRACTS } from '../packages/addon-kit/src/index';
import { MODULE_CAPABILITIES } from '../packages/svforge/src/ai-context';
import { ROOT, tempProject } from './helpers';
import { createDashboardProject, diskSv } from './helpers/fixtures';

/**
 * Integration test (#323/#324 remediation round): a REAL multi-addon
 * composition — several @svforge/* addons installed by ONE `sv add`
 * invocation against the same temp project, exactly like the documented
 * recipes (`sv add svforge=template:dashboard email uploads`, the `saas`
 * preset) and scripts/test-scaffold.sh dashboard profiles.
 *
 * The sv engine runs the addons SEQUENTIALLY against the live project state:
 * each addon re-reads the files on disk, so the second addon must observe the
 * first one's writes and compose with them (catalog keys, manifest entries,
 * llms.txt sections) instead of overwriting them.
 */
describe('multi-addon composition in one sv add invocation', () => {
	let cleanup: (() => void) | undefined;
	afterEach(() => cleanup?.());

	/** Run several addons sequentially — one sv add invocation, one disk. */
	async function runAddons(dir: string, pkgs: string[]) {
		const sv = diskSv(dir);
		const cancelled: string[] = [];
		for (const pkg of pkgs) {
			const { default: addon } = await import(`../packages/${pkg}/src/index`);
			await addon.run({
				sv,
				cancel: (reason: string) => cancelled.push(`${pkg}: ${reason}`),
				cwd: dir,
				options: {}
			});
		}
		return { cancelled, written: sv.written };
	}

	it('saas preset composition (email + uploads) on one dashboard project', async () => {
		const { dir, cleanup: done } = tempProject('sf-multi-saas-');
		cleanup = done;
		createDashboardProject(dir);

		const { cancelled } = await runAddons(dir, ['email', 'uploads']);

		expect(cancelled).toEqual([]);

		// Both modules delivered their files.
		expect(existsSync(join(dir, 'src/lib/server/email.ts'))).toBe(true);
		expect(existsSync(join(dir, 'src/routes/api/upload/+server.ts'))).toBe(true);

		// The manifest lists BOTH modules and their capability data coexists.
		const manifest = JSON.parse(readFileSync(join(dir, '.svforge.json'), 'utf8'));
		expect(manifest.modules).toEqual(expect.arrayContaining(['email', 'uploads']));
		expect(manifest.capabilities).toContain('email (Resend)');
		expect(manifest.capabilities).toContain('uploads (S3-compatible: POST hard limit, PUT best-effort fallback)');
		// The canonical token provided by uploads is exposed in the full list (#323).
		expect(manifest.capabilities).toContain('storage.object');
		expect(manifest.moduleCapabilities.uploads.provides).toContain('storage.object');
		expect(manifest.patterns['email (Resend)']).toMatch(/src\/lib\/server\/email/);
		expect(manifest.patterns['uploads (S3-compatible: POST hard limit, PUT best-effort fallback)']).toMatch(
			/src\/routes\/api\/upload/
		);

		// llms.txt carries BOTH module sections and both contracts.
		const llms = readFileSync(join(dir, 'llms.txt'), 'utf8');
		expect(llms).toContain('- email (Resend)');
		expect(llms).toContain('- uploads (S3-compatible: POST hard limit, PUT best-effort fallback)');
		for (const mod of ['email', 'uploads']) {
			const contract = MODULE_CONTRACTS[mod];
			expect(llms).toContain(
				`- ${mod}: requires ${contract.requires.length > 0 ? contract.requires.join(', ') : '—'}; provides ${
					contract.provides.length > 0 ? contract.provides.join(', ') : '—'
				}`
			);
		}

		// The template's canonical capability list survives the composition.
		for (const token of ['ui.skeleton', 'ui.svforge', 'i18n.messages', 'auth.currentUser', 'database.drizzle.postgres']) {
			expect(manifest.capabilities, token).toContain(token);
		}
	});

	it('catalog-merging modules compose without losing each other (audit + notifications + uploads)', async () => {
		const { dir, cleanup: done } = tempProject('sf-multi-catalogs-');
		cleanup = done;
		createDashboardProject(dir);
		const frBefore = JSON.parse(readFileSync(join(dir, 'messages/fr.json'), 'utf8'));

		const { cancelled } = await runAddons(dir, ['audit', 'notifications', 'uploads']);

		expect(cancelled).toEqual([]);

		// Every module's keys landed in BOTH catalogs, and the pre-existing
		// user key (`hello`) survived all three merges.
		const fr = JSON.parse(readFileSync(join(dir, 'messages/fr.json'), 'utf8'));
		const en = JSON.parse(readFileSync(join(dir, 'messages/en.json'), 'utf8'));
		for (const key of ['audit_title', 'notif_title', 'uploads_uploading']) {
			expect(fr, `fr ${key}`).toHaveProperty(key);
			expect(en, `en ${key}`).toHaveProperty(key);
		}
		expect(fr.hello).toBe(frBefore.hello);

		// One merged manifest: three modules, one entry each.
		const manifest = JSON.parse(readFileSync(join(dir, '.svforge.json'), 'utf8'));
		for (const mod of ['audit', 'notifications', 'uploads']) {
			expect(manifest.modules.filter((m: string) => m === mod)).toHaveLength(1);
		}
		// Re-running the SAME invocation is idempotent (no duplicate keys).
		await runAddons(dir, ['audit', 'notifications', 'uploads']);
		const frAfter = JSON.parse(readFileSync(join(dir, 'messages/fr.json'), 'utf8'));
		for (const key of ['audit_title', 'notif_title', 'uploads_uploading']) {
			expect(Object.keys(frAfter).filter((k) => k === key)).toHaveLength(1);
		}
	});

	it('uploads then tiptap compose with NOTHING lost: manifest, fr/en catalogs, llms.txt and scaffold catalog files all survive', async () => {
		const { dir, cleanup: done } = tempProject('sf-multi-coexist-');
		cleanup = done;
		createDashboardProject(dir);
		// A REAL scaffold also ships the design-system catalog and the module
		// metadata contract at the project root (baseRootFiles): neither addon's
		// merge may touch them.
		copyFileSync(join(ROOT, 'packages/svforge/templates/base/root/svforge-catalog.json'), join(dir, 'svforge-catalog.json'));
		copyFileSync(join(ROOT, 'packages/svforge/templates/base/root/svforge-modules.json'), join(dir, 'svforge-modules.json'));
		const catalogBefore = readFileSync(join(dir, 'svforge-catalog.json'), 'utf8');
		const modulesContractBefore = readFileSync(join(dir, 'svforge-modules.json'), 'utf8');

		// Sequential real addon flow: tiptap runs AFTER uploads, so every one of
		// its reads (catalogs, manifest, llms.txt) sees uploads' writes — proving
		// the second addon composes with the first instead of resetting it.
		const { cancelled } = await runAddons(dir, ['uploads', 'tiptap']);

		expect(cancelled).toEqual([]);
		// Both addons delivered their own files.
		expect(existsSync(join(dir, 'src/routes/api/upload/+server.ts'))).toBe(true);
		expect(existsSync(join(dir, 'src/lib/components/svforge/tiptap/TiptapEditor.svelte'))).toBe(true);

		// ── 1. Manifest (.svforge.json): BOTH contributions coexist. ──
		const manifest = JSON.parse(readFileSync(join(dir, '.svforge.json'), 'utf8'));
		for (const mod of ['uploads', 'tiptap']) {
			expect(manifest.modules.filter((m: string) => m === mod)).toHaveLength(1);
			expect(manifest.moduleCapabilities[mod]).toBeDefined();
		}
		// uploads' provided canonical token + both human capability labels.
		expect(manifest.capabilities).toContain('storage.object');
		expect(manifest.capabilities).toContain(MODULE_CAPABILITIES.uploads.capability);
		expect(manifest.capabilities).toContain(MODULE_CAPABILITIES.tiptap.capability);
		expect(manifest.moduleCapabilities.uploads.provides).toContain('storage.object');
		expect(manifest.moduleCapabilities.tiptap.requires).toEqual(MODULE_CONTRACTS.tiptap.requires);
		// The template's canonical grants survive both merges.
		for (const token of ['ui.skeleton', 'ui.svforge', 'i18n.messages', 'auth.currentUser', 'auth.admin', 'database.drizzle.postgres']) {
			expect(manifest.capabilities, token).toContain(token);
		}

		// ── 2. Message catalogs: FR/EN parity, neither addon's keys lost. ──
		const fr = JSON.parse(readFileSync(join(dir, 'messages/fr.json'), 'utf8'));
		const en = JSON.parse(readFileSync(join(dir, 'messages/en.json'), 'utf8'));
		for (const key of [
			'uploads_uploading',
			'uploads_failed',
			'tiptap_bold',
			'tiptap_loading',
			'tiptap_link_description',
			'tiptap_link_url',
			'tiptap_link_apply',
			'tiptap_link_update',
			'tiptap_link_remove',
			'tiptap_link_cancel',
			'tiptap_edit_link',
			'tiptap_toolbar',
			'tiptap_toolbar_formatting',
			'tiptap_toolbar_headings',
			'tiptap_toolbar_lists',
			'tiptap_toolbar_blocks'
		]) {
			expect(fr, `fr ${key}`).toHaveProperty(key);
			expect(en, `en ${key}`).toHaveProperty(key);
		}
		// Parity: both catalogs expose the SAME key set ($schema included on both).
		expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
		// The user's pre-existing key survived both merges, in both locales.
		expect(fr.hello).toBe('bonjour');
		expect(en.hello).toBe('hello');

		// ── 3. llms.txt: both modules' lines coexist in their sections. ──
		const llms = readFileSync(join(dir, 'llms.txt'), 'utf8');
		for (const mod of ['uploads', 'tiptap']) {
			const meta = MODULE_CAPABILITIES[mod];
			expect(llms).toContain(`- ${meta.capability}`);
			expect(llms).toContain(`- ${meta.capability}: ${meta.pattern}`);
			const contract = MODULE_CONTRACTS[mod];
			expect(llms).toContain(
				`- ${mod}: requires ${contract.requires.join(', ')}; provides ${
					contract.provides.length > 0 ? contract.provides.join(', ') : '—'
				}`
			);
		}
		expect(llms).toContain('## Capabilities installed');
		expect(llms).toContain('## Capability contracts');
		expect(llms).toContain('## Canonical patterns');

		// ── 4. The scaffold's root catalog files stay byte-identical. ──
		expect(readFileSync(join(dir, 'svforge-catalog.json'), 'utf8')).toBe(catalogBefore);
		expect(readFileSync(join(dir, 'svforge-modules.json'), 'utf8')).toBe(modulesContractBefore);
	});

	it('a cancelled addon inside the invocation does not corrupt the others (per-addon plan-before-write)', async () => {
		const { dir, cleanup: done } = tempProject('sf-multi-cancel-');
		cleanup = done;
		createDashboardProject(dir);
		// audit + notifications install; the manifest is then corrupted — the
		// next addon (uploads) must cancel WITHOUT having written anything,
		// while the previously installed modules stay intact.
		const first = await runAddons(dir, ['audit', 'notifications']);
		expect(first.cancelled).toEqual([]);
		// Corrupt the manifest AFTER the first installs: the next addon must
		// refuse to merge into it (and must not write anything).
		writeFileSync(join(dir, '.svforge.json'), '{ "corrupted"');

		const { default: uploadsAddon } = await import('../packages/uploads/src/index');
		const sv = diskSv(dir);
		let cancelReason: string | undefined;
		await (uploadsAddon as unknown as { run: (ctx: Record<string, unknown>) => unknown }).run({
			sv,
			cancel: (reason: string) => (cancelReason = reason),
			cwd: dir,
			options: { testpack: false }
		});

		// uploads merges messages + manifest: the corrupted manifest must cancel
		// the install before ANY write (no partial composition state).
		expect(cancelReason).toContain('.svforge.json');
		expect(sv.written).toEqual([]);
		expect(readFileSync(join(dir, '.svforge.json'), 'utf8')).toBe('{ "corrupted"');
	});
});
