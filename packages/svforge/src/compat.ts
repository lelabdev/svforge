import { readFileSync } from 'node:fs';
import { COMPAT_MANIFEST, type CompatManifest } from './compat-manifest';

/**
 * Compatibility manifest runtime (#470).
 *
 * `svforge` is the public DISTRIBUTION package; `@svforge/*` modules keep
 * INDEPENDENT versions. The generated `COMPAT_MANIFEST` (see
 * packages/svforge/scripts/prebuild.ts) records the exact compatible version
 * of every package in this distribution, so `svforge create --modules all`
 * installs the versions that shipped with the user's `svforge` — never an
 * implicit `latest`.
 */

export { COMPAT_MANIFEST };
export type { CompatManifest };

/** Assert a value is a valid compatibility manifest, returning it. */
export function assertCompatManifest(value: unknown, source = 'compatibility manifest'): CompatManifest {
	if (!value || typeof value !== 'object') {
		throw new Error(`${source}: expected an object.`);
	}
	const manifest = value as Partial<CompatManifest>;
	if (manifest.schema !== 1) throw new Error(`${source}: unsupported schema (expected 1).`);
	if (!manifest.template || typeof manifest.template.version !== 'string' || manifest.template.name !== 'svforge') {
		throw new Error(`${source}: missing a valid template { name: 'svforge', version }.`);
	}
	if (!manifest.packages || typeof manifest.packages !== 'object') {
		throw new Error(`${source}: missing the packages version map.`);
	}
	const entries = Object.entries(manifest.packages);
	for (const [name, version] of entries) {
		if (typeof name !== 'string' || typeof version !== 'string' || version.length === 0) {
			throw new Error(`${source}: every packages entry must map a package name to a version string.`);
		}
	}
	if (manifest.packages.svforge !== manifest.template.version) {
		throw new Error(
			`${source}: template.version (${manifest.template.version}) does not match packages.svforge (${manifest.packages.svforge}).`
		);
	}
	return manifest as CompatManifest;
}

/**
 * Load a compatibility manifest from disk. Accepts either the manifest itself
 * or a release plan carrying it under `compatibility`, so the golden path can
 * point at the release plan directly.
 */
export function loadCompatManifest(path: string): CompatManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new Error(
			`Could not read compatibility manifest at ${path}: ${error instanceof Error ? error.message : error}`,
			{ cause: error }
		);
	}
	const candidate =
		parsed && typeof parsed === 'object' && 'compatibility' in (parsed as Record<string, unknown>)
			? (parsed as { compatibility: unknown }).compatibility
			: parsed;
	return assertCompatManifest(candidate, `compatibility manifest ${path}`);
}

/** Exact npm version for a module id from a manifest, or undefined. */
export function compatibleModuleVersion(manifest: CompatManifest, moduleId: string): string | undefined {
	return manifest.packages[`@svforge/${moduleId}`];
}
