import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const workflow = readFileSync(join(root, '.github/workflows/publish.yml'), 'utf8');
const regularBaseline = JSON.parse(readFileSync(join(root, 'docs/audit-baseline.json'), 'utf8'));
const recoveryWaivers = JSON.parse(readFileSync(join(root, 'docs/release-615-audit-waivers.json'), 'utf8'));
const releaseCommit = '44f726cf4bc45d90ad558b01777bb8335d538f92';
const expectedAdvisories = ['GHSA-qxg6-89mg-rqv8', 'GHSA-xp26-3454-mjgp'].sort();

describe('scoped audit exceptions for immutable release #615 (#623)', () => {
	it('limits the release quality override to the exact already-published commit', () => {
		const start = workflow.indexOf('  quality:');
		const end = workflow.indexOf('  scaffolds:', start);
		const quality = workflow.slice(start, end);
		expect(start).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(start);
		expect(quality).toContain(`if: needs.authorize-release.outputs.release_commit == '${releaseCommit}'`);
		expect(quality).toContain('git show "${{ github.sha }}:docs/release-615-audit-waivers.json"');
		expect(quality).toContain('jq -s');
		expect(quality.indexOf('Apply scoped audit waivers')).toBeLessThan(
			quality.indexOf('name: Dependency audit (OSV)')
		);
		expect(quality).toContain('run: bun run audit');
		// No changes to audit enforcement on the main branch.
		const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
		expect(ci).toContain('run: bun run audit');
	});

	it('waives exactly two dev-only mocker advisories with explicit justifications', () => {
		expect(recoveryWaivers).toHaveLength(2);
		expect(recoveryWaivers.map((w: { advisory: string }) => w.advisory).sort()).toEqual(expectedAdvisories);
		for (const waiver of recoveryWaivers) {
			expect(waiver.package).toBe('@vitest/mocker');
			expect(waiver.version).toBe('5.0.0');
			expect(waiver.path).toBe('@vitest/mocker');
			expect(waiver.reason).toContain(releaseCommit);
			expect(waiver.reason).toMatch(/development|dev(\W|$)/i);
			expect(waiver.reason).not.toMatch(/^TODO\b/);
		}
		expect(regularBaseline).not.toContainEqual(expect.objectContaining({ package: '@vitest/mocker' }));
	});

	it('keeps other advisory, version and path combinations blocking', async () => {
		const { isBaselined } = await import('../scripts/audit.mjs');
		const finding = {
			name: '@vitest/mocker', version: '5.0.0', path: '@vitest/mocker',
			ids: ['GHSA-qxg6-89mg-rqv8']
		};
		const combined = [...regularBaseline, ...recoveryWaivers];
		expect(isBaselined(finding, combined)).toBe(true);
		expect(isBaselined({ ...finding, version: '5.0.1' }, combined)).toBe(false);
		expect(isBaselined({ ...finding, path: 'another-path' }, combined)).toBe(false);
		expect(isBaselined({ ...finding, ids: ['GHSA-new-advisory'] }, combined)).toBe(false);
		expect(isBaselined(finding, regularBaseline)).toBe(false);
	});
});
