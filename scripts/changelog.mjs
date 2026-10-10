#!/usr/bin/env node
/**
 * Read and validate Changesets' package-scoped changelogs for release planning
 * and the notes embedded in `svforge upgrade`. CHANGELOG.md at the repository
 * root remains the immutable archive of releases published before migration.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGESET_HEADING = /^##\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+—\s+(\d{4}-\d{2}-\d{2}))?\s*$/gm;
const LEGACY_MARKER = /^<!--\s*svforge-release\s+(.+?)\s*-->$/gm;

export function parseAttributes(attributes) {
	const values = {};
	for (const match of attributes.matchAll(/([a-z]+)="([^"]*)"/g)) values[match[1]] = match[2];
	return values;
}

/** Parse one package's Changesets-generated changelog. */
export function parsePackageChangelog(content, packageName) {
	const headings = [...content.matchAll(CHANGESET_HEADING)];
	return headings.map((heading, index) => {
		const bodyStart = heading.index + heading[0].length;
		const bodyEnd = headings[index + 1]?.index ?? content.length;
		return {
			package: packageName,
			version: heading[1],
			date: heading[2] ?? '',
			body: content.slice(bodyStart, bodyEnd).trim()
		};
	});
}

/** Read every workspace's changelog in deterministic package-name order. */
export function readPackageChangelogs(root = ROOT) {
	const packagesDir = join(root, 'packages');
	const workspaces = readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
		.map((entry) => {
			const directory = `packages/${entry.name}`;
			const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'));
			return { name: manifest.name, version: manifest.version, directory };
		})
		.sort((left, right) => left.name.localeCompare(right.name));

	return workspaces.flatMap((pkg) => {
		const path = join(root, pkg.directory, 'CHANGELOG.md');
		if (!existsSync(path)) throw new Error(`Missing package changelog: ${pkg.directory}/CHANGELOG.md.`);
		return parsePackageChangelog(readFileSync(path, 'utf8'), pkg.name);
	});
}

/** Ensure all planned current package versions have a corresponding release note. */
export function validatePackageChangelogs(packages, root = ROOT) {
	const errors = [];
	const entries = [];
	const seen = new Set();

	for (const pkg of packages) {
		const path = join(root, pkg.directory, 'CHANGELOG.md');
		if (!existsSync(path)) {
			errors.push(`${pkg.name}: missing package changelog (${pkg.directory}/CHANGELOG.md).`);
			continue;
		}
		const packageEntries = parsePackageChangelog(readFileSync(path, 'utf8'), pkg.name);
		for (const entry of packageEntries) {
			if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(entry.version)) {
				errors.push(`${pkg.name}@${entry.version}: invalid semantic version heading.`);
			}
			if (entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
				errors.push(`${pkg.name}@${entry.version}: historical date must be YYYY-MM-DD.`);
			}
			const key = `${pkg.name}@${entry.version}`;
			if (seen.has(key)) errors.push(`${key}: duplicate package changelog entry.`);
			seen.add(key);
			entries.push(entry);
		}
		if (!seen.has(`${pkg.name}@${pkg.version}`)) {
			errors.push(`${pkg.name}@${pkg.version}: missing current package changelog entry.`);
		}
	}

	return { valid: errors.length === 0, errors, entries };
}

function compareIdentifiers(left, right) {
	if (left === right) return 0;
	const leftNumeric = /^\d+$/.test(left);
	const rightNumeric = /^\d+$/.test(right);
	if (leftNumeric && rightNumeric) {
		const a = left.replace(/^0+/, '') || '0';
		const b = right.replace(/^0+/, '') || '0';
		return a.length === b.length ? (a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
	}
	if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
	return left < right ? -1 : 1;
}

/** SemVer ordering for recipe releases, including prereleases. */
export function compareVersions(left, right) {
	const parse = (version) => {
		const withoutBuild = version.split('+', 1)[0];
		const separator = withoutBuild.indexOf('-');
		const core = separator < 0 ? withoutBuild : withoutBuild.slice(0, separator);
		const prerelease = separator < 0 ? '' : withoutBuild.slice(separator + 1);
		return { core: core.split('.'), prerelease: prerelease ? prerelease.split('.') : [] };
	};
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index++) {
		const compared = compareIdentifiers(a.core[index], b.core[index]);
		if (compared !== 0) return compared;
	}
	if (!a.prerelease.length && !b.prerelease.length) return 0;
	if (!a.prerelease.length) return 1;
	if (!b.prerelease.length) return -1;
	for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
		if (a.prerelease[index] === undefined) return -1;
		if (b.prerelease[index] === undefined) return 1;
		const compared = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
		if (compared !== 0) return compared;
	}
	return 0;
}

/** Select release notes belonging to the installed-to-target recipe interval. */
export function entriesBetween(entries, packageName, fromVersion, toVersion) {
	return entries
		.filter((entry) => entry.package === packageName)
		.filter((entry) => (!fromVersion || compareVersions(entry.version, fromVersion) > 0) && compareVersions(entry.version, toVersion) <= 0)
		.sort((left, right) => compareVersions(left.version, right.version));
}

/** Parse the pre-Changesets root archive for the one-time history migration. */
export function parseLegacyChangelog(content) {
	const markers = [...content.matchAll(LEGACY_MARKER)];
	return markers.map((marker, index) => {
		const attributes = parseAttributes(marker[1]);
		const bodyStart = marker.index + marker[0].length;
		const bodyEnd = markers[index + 1]?.index ?? content.length;
		return {
			package: attributes.package,
			version: attributes.version,
			date: attributes.date,
			body: content.slice(bodyStart, bodyEnd).trim()
		};
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const packages = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(ROOT, 'packages', entry.name, 'package.json')))
		.map((entry) => {
			const directory = `packages/${entry.name}`;
			const manifest = JSON.parse(readFileSync(join(ROOT, directory, 'package.json'), 'utf8'));
			return { name: manifest.name, version: manifest.version, directory };
		});
	const result = validatePackageChangelogs(packages);
	if (!result.valid) {
		for (const error of result.errors) console.error(`Changelog error: ${error}`);
		process.exitCode = 1;
	} else {
		console.log(`Package changelogs OK: ${result.entries.length} release entries.`);
	}
}
