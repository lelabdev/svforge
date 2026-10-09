import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

const workflowFiles = readdirSync(WORKFLOWS).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));

describe('Better Auth upgrades are manual and CI-validated (#460)', () => {
	it('removes the dedicated better-auth automation workflow', () => {
		expect(existsSync(join(WORKFLOWS, 'better-auth-upgrade.yml'))).toBe(false);
	});

	it('keeps no cron, auto-publication or PAT machinery for better-auth', () => {
		for (const file of workflowFiles) {
			const content = readFileSync(join(WORKFLOWS, file), 'utf8');
			expect(content, file).not.toContain('BETTER_AUTH_UPGRADE_TOKEN');
			expect(content, file).not.toMatch(/bot\/better-auth/);
		}
	});

	it('validates an intentional bump in the normal CI path', () => {
		const ci = readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8');
		const publish = readFileSync(join(WORKFLOWS, 'publish.yml'), 'utf8');

		// schema/runtime smoke (release gate: scaffolds left PR CI in #413)
		expect(publish).toMatch(/^\s*- dashboard$/m);
		expect(publish).toContain('bash scripts/test-scaffold.sh ${{ matrix.scaffold }}');
		// vulnerability audit of the pinned better-auth stack (fast PR guard)
		expect(ci).toContain('scripts/better-auth-audit.mjs');
		// repository tests carry the pin drift guards
		expect(ci).toContain('bun x vitest run');
	});

	it('keeps the reusable drift/audit tooling', () => {
		for (const rel of [
			'scripts/better-auth-upgrade.mjs',
			'scripts/better-auth-audit.mjs',
			'tests/better-auth-upgrade.test.ts',
			'tests/better-auth-audit.test.ts'
		]) {
			expect(existsSync(join(ROOT, rel)), rel).toBe(true);
		}
	});

	it('documents the manual bump + CI validation policy', () => {
		const doc = readFileSync(join(ROOT, 'docs', 'better-auth-upgrades.md'), 'utf8');
		expect(doc).toMatch(/manual/i);
		// The old policy's scheduled/automatic publication must be gone.
		expect(doc).not.toMatch(/auto-?pr|automatically|weekly cron|daily cron/i);

	});
});
