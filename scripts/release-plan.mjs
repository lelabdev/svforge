#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChangelog, validateChangelog } from './changelog.mjs';
import { assertCompatManifestMatchesPlan, assertCompatibilityFreshness, buildCompatManifest } from './compat-manifest.mjs';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_FILES = ['README.md', 'package.json', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];

export function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
	if (!match || [match[1], match[2], match[3]].some((part) => part.length > 1 && part.startsWith('0'))) {
		throw new Error(`Unsupported package version: ${version}`);
	}
	const prerelease = match[4]?.split('.') ?? [];
	if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
		throw new Error(`Unsupported package version: ${version}`);
	}
	return {
		// Keep numeric identifiers as decimal strings. JavaScript numbers cannot
		// represent every valid SemVer integer exactly (notably above 2^53 - 1).
		major: match[1],
		minor: match[2],
		patch: match[3],
		prerelease,
		build: match[5]?.split('.') ?? []
	};
}

function compareNumericIdentifiers(left, right) {
	const normalizedLeft = left.replace(/^0+/, '') || '0';
	const normalizedRight = right.replace(/^0+/, '') || '0';
	if (normalizedLeft.length !== normalizedRight.length) {
		return normalizedLeft.length < normalizedRight.length ? -1 : 1;
	}
	if (normalizedLeft === normalizedRight) return 0;
	return normalizedLeft < normalizedRight ? -1 : 1;
}

export function compareVersions(left, right) {
	const a = typeof left === 'string' ? parseVersion(left) : left;
	const b = typeof right === 'string' ? parseVersion(right) : right;
	for (const key of ['major', 'minor', 'patch']) {
		const comparison = compareNumericIdentifiers(String(a[key]), String(b[key]));
		if (comparison !== 0) return comparison;
	}
	if (!a.prerelease.length && !b.prerelease.length) return 0;
	if (!a.prerelease.length) return 1;
	if (!b.prerelease.length) return -1;
	for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
		const leftPart = a.prerelease[index];
		const rightPart = b.prerelease[index];
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;
		if (leftPart === rightPart) continue;
		const leftNumeric = /^\d+$/.test(leftPart);
		const rightNumeric = /^\d+$/.test(rightPart);
		if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftPart, rightPart);
		if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
		return leftPart < rightPart ? -1 : 1;
	}
	return 0;
}

function packageDirectories(root) {
	return readdirSync(join(root, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'package.json')))
		.map((entry) => entry.name)
		.sort();
}

function localDependencyNames(manifest, packageNames) {
	const names = new Set();
	for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
		for (const name of Object.keys(manifest[field] ?? {})) {
			if (packageNames.has(name)) names.add(name);
		}
	}
	return [...names].sort();
}

function packageComparator(left, right) {
	const leftScoped = left.name.startsWith('@');
	const rightScoped = right.name.startsWith('@');
	if (leftScoped !== rightScoped) return leftScoped ? -1 : 1;
	return left.name.localeCompare(right.name);
}

export function orderPackages(packages) {
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const indegree = new Map(packages.map((pkg) => [pkg.name, 0]));
	const dependents = new Map(packages.map((pkg) => [pkg.name, []]));

	for (const pkg of packages) {
		for (const dependency of pkg.localDependencies ?? []) {
			if (!byName.has(dependency)) continue;
			indegree.set(pkg.name, indegree.get(pkg.name) + 1);
			dependents.get(dependency).push(pkg.name);
		}
	}

	const ready = packages
		.filter((pkg) => indegree.get(pkg.name) === 0)
		.map((pkg) => pkg.name)
		.sort((a, b) => packageComparator(byName.get(a), byName.get(b)));
	const ordered = [];
	while (ready.length) {
		const name = ready.shift();
		const pkg = byName.get(name);
		ordered.push(pkg);
		for (const dependent of dependents.get(name).sort()) {
			indegree.set(dependent, indegree.get(dependent) - 1);
			if (indegree.get(dependent) === 0) {
				ready.push(dependent);
				ready.sort((a, b) => packageComparator(byName.get(a), byName.get(b)));
			}
		}
	}

	if (ordered.length !== packages.length) {
		throw new Error('Cannot create release plan: local package dependencies contain a cycle.');
	}
	return ordered;
}

export function buildReleasePlan(root = SCRIPT_ROOT, commit = process.env.GITHUB_SHA ?? 'unknown') {
	const directories = packageDirectories(root);
	const manifests = directories.map((directory) => ({
		directory,
		manifestPath: `packages/${directory}/package.json`,
		manifest: JSON.parse(readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'))
	}));
	const packageNames = new Set(manifests.map(({ manifest }) => manifest.name));
	if (packageNames.size !== manifests.length) throw new Error('Cannot create release plan: package names must be unique.');

	const packages = manifests.map(({ directory, manifestPath, manifest }) => {
		parseVersion(manifest.version);
		return {
			name: manifest.name,
			version: manifest.version,
			directory: `packages/${directory}`,
			manifestPath,
			localDependencies: localDependencyNames(manifest, packageNames)
		};
	});

	const orderedPackages = orderPackages(packages);
	const changelog = validateChangelog(readChangelog(root), orderedPackages);
	if (!changelog.valid) {
		throw new Error(`Release plan rejected: ${changelog.errors.join(' ')}`);
	}

	// #470: the compatibility manifest is DERIVED from the same manifests, so
	// the plan and the version embedded into the published `svforge` cannot
	// diverge. Validated here, consumed by the golden path.
	const compatibility = assertCompatManifestMatchesPlan(buildCompatManifest(root), orderedPackages);

	return {
		schemaVersion: 1,
		versionPolicy: 'independent',
		commit,
		changelog: { path: 'CHANGELOG.md', entries: changelog.entries.length },
		compatibility,
		packages: orderedPackages
	};
}

function runNpm(args, cwd, options = {}) {
	const result = spawnSync('npm', args, {
		cwd,
		encoding: 'utf8',
		...options
	});
	if (result.error) throw result.error;
	return result;
}

function registryVersions(name, npm = runNpm, cwd = SCRIPT_ROOT) {
	const result = npm(['view', name, 'versions', '--json'], cwd);
	if (result.status !== 0) {
		const output = `${result.stdout}\n${result.stderr}`;
		if (/E404|404 Not Found|is not in this registry/i.test(output)) return [];
		throw new Error(`Could not query npm for ${name}: ${output.trim()}`);
	}
	if (!result.stdout.trim()) return [];
	const versions = JSON.parse(result.stdout);
	return (Array.isArray(versions) ? versions : [versions]).filter((version) => typeof version === 'string');
}

export function checkRegistry(plan, root = SCRIPT_ROOT, npm = runNpm) {
	const checked = plan.packages.map((pkg) => {
		const versions = registryVersions(pkg.name, npm, root);
		const published = versions.includes(pkg.version);
		const latest = versions.reduce(
			(current, version) => (!current || compareVersions(version, current) > 0 ? version : current),
			null
		);
		if (!published && latest && compareVersions(pkg.version, latest) < 0) {
			throw new Error(
			`Registry version conflict for ${pkg.name}: local ${pkg.version} is older than published ${latest}.`
			);
		}
		return { ...pkg, registry: { published, latest, availableVersions: versions } };
	});
	const checkedPlan = { ...plan, registry: 'https://registry.npmjs.org', packages: checked };
	// #470: never ship a distribution whose embedded manifest would point at
	// outdated modules because `svforge` was not bumped alongside them.
	assertCompatibilityFreshness(checkedPlan);
	printPlan(checkedPlan, root);
	return checkedPlan;
}

/**
 * Verify npm publish access for packages that already exist.
 *
 * `npm access list packages` only reports packages that already exist. A
 * package with no registry versions is intentionally absent from that response
 * until its first publication, so its access must be validated by the
 * authenticated publish itself rather than rejected here.
 */
export function checkPublishAccess(plan, root = SCRIPT_ROOT, npm = runNpm) {
	const hasPublishedPackage = (pkg) => !pkg.registry
		|| pkg.registry.published === true
		|| (pkg.registry.availableVersions?.length ?? 0) > 0;
	const existing = plan.packages.filter(hasPublishedPackage);
	const notYetPublished = plan.packages.filter((pkg) => !hasPublishedPackage(pkg));
	let access = {};

	if (existing.length) {
		const result = npm(['access', 'list', 'packages', '--json'], root);
		if (result.status !== 0) {
			throw new Error(`Could not query npm publish permissions: ${`${result.stdout}\n${result.stderr}`.trim()}`);
		}
		try {
			access = JSON.parse(result.stdout);
		} catch {
			throw new Error('Could not query npm publish permissions: npm returned invalid JSON.');
		}
	}

	const canPublish = (permission) => typeof permission === 'string'
		? /write|admin/i.test(permission)
		: permission === true;
	const denied = existing.filter((pkg) => !canPublish(access[pkg.name])).map((pkg) => pkg.name);
	if (denied.length) {
		throw new Error(`Authenticated npm account cannot publish: ${denied.join(', ')}.`);
	}
	if (notYetPublished.length) {
		console.log(`Skipping npm access lookup for ${notYetPublished.length} not-yet-published package(s).`);
	}
	console.log(`Publish access OK for ${plan.packages.length} package(s).`);
	return plan;
}

function exportedPaths(manifest) {
	const paths = [];
	const rootExport = manifest.exports?.['.'] ?? manifest.exports;
	if (typeof rootExport === 'string') paths.push(rootExport);
	else if (rootExport && typeof rootExport === 'object') {
		for (const value of Object.values(rootExport)) if (typeof value === 'string') paths.push(value);
	}
	const binaries = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
	for (const value of binaries) if (typeof value === 'string') paths.push(value);
	return paths.map((path) => path.replace(/^\.\//, ''));
}

/**
 * Extract the pack record from `npm pack --dry-run --json` output.
 *
 * npm historically returned an array of records, but npm 12+ returns an
 * object keyed by package name (e.g. { "@svforge/ui_toast": { files: [...] } }).
 * Accept both shapes: prefer the pkgName entry, falling back to the first own
 * enumerable entry whose value carries a files array.
 */
function extractPackRecord(stdout, pkgName) {
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error(`npm pack --json returned invalid JSON for ${pkgName}. Raw output: ${stdout.trim().slice(0, 200) || '(empty)'}`);
	}
	let record = Array.isArray(parsed)
		? parsed[0]
		: (parsed && typeof parsed === 'object' ? parsed[pkgName] : undefined);
	if (!record || typeof record !== 'object' || !Array.isArray(record.files)) {
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			record = Object.values(parsed).find((entry) => entry && typeof entry === 'object' && Array.isArray(entry.files));
		}
	}
	if (!record || typeof record !== 'object' || !Array.isArray(record.files)) {
		throw new Error(
			`npm pack --json returned an unexpected shape for ${pkgName}: expected an array of records or an object keyed by package name with a "files" array. Raw output: ${stdout.trim().slice(0, 200) || '(empty)'}`
		);
	}
	return record;
}

export function preflightPackage(pkg, root = SCRIPT_ROOT, npm = runNpm) {
	const packageDirectory = join(root, pkg.directory);
	const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
	const result = npm(['pack', '--dry-run', '--json', '--ignore-scripts'], packageDirectory);
	if (result.status !== 0) throw new Error(`npm pack failed for ${pkg.name}: ${result.stderr.trim()}`);
	const pack = extractPackRecord(result.stdout, pkg.name);
	const files = new Set(pack.files.map((file) => file.path));
	const expectedFiles = [...REQUIRED_FILES, ...exportedPaths(manifest)];
	for (const file of expectedFiles) {
		if (!files.has(file)) throw new Error(`Preflight failed for ${pkg.name}: ${file} is missing from the tarball.`);
	}
	return { name: pkg.name, version: pkg.version, fileCount: files.size };
}

export function preflightPlan(plan, root = SCRIPT_ROOT, npm = runNpm) {
	const results = plan.packages.map((pkg) => preflightPackage(pkg, root, npm));
	for (const result of results) console.log(`Preflight OK: ${result.name}@${result.version} (${result.fileCount} files)`);
	return results;
}

export function publishPlan(plan, root = SCRIPT_ROOT, npm = runNpm) {
	for (const pkg of plan.packages) {
		if (!pkg.registry) {
			throw new Error('Cannot publish an unchecked release plan; run --check-registry first.');
		}
		if (pkg.registry.published) {
			console.log(`Skipping ${pkg.name}@${pkg.version}: version already exists on npm.`);
			continue;
		}
		console.log(`Publishing ${pkg.name}@${pkg.version} from ${pkg.directory}...`);
		const result = npm(['publish', '--access', 'public', '--ignore-scripts'], join(root, pkg.directory), {
			stdio: 'inherit'
		});
		if (result.status !== 0) throw new Error(`npm publish failed for ${pkg.name}@${pkg.version}.`);
	}
}

function printPlan(plan) {
	console.log(`Release plan (${plan.versionPolicy} versioning, commit ${plan.commit})`);
	console.log(JSON.stringify(plan, null, 2));
}

function readPlan(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function optionValue(args, option) {
	const index = args.indexOf(option);
	return index === -1 ? null : args[index + 1];
}

async function main() {
	const args = process.argv.slice(2);
	const root = SCRIPT_ROOT;
	const output = optionValue(args, '--output');
	let plan;
	if (args.includes('--plan')) {
		const planPath = optionValue(args, '--plan');
		if (!planPath) throw new Error('--plan requires a path.');
		plan = readPlan(planPath);
	} else {
		const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		plan = buildReleasePlan(root, commit);
	}

	if (args.includes('--check-registry')) plan = checkRegistry(plan, root);
	if (args.includes('--check-access')) checkPublishAccess(plan, root);
	if (args.includes('--preflight')) preflightPlan(plan, root);
	if (args.includes('--publish')) publishPlan(plan, root);
	if (!args.includes('--check-registry') && !args.includes('--check-access') && !args.includes('--preflight') && !args.includes('--publish')) {
		printPlan(plan, root);
	}
	if (output) writeFileSync(resolve(output), `${JSON.stringify(plan, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`Release plan failed: ${error.message}`);
		process.exitCode = 1;
	});
}
