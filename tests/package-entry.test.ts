import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODULE_CONTRACTS } from '../packages/addon-kit/src/index';
import { buildManifest, enrichManifest } from '../packages/svforge/src';
import { ROOT } from './helpers';
import { importGenerated } from './helpers/generated-module';

/** Minimal shape of the package entry used here (source AND built dist). */
interface EntryExports {
	buildManifest: (template: 'base' | 'dashboard', modules: string[]) => Record<string, unknown>;
	enrichManifest: (content: string, moduleId: string) => string;
}

/**
 * Public-surface test (#324 remediation round — review Finding A).
 *
 * The deprecated `enrichManifest` alias is exercised through the PACKAGE
 * ENTRY — the module `svforge` consumers actually import — not only through
 * the internal ai-context module (covered by tests/ai-context.test.ts). The
 * built dist entry is asserted too: it is what an npm consumer loads, and the
 * alias only fulfills its compatibility contract if it survives bundling.
 */
describe('package entry surface: deprecated enrichManifest alias (#324)', () => {
	it('is exported by the package entry and delegates to the non-destructive core (warns once)', () => {
		expect(typeof enrichManifest).toBe('function');
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const content = `${JSON.stringify(buildManifest('dashboard', []), null, 2)}\n`;
			const out = enrichManifest(content, 'audit');
			const merged = JSON.parse(out) as {
				modules: string[];
				capabilities: string[];
				moduleCapabilities: Record<string, { requires: string[]; provides: string[] }>;
			};
			expect(merged.modules).toContain('audit');
			expect(merged.capabilities).toContain('audit trail');
			expect(merged.moduleCapabilities.audit.requires).toEqual(MODULE_CONTRACTS.audit.requires);
			// One-time deprecation warning pointing to the replacement API.
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(String(warnSpy.mock.calls[0][0])).toMatch(/planManifestEnrich/);
			// Second call: the warning is NOT repeated.
			enrichManifest(out, 'blog');
			expect(warnSpy).toHaveBeenCalledTimes(1);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it('an invalid manifest THROWS through the entry too (no empty-base reset)', () => {
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

	it('the BUILT dist entry exports the same working alias (what npm consumers actually load)', async () => {
		const distPath = join(ROOT, 'packages/svforge/dist/index.js');
		if (!existsSync(distPath)) return; // CI builds before tests; local skip mirrors tests/addon-packaging.test.ts
		const dist = (await importGenerated(distPath)) as EntryExports;
		expect(typeof dist.enrichManifest).toBe('function');
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const content = `${JSON.stringify(dist.buildManifest('dashboard', []), null, 2)}\n`;
			const out = dist.enrichManifest(content, 'uploads');
			const merged = JSON.parse(out) as {
				modules: string[];
				capabilities: string[];
				moduleCapabilities: Record<string, { provides: string[] }>;
			};
			expect(merged.modules).toContain('uploads');
			expect(merged.capabilities).toContain('storage.object');
			expect(merged.moduleCapabilities.uploads.provides).toContain('storage.object');
			// The dist bundle owns its own once-flag: its first call warns.
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(String(warnSpy.mock.calls[0][0])).toMatch(/planManifestEnrich/);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it('the addon-kit dist entry exports the planning API the alias delegates to', async () => {
		const distPath = join(ROOT, 'packages/addon-kit/dist/index.js');
		if (!existsSync(distPath)) return; // CI builds all packages before tests
		const dist = (await importGenerated(distPath)) as Record<string, unknown>;
		for (const name of [
			'planManifestEnrich',
			'planManifestEnrichContent',
			'planCatalogMerges',
			'planAddonContext',
			'checkModuleCapabilities',
			'JsonGuardError'
		]) {
			expect(dist[name], `${name} must be exported by @svforge/addon-kit`).toBeDefined();
		}
	});
});
