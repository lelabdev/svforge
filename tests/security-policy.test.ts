import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();

describe('security policy (#352)', () => {
	const policy = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
	const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

	it('exists at the GitHub-recognized repository root', () => {
		expect(policy).toBeTruthy();
	});

	it('routes reporters to GitHub private vulnerability reporting, never public issues', () => {
		expect(policy).toContain('https://github.com/lelabdev/svforge/security/advisories/new');
		expect(policy).toMatch(/Do NOT open a public GitHub issue/i);
	});

	it('keeps obsolete GitHub repository URLs out of tracked sources', () => {
		const obsoleteRepository = 'github.com/lelabdev/' + 'svelteforge';
		const result = spawnSync(
			'git',
			['grep', '-n', obsoleteRepository, '--', '.', ':!tests/security-policy.test.ts'],
			{ cwd: ROOT, encoding: 'utf8' }
		);

		expect(result.status).toBe(1);
		expect(result.stdout).toBe('');
	});

	it('declares supported versions explicitly and without contradiction', () => {
		expect(policy).toMatch(/Supported/);
		// Pre-1.0 published versions are evaluation-only; main is the supported line.
		expect(policy).toMatch(/pre-1\.0/);
		expect(policy).toMatch(/evaluation only[\s\S]*no security fixes/i);
		// From 1.0 onward, the latest published version is supported.
		expect(policy).toMatch(/latest published version/);
	});

	it('does not depend on an implicitly-enabled GitHub feature for the private route', () => {
		expect(policy).toMatch(/Settings → Code security/);
		expect(policy).toMatch(/currently\s+\*\*enabled\*\*/i);
		expect(policy).toMatch(/If that route is ever unavailable/i);
	});

	it('sets acknowledgement, update, and fix targets', () => {
		expect(policy).toMatch(/72 hours/);
		expect(policy).toMatch(/every 7 days/);
		expect(policy).toMatch(/≤ 30 days/);
		expect(policy).toMatch(/90 days/);
	});

	it('covers coordinated disclosure and safe harbor', () => {
		expect(policy).toMatch(/coordinated disclosure/i);
		expect(policy).toMatch(/safe harbor/i);
	});

	it('guides on leaked credentials and generated-project vulnerabilities', () => {
		expect(policy).toMatch(/Leaked credentials and secrets/i);
		expect(policy).toMatch(/Vulnerabilities affecting generated projects/i);
		expect(policy).toMatch(/report here/);
		expect(policy).toMatch(/not[\s\S]*an SVForge issue/);
	});

	it('is linked from the README before packages are broadly published', () => {
		expect(readme).toContain('## Security');
		expect(readme).toContain('SECURITY.md');
		expect(readme).toContain('security/advisories/new');
	});
});
