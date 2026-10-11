import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const workflow = readFileSync(join(ROOT, '.github/workflows/publish.yml'), 'utf8');
const canary = workflow.slice(workflow.indexOf('\n  canary:\n'));

describe('tokenless npm canary publishing (#572)', () => {
	it('uses the same trusted publisher workflow as the stable release', () => {
		expect(canary).toContain("inputs.channel == 'canary'");
		expect(canary).toContain("inputs.confirmation == 'publish-canary'");
		expect(canary).toContain("github.ref == 'refs/heads/main'");
		expect(canary).toContain('id-token: write');
		expect(canary).toContain('npm install --global npm@11.21.0');
		expect(workflow).toContain("inputs.channel == 'stable'");
		expect(workflow).not.toContain('NPM_TOKEN');
		expect(workflow).not.toContain('NODE_AUTH_TOKEN');
		expect(workflow).not.toContain('npm whoami');
		expect(existsSync(join(ROOT, '.github/workflows/canary-snapshots.yml'))).toBe(false);
	});

	it('requires packed and published consumer validation before modifying the canary tag', () => {
		const prepack = canary.indexOf('Pack exact snapshot candidates');
		const publish = canary.indexOf('Publish immutable snapshots to the per-run staging tag');
		const consumer = canary.indexOf('Post-publish exact-version consumer install');
		const goldenPath = canary.indexOf('Post-publish golden path with exact compatibility versions');
		const promote = canary.indexOf('Promote validated snapshots to the canary dist-tag');
		expect(prepack).toBeGreaterThan(-1);
		expect(publish).toBeGreaterThan(prepack);
		expect(consumer).toBeGreaterThan(publish);
		expect(goldenPath).toBeGreaterThan(consumer);
		expect(promote).toBeGreaterThan(goldenPath);
		expect(canary).toContain('canary-run-${GITHUB_RUN_ID}');
		expect(canary).not.toContain('--tag latest');
	});
});
