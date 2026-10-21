import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(join(process.cwd(), '.github/workflows/publish.yml'), 'utf8');

/** A routine PR merge must never publish npm packages (#616). */
describe('explicit release authorization (#616)', () => {
	it('has no PR close, push or merge trigger', () => {
		const triggers = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'));
		expect(triggers).toContain('workflow_dispatch:');
		expect(triggers).not.toMatch(/^\s+(pull_request|push):/m);
	});

	it('requires a manual stable dispatch with the exact confirmation on main', () => {
		const auth = workflow.slice(workflow.indexOf('  authorize-release:'), workflow.indexOf('  quality:'));
		expect(auth).toContain("github.event_name == 'workflow_dispatch'");
		expect(auth).toContain("github.repository == 'lelabdev/svforge'");
		expect(auth).toContain("github.ref == 'refs/heads/main'");
		expect(auth).toContain("inputs.channel == 'stable'");
		expect(auth).toContain("inputs.confirmation == 'publish-stable'");
		expect(auth).toContain('PR_NUMBER: ${{ inputs.release_pr }}');
		expect(auth).toContain('.merged == true');
		expect(auth).toContain('git merge-base --is-ancestor "$COMMIT" origin/main');
		expect(auth).toContain('release_commit=$COMMIT');
	});

	it('gates all stable jobs on successful authorization', () => {
		for (const job of ['quality', 'scaffolds', 'user-journey', 'publish']) {
			const start = workflow.indexOf(`  ${job}:\n`);
			const block = workflow.slice(start, start + 240);
			expect(start, `Missing job ${job}`).toBeGreaterThan(0);
			expect(block, `Missing authorization dependency in ${job}`).toMatch(
				/needs:\s*(?:authorize-release|\[authorize-release,[^\]]*\])/
			);
		}
	});

	it('keeps manual canary publication separately confirmed', () => {
		const canary = workflow.slice(workflow.indexOf('  canary:'));
		expect(canary).toContain("github.event_name == 'workflow_dispatch'");
		expect(canary).toContain("github.ref == 'refs/heads/main'");
		expect(canary).toContain("inputs.channel == 'canary'");
		expect(canary).toContain("inputs.confirmation == 'publish-canary'");
	});
});
