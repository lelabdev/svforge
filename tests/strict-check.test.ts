import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { baseRootFiles } from '../packages/svforge/src/templates';
import { applyBaseMode } from '../packages/svforge/src/modes/base';
import { ROOT } from './helpers';

function warningProject(): string {
	const project = mkdtempSync(join(tmpdir(), 'sf-strict-check-'));
	writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'probe' }));
	mkdirSync(join(project, 'src'), { recursive: true });
	writeFileSync(join(project, 'src', 'Warning.svelte'), '<div class="p-[13px]">warning</div>');
	writeFileSync(join(project, 'svforge-check.mjs'), baseRootFiles['/svforge-check.mjs']);
	return project;
}

function run(project: string, command: string, args: string[] = []) {
	return spawnSync(process.execPath, [command, ...args], { cwd: project, encoding: 'utf-8' });
}

function runCommand(project: string, command: string, args: string[], env: Record<string, string> = {}) {
	return spawnSync(command, args, {
		cwd: project,
		encoding: 'utf-8',
		env: { ...process.env, ...env }
	});
}

function expectSuccess(project: string, command: string, args: string[], env: Record<string, string> = {}) {
	const result = runCommand(project, command, args, env);
	const diagnostics = [
		`Command and arguments: ${JSON.stringify([command, ...args])}`,
		`Exit status: ${result.status ?? 'null'}`,
		`stdout:\n${result.stdout ?? ''}`,
		`stderr:\n${result.stderr ?? ''}`,
		...(result.error ? [`Spawn error: ${result.error.message}`] : [])
	].join('\n');
	expect(result.status, diagnostics).toBe(0);
	return result;
}

describe('strict design-system checks (#344)', () => {
	it('keeps WARN advisory normally but makes them block in strict mode for packaged and generated checkers', () => {
		const project = warningProject();
		try {
			for (const command of ['svforge-check.mjs', join(ROOT, 'packages/svforge/bin/svforge.mjs')]) {
				const args = command.endsWith('svforge.mjs') ? ['check'] : [];
				const normal = run(project, command, args);
				const strict = run(project, command, [...args, '--strict']);

				expect(normal.status).toBe(0);
				expect(normal.stdout).toContain('WARN');
				expect(strict.status).toBe(1);
			}
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it('runs the guarded Lefthook prepare after Git init and blocks a real commit', () => {
		const project = mkdtempSync(join(tmpdir(), 'sf-lefthook-contract-'));
		const bin = join(project, 'node_modules', '.bin');
		const callLog = join(project, 'lefthook-calls.log');
		const files = new Map<string, ((content: string) => string)[]>();
		const dependencies: string[] = [];
		try {
			applyBaseMode(
				{
					dependency: () => {},
					devDependency: (name: string) => dependencies.push(name),
					file: (path: string, transform: (content: string) => string) => {
						files.set(path, [...(files.get(path) ?? []), transform]);
					}
				} as never,
				{},
				{},
				'lefthook'
			);
			expect(dependencies).toContain('lefthook');

			let packageJson = JSON.stringify({ name: 'hook-probe', scripts: { prepare: 'true' } });
			for (const transform of files.get('package.json') ?? []) packageJson = transform(packageJson);
			writeFileSync(join(project, 'package.json'), packageJson);
			const config = files.get('.lefthook.yml')![0]('');
			writeFileSync(join(project, '.lefthook.yml'), config);
			writeFileSync(join(project, 'svforge-check.mjs'), baseRootFiles['/svforge-check.mjs']);

			// Model dependency preparation with a local Lefthook executable. The
			// add-on's generated prepare script must be harmless before git init.
			mkdirSync(bin, { recursive: true });
			const hookCommand = config.match(/^\s+run: (.+)$/m)?.[1];
			expect(hookCommand).toBe('node svforge-check.mjs --strict');
			writeFileSync(
				join(bin, 'lefthook'),
				`#!/bin/sh\nprintf '%s\\n' "$*" >> "$LEFTHOOK_CALL_LOG"\n[ "$1" = install ] || exit 2\ncat > .git/hooks/pre-commit <<'HOOK'\n#!/bin/sh\n${hookCommand}\nHOOK\nchmod +x .git/hooks/pre-commit\n`,
				{ mode: 0o755 }
			);
			const env = {
				PATH: `${bin}:${process.env.PATH ?? ''}`,
				LEFTHOOK_CALL_LOG: callLog
			};
			const prepare = JSON.parse(packageJson).scripts.prepare;
			expect(existsSync(join(project, '.git'))).toBe(false);
			expectSuccess(project, 'sh', ['-c', prepare], env);
			expect(existsSync(callLog)).toBe(false);

			expectSuccess(project, 'git', ['init']);
			expectSuccess(project, 'sh', ['-c', prepare], env);
			expect(readFileSync(callLog, 'utf8')).toBe('install\n');
			expect(existsSync(join(project, '.git/hooks/pre-commit'))).toBe(true);
			expectSuccess(project, 'git', ['config', 'user.email', 'tests@example.com']);
			expectSuccess(project, 'git', ['config', 'user.name', 'SvelteForge tests']);
			mkdirSync(join(project, 'src'), { recursive: true });
			writeFileSync(join(project, 'src', 'Warning.svelte'), '<div class="p-[13px]">warning</div>');
			expectSuccess(project, 'git', ['add', 'src/Warning.svelte']);

			const commit = runCommand(project, 'git', ['commit', '-m', 'strict hook must block'], env);
			expect(commit.status).not.toBe(0);
			expect(`${commit.stdout}\n${commit.stderr}`).toContain('WARN');
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it('includes command, status, stdout, and stderr when an external command fails', () => {
		const project = mkdtempSync(join(tmpdir(), 'sf-command-diagnostics-'));
		try {
			let message = '';
			try {
				expectSuccess(project, 'sh', ['-c', 'printf stdout; printf stderr >&2; exit 2']);
			} catch (error) {
				message = String(error);
			}
			expect(message).toContain('Command and arguments: ["sh","-c","printf stdout; printf stderr >&2; exit 2"]');
			expect(message).toContain('Exit status: 2');
			expect(message).toContain('stdout:\nstdout');
			expect(message).toContain('stderr:\nstderr');
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it('adds an opt-in Lefthook adapter that blocks the same warning', () => {
		const files = new Map<string, (content: string) => string>();
		const dependencies: string[] = [];
		applyBaseMode(
			{
				dependency: () => {},
				devDependency: (name: string) => dependencies.push(name),
				file: (path: string, transform: (content: string) => string) => files.set(path, transform)
			} as never,
			{},
			{},
			'lefthook'
		);
		const project = warningProject();
		try {
			const config = files.get('.lefthook.yml')!('');
			expect(dependencies).toContain('lefthook');
			expect(config).toContain("glob: '*.{svelte,html,css,json}'");
			const hookCommand = config.match(/run: (.+)/)?.[1];
			expect(hookCommand).toBe('node svforge-check.mjs --strict');
			const [binary, checker, flag] = hookCommand!.split(' ');
			const result = spawnSync(binary, [checker, flag], { cwd: project, encoding: 'utf-8' });
			expect(result.status).toBe(1);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});
});
