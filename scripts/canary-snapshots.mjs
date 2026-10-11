#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCompatManifest } from './compat-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PREFIX = '0.0.0-';

export function canarySnapshotTag(commit, runId) {
	if (typeof commit !== 'string' || !/^[0-9a-f]{12,40}$/i.test(commit)) {
		throw new Error(`Canary snapshot requires a hexadecimal Git commit SHA; got ${String(commit)}.`);
	}
	if (typeof runId !== 'string' || !/^\d+$/.test(runId) || runId === '0') {
		throw new Error(`Canary snapshot requires a numeric GitHub Actions run ID; got ${String(runId)}.`);
	}
	return `canary-${commit.slice(0, 12).toLowerCase()}-${runId}`;
}

export function ensureDistributionSnapshotChangeset(root, selectedReleases, runId) {
	const hasAddonRelease = selectedReleases.some((pkg) => pkg.name.startsWith('@svforge/'));
	const hasDistributionRelease = selectedReleases.some((pkg) => pkg.name === 'svforge');
	if (!hasAddonRelease || hasDistributionRelease) return null;
	const changesetPath = join(root, `.changeset/canary-svforge-${runId}.md`);
	writeFileSync(changesetPath, `---\nsvforge: patch\n---\nRefresh the exact compatibility manifest for this isolated canary snapshot.\n`);
	return changesetPath;
}

export function readCanaryPackageVersions(root = ROOT) {
	return readdirSync(join(root, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'package.json')))
		.map((entry) => {
			const directory = `packages/${entry.name}`;
			const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'));
			if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
				throw new Error(`Canary snapshot: ${directory}/package.json must declare a name and version.`);
			}
			return { name: manifest.name, version: manifest.version, directory, private: manifest.private === true };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

function assertUniquePackages(packages, label) {
	const names = new Set();
	for (const pkg of packages) {
		if (!pkg.name || !pkg.version || !pkg.directory || names.has(pkg.name)) {
			throw new Error(`Canary snapshot: invalid or duplicate ${label} package ${pkg.name ?? '(unnamed)'}.`);
		}
		names.add(pkg.name);
	}
}

/** Build an exact-version consumer plan without changing stable package versions. */
export function buildCanaryPlan(before, after, { root = ROOT, tag, commit, runId }) {
	if (tag !== canarySnapshotTag(commit, String(runId))) {
		throw new Error(`Canary snapshot: tag ${String(tag)} does not match this commit and Actions run.`);
	}
	assertUniquePackages(before, 'baseline');
	assertUniquePackages(after, 'snapshot');
	const previous = new Map(before.map((pkg) => [pkg.name, pkg]));
	const expectedSnapshotVersion = `${SNAPSHOT_PREFIX}${tag}`;
	const packages = after.filter((pkg) => !pkg.private).map((pkg) => {
		const prior = previous.get(pkg.name);
		const snapshot = pkg.version === expectedSnapshotVersion;
		if (pkg.version.startsWith(SNAPSHOT_PREFIX) && !snapshot) {
			throw new Error(`Canary snapshot: ${pkg.name}@${pkg.version} does not match this run's immutable version ${expectedSnapshotVersion}.`);
		}
		if (prior && pkg.version !== prior.version && !snapshot) {
			throw new Error(`Canary snapshot: ${pkg.name} changed from ${prior.version} to non-snapshot version ${pkg.version}.`);
		}
		if (!prior && !snapshot) {
			throw new Error(`Canary snapshot: new package ${pkg.name}@${pkg.version} was not assigned this run's snapshot version.`);
		}
		return { name: pkg.name, version: pkg.version, directory: pkg.directory, snapshot };
	});
	const candidates = packages.filter((pkg) => pkg.snapshot).sort((a, b) => a.name.localeCompare(b.name));
	if (candidates.length === 0) throw new Error('Canary snapshot: Changesets produced no snapshot package versions.');
	if (candidates.some((pkg) => pkg.name.startsWith('@svforge/')) && !candidates.some((pkg) => pkg.name === 'svforge')) {
		throw new Error('Canary snapshot: addon snapshots require a matching svforge snapshot compatibility manifest.');
	}

	const compatibility = buildCompatManifest(root);
	for (const pkg of packages) {
		if (compatibility.packages[pkg.name] !== pkg.version) {
			throw new Error(`Canary snapshot: compatibility manifest says ${pkg.name}@${compatibility.packages[pkg.name]}, expected ${pkg.version}.`);
		}
	}
	if (compatibility.template.version !== compatibility.packages.svforge) {
		throw new Error('Canary snapshot: compatibility template version does not match the svforge package version.');
	}

	return {
		schemaVersion: 1,
		channel: 'canary',
		commit,
		runId,
		snapshotTag: tag,
		stagingDistTag: `canary-run-${runId}`,
		distTag: 'canary',
		compatibility,
		packages,
		candidates
	};
}

/** Unchanged stable packages must already exist at their exact compatibility versions. */
export function assertStableVersionsPublished(plan, isPublished) {
	const missing = plan.packages
		.filter((pkg) => !pkg.snapshot && !isPublished(pkg.name, pkg.version))
		.map((pkg) => `${pkg.name}@${pkg.version}`);
	if (missing.length) {
		throw new Error(`Canary snapshot blocked: unchanged compatibility package(s) are not published at their exact stable version: ${missing.join(', ')}.`);
	}
	return plan;
}

function isVersionPublished(name, version) {
	const result = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], { encoding: 'utf8' });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const output = `${result.stdout}\n${result.stderr}`;
		if (/E404|404 Not Found|is not in this registry/i.test(output)) return false;
		throw new Error(`Could not query npm for ${name}@${version}: ${output.trim()}`);
	}
	return result.stdout.trim().replace(/^['"]|['"]$/g, '') === version;
}

function run(command, args, cwd) {
	execFileSync(command, args, { cwd, stdio: 'inherit' });
}

/**
 * Apply Changesets snapshot mode only inside the disposable staging checkout.
 * The caller creates that checkout from the target Git commit; this function
 * never edits the invoking repository.
 */
export function prepareCanarySnapshot({
	root = ROOT,
	commit,
	runId,
	planPath = '/tmp/canary-plan.json',
	runCommand = run,
	isPublished = isVersionPublished
}) {
	const tag = canarySnapshotTag(commit, runId);
	const before = readCanaryPackageVersions(root);
	const statusPath = join(root, `.changeset-status-${runId}.json`);
	runCommand('bun', ['x', 'changeset', 'status', '--output', statusPath], root);
	const status = JSON.parse(readFileSync(statusPath, 'utf8'));
	const selected = status.releases ?? [];
	if (selected.length === 0) throw new Error('Canary snapshot: no pending Changesets release entries; nothing to publish.');

	// Snapshot artifacts are not stable releases: do not run the repository's
	// GitHub changelog generator or mutate package changelogs in the staging copy.
	const configPath = join(root, '.changeset/config.json');
	const originalConfig = readFileSync(configPath, 'utf8');
	const config = JSON.parse(originalConfig);
	config.changelog = false;
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	ensureDistributionSnapshotChangeset(root, selected, runId);

	runCommand('bun', [
		'x', 'changeset', 'version', '--snapshot', tag,
		'--snapshot-prerelease-template', '{tag}'
	], root);
	writeFileSync(configPath, originalConfig);
	runCommand('bun', ['install', '--ignore-scripts'], root);
	runCommand('bun', ['run', '--filter', 'svforge', 'prebuild'], root);

	const after = readCanaryPackageVersions(root);
	const plan = buildCanaryPlan(before, after, { root, tag, commit, runId });
	assertStableVersionsPublished(plan, isPublished);
	mkdirSync(dirname(resolve(planPath)), { recursive: true });
	writeFileSync(resolve(planPath), `${JSON.stringify(plan, null, 2)}\n`);
	rmStatusFile(statusPath);
	console.log(`Prepared ${plan.candidates.length} immutable snapshot package(s) for ${plan.stagingDistTag}.`);
	return plan;
}

function rmStatusFile(path) {
	try {
		unlinkSync(path);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const value = (name) => {
		const index = args.indexOf(`--${name}`);
		return index === -1 ? undefined : args[index + 1];
	};
	if (args[0] !== 'prepare' || !value('commit') || !value('run-id')) {
		console.error('Usage: node scripts/canary-snapshots.mjs prepare --commit <sha> --run-id <id> [--root <dir>] [--plan <path>]');
		process.exitCode = 1;
	} else {
		try {
			prepareCanarySnapshot({
				root: value('root') ? resolve(value('root')) : ROOT,
				commit: value('commit'),
				runId: value('run-id'),
				planPath: value('plan') ?? '/tmp/canary-plan.json'
			});
		} catch (error) {
			console.error(`Canary snapshot preparation failed: ${error.message}`);
			process.exitCode = 1;
		}
	}
}
