#!/usr/bin/env node
/**
 * Decide whether the reusable Docker builder (#606) must be validated.
 *
 * The builder has exactly three inputs: `docker/**`, the Dockerfile's pinned
 * lockfile (inside `docker/`), and the Dashboard package manifest it is
 * generated from. Rebuilding the ~1.1 GB image for unrelated changes wastes CI
 * minutes, so both pull requests and pushes classify the changed files through
 * this one function.
 *
 * Usage:
 *   node scripts/docker-builder-changed.mjs --files-from -     # newline paths
 *   node scripts/docker-builder-changed.mjs --base <ref> --head <ref>
 *
 * Prints `true` or `false` on stdout and always exits 0: the workflow decides
 * what to do with the answer, and a classification problem must never fail the
 * build silently in the "skip" direction.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Paths whose change invalidates the builder image. */
export const BUILDER_INPUTS = [
	// docker/builder.Dockerfile, docker/builder.bun.lock, docker/README.md,
	// docker/builder-smoke.sh and any future docker/ input.
	/^docker\//,
	// The only manually maintained package list: the Dockerfile copies it and
	// the lockfile is generated from it.
	/^packages\/svforge\/templates\/dashboard\/package\.json$/
];

/** Whether a single repository-relative path affects the builder image. */
export function affectsBuilderImage(file) {
	return BUILDER_INPUTS.some((pattern) => pattern.test(file));
}

/** Whether any of the changed paths affects the builder image. */
export function changesRequireBuilderBuild(files) {
	return files.some(affectsBuilderImage);
}

function changedFilesFromGit(base, head) {
	return execFileSync('git', ['diff', '--name-only', base, head], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	})
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function main(argv) {
	const filesFrom = argv.indexOf('--files-from');
	const baseIndex = argv.indexOf('--base');
	const headIndex = argv.indexOf('--head');

	let files;
	if (filesFrom !== -1) {
		const source = argv[filesFrom + 1];
		if (!source) throw new Error('--files-from requires a path or `-` for stdin.');
		files = (source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8'))
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
	} else if (baseIndex !== -1 && headIndex !== -1) {
		files = changedFilesFromGit(argv[baseIndex + 1], argv[headIndex + 1]);
	} else {
		throw new Error('Use --files-from <path|-> or --base <ref> --head <ref>.');
	}

	process.stdout.write(`${changesRequireBuilderBuild(files)}\n`);
}

try {
	main(process.argv.slice(2));
} catch (error) {
	// Fail loudly in CI logs but keep the workflow decision conservative: an
	// unclassifiable diff means "build", never "skip".
	console.error(`docker-builder-changed: ${error.message}`);
	process.stdout.write('true\n');
}
