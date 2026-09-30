#!/usr/bin/env node
/**
 * Release compatibility manifest (#470).
 *
 * SVForge keeps INDEPENDENT package versions: a module that did not change is
 * never republished, while the unscoped `svforge` package carries the public
 * DISTRIBUTION version of a release. To make one `svforge create my-app
 * --modules all` install exactly the compatible set for the user's installed
 * `svforge`, every release ships a machine-readable compatibility manifest:
 *
 *   {
 *     "schema": 1,
 *     "template": { "name": "svforge", "version": "2.1.0" },
 *     "packages": {
 *       "svforge": "2.1.0",
 *       "@svforge/addon-kit": "2.1.0",
 *       "@svforge/ui_toast": "2.0.1",
 *       "@svforge/dnd": "2.0.3"
 *     }
 *   }
 *
 * It is DERIVED from the actual package manifests (never a hand-maintained
 * list), embedded into the published `svforge` CLI (see
 * packages/svforge/scripts/prebuild.ts) and included in the release plan so
 * the golden path can assert the exact artifacts it tests.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The npm name of the distribution package that carries the manifest. */
export const DISTRIBUTION_PACKAGE = 'svforge';

/** Sort keys for a deterministic, diff-friendly manifest. */
function sortedRecord(record) {
	/** @type {Record<string, string>} */
	const sorted = {};
	for (const key of Object.keys(record).sort()) sorted[key] = record[key];
	return sorted;
}

/**
 * Build the compatibility manifest from every workspace package manifest.
 * Deterministic: package directories are enumerated sorted and the `packages`
 * record keys are sorted.
 *
 * @param {string} [root]
 * @returns {{ schema: 1, template: { name: string, version: string }, packages: Record<string, string> }}
 */
export function buildCompatManifest(root = DEFAULT_ROOT) {
	const packagesDir = join(root, 'packages');
	const directories = readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
		.map((entry) => entry.name)
		.sort();

	/** @type {Record<string, string>} */
	const packages = {};
	for (const directory of directories) {
		const manifest = JSON.parse(readFileSync(join(packagesDir, directory, 'package.json'), 'utf8'));
		if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
			throw new Error(`compat manifest: ${directory}/package.json must declare a name and version.`);
		}
		packages[manifest.name] = manifest.version;
	}
	const version = packages[DISTRIBUTION_PACKAGE];
	if (typeof version !== 'string') {
		throw new Error(`compat manifest: the "${DISTRIBUTION_PACKAGE}" package was not found under packages/.`);
	}
	return {
		schema: 1,
		template: { name: DISTRIBUTION_PACKAGE, version },
		packages: sortedRecord(packages)
	};
}

/**
 * Assert the manifest is internally consistent and matches the release plan's
 * own name/version records — the plan and the embedded manifest can never
 * diverge silently.
 */
export function assertCompatManifestMatchesPlan(compat, packages, distribution = DISTRIBUTION_PACKAGE) {
	if (!compat || compat.schema !== 1 || !compat.packages || !compat.template) {
		throw new Error('compat manifest: expected a schema-1 { template, packages } object.');
	}
	const fromPlan = new Map(packages.map((pkg) => [pkg.name, pkg.version]));
	for (const [name, version] of Object.entries(compat.packages)) {
		const planned = fromPlan.get(name);
		if (planned === undefined) throw new Error(`compat manifest: ${name}@${version} is not in the release plan.`);
		if (planned !== version) throw new Error(`compat manifest: ${name} is ${version} but the release plan says ${planned}.`);
		fromPlan.delete(name);
	}
	if (fromPlan.size > 0) {
		throw new Error(`compat manifest: missing entries for ${[...fromPlan.keys()].join(', ')}.`);
	}
	const distributionVersion = compat.packages[distribution];
	if (distributionVersion !== compat.template.version) {
		throw new Error(`compat manifest: template.version (${compat.template.version}) does not match packages.${distribution} (${distributionVersion}).`);
	}
	return compat;
}

/**
 * Staleness guard (#470): the embedded manifest must not go stale. If any
 * NON-distribution package is about to be published while `svforge` itself is
 * already on the registry (so it would be skipped), the distribution version
 * was not bumped — the published `svforge` would announce the OLD compatible
 * modules. Fail instead of shipping an incoherent release.
 */
export function assertCompatibilityFreshness(plan, distribution = DISTRIBUTION_PACKAGE) {
	if (!plan.compatibility) return plan;
	const distributionPkg = plan.packages.find((pkg) => pkg.name === distribution);
	const distributionPublished = distributionPkg?.registry?.published === true;
	if (!distributionPublished) return plan;
	const republished = plan.packages
		.filter((pkg) => pkg.name !== distribution && pkg.registry?.published === false)
		.map((pkg) => `${pkg.name}@${pkg.version}`);
	if (republished.length > 0) {
		throw new Error(
			`Compatibility manifest is stale: ${distribution}@${distributionPkg.version} is already published, ` +
				`but ${republished.join(', ')} changed. Bump ${distribution} so the published compatibility manifest cannot point at outdated modules.`
		);
	}
	return plan;
}
