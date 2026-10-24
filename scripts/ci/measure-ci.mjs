#!/usr/bin/env node
/**
 * Reproducible CI measurement helper (#570 phase C).
 *
 * Compares GitHub Actions runs of the CI workflow (full vs `ci:targeted`) for a
 * PR or a list of run ids: scope mode (parsed from the run log), job/step
 * durations and totals. Used to collect before/after evidence before any
 * default selection is enabled; it never triggers, re-runs or cancels a run.
 *
 * Usage:
 *   node scripts/ci/measure-ci.mjs --pr <number> [--json] [--markdown]
 *   node scripts/ci/measure-ci.mjs --run <id> [--run <id> ...] [--json|--markdown]
 *
 * Requires the `gh` CLI (authenticated) for the network commands; the parsing
 * and summary helpers are pure and fixture-tested.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Extract the scope mode printed by the "Report affected scope" step. */
export function parseScope(log) {
	const match = String(log ?? '').match(/CI scope: mode=(\w+) build=(\w+) tests=(\w+)/);
	if (!match) return null;
	return { mode: match[1], build: match[2], tests: match[3] };
}

function seconds(startedAt, completedAt) {
	if (!startedAt || !completedAt) return null;
	const ms = Date.parse(completedAt) - Date.parse(startedAt);
	return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : null;
}

/** Duration of the first step whose name matches, across all jobs of a run. */
export function stepSeconds(jobs, namePattern) {
	for (const job of jobs ?? []) {
		for (const step of job.steps ?? []) {
			if (!namePattern.test(step.name ?? '')) continue;
			const duration = seconds(step.started_at, step.completed_at);
			if (duration !== null) return duration;
		}
	}
	return null;
}

/** Summarize one run: scope, job durations, build/test step durations, total. */
export function summarizeRun({ run, jobs, log }) {
	const scope = parseScope(log);
	const jobDurations = {};
	for (const job of jobs ?? []) {
		const duration = seconds(job.started_at, job.completed_at);
		if (duration !== null) jobDurations[job.name] = duration;
	}
	const total = Object.values(jobDurations).reduce((sum, value) => sum + value, 0);
	return {
		runId: run.databaseId ?? run.id ?? null,
		sha: (run.headSha ?? run.head_sha ?? '').slice(0, 7),
		event: run.event ?? null,
		conclusion: run.conclusion ?? null,
		scope: scope ?? { mode: 'unknown', build: 'unknown', tests: 'unknown' },
		qualitySeconds: jobDurations.quality ?? null,
		buildSeconds: stepSeconds(jobs, /^Build packages$/),
		testSeconds: stepSeconds(jobs, /^Run tests$/),
		totalSeconds: Math.round(total * 10) / 10,
		jobs: jobDurations
	};
}

export function formatMarkdown(rows) {
	const lines = [
		'| Run | SHA | Scope | Quality | Build step | Test step | All jobs |',
		'| --- | --- | --- | --- | --- | --- | --- |'
	];
	for (const row of rows) {
		const fmt = (value) => (value === null || value === undefined ? '—' : `${value}s`);
		lines.push(
			`| ${row.runId} | \`${row.sha}\` | ${row.scope.mode} (${row.scope.build}/${row.scope.tests}) | ${fmt(row.qualitySeconds)} | ${fmt(row.buildSeconds)} | ${fmt(row.testSeconds)} | ${fmt(row.totalSeconds)} |`
		);
	}
	return `${lines.join('\n')}\n`;
}

function gh(args) {
	return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function repoSlug() {
	return gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
}

function fetchJobs(runId) {
	const payload = JSON.parse(gh(['api', `repos/${repoSlug()}/actions/runs/${runId}/jobs`]));
	return payload.jobs ?? [];
}

function fetchLog(runId) {
	try {
		return gh(['run', 'view', String(runId), '--log']);
	} catch {
		return '';
	}
}

function runsForPr(pr) {
	const view = JSON.parse(gh(['pr', 'view', String(pr), '--json', 'headRefName,headRefOid']));
	const list = JSON.parse(
		gh(['run', 'list', '--branch', view.headRefName, '--workflow', 'CI', '--limit', '20', '--json', 'databaseId,headSha,createdAt,conclusion,event,workflowName'])
	);
	return list.filter((run) => run.workflowName === 'CI').slice().reverse();
}

function parseArgs(argv) {
	const options = { pr: null, runs: [], json: false, markdown: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--pr') options.pr = argv[++index];
		else if (arg === '--run') options.runs.push(argv[++index]);
		else if (arg === '--json') options.json = true;
		else if (arg === '--markdown') options.markdown = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!options.pr && options.runs.length === 0) throw new Error('Pass --pr <number> or --run <id>.');
	return options;
}

export function collect({ pr, runs = [] }) {
	const selected = pr
		? runsForPr(pr)
		: runs.map((id) => ({ databaseId: Number(id) }));
	return selected.map((run) => {
		const runId = run.databaseId ?? run.id;
		return summarizeRun({ run, jobs: fetchJobs(runId), log: fetchLog(runId) });
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const rows = collect({ pr: options.pr, runs: options.runs });
		if (options.json) console.log(JSON.stringify(rows, null, 2));
		else if (options.markdown) process.stdout.write(formatMarkdown(rows));
		else {
			for (const row of rows) {
				console.log(
					`${row.runId} ${row.scope.mode} (${row.scope.build}/${row.scope.tests}) quality=${row.qualitySeconds}s build=${row.buildSeconds}s tests=${row.testSeconds}s total=${row.totalSeconds}s`
				);
			}
		}
	} catch (error) {
		console.error(`measure-ci: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 2;
	}
}
