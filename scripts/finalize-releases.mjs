#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePackageChangelog } from './changelog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, root = ROOT) {
	const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
	if (result.error) throw result.error;
	return result;
}

function requireSuccess(command, args, root = ROOT) {
	const result = run(command, args, root);
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
	}
	return result.stdout.trim();
}

function verifyRegistryVersion(name, version, root = ROOT) {
	const result = run('npm', ['view', `${name}@${version}`, 'version', '--json'], root);
	if (result.status !== 0) {
		const output = `${result.stdout}\n${result.stderr}`;
		if (/E404|404 Not Found|is not in this registry/i.test(output)) return null;
		throw new Error(`Could not verify npm version ${name}@${version}: ${output.trim()}`);
	}
	const output = result.stdout.trim();
	if (!output) return null;
	try {
		const parsed = JSON.parse(output);
		return Array.isArray(parsed) ? parsed[0] ?? null : parsed;
	} catch {
		return output.replace(/^['"]|['"]$/g, '');
	}
}

function remoteTagTarget(tag, root = ROOT) {
	const result = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], root);
	if (result.status !== 0) throw new Error(`Could not check remote tag ${tag}: ${(result.stderr || result.stdout).trim()}`);
	const lines = result.stdout.trim().split('\n').filter(Boolean);
	const peeled = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`));
	const plain = lines.find((line) => line.endsWith(`refs/tags/${tag}`));
	return (peeled ?? plain)?.split(/\s+/)[0] ?? null;
}

function gitObjectTarget(tag, root = ROOT) {
	const result = run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], root);
	return result.status === 0 ? result.stdout.trim() : null;
}

function ensureRemoteTag(tag, commit, operations) {
	let remoteTarget = operations.remoteTagTarget(tag);
	if (remoteTarget && remoteTarget !== commit) {
		throw new Error(`Refusing to use ${tag}: remote tag points to ${remoteTarget}, expected ${commit}.`);
	}
	if (remoteTarget) return;

	const localTarget = operations.gitObjectTarget(tag);
	if (localTarget && localTarget !== commit) {
		throw new Error(`Refusing to push ${tag}: local tag points to ${localTarget}, expected ${commit}.`);
	}
	if (!localTarget) operations.createLocalTag(tag, commit);
	operations.pushTag(tag);
	remoteTarget = operations.remoteTagTarget(tag);
	if (remoteTarget !== commit) {
		throw new Error(`Could not verify remote tag ${tag} at ${commit} after pushing.`);
	}
}

function validateInputs(plan, candidates, commit, root) {
	if (!plan?.compatibility || !Array.isArray(plan.packages) || !Array.isArray(candidates?.packages)) {
		throw new Error('Release plan or candidate manifest is invalid or lacks compatibility data.');
	}
	if (plan.commit !== commit || candidates.commit !== commit) {
		throw new Error('Release plan, candidate manifest, and checked-out merge commit do not match.');
	}
	const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
	if (currentCommit !== commit) throw new Error(`Checked-out commit ${currentCommit} does not match release commit ${commit}.`);
	const plannedByName = new Map(plan.packages.map((pkg) => [pkg.name, pkg]));
	const seen = new Set();
	return candidates.packages.map((candidate) => {
		if (seen.has(candidate.name)) throw new Error(`Duplicate release candidate: ${candidate.name}.`);
		seen.add(candidate.name);
		const pkg = plannedByName.get(candidate.name);
		if (!pkg || pkg.version !== candidate.version || pkg.directory !== candidate.directory) {
			throw new Error(`Candidate ${candidate.name}@${candidate.version} does not match the release plan.`);
		}
		const manifestPath = join(root, candidate.directory, 'package.json');
		if (!existsSync(manifestPath)) throw new Error(`Missing package manifest for ${candidate.name}.`);
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		if (manifest.name !== candidate.name || manifest.version !== candidate.version) {
			throw new Error(`Current package manifest does not match ${candidate.name}@${candidate.version}.`);
		}
		const changelogPath = join(root, candidate.directory, 'CHANGELOG.md');
		if (!existsSync(changelogPath)) throw new Error(`Missing changelog for ${candidate.name}.`);
		const entry = parsePackageChangelog(readFileSync(changelogPath, 'utf8'), candidate.name)
			.find((item) => item.version === candidate.version);
		if (!entry) throw new Error(`Missing changelog entry for ${candidate.name}@${candidate.version}.`);
		return { ...candidate, notes: entry.body };
	});
}

export function finalizeReleases({
	plan,
	candidates,
	commit,
	root = ROOT,
	operations = {}
}) {
	const defaults = {
		verifyRegistryVersion: (name, version) => verifyRegistryVersion(name, version, root),
		remoteTagTarget: (tag) => remoteTagTarget(tag, root),
		gitObjectTarget: (tag) => gitObjectTarget(tag, root),
		createLocalTag: (tag, sha) => requireSuccess('git', ['tag', tag, sha], root),
		pushTag: (tag) => requireSuccess('git', ['push', 'origin', `refs/tags/${tag}`], root),
		getRelease: (tag) => {
			const result = run('gh', ['release', 'view', tag, '--json', 'tagName'], root);
			if (result.status === 0) return JSON.parse(result.stdout).tagName;
			if (/release not found|HTTP 404/i.test(`${result.stdout}\n${result.stderr}`)) return null;
			throw new Error(`Could not inspect GitHub Release ${tag}: ${(result.stderr || result.stdout).trim()}`);
		},
		createRelease: (tag, notes) => requireSuccess('gh', [
			'release', 'create', tag,
			'--title', tag,
			'--notes', notes,
			'--verify-tag'
		], root)
	};
	const actions = { ...defaults, ...operations };
	const releasePackages = validateInputs(plan, candidates, commit, root);
	if (!releasePackages.length) throw new Error('No verified stable release candidates were supplied.');

	// Check every exact registry version before creating any remote tag or release.
	const missing = releasePackages.filter((pkg) => actions.verifyRegistryVersion(pkg.name, pkg.version) !== pkg.version);
	if (missing.length) {
		throw new Error(`Refusing to announce unpublished versions: ${missing.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}.`);
	}

	for (const pkg of releasePackages) {
		ensureRemoteTag(`${pkg.name}@${pkg.version}`, commit, actions);
	}

	const results = [];
	for (const pkg of releasePackages) {
		const tag = `${pkg.name}@${pkg.version}`;
		const existing = actions.getRelease(tag);
		if (existing && existing !== tag) throw new Error(`GitHub Release ${tag} references unexpected tag ${existing}.`);
		if (!existing) actions.createRelease(tag, pkg.notes);
		results.push({ name: pkg.name, version: pkg.version, tag, created: !existing });
	}
	return results;
}

function optionValue(args, option) {
	const index = args.indexOf(option);
	return index < 0 ? null : args[index + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const args = process.argv.slice(2);
		const planPath = optionValue(args, '--plan');
		const candidatesPath = optionValue(args, '--candidates');
		const commit = optionValue(args, '--commit') ?? process.env.GITHUB_SHA;
		if (!planPath || !candidatesPath || !commit) {
			throw new Error('Usage: finalize-releases.mjs --plan <file> --candidates <file> --commit <sha>');
		}
		const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
		const candidates = JSON.parse(readFileSync(resolve(candidatesPath), 'utf8'));
		const results = finalizeReleases({ plan, candidates, commit });
		for (const result of results) console.log(`${result.created ? 'Created' : 'Verified'} GitHub Release ${result.tag}`);
	} catch (error) {
		console.error(`Stable release finalization failed: ${error.message}`);
		process.exitCode = 1;
	}
}
