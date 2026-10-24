#!/usr/bin/env node
/**
 * Translate an affected-scope report into the concrete CI work for this run
 * (#570 phase B).
 *
 * Deliberately conservative activation:
 * - documentation/artifact-only → skip build and tests (mandatory repository
 *   guards lint/typecheck/audit/generated-manifest still run);
 * - tests-only → build everything (a changed test may import a built package),
 *   run only the changed test files;
 * - workspace changes → FULL build + FULL tests by default; the
 *   `ci:targeted` opt-in selects the TESTS only and still builds every
 *   workspace (repository guards inspect all `dist/` outputs);
 * - detector failure / unknown path / release metadata / root config force a
 *   full scope in the resolver already, so this module never narrows them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {object} scope affected-scope JSON */
export function planCiSteps(scope, { targeted = false } = {}) {
	if (scope?.global) {
		return { mode: 'full', build: 'all', buildDirs: [], tests: 'all', testFiles: [], reason: scope.fallback ? 'detector failure → full' : 'full-scope change' };
	}
	const tests = scope?.tests ?? { mode: 'none', files: [] };
	if (scope?.docsOnly) {
		return { mode: 'none', build: 'none', buildDirs: [], tests: 'none', testFiles: [], reason: 'documentation/artifact-only' };
	}
	if ((scope?.packages ?? []).length === 0) {
		if (tests.files.length === 0) {
			return { mode: 'none', build: 'none', buildDirs: [], tests: 'none', testFiles: [], reason: 'no workspace or test selected' };
		}
		return { mode: 'tests', build: 'all', buildDirs: [], tests: 'selected', testFiles: tests.files, reason: 'tests-only change' };
	}
	if (!targeted) {
		return {
			mode: 'targeted',
			build: 'all',
			buildDirs: [],
			tests: 'all',
			testFiles: [],
			reason: 'workspace change: full validation until ci:targeted opt-in'
		};
	}
	// Measured on a real PR (#570 phase C): scoping the BUILD to the affected
	// closure fails repository tests that inspect every workspace's `dist/`
	// (structure/cli-create addon inventory, package-entry). Target only the
	// tests; the build stays complete so those guards remain meaningful.
	return {
		mode: 'targeted',
		build: 'all',
		buildDirs: [],
		tests: tests.files.length > 0 ? 'selected' : 'all',
		testFiles: tests.files,
		reason: 'workspace change: ci:targeted opt-in (tests only; full build)'
	};
}

/** GitHub Actions outputs (space-joined lists; repository paths contain no spaces). */
export function renderGithubOutputs(plan) {
	return [
		`mode=${plan.mode}`,
		`build=${plan.build}`,
		`build_dirs=${plan.buildDirs.join(' ')}`,
		`tests=${plan.tests}`,
		`test_files=${plan.testFiles.join(' ')}`,
		`reason=${plan.reason.replace(/\n/g, ' ')}`,
		''
	].join('\n');
}

function parseArgs(argv) {
	const options = { scope: null, githubOutput: null, targeted: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--scope') options.scope = argv[++index];
		else if (arg === '--github-output') options.githubOutput = argv[++index];
		else if (arg === '--targeted') {
			const value = argv[++index];
			options.targeted = value === '1' || value === 'true';
		}
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!options.scope) throw new Error('Missing required --scope <file>.');
	return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const scope = JSON.parse(readFileSync(options.scope, 'utf8'));
		const plan = planCiSteps(scope, { targeted: options.targeted });
		console.log(`CI scope: mode=${plan.mode} build=${plan.build} tests=${plan.tests} — ${plan.reason}`);
		if (options.githubOutput) writeFileSync(options.githubOutput, renderGithubOutputs(plan), { flag: 'a' });
	} catch (error) {
		console.error(`affected-step: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 2;
	}
}
