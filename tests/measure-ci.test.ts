import { describe, expect, it } from 'vitest';
import { formatMarkdown, parseScope, stepSeconds, summarizeRun } from '../scripts/ci/measure-ci.mjs';

/**
 * #570 phase C — reproducible CI measurement helper.
 *
 * Parsing/summarizing is pure and fixture-tested; the CLI only adds `gh`
 * network calls, so measurements can be reproduced without trusting a prose
 * report.
 */
const jobs = [
	{
		name: 'quality',
		started_at: '2026-10-24T10:00:00Z',
		completed_at: '2026-10-24T10:03:00Z',
		steps: [
			{ name: 'Build packages', started_at: '2026-10-24T10:01:00Z', completed_at: '2026-10-24T10:01:40Z' },
			{ name: 'Run tests', started_at: '2026-10-24T10:01:40Z', completed_at: '2026-10-24T10:02:40Z' }
		]
	},
	{
		name: 'docker-builder',
		started_at: '2026-10-24T10:00:10Z',
		completed_at: '2026-10-24T10:00:16Z',
		steps: []
	}
];

describe('CI scope parsing and durations (#570 phase C)', () => {
	it('reads the scope line printed by the report step, in full or targeted mode', () => {
		expect(parseScope('noise\nCI scope: mode=targeted build=selected tests=selected\nmore')).toEqual({
			mode: 'targeted',
			build: 'selected',
			tests: 'selected'
		});
		expect(parseScope('CI scope: mode=full build=all tests=all')).toEqual({ mode: 'full', build: 'all', tests: 'all' });
		expect(parseScope('no scope line')).toBeNull();
	});

	it('computes step and job durations from the Actions payload', () => {
		expect(stepSeconds(jobs, /^Build packages$/)).toBe(40);
		expect(stepSeconds(jobs, /^Run tests$/)).toBe(60);
		expect(stepSeconds(jobs, /^Missing$/)).toBeNull();
	});

	it('summarizes a run with scope, job durations, build/test steps and totals', () => {
		const summary = summarizeRun({
			run: { databaseId: 123, headSha: 'abcdef1234567', event: 'pull_request', conclusion: 'success' },
			jobs,
			log: 'CI scope: mode=targeted build=selected tests=selected'
		});
		expect(summary).toMatchObject({
			runId: 123,
			sha: 'abcdef1',
			scope: { mode: 'targeted', build: 'selected', tests: 'selected' },
			qualitySeconds: 180,
			buildSeconds: 40,
			testSeconds: 60,
			totalSeconds: 186
		});
	});

	it('renders a markdown table for the issue/PR report', () => {
		const summary = summarizeRun({ run: { databaseId: 1, headSha: 'abc1234' }, jobs, log: 'CI scope: mode=full build=all tests=all' });
		const markdown = formatMarkdown([summary]);
		expect(markdown).toContain('| Run | SHA | Scope |');
		expect(markdown).toContain('full (all/all)');
		expect(markdown).toContain('180s');
		expect(markdown).toContain('186s');
	});
});
