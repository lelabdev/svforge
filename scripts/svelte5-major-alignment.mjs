#!/usr/bin/env node
/**
 * One-time distribution-major alignment with Svelte 5.
 *
 * Changesets correctly calculates the first major after svforge@2.3.0 as
 * 3.0.0. The reviewed Svelte 5 distribution intentionally skips the unused
 * major numbers and releases svforge@5.0.0. Addons remain independently
 * versioned. This exception is active ONLY while its Changeset is pending.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SVELTE5_ALIGNMENT_CHANGESET = '.changeset/svforge-svelte5-alignment.md';
export const SVELTE5_BASE_VERSION = '2.3.0';
export const SVELTE5_CALCULATED_VERSION = '3.0.0';
export const SVELTE5_TARGET_VERSION = '5.0.0';

export function hasSvelte5AlignmentChangeset(root) {
	return existsSync(join(root, SVELTE5_ALIGNMENT_CHANGESET));
}

export function assertSvelte5AlignmentBaseline(before) {
	const distribution = before.find((pkg) => pkg.name === 'svforge');
	if (distribution?.version !== SVELTE5_BASE_VERSION) {
		throw new Error(
			`Svelte 5 major alignment requires svforge@${SVELTE5_BASE_VERSION}; got ${distribution?.version ?? '(missing)'}.`
		);
	}
}

export function alignSvelte5ProspectiveReleases(releases, enabled) {
	if (!enabled) return releases;
	const distribution = releases.find((release) => release.name === 'svforge');
	if (distribution?.newVersion !== SVELTE5_CALCULATED_VERSION || distribution.type !== 'major') {
		throw new Error(
			`Svelte 5 major alignment requires a calculated svforge@${SVELTE5_CALCULATED_VERSION} major Changeset.`
		);
	}
	return releases.map((release) => release.name === 'svforge'
		? { ...release, newVersion: SVELTE5_TARGET_VERSION }
		: release);
}

/**
 * Rewrite the calculated Changesets version inside the disposable snapshot or
 * the reviewed Version Packages staging branch. Do not run on main directly.
 * All expected values are checked BEFORE writing either file.
 */
export function alignSvelte5GeneratedVersion(root, { iteration = null } = {}) {
	if (iteration !== null && (!Number.isSafeInteger(iteration) || iteration < 1)) {
		throw new Error('Svelte 5 major alignment requires a positive canary iteration.');
	}
	const suffix = iteration === null ? '' : `-canary.${iteration}`;
	const calculated = `${SVELTE5_CALCULATED_VERSION}${suffix}`;
	const target = `${SVELTE5_TARGET_VERSION}${suffix}`;
	const manifestPath = join(root, 'packages/svforge/package.json');
	const original = readFileSync(manifestPath, 'utf8');
	const manifest = JSON.parse(original);
	if (manifest.name !== 'svforge' || manifest.version !== calculated) {
		throw new Error(`Svelte 5 major alignment expected svforge@${calculated} from Changesets; got ${manifest.version}.`);
	}
	const match = original.match(/^([ \t]*"version"[ \t]*:[ \t]*")([^"]+)(")/m);
	if (!match || match[2] !== calculated) {
		throw new Error('Svelte 5 major alignment could not locate the calculated package manifest version.');
	}
	const updated = original.replace(match[0], `${match[1]}${target}${match[3]}`);
	let changelogPath;
	let changelog;
	let nextChangelog;
	if (iteration === null) {
		changelogPath = join(root, 'packages/svforge/CHANGELOG.md');
		changelog = readFileSync(changelogPath, 'utf8');
		const header = '# svforge\\n\\n## 3.0.0\\n';
		if (!changelog.startsWith(header)) {
			throw new Error('Svelte 5 major alignment requires a newly generated 3.0.0 changelog entry.');
		}
		nextChangelog = changelog.replace(header, '# svforge\\n\\n## 5.0.0\\n');
	}
	writeFileSync(manifestPath, updated);
	if (iteration === null) writeFileSync(changelogPath, nextChangelog);
	return target;
}
