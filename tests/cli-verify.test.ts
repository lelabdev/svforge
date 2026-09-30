import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runVerify, printVerifyResult } from '../packages/svforge/src/verify';
import type { SpawnPort } from '../packages/svforge/src/cli/add';

/**
 * `svforge verify` (#470): the light, single-command project readiness check
 * (doctor → design-system check → project check → build → test).
 *
 * These tests exercise the orchestration behaviourally: which scripts run, in
 * which order, and how missing/failing scripts affect the verdict. The real
 * doctor/check implementation is the same one already covered elsewhere — here
 * a minimal valid project keeps it green so the script steps are isolated.
 */
function fixtureProject(scripts: Record<string, string> = {}): string {
	const dir = mkdtempSync(join(tmpdir(), 'sf-verify-'));
	mkdirSync(join(dir, 'src', 'lib', 'components', 'svforge'), { recursive: true });
	writeFileSync(join(dir, 'vite.config.ts'), 'export default {};\n');
	writeFileSync(
		join(dir, 'package.json'),
		`${JSON.stringify(
			{
				name: 'verify-fixture',
				type: 'module',
				dependencies: { '@sveltejs/kit': '^2.0.0', svelte: '^5.0.0' },
				scripts: { check: 'svelte-check', build: 'vite build', test: 'vitest run', ...scripts }
			},
			null,
			2
		)}\n`
	);
	writeFileSync(
		join(dir, '.svforge.json'),
		`${JSON.stringify({ schema: 1, template: 'base', modules: [], capabilities: [] })}\n`
	);
	return dir;
}

function recordingSpawn(results: Record<string, number> = {}) {
	const calls: { command: string; args: string[] }[] = [];
	const spawn: SpawnPort = async (command, args) => {
		calls.push({ command, args });
		return results[args[args.length - 1] as string] ?? 0;
	};
	return { spawn, calls };
}

describe('svforge verify (#470)', () => {
	it('runs doctor, check and the project scripts in order, and reports ready', async () => {
		const dir = fixtureProject();
		try {
			const { spawn, calls } = recordingSpawn();
			const result = await runVerify(dir, { pm: 'bun', spawn });

			expect(result.ok).toBe(true);
			expect(result.steps.map((s) => s.name)).toEqual(['doctor', 'check', 'project-check', 'build', 'test']);
			expect(result.steps.every((s) => s.status === 'ok')).toBe(true);
			expect(calls).toEqual([
				{ command: 'bun', args: ['run', 'check'] },
				{ command: 'bun', args: ['run', 'build'] },
				{ command: 'bun', args: ['run', 'test'] }
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('fails when a required project script is missing from package.json', async () => {
		const dir = fixtureProject({ build: undefined as unknown as string });
		try {
			// Remove the build script entirely.
			writeFileSync(
				join(dir, 'package.json'),
				`${JSON.stringify({ name: 'x', dependencies: { '@sveltejs/kit': '^2.0.0', svelte: '^5.0.0' }, scripts: { check: 'svelte-check', test: 'vitest run' } })}\n`
			);
			const { spawn } = recordingSpawn();
			const result = await runVerify(dir, { pm: 'bun', spawn });
			expect(result.ok).toBe(false);
			const build = result.steps.find((s) => s.name === 'build');
			expect(build?.status).toBe('error');
			expect(build?.message).toMatch(/No "build" script/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('treats a missing optional test script as a skip, not a failure', async () => {
		const dir = fixtureProject();
		try {
			writeFileSync(
				join(dir, 'package.json'),
				`${JSON.stringify({ name: 'x', dependencies: { '@sveltejs/kit': '^2.0.0', svelte: '^5.0.0' }, scripts: { check: 'svelte-check', build: 'vite build' } })}\n`
			);
			const { spawn } = recordingSpawn();
			const result = await runVerify(dir, { pm: 'bun', spawn });
			expect(result.ok).toBe(true);
			expect(result.steps.find((s) => s.name === 'test')?.status).toBe('skipped');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('fails when a project script exits non-zero', async () => {
		const dir = fixtureProject();
		try {
			const { spawn } = recordingSpawn({ test: 1 });
			const result = await runVerify(dir, { pm: 'bun', spawn });
			expect(result.ok).toBe(false);
			const test = result.steps.find((s) => s.name === 'test');
			expect(test?.status).toBe('error');
			expect(test?.message).toMatch(/exited with 1/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('prints a readable verdict without throwing', async () => {
		const dir = fixtureProject();
		try {
			const { spawn } = recordingSpawn();
			const result = await runVerify(dir, { pm: 'bun', spawn });
			expect(() => printVerifyResult(result)).not.toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
