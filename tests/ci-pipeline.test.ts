import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const readWorkflow = (file: string) => readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8');

const ci = readWorkflow('ci.yml');
const publish = readWorkflow('publish.yml');
const canary = readWorkflow('canary.yml');

const SCAFFOLD_PROFILES = [
	'base',
	'dashboard',
	'dashboard-playwright',
	'base-blog',
	'base-modules',
	'dashboard-foundations',
	'base-ui-modules',
	'dashboard-integrations',
	'create-cli'
];

describe('CI pipeline split (#413): fast PR CI, full release gate', () => {
	it('runs only the fast guards on every pull request', () => {
		expect(ci).toContain('bun run lint');
		expect(ci).toContain('bun run typecheck');
		expect(ci).toContain('bun run audit');
		expect(ci).toContain('scripts/better-auth-audit.mjs');
		expect(ci).toContain('scripts/check-generated.mjs');
		expect(ci).toContain("bun run --filter '*' build");
		expect(ci).toContain('bun x vitest run');
	});

	it('provisions no PostgreSQL and runs no user journey on pull requests', () => {
		expect(ci).not.toContain('POSTGRES_');
		expect(ci).not.toMatch(/postgres:1[0-9]/);
		expect(ci).not.toMatch(/^\s*services:/m);
		expect(ci).not.toContain('test-user-journey.sh');
	});

	it('runs exactly one representative scaffold, only after a merge to main', () => {
		const gate = ci.indexOf("github.ref == 'refs/heads/main'");
		const scaffolds = [...ci.matchAll(/test-scaffold\.sh\s+(\S+)/g)].map((match) => match[1]);

		expect(scaffolds).toEqual(['base']);
		// The only scaffold step sits after the `main` push gate.
		expect(gate).toBeGreaterThan(-1);
		expect(ci.indexOf('test-scaffold.sh')).toBeGreaterThan(gate);
	});

	it('cancels superseded runs per pull request', () => {
		expect(ci).toContain('group: ci-${{ github.event.pull_request.number || github.ref }}');
		expect(ci).toContain('cancel-in-progress: true');
	});

	it('makes the release the superset: quality + full scaffold matrix + user journey', () => {
		for (const profile of SCAFFOLD_PROFILES) {
			expect(publish, profile).toMatch(new RegExp(`^\\s*- ${profile}$`, 'm'));
		}
		expect(publish).toContain('bash scripts/test-scaffold.sh ${{ matrix.scaffold }}');
		expect(publish).toContain('bash scripts/test-user-journey.sh');
		expect(publish).toContain('POSTGRES_DB: sf_dashboard_test');
		expect(publish).toContain('bash scripts/test-user-journey.sh --published "$VERSION"');
		expect(publish).toContain('node scripts/npm-consumer-smoke.mjs');
	});

	it('blocks the publish job on all three release gates', () => {
		expect(publish).toMatch(/needs:\s*\[quality, scaffolds, user-journey\]/);
	});

	it('keeps the canary independent on the latest ecosystem', () => {
		expect(canary).toContain('bun-version: latest');
		expect(canary).toContain('scripts/canary-issue.mjs');
	});
});
