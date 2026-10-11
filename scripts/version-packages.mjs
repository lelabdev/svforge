#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE_PATH = '.changeset/release-candidates.json';

export function readPackageVersions(root = ROOT) {
	return readdirSync(join(root, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const path = join(root, 'packages', entry.name, 'package.json');
			try {
				const manifest = JSON.parse(readFileSync(path, 'utf8'));
				return [{ name: manifest.name, version: manifest.version, directory: `packages/${entry.name}`, private: manifest.private === true }];
			} catch (error) {
				if (error.code === 'ENOENT') return [];
				throw error;
			}
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function selectReleaseCandidates(before, after, isPublished) {
	const previousVersions = new Map(before.map((pkg) => [pkg.name, pkg.version]));
	const names = new Set();
	return after.filter((pkg) => {
		if (pkg.private) return false;
		if (!pkg.name || !pkg.version || !pkg.directory || names.has(pkg.name)) {
			throw new Error(`Invalid or duplicate package in release candidate input: ${pkg.name ?? '(unnamed)'}.`);
		}
		names.add(pkg.name);
		return previousVersions.get(pkg.name) !== pkg.version || !isPublished(pkg.name, pkg.version);
	}).map(({ name, version, directory }) => ({ name, version, directory }));
}

// The first reviewed Changesets release is a one-off common baseline. Subsequent
// releases stay independent; the fixed group is NEVER committed to the repo.
export const INITIAL_BASELINE_VERSION = '2.2.0';

export function needsInitialBaseline(packages) {
	const distribution = packages.find((pkg) => pkg.name === 'svforge');
	if (distribution?.version !== '2.1.1') return false;
	if (packages.length !== 15 || packages.some((pkg) =>
		pkg.private || (pkg.name !== 'svforge' && !/^2\.0\.[12]$/.test(pkg.version))
	)) {
		throw new Error('Initial 2.2.0 release baseline no longer matches the reviewed 15-package starting versions.');
	}
	return true;
}

export function runChangesetsVersion(root, before, run) {
	if (!needsInitialBaseline(before)) {
		run('bun', ['x', 'changeset', 'version']);
		return false;
	}

	const configPath = join(root, '.changeset/config.json');
	const original = readFileSync(configPath, 'utf8');
	const config = JSON.parse(original);
	if (config.fixed?.length || config.linked?.length) {
		throw new Error('One-time baseline expects independent Changesets configuration (no fixed or linked groups).');
	}
	// Use the standard Changesets fixed-group algorithm for ONE version operation;
	// keep the source config unchanged so the next release is independent.
	config.fixed = [before.map((pkg) => pkg.name)];
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	try {
		run('bun', ['x', 'changeset', 'version']);
	} finally {
		writeFileSync(configPath, original);
	}
	const versions = readPackageVersions(root);
	const invalid = versions.filter((pkg) => pkg.version !== INITIAL_BASELINE_VERSION);
	if (invalid.length) {
		throw new Error(`Changesets did not align the initial release to ${INITIAL_BASELINE_VERSION}: ${invalid.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`);
	}
	return true;
}

function isVersionPublished(name, version) {
	const result = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], { encoding: 'utf8' });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const output = `${result.stdout}\n${result.stderr}`;
		if (/E404|404 Not Found|is not in this registry/i.test(output)) return false;
		throw new Error(`Could not query npm for ${name}@${version}: ${output.trim()}`);
	}
	const output = result.stdout.trim();
	if (!output) return false;
	try {
		return JSON.parse(output) === version;
	} catch {
		return output.replace(/^['"]|['"]$/g, '') === version;
	}
}

export function prepareVersionPackages(
	root = ROOT,
	run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' }),
	isPublished = isVersionPublished
) {
	const before = readPackageVersions(root);
	runChangesetsVersion(root, before, run);
	run('bun', ['install', '--ignore-scripts']);
	run('bun', ['run', '--filter', 'svforge', 'prebuild']);
	const after = readPackageVersions(root);
	const candidates = selectReleaseCandidates(before, after, isPublished);
	if (!candidates.length) throw new Error('Changesets did not produce any stable release candidates.');
	writeFileSync(join(root, CANDIDATE_PATH), `${JSON.stringify({ schemaVersion: 1, packages: candidates }, null, 2)}\n`);
	console.log(`Recorded ${candidates.length} reviewed stable release candidate(s) in ${CANDIDATE_PATH}.`);
	return candidates;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		prepareVersionPackages();
	} catch (error) {
		console.error(`Changesets version preparation failed: ${error.message}`);
		process.exitCode = 1;
	}
}
