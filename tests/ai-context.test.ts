import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CONTRACTS } from '../packages/addon-kit/src/index';
import {
	buildManifest,
	enrichManifest,
	renderLlmstxt,
	mergeManifest,
	regenerateLlmstxt,
	synchronizeManifestI18n,
	MODULE_CAPABILITIES
} from '../packages/svforge/src/ai-context';
import { ROOT, tempProject } from './helpers';
import { createBaseProject, createDashboardProject, diskSv } from './helpers/fixtures';
import { validateManifestShape } from '../packages/addon-kit/src/json';

/**
 * Tests for #234 — generated AI context (llms.txt + .svforge.json manifest).
 * Content must derive from the real scaffold state, never generic docs.
 */
describe('AI context generation (#234)', () => {
	it('base manifest exposes canonical capability tokens, no auth/orm', () => {
		const m = buildManifest('base', []);
		expect(m.template).toBe('base');
		expect(m.stack?.auth).toBeUndefined();
		// #323 canonical tokens replace the legacy labels (skeleton-ui,
		// paraglide-fr-en, vitest, seo…): the template grants come from
		// TEMPLATE_PROVIDES, the same source as the install gates.
		expect(m.capabilities).toContain('ui.skeleton');
		expect(m.capabilities).toContain('ui.svforge');
		expect(m.capabilities).toContain('i18n.messages');
		expect(m.capabilities).toEqual([...new Set(m.capabilities)]);
		expect(m.capabilities).not.toContain('auth');
		expect(m.capabilities).not.toContain('skeleton-ui');
		expect(m.capabilities).not.toContain('paraglide-fr-en');
		expect(m.capabilities).not.toContain('auth.currentUser');
		expect(m.patterns['Skeleton theme']).toBe('src/lib/styles/svelteforge-theme.css');
		expect(m.patterns['Global CSS entrypoint']).toBe('src/routes/layout.css');
	});

	it('dashboard manifest adds the auth/db canonical tokens', () => {
		const m = buildManifest('dashboard', []);
		expect(m.stack?.auth).toBe('better-auth');
		expect(m.stack?.orm).toBe('drizzle');
		expect(m.stack?.database).toBe('postgresql');
		expect(m.capabilities).toContain('auth.currentUser');
		expect(m.capabilities).toContain('database.drizzle.postgres');
		expect(m.capabilities).toContain('auth.admin');
		expect(m.capabilities).not.toContain('auth');
		expect(m.capabilities).not.toContain('db');
		expect(m.capabilities).not.toContain('admin');
		expect(m.patterns['Auth guard']).toMatch(/admin/);
	});

	it('the manifest exposes the FULL canonical capability list of the project (#323)', () => {
		const m = buildManifest('dashboard', ['uploads']);
		for (const token of [
			'ui.skeleton',
			'ui.svforge',
			'i18n.messages',
			'auth.currentUser',
			'auth.admin',
			'database.drizzle.postgres',
			// provided by the uploads module itself
			'storage.object'
		]) {
			expect(m.capabilities, token).toContain(token);
		}
		// runtime.* are deployment constraints, not project state: they surface
		// through the module contracts, never as granted capabilities.
		expect(m.capabilities).not.toContain('runtime.websocket');
		expect(m.capabilities).not.toContain('runtime.longLivedWorker');
	});

	it('generated context declares deployment profiles and module compatibility', () => {
		const manifest = buildManifest('dashboard', ['realtime', 'jobs', 'uploads']);
		expect(manifest.deployment?.profile).toBe('serverless');
		expect(manifest.moduleProfiles?.dashboard.unsupported).toContain('edge');
		expect(manifest.moduleProfiles?.realtime.supported).toEqual(['long-lived-node', 'separate-worker']);
		expect(renderLlmstxt(manifest)).toContain('## Deployment profile');
		expect(renderLlmstxt(manifest)).toContain('realtime: supported long-lived-node, separate-worker');
	});

	it('module installation adds its capability (no ghost when absent)', () => {
		const base = buildManifest('base', []);
		expect(base.capabilities).not.toContain('email (Resend)');
		const withEmail = mergeManifest(base, 'base', ['email']);
		expect(withEmail.modules).toEqual(['email']);
		expect(withEmail.capabilities).toContain('email (Resend)');
		expect(withEmail.patterns['email (Resend)']).toMatch(/src\/lib\/server\/email/);
	});

	it('module-provided capability tokens land in the canonical list (#323)', () => {
		const withUploads = mergeManifest(buildManifest('base', []), 'base', ['uploads']);
		expect(withUploads.capabilities).toContain('storage.object');
		expect(withUploads.capabilities).toContain('uploads (S3-compatible: POST hard limit, PUT best-effort fallback)');
	});

	it('mergeManifest preserves the configured locale contract', () => {
		const existing = buildManifest('base', []);
		existing.i18n = { ...existing.i18n!, baseLocale: 'en', locales: ['en', 'de'] };
		expect(mergeManifest(existing, 'base', ['blog']).i18n).toEqual(existing.i18n);
	});

	it('mergeManifest is idempotent', () => {
		const m1 = mergeManifest(buildManifest('base', []), 'base', ['uploads']);
		const m2 = mergeManifest(m1, 'base', ['uploads']);
		expect(m2.modules).toEqual(['uploads']);
		expect(m2.capabilities.filter((c) => c === 'uploads (S3-compatible: POST hard limit, PUT best-effort fallback)').length).toBe(1);
	});

	it('every module has a capability contribution', () => {
		const expected = ['email', 'uploads', 'oauth', 'ui_toast', 'dnd', 'tiptap', 'graph', 'blog'];
		for (const mod of expected) {
			expect(MODULE_CAPABILITIES[mod], `${mod} missing capability`).toBeDefined();
		}
	});

	it('the manifest exposes the i18n contract: catalog paths + base locale (#322)', () => {
		const m = buildManifest('base', []);
		expect(m.i18n).toEqual({
			adapter: 'paraglide',
			baseLocale: 'fr',
			locales: ['fr', 'en'],
			catalogs: 'messages/',
			settings: 'project.inlang/settings.json'
		});
		// One source of truth per concern, exposed as canonical patterns too.
		expect(m.patterns['i18n messages']).toBe('messages/');
		expect(m.patterns['Fonts']).toBe('src/routes/layout.css');
	});

	it('syncs manifest locales from Paraglide settings without hard-coded scaffold defaults (#438)', () => {
		const original = buildManifest('base', ['email']);
		original.ui.preferred = '@example/ui';
		original.deployment!.profile = 'long-lived-node';
		const settings = JSON.stringify({ baseLocale: 'en', locales: ['en', 'fr', 'de'] });

		const result = synchronizeManifestI18n(JSON.stringify(original), settings);
		expect(result.drift).toBe(true);
		expect(result.manifest.i18n).toEqual({
			adapter: 'paraglide',
			baseLocale: 'en',
			locales: ['en', 'fr', 'de'],
			catalogs: 'messages/',
			settings: 'project.inlang/settings.json'
		});
		expect(result.manifest.ui.preferred).toBe('@example/ui');
		expect(result.manifest.deployment?.profile).toBe('long-lived-node');
		expect(JSON.parse(result.content).modules).toEqual(['email']);
	});

	it('rejects incomplete Paraglide locale settings without producing metadata (#438)', () => {
		const original = JSON.stringify(buildManifest('base', []));
		expect(() => synchronizeManifestI18n(original, JSON.stringify({ baseLocale: 'en', locales: ['fr'] }))).toThrow(/baseLocale.*locales/);
	});

	it('manifest shape validation accepts the i18n block and rejects malformed values (#322)', () => {
		const good = buildManifest('dashboard', ['email']);
		expect(validateManifestShape(good, '.svforge.json')).toEqual([]);
		const bad = { ...good, i18n: { adapter: 'paraglide', baseLocale: 42 } };
		const problems = validateManifestShape(bad, '.svforge.json');
		expect(problems.length).toBeGreaterThan(0);
		expect(problems.join(' ')).toMatch(/i18n\.baseLocale/);
	});

	it('llms.txt documents the defaults-vs-constraints i18n contract (#322)', () => {
		const txt = renderLlmstxt(buildManifest('base', []));
		expect(txt).toContain('## i18n (Paraglide)');
		expect(txt).toContain('- baseLocale: fr');
		expect(txt).toContain('- configured locales: fr, en');
		expect(txt).toContain('never generated src/lib/paraglide');
		expect(txt).toContain('key parity across every configured locale');
		expect(txt).toContain('add a locale: create messages/<locale>.json with the full key set');
		expect(txt).toContain('long-form editorial, business and CMS content does not belong in the catalogs');
		// fonts: layout.css is the single source of truth for font imports
		expect(txt).toContain('- Fonts: src/routes/layout.css');
	});

	it('llms.txt renders the manifest deterministically', () => {
		const m = buildManifest('dashboard', ['email']);
		const txt = renderLlmstxt(m);
		expect(txt).toContain('Template: dashboard');
		expect(txt).toContain('email (Resend)');
		// #323: the canonical capability list is exposed in llms.txt too.
		expect(txt).toContain('- ui.skeleton');
		expect(txt).toContain('- auth.currentUser');
		expect(txt).toContain('- database.drizzle.postgres');
		expect(txt).toContain('MUST NOT');
		expect(txt).toContain('- install/register a new ORM, auth provider or UI library without explicit user request');
		expect(txt).toContain('src/routes/layout.css is the single global CSS entrypoint');
		expect(txt).toContain('no generic tokens.css/index.css layer is scaffolded');
		expect(txt).toContain('change the Skeleton theme/presets first');
		// deterministic: same input → same output
		expect(renderLlmstxt(m)).toBe(txt);
	});

	it('regenerateLlmstxt rebuilds from template+modules', () => {
		const manifest = JSON.stringify(buildManifest('dashboard', ['email']));
		const txt = regenerateLlmstxt(manifest);
		expect(txt).toContain('email (Resend)');
		expect(txt).toContain('Template: dashboard');
	});

	it('base/dashboard modes write the context', () => {
		const baseMode = readFileSync(join(ROOT, 'packages/svforge/src/modes/base.ts'), 'utf-8');
		expect(baseMode).toMatch(/\.svforge\.json/);
		expect(baseMode).toMatch(/llms\.txt/);
		const dashMode = readFileSync(join(ROOT, 'packages/svforge/src/modes/dashboard.ts'), 'utf-8');
		expect(dashMode).toMatch(/buildManifest\('dashboard'/);
	});

	it('modules enrich .svforge.json through the shared kit (#324)', () => {
		for (const mod of ['email', 'uploads', 'oauth', 'ui_toast', 'dnd', 'tiptap', 'graph', 'blog']) {
			const src = readFileSync(join(ROOT, 'packages', mod, 'src/index.ts'), 'utf-8');
			// #324: the manifest + llms.txt merges are planned by
			// @svforge/addon-kit before any write (the old inline try/catch
			// helpers were removed).
			expect(src, `${mod} missing planAddonContext`).toMatch(/planAddonContext/);
			expect(src, `${mod} must not keep an inline enrichManifest`).not.toMatch(/function enrichManifest/);
		}
	});

	it('svforge context command exists in the bin', () => {
		const bin = readFileSync(join(ROOT, 'packages/svforge/bin/svforge.mjs'), 'utf-8');
		expect(bin).toMatch(/command === 'context'/);
		expect(bin).toMatch(/regenerateLlmstxt/);
	});

	describe('enrichManifest deprecated alias (#324 remediation round)', () => {
		it('is kept as a deprecated alias wrapping planManifestEnrich and warns ONCE', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			try {
				const content = `${JSON.stringify(buildManifest('dashboard', []), null, 2)}\n`;
				const out = enrichManifest(content, 'audit');
				const merged = JSON.parse(out);
				expect(merged.modules).toContain('audit');
				expect(merged.capabilities).toContain('audit trail');
				expect(merged.moduleCapabilities.audit.requires).toEqual(MODULE_CONTRACTS.audit.requires);
				// One-time deprecation warning pointing to the new API.
				expect(warnSpy).toHaveBeenCalledTimes(1);
				expect(String(warnSpy.mock.calls[0][0])).toMatch(/planManifestEnrich/);
				// Second call: the warning is NOT repeated.
				enrichManifest(out, 'blog');
				expect(warnSpy).toHaveBeenCalledTimes(1);
			} finally {
				warnSpy.mockRestore();
			}
		});

		it('never resets an invalid manifest to an empty base — it throws the diagnosable error', () => {
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			try {
				let thrown: unknown;
				try {
					enrichManifest('{ "broken": ', 'audit');
				} catch (e) {
					thrown = e;
				}
				// Name-based check: the error crosses the package boundary (built
				// dist), so cross-instance instanceof is not reliable in tests.
				expect((thrown as Error)?.name).toBe('JsonGuardError');
				expect((thrown as Error)?.message).toMatch(/invalid JSON syntax/);
				expect((thrown as Error)?.message).toMatch(/planManifestEnrich/);
			} finally {
				vi.mocked(console.warn).mockRestore();
			}
		});

		it('stays idempotent like the planning API', () => {
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			try {
				const content = `${JSON.stringify(buildManifest('base', []), null, 2)}\n`;
				const once = enrichManifest(content, 'ui_toast');
				const twice = enrichManifest(once, 'ui_toast');
				expect(twice).toBe(once);
			} finally {
				vi.mocked(console.warn).mockRestore();
			}
		});
	});

	describe('AI manifest completeness & non-destructive merges (#296, #324)', () => {
		const MODULE_IDS = Object.keys(MODULE_CAPABILITIES);
		// Modules requiring capabilities the base template never grants (auth,
		// database) run against a dashboard-equivalent project.
		const DASH_CAPS = new Set(['auth.currentUser', 'auth.admin', 'database.drizzle.postgres']);
		const needsDashboard = (id: string) => MODULE_CONTRACTS[id].requires.some((c) => DASH_CAPS.has(c));
		let cleanup: (() => void) | undefined;
		afterEach(() => cleanup?.());

		/**
		 * BEHAVIORAL: run every REAL addon against a project providing its
		 * capabilities, then verify the manifest (.svforge.json) and llms.txt
		 * carry the SAME capability/pattern data declared in MODULE_CAPABILITIES.
		 */
		it.for(MODULE_IDS)('%s enriches .svforge.json and llms.txt with its capability and pattern', async (mod) => {
			const { dir, cleanup: done } = tempProject('sf-ai-context-');
			cleanup = done;
			if (needsDashboard(mod)) createDashboardProject(dir);
			else createBaseProject(dir);

			const { default: addon } = await import(`../packages/${mod}/src/index`);
			const sv = diskSv(dir);
			let canceled: string | undefined;
			await addon.run({ sv, cancel: (r: string) => (canceled = r), cwd: dir, options: {} });
			expect(canceled, `${mod} should install on a capable project`).toBeUndefined();

			const meta = MODULE_CAPABILITIES[mod];
			const manifest = JSON.parse(readFileSync(join(dir, '.svforge.json'), 'utf8'));
			expect(manifest.modules).toContain(mod);
			expect(manifest.capabilities).toContain(meta.capability);
			expect(manifest.patterns[meta.capability]).toBe(meta.pattern);

			const llms = readFileSync(join(dir, 'llms.txt'), 'utf8');
			expect(llms).toContain(`- ${meta.capability}`);
			expect(llms).toContain(`- ${meta.capability}: ${meta.pattern}`);
			// #323: llms.txt exposes the module's capability-token contract
			const contract = MODULE_CONTRACTS[mod];
			const contractLine = `- ${mod}: requires ${
				contract.requires.length > 0 ? contract.requires.join(', ') : '—'
			}; provides ${contract.provides.length > 0 ? contract.provides.join(', ') : '—'}`;
			expect(llms).toContain(contractLine);
			// #323: capability tokens are exposed for AI agents
			expect(manifest.moduleCapabilities[mod]).toBeDefined();
		});

		it('mergeMessages is shared and non-destructive by construction (#324)', async () => {
			for (const mod of ['audit', 'chat', 'notifications', 'tiptap', 'uploads']) {
				const src = readFileSync(join(ROOT, 'packages', mod, 'src/index.ts'), 'utf-8');
				// The destructive inline helper is gone; merges are planned through
				// the shared kit whose non-destructive merge is proven behaviorally
				// in tests/addon-json-guard.test.ts.
				expect(src, `${mod} must use the shared catalog planner`).toMatch(/planCatalogMerges/);
				expect(src, `${mod} must not keep an inline mergeMessages`).not.toMatch(/function mergeMessages/);
			}
		});

		it('the manifest merges stay idempotent for every module (no duplicate capabilities)', async () => {
			const { dir, cleanup: done } = tempProject('sf-ai-context-idem-');
			cleanup = done;
			createDashboardProject(dir);

			const { default: auditAddon } = await import('../packages/audit/src/index');
			const sv = diskSv(dir);
			const run = () =>
				(auditAddon as unknown as { run: (ctx: Record<string, unknown>) => unknown }).run({
					sv,
					cancel: () => {},
					cwd: dir,
					options: {}
				});
			await run();
			const first = readFileSync(join(dir, '.svforge.json'), 'utf8');
			await run();
			expect(readFileSync(join(dir, '.svforge.json'), 'utf8')).toBe(first);
		});
	});
});
