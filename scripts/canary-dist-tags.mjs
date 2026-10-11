#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @typedef {{ status: number | null, stdout: string, stderr: string }} NpmResult */
/** @typedef {(args: string[]) => NpmResult} NpmRunner */

/** @param {string[]} args @returns {NpmResult} */
function runNpm(args) {
	const result = spawnSync('npm', args, { encoding: 'utf8' });
	if (result.error) throw result.error;
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** @param {NpmRunner} npm @param {string[]} args */
function runChecked(npm, args) {
	const result = npm(args);
	if (result.status !== 0) {
		throw new Error(`npm ${args.join(' ')} failed: ${`${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()}`);
	}
	return result;
}

function parseJsonOutput(result, label) {
	try {
		return JSON.parse(result.stdout || '{}');
	} catch (error) {
		throw new Error(`Could not parse npm ${label} response: ${result.stdout}`, { cause: error });
	}
}

/** @param {{ name: string }} pkg @param {string} tag @param {NpmRunner} npm */
function currentDistTag(pkg, tag, npm) {
	const result = npm(['view', pkg.name, 'dist-tags', '--json']);
	if (result.status !== 0) {
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		if (/E404|404 Not Found|is not in this registry/i.test(output)) return null;
		throw new Error(`Could not read ${tag} dist-tag for ${pkg.name}: ${output.trim()}`);
	}
	return parseJsonOutput(result, `${pkg.name} dist-tags`)[tag] ?? null;
}

function assertPlan(plan) {
	if (!Array.isArray(plan.candidates) || plan.candidates.length === 0 || !plan.stagingDistTag || plan.distTag !== 'canary') {
		throw new Error('Canary dist-tags: invalid or empty canary plan.');
	}
	for (const pkg of plan.candidates) {
		if (!pkg.snapshot || !pkg.name || !pkg.version || !pkg.version.includes(plan.snapshotTag)) {
			throw new Error(`Canary dist-tags: invalid snapshot candidate ${pkg.name ?? '(unnamed)'}.`);
		}
	}
}

/** Reapply the unique staging tag on retry, including when Changesets skipped an already-published version. */
/** @param {any} plan @param {NpmRunner} [npm] */
export function ensureCanaryStagingTags(plan, npm = runNpm) {
	assertPlan(plan);
	for (const pkg of plan.candidates) {
		runChecked(npm, ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, plan.stagingDistTag]);
	}
}

/** Promote only after exact-version consumer checks pass; restore the prior canary map on any partial failure. */
/** @param {any} plan @param {NpmRunner} [npm] */
export function promoteCanaryDistTag(plan, npm = runNpm) {
	assertPlan(plan);
	for (const pkg of plan.candidates) {
		const result = npm(['view', `${pkg.name}@${pkg.version}`, 'version', '--json']);
		if (result.status !== 0 || result.stdout.trim().replace(/^['"]|['"]$/g, '') !== pkg.version) {
			throw new Error(`Canary dist-tags: refusing to promote unpublished ${pkg.name}@${pkg.version}.`);
		}
	}

	const previous = new Map(plan.candidates.map((pkg) => [pkg.name, currentDistTag(pkg, 'canary', npm)]));
	// Workflow concurrency prevents simultaneous writes but does not guarantee
	// dispatch order. A delayed or retried older run must never roll back a
	// newer validated canary release.
	for (const pkg of plan.candidates) {
		const current = previous.get(pkg.name);
		const existingRun = current?.match(/^0\.0\.0-canary-[0-9a-f]{12}-(\d+)$/);
		if (existingRun && BigInt(existingRun[1]) > BigInt(plan.runId)) {
			throw new Error(`Canary dist-tags: refusing to replace newer canary ${pkg.name}@${current} with older run ${plan.runId}.`);
		}
	}
	try {
		for (const pkg of plan.candidates) {
			runChecked(npm, ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, 'canary']);
		}
	} catch (error) {
		const rollbackErrors = [];
		for (const pkg of plan.candidates) {
			const version = previous.get(pkg.name);
			try {
				if (version) {
					runChecked(npm, ['dist-tag', 'add', `${pkg.name}@${version}`, 'canary']);
				} else if (currentDistTag(pkg, 'canary', npm) !== null) {
					runChecked(npm, ['dist-tag', 'rm', pkg.name, 'canary']);
				}
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError.message);
			}
		}
		if (rollbackErrors.length) {
			throw new Error(`${error.message}\nCanary dist-tag rollback was incomplete: ${rollbackErrors.join('; ')}`, { cause: error });
		}
		throw new Error(`Canary dist-tag promotion failed; previous canary tags were restored: ${error.message}`, { cause: error });
	}
}

/** Remove the per-run staging tag; it never aliases npm's stable `latest` tag. */
/** @param {any} plan @param {NpmRunner} [npm] */
export function removeCanaryStagingTags(plan, npm = runNpm) {
	assertPlan(plan);
	const errors = [];
	for (const pkg of plan.candidates) {
		if (currentDistTag(pkg, plan.stagingDistTag, npm) === null) continue;
		const result = npm(['dist-tag', 'rm', pkg.name, plan.stagingDistTag]);
		if (result.status !== 0) errors.push(`${pkg.name}: ${`${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()}`);
	}
	if (errors.length) throw new Error(`Could not remove canary staging tags: ${errors.join('; ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [command, ...args] = process.argv.slice(2);
	const planFlag = args.indexOf('--plan');
	if (!['stage', 'promote', 'cleanup'].includes(command) || planFlag === -1 || !args[planFlag + 1]) {
		console.error('Usage: node scripts/canary-dist-tags.mjs <stage|promote|cleanup> --plan <path>');
		process.exitCode = 1;
	} else {
		try {
			const plan = JSON.parse(readFileSync(resolve(args[planFlag + 1]), 'utf8'));
			if (command === 'stage') ensureCanaryStagingTags(plan);
			else if (command === 'promote') promoteCanaryDistTag(plan);
			else removeCanaryStagingTags(plan);
		} catch (error) {
			console.error(`Canary dist-tag ${command} failed: ${error.message}`);
			process.exitCode = 1;
		}
	}
}
