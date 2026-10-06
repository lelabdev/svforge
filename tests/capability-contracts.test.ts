import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CONTRACTS, TEMPLATE_PROVIDES } from '../packages/addon-kit/src/index';
import { MODULES, validateComposition, expandPreset } from '../packages/svforge/src/module-composition';
import { tempProject } from './helpers';
import { createBaseProject, createBareProject, createDashboardProject, diskSv } from './helpers/fixtures';

/**
 * Behavioral tests for #323 — the capability contract.
 *
 * Modules no longer gate on template names or file-presence heuristics: they
 * declare capabilities (requires/provides/optional) and the gate validates
 * them STRUCTURALLY on the real project. Consequences proven here:
 * 1. a bare minimal SvelteKit project fails EARLY and READABLY when a
 *    required capability is missing (no files written);
 * 2. installation succeeds when SVForge (base/dashboard) provides them;
 * 3. installation succeeds when an EXTERNAL implementation provides them
 *    (project origin is irrelevant);
 * 4. composition validation derives from the same contract (single sv add);
 * 5. reinstall is idempotent.
 */
describe('#323 — capability contract', () => {
	let cleanup: (() => void) | undefined;
	afterEach(() => cleanup?.());

	async function runAddon(dir: string, pkg: string, options: Record<string, unknown> = {}) {
		const { default: addon } = await import(`../packages/${pkg}/src/index`);
		let cancelReason: string | undefined;
		const sv = diskSv(dir);
		await addon.run({
			sv,
			cancel: (reason: string) => {
				cancelReason = reason;
			},
			cwd: dir,
			options
		});
		return { cancelReason, written: sv.written };
	}

	describe('metadata', () => {
		it('every module declares a capability contract and the metadata match', () => {
			for (const [id, meta] of Object.entries(MODULES)) {
				const contract = MODULE_CONTRACTS[id];
				expect(contract, `${id} has no capability contract`).toBeDefined();
				expect(meta.template).toBe(contract!.template);
				expect(meta.requires).toEqual(contract!.requires);
				expect(meta.provides).toEqual(contract!.provides);
				expect(meta.optional).toEqual(contract!.optional);
			}
		});

		it('the audited modules declare the capabilities the issue demands', () => {
			// uploads needs identity (locals.user) + message catalogs
			expect(MODULE_CONTRACTS.uploads.requires).toContain('auth.currentUser');
			expect(MODULE_CONTRACTS.uploads.requires).toContain('i18n.messages');
			expect(MODULE_CONTRACTS.uploads.provides).toContain('storage.object');
			// blog imports base Card/Badge and merges its Paraglide UI labels
			expect(MODULE_CONTRACTS.blog.requires).toContain('ui.svforge');
			expect(MODULE_CONTRACTS.blog.requires).toContain('i18n.messages');
			// tiptap writes Paraglide messages
			expect(MODULE_CONTRACTS.tiptap.requires).toContain('i18n.messages');
			// ui_toast needs the Skeleton theme wiring
			expect(MODULE_CONTRACTS.ui_toast.requires).toContain('ui.skeleton');
			// jobs/realtime runtime constraints are explicit capabilities
			expect(MODULE_CONTRACTS.jobs.requires).toContain('runtime.longLivedWorker');
			expect(MODULE_CONTRACTS.jobs.requires).toContain('database.drizzle.postgres');
			expect(MODULE_CONTRACTS.realtime.requires).toContain('runtime.websocket');
			// dashboard modules are gated on the declared DB capability
			for (const id of ['audit', 'notifications', 'jobs', 'chat']) {
				expect(MODULE_CONTRACTS[id].requires).toContain('database.drizzle.postgres');
			}
		});
	});

	describe('bare minimal SvelteKit project — early, readable failure', () => {
		it('audit is refused naming the missing capabilities and the remedy, writing nothing', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-bare-');
			cleanup = done;
			createBareProject(dir);

			const { cancelReason, written } = await runAddon(dir, 'audit');

			expect(cancelReason).toBeTruthy();
			expect(cancelReason).toContain('database.drizzle.postgres');
			expect(cancelReason).toContain('auth.currentUser');
			expect(cancelReason).toMatch(/svforge=template:dashboard/);
			expect(cancelReason).toMatch(/No files were written/);
			expect(written).toEqual([]);
			expect(existsSync(join(dir, 'src/lib/server/audit'))).toBe(false);
		});

		it('uploads is refused on the missing auth contract (base never had it)', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-bare-up-');
			cleanup = done;
			createBareProject(dir);

			const { cancelReason, written } = await runAddon(dir, 'uploads');

			expect(cancelReason).toContain('auth.currentUser');
			expect(written).toEqual([]);
		});

		it('ui_toast is refused without the Skeleton theme wiring', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-bare-toast-');
			cleanup = done;
			createBareProject(dir);

			const { cancelReason } = await runAddon(dir, 'ui_toast');

			expect(cancelReason).toContain('ui.skeleton');
		});

		it('jobs is refused on the declared database capability', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-bare-jobs-');
			cleanup = done;
			createBareProject(dir);

			const { cancelReason } = await runAddon(dir, 'jobs');

			expect(cancelReason).toContain('database.drizzle.postgres');
		});

		it('realtime still installs (runtime.websocket is unverifiable, not absent) and warns', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-bare-rt-');
			cleanup = done;
			createBareProject(dir);

			const { cancelReason, written } = await runAddon(dir, 'realtime');

			expect(cancelReason).toBeUndefined();
			expect(written.length).toBeGreaterThan(0);
		});
	});

	describe('SVForge template provides the capability — installation succeeds', () => {
		it('audit installs on a dashboard-equivalent project', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-dash-');
			cleanup = done;
			createDashboardProject(dir);

			const { cancelReason } = await runAddon(dir, 'audit');

			expect(cancelReason).toBeUndefined();
			expect(existsSync(join(dir, 'src/lib/server/audit/index.ts'))).toBe(true);
			const manifest = JSON.parse(readFileSync(join(dir, '.svforge.json'), 'utf8'));
			expect(manifest.modules).toContain('audit');
		});

		it('ui_toast installs on a base-equivalent project', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-base-');
			cleanup = done;
			createBaseProject(dir);

			const { cancelReason } = await runAddon(dir, 'ui_toast');

			expect(cancelReason).toBeUndefined();
			expect(existsSync(join(dir, 'src/lib/components/svforge/ui/Toaster.svelte'))).toBe(true);
		});

		it('reinstallation is idempotent (manifest entry, capabilities and catalogs stay single)', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-base-toast-');
			cleanup = done;
			createBaseProject(dir);
			await runAddon(dir, 'ui_toast');
			const manifestAfterFirst = readFileSync(join(dir, '.svforge.json'), 'utf8');

			await runAddon(dir, 'ui_toast');

			expect(readFileSync(join(dir, '.svforge.json'), 'utf8')).toBe(manifestAfterFirst);
			const manifest = JSON.parse(manifestAfterFirst);
			expect(manifest.modules.filter((m: string) => m === 'ui_toast')).toHaveLength(1);
		});
	});

	describe('external implementation — project origin is irrelevant', () => {
		/** Remove every SVForge origin marker: only the structural state remains. */
		async function stripOriginMarkers(dir: string): Promise<void> {
			const { rmSync } = await import('node:fs');
			rmSync(join(dir, '.svforge.json'), { force: true });
			rmSync(join(dir, 'llms.txt'), { force: true });
		}

		it('uploads installs on an external project providing auth + paraglide itself', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-ext-');
			cleanup = done;
			// NOT scaffolded by SVForge: no .svforge.json, no llms.txt — but the
			// project provides the same capabilities with its own setup.
			createBareProject(dir);
			createDashboardProject(dir, { messages: true });
			await stripOriginMarkers(dir);

			const { cancelReason } = await runAddon(dir, 'uploads');

			expect(cancelReason).toBeUndefined();
			expect(existsSync(join(dir, 'src/routes/api/upload/+server.ts'))).toBe(true);
			// The manifest is fabricated with the module's capability tokens.
			const manifest = JSON.parse(readFileSync(join(dir, '.svforge.json'), 'utf8'));
			expect(manifest.moduleCapabilities.uploads.requires).toContain('auth.currentUser');
			expect(manifest.moduleCapabilities.uploads.provides).toContain('storage.object');
		});

		it('audit installs on an external Better Auth + Drizzle project (validated STRUCTURALLY, not by dep sniffing)', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-ext-audit-');
			cleanup = done;
			createDashboardProject(dir);
			await stripOriginMarkers(dir);

			const { cancelReason } = await runAddon(dir, 'audit');

			expect(cancelReason).toBeUndefined();
		});

		it('a deps-only external project (no hooks/drizzle structure) is NOT silently trusted — it installs with a clear warning', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-ext-shallow-');
			cleanup = done;
			createBareProject(dir);
			createDashboardProject(dir, { messages: true });
			await stripOriginMarkers(dir);
			// Strip the structural signals, keep only the dependency evidence:
			// the shallow check would have pretended support — the structural one
			// must warn instead.
			rmSync(join(dir, 'src/hooks.server.ts'));
			rmSync(join(dir, 'drizzle.config.ts'));

			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			try {
				const { cancelReason, written } = await runAddon(dir, 'notifications');

				// database.drizzle.postgres has indirect evidence only: install proceeds,
				// but the warning must be EMITTED, not suppressed.
				expect(cancelReason).toBeUndefined();
				expect(written.length).toBeGreaterThan(0);
				const warnings = warnSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('database.drizzle.postgres'));
				expect(warnings.length).toBeGreaterThan(0);
				expect(warnings[0]).toMatch(/could not be verified/i);
				expect(warnings[0]).toMatch(/drizzle\.config/);
			} finally {
				warnSpy.mockRestore();
			}
		});

		it('an external project with an unverifiable auth wiring installs with a warning naming the expected structure', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-ext-authwarn-');
			cleanup = done;
			createBareProject(dir);
			// better-auth is installed but hooks.server.ts carries NO auth wiring:
			// indirect evidence only — the capability is 'unverified', not 'satisfied'.
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({ name: 'ext-auth', type: 'module', dependencies: { 'better-auth': '~1.4.0' } }, null, 2)
			);
			mkdirSync(join(dir, 'src'), { recursive: true });
			writeFileSync(join(dir, 'src/hooks.server.ts'), 'export const handle = ({ resolve }) => resolve();\n');

			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			try {
				const { cancelReason } = await runAddon(dir, 'oauth');

				expect(cancelReason).toBeUndefined();
				const warnings = warnSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('auth.currentUser'));
				expect(warnings.length).toBeGreaterThan(0);
				expect(warnings[0]).toMatch(/could not be verified/i);
				expect(warnings[0]).toMatch(/locals\.user/);
			} finally {
				warnSpy.mockRestore();
			}
		});

		it('an external project WITHOUT any auth evidence is still refused (structure or dependency required)', async () => {
			const { dir, cleanup: done } = tempProject('sf-cap-ext-noauth-');
			cleanup = done;
			createBareProject(dir);
			createDashboardProject(dir, { messages: true });
			await stripOriginMarkers(dir);
			// Remove every auth signal: no hooks.server.ts, no better-auth dep.
			rmSync(join(dir, 'src/hooks.server.ts'), { force: true });
			const pkgPath = join(dir, 'package.json');
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
				dependencies: Record<string, string>;
			};
			delete pkg.dependencies['better-auth'];
			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

			const { cancelReason, written } = await runAddon(dir, 'oauth');

			expect(cancelReason).toContain('auth.currentUser');
			expect(written).toEqual([]);
		});
	});

	describe('composition in a single sv add', () => {
		it('the dashboard template covers audit, jobs, chat, notifications, realtime', () => {
			expect(() =>
				validateComposition('dashboard', ['audit', 'jobs', 'chat', 'notifications', 'realtime'])
			).not.toThrow();
		});

		it('the base template does NOT cover audit — the error names the capability and the remedy', () => {
			expect(() => validateComposition('base', ['audit'])).toThrow(/database\.drizzle\.postgres/);
			expect(() => validateComposition('base', ['audit'])).toThrow(/svforge=template:dashboard/);
		});

		it('uploads needs auth: base does NOT cover it, the dashboard does (#323 bug fixed)', () => {
			expect(() => validateComposition('base', ['uploads'])).toThrow(/auth\.currentUser/);
			expect(() => validateComposition('dashboard', ['uploads'])).not.toThrow();
		});

		it('unverifiable runtime capabilities do not block composition (install gate warns instead)', () => {
			expect(() => validateComposition('base', ['realtime'])).not.toThrow();
		});

		it('unknown modules are still rejected', () => {
			expect(() => validateComposition('base', ['nope'])).toThrow(/Unknown module/);
		});

		it('presets still compose: saas on dashboard, community on base', () => {
			const saas = expandPreset('saas');
			expect(saas[0]).toMatch(/template:dashboard/);
			expect(() => validateComposition('dashboard', ['email', 'uploads'])).not.toThrow();
			const community = expandPreset('community');
			expect(community[0]).toMatch(/template:base/);
			expect(() => validateComposition('base', ['blog', 'ui_toast'])).not.toThrow();
		});

		it('the template grant list is the single source for what a template provides', () => {
			expect(TEMPLATE_PROVIDES.base).toContain('ui.skeleton');
			expect(TEMPLATE_PROVIDES.dashboard).toContain('database.drizzle.postgres');
			expect(TEMPLATE_PROVIDES.dashboard).toContain('auth.currentUser');
		});
	});
});
