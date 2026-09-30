import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const { buildCompatManifest, assertCompatManifestMatchesPlan, assertCompatibilityFreshness } = await import(
	'../scripts/compat-manifest.mjs'
);
const { buildReleasePlan } = await import('../scripts/release-plan.mjs');
const { COMPAT_MANIFEST, assertCompatManifest, loadCompatManifest } = await import('../packages/svforge/src/compat');

describe('release compatibility manifest (#470)', () => {
	it('derives the exact version of every package from the workspace manifests', () => {
		const manifest = buildCompatManifest(ROOT);
		expect(manifest.schema).toBe(1);
		expect(manifest.template.name).toBe('svforge');
		expect(manifest.template.version).toBe(manifest.packages.svforge);
		// The distribution package + every module are present.
		expect(Object.keys(manifest.packages)).toContain('@svforge/dnd');
		expect(Object.keys(manifest.packages)).toContain('@svforge/ui_toast');
		// Deterministic: keys are sorted.
		const keys = Object.keys(manifest.packages);
		expect([...keys].sort()).toEqual(keys);
	});

	it('is embedded in the published CLI and matches the actual manifests (freshness)', () => {
		expect(COMPAT_MANIFEST).toEqual(buildCompatManifest(ROOT));
	});

	it('matches the release plan and rejects any divergence', () => {
		const plan = buildReleasePlan(ROOT, 'test-commit');
		expect(plan.compatibility).toEqual(buildCompatManifest(ROOT));
		expect(() => assertCompatManifestMatchesPlan(plan.compatibility, plan.packages)).not.toThrow();

		// A changed module version the plan does not know about is rejected.
		const mutated = {
			...plan.compatibility,
			packages: { ...plan.compatibility.packages, '@svforge/dnd': '9.9.9' }
		};
		expect(() => assertCompatManifestMatchesPlan(mutated, plan.packages)).toThrow(/@svforge\/dnd/);
	});

	it('fails the release when the distribution version was not bumped alongside a module', () => {
		const compatibility = buildCompatManifest(ROOT);
		const plan = {
			compatibility,
			packages: [
				{ name: 'svforge', version: '2.0.1', registry: { published: true } },
				{ name: '@svforge/dnd', version: '2.0.3', registry: { published: false } }
			]
		};
		expect(() => assertCompatibilityFreshness(plan)).toThrow(/stale/);
		expect(() => assertCompatibilityFreshness(plan)).toThrow(/svforge/);

		// A bumped distribution (not yet published) is fine.
		const bumped = { ...plan, packages: [{ ...plan.packages[0], registry: { published: false } }, plan.packages[1]] };
		expect(() => assertCompatibilityFreshness(bumped)).not.toThrow();

		// No compatibility manifest on the plan → nothing to check.
		expect(() => assertCompatibilityFreshness({ packages: plan.packages })).not.toThrow();
	});

	it('loads a manifest from disk, accepting a release plan that carries it', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-compat-'));
		try {
			const manifest = buildCompatManifest(ROOT);
			const manifestPath = join(dir, 'compat.json');
			writeFileSync(manifestPath, JSON.stringify(manifest));
			expect(loadCompatManifest(manifestPath)).toEqual(manifest);

			const planPath = join(dir, 'plan.json');
			writeFileSync(planPath, JSON.stringify({ ...buildReleasePlan(ROOT), compatibility: manifest }));
			expect(loadCompatManifest(planPath)).toEqual(manifest);

			const invalidPath = join(dir, 'invalid.json');
			writeFileSync(invalidPath, JSON.stringify({ schema: 1, template: { name: 'svforge', version: '1.0.0' }, packages: {} }));
			expect(() => loadCompatManifest(invalidPath)).toThrow(/packages\.svforge/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('validates the manifest shape defensively', () => {
		expect(() => assertCompatManifest(null)).toThrow(/object/);
		expect(() => assertCompatManifest({ schema: 2 })).toThrow(/schema/);
		expect(() => assertCompatManifest({ schema: 1, template: { name: 'other', version: '1.0.0' }, packages: {} })).toThrow(
			/template/
		);
	});
});

describe('generated compat-manifest.ts is committed (freshness gate)', () => {
	it('declares the same versions as the workspace manifests', () => {
		const source = readFileSync(join(ROOT, 'packages/svforge/src/compat-manifest.ts'), 'utf8');
		const manifest = buildCompatManifest(ROOT);
		for (const [name, version] of Object.entries(manifest.packages)) {
			expect(source, `${name}@${version}`).toContain(`"${name}": "${version}"`);
		}
	});
});
