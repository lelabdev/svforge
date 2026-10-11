#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE_PATH = '.changeset/release-candidates.json';

function runGit(args, root = ROOT) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function manifestAt(root, revision, path) {
	try {
		return JSON.parse(runGit(['show', `${revision}:${path}`], root));
	} catch (error) {
		if (error.status === 128) return null;
		throw error;
	}
}

export function buildReleaseCandidates(plan, commit, root = ROOT, git = runGit, headCommit = null) {
	if (!plan || !Array.isArray(plan.packages) || !commit) {
		throw new Error('Cannot identify stable release candidates without a release plan and merge commit.');
	}
	const manifestPath = join(root, CANDIDATE_PATH);
	if (!existsSync(manifestPath)) {
		throw new Error(`Missing ${CANDIDATE_PATH}; regenerate the human-reviewed Version Packages PR before publishing.`);
	}
	const candidateManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	if (candidateManifest.schemaVersion !== 1 || !Array.isArray(candidateManifest.packages)) {
		throw new Error(`${CANDIDATE_PATH} has an unsupported schema.`);
	}

	let base = git(['rev-parse', `${commit}^1`], root);
	if (headCommit) {
		try {
			const mergeBase = git(['merge-base', commit, headCommit], root);
			if (mergeBase !== commit) base = mergeBase;
		} catch {
			// A source branch can be deleted after merge; the merge commit's first
			// parent remains a safe fallback for the package-version diff.
		}
	}
	const changedManifests = git([
		'diff', '--name-only', base, commit, '--', 'packages/*/package.json'
	], root).split('\n').filter(Boolean);
	const planByName = new Map(plan.packages.map((pkg) => [pkg.name, pkg]));
	const candidatesByName = new Map();

	for (const candidate of candidateManifest.packages) {
		const planned = planByName.get(candidate.name);
		if (!planned || planned.version !== candidate.version || planned.directory !== candidate.directory) {
			throw new Error(`Candidate ${candidate.name}@${candidate.version} does not match the release plan.`);
		}
		if (!planned.registry || typeof planned.registry.published !== 'boolean') {
			throw new Error(`Release plan has no registry state for ${candidate.name}@${candidate.version}.`);
		}
		if (candidatesByName.has(candidate.name)) throw new Error(`Duplicate release candidate: ${candidate.name}.`);
		candidatesByName.set(candidate.name, candidate);
	}

	for (const path of changedManifests) {
		const currentPath = join(root, path);
		if (!existsSync(currentPath)) continue;
		const current = JSON.parse(readFileSync(currentPath, 'utf8'));
		const previous = manifestAt(root, base, path);
		if (previous?.version === current.version) continue;
		const candidate = candidatesByName.get(current.name);
		if (!candidate || candidate.version !== current.version) {
			throw new Error(`Changed package version ${current.name}@${current.version} is missing from ${CANDIDATE_PATH}.`);
		}
	}

	const unselectedUnpublished = plan.packages
		.filter((pkg) => pkg.registry?.published === false && !candidatesByName.has(pkg.name))
		.map((pkg) => `${pkg.name}@${pkg.version}`);
	if (unselectedUnpublished.length) {
		throw new Error(
			`Changesets would publish versions missing from the reviewed candidate manifest: ${unselectedUnpublished.join(', ')}.`
		);
	}
	if (!candidatesByName.size) throw new Error('The reviewed Version Packages PR contains no stable release candidates.');

	return {
		commit,
		packages: plan.packages
			.filter((pkg) => candidatesByName.has(pkg.name))
			.map((pkg) => candidatesByName.get(pkg.name))
	};
}

function optionValue(args, option) {
	const index = args.indexOf(option);
	return index < 0 ? null : args[index + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const args = process.argv.slice(2);
		const planPath = optionValue(args, '--plan');
		const commit = optionValue(args, '--commit') ?? process.env.GITHUB_SHA;
		const headCommit = optionValue(args, '--head');
		const output = optionValue(args, '--output');
		if (!planPath || !commit || !output) throw new Error('Usage: release-candidates.mjs --plan <file> --commit <sha> --output <file>');
		const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
		const candidates = buildReleaseCandidates(plan, commit, ROOT, runGit, headCommit);
		writeFileSync(resolve(output), `${JSON.stringify(candidates, null, 2)}\n`);
		console.log(`Validated ${candidates.packages.length} reviewed stable release candidate(s).`);
	} catch (error) {
		console.error(`Release candidate validation failed: ${error.message}`);
		process.exitCode = 1;
	}
}
