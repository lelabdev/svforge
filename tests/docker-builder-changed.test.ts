import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	affectsBuilderImage,
	changesRequireBuilderBuild
} from '../scripts/docker-builder-changed.mjs';

const ROOT = process.cwd();
const SCRIPT = resolve('scripts/docker-builder-changed.mjs');

/**
 * #607 review — the reusable builder image has three inputs: `docker/**`, the
 * pinned lockfile living there, and the Dashboard package manifest the lock is
 * generated from. Both pull requests and pushes must classify the changed files
 * instead of rebuilding ~1.1 GB for unrelated work.
 */
describe('Docker builder input classification (#607)', () => {
	it.each([
		'docker/builder.Dockerfile',
		'docker/builder.bun.lock',
		'docker/README.md',
		'docker/builder-smoke.sh',
		'docker/new-input.txt',
		'packages/svforge/templates/dashboard/package.json'
	])('rebuilds for a builder input (%s)', (file) => {
		expect(affectsBuilderImage(file)).toBe(true);
	});

	it.each([
		'README.md',
		'docs/RELEASE.md',
		'packages/svforge/src/index.ts',
		'packages/svforge/templates/dashboard/src/routes/+page.svelte',
		'packages/svforge/templates/base/root/messages/en.json',
		'tests/local-bootstrap.test.ts',
		'scripts/test-scaffold.sh',
		// Same basename, different manifest: the lock only tracks the dashboard.
		'packages/svforge/templates/base/package.json'
	])('skips the rebuild for an unrelated change (%s)', (file) => {
		expect(affectsBuilderImage(file)).toBe(false);
	});

	it('classifies a whole change set from any matching path', () => {
		expect(changesRequireBuilderBuild(['README.md', 'docs/RELEASE.md'])).toBe(false);
		expect(changesRequireBuilderBuild(['README.md', 'docker/builder.bun.lock'])).toBe(true);
		expect(changesRequireBuilderBuild([])).toBe(false);
	});

	it('answers through the CLI for a change list', () => {
		const run = (files: string[]) =>
			spawnSync(process.execPath, [SCRIPT, '--files-from', '-'], {
				encoding: 'utf8',
				input: files.join('\n')
			});

		expect(run(['docker/builder.Dockerfile']).stdout).toBe('true\n');
		expect(run(['docs/RELEASE.md', 'packages/svforge/src/index.ts']).stdout).toBe('false\n');
	});

	it('classifies pushed commit ranges: relevant and unrelated pushes', () => {
		const repo = mkdtempSync(join(tmpdir(), 'svforge-builder-scope-'));
		const git = (...args: string[]) =>
			spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
				cwd: repo,
				encoding: 'utf8'
			});
		const commit = (path: string, content: string) => {
			mkdirSync(dirname(join(repo, path)), { recursive: true });
			writeFileSync(join(repo, path), content);
			git('add', path);
			expect(git('commit', '-q', '-m', `touch ${path}`).status).toBe(0);
			return git('rev-parse', 'HEAD').stdout.trim();
		};
		const classify = (before: string, after: string) =>
			spawnSync(process.execPath, [SCRIPT, '--base', before, '--head', after], {
				cwd: repo,
				encoding: 'utf8'
			});

		try {
			expect(git('init', '-q').status).toBe(0);
			const initial = commit('README.md', '# repo\n');

			// Push touching only documentation/source: the builder is skipped.
			writeFileSync(join(repo, 'README.md'), '# repo\n\nmore docs\n');
			writeFileSync(join(repo, 'notes.md'), 'notes\n');
			git('add', 'README.md', 'notes.md');
			expect(git('commit', '-q', '-m', 'docs only').status).toBe(0);
			const docsOnly = git('rev-parse', 'HEAD').stdout.trim();
			expect(classify(initial, docsOnly).stdout).toBe('false\n');

			// Push touching the pinned lockfile: the builder is validated.
			mkdirSync(join(repo, 'docker'), { recursive: true });
			writeFileSync(join(repo, 'docker/builder.bun.lock'), '{}\n');
			git('add', 'docker/builder.bun.lock');
			expect(git('commit', '-q', '-m', 'refresh lock').status).toBe(0);
			const lockUpdate = git('rev-parse', 'HEAD').stdout.trim();
			expect(classify(docsOnly, lockUpdate).stdout).toBe('true\n');

			// A multi-commit push is classified across its whole range.
			expect(classify(initial, lockUpdate).stdout).toBe('true\n');
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('wires both CI event paths through the classifier', () => {
		const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
		const job = workflow.slice(workflow.indexOf('docker-builder:'), workflow.indexOf('main-smoke:'));

		expect(job).toContain('scripts/docker-builder-changed.mjs');
		// Pushes compare the pushed commit range instead of always rebuilding.
		expect(job).toContain('github.event.before');
		expect(job).toContain('github.sha');
	});
});
