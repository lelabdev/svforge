import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	runCreateCommand,
	expandAllModules,
	parseCreateArgs,
} from '../packages/svforge/src/cli/create';
import type { SpawnPort } from '../packages/svforge/src/cli/add';

/**
 * Tests for `svforge create` (#417): registry-driven all-modules expansion,
 * template implication, runtime honesty, target-dir safety, and the exact
 * two-stage orchestration (official `sv create` + ONE grouped `sv add`).
 * The spawn port is a fake — the real end-to-end runs in the CI scaffold
 * profile `create-cli`.
 */

function fakeSpawn(): { spawn: SpawnPort; calls: { command: string; args: string[]; options: { cwd: string } }[] } {
	const calls: { command: string; args: string[]; options: { cwd: string } }[] = [];
	const spawn: SpawnPort = async (command, args, options) => {
		calls.push({ command, args, options });
		return 0;
	};
	return { spawn, calls };
}

function flagsToOptions(flags: Record<string, string | string[] | boolean | undefined>, extra: Record<string, unknown> = {}) {
	return {
		dir: flags.dir as string | undefined,
		template: flags.template as 'base' | 'dashboard' | undefined,
		pm: flags.pm as string | undefined,
		testing: flags.testing as 'vitest' | 'playwright' | undefined,
		hooks: flags.hooks as 'none' | 'lefthook' | undefined,
		modules: flags.modules as string[] | 'all' | undefined,
		runtime: flags.runtime as 'long-lived-node' | undefined,
		yes: true,
		interactive: false,
		...extra
	};
}

describe('all-modules expansion (#417)', () => {
	it('expands from the canonical registry — future modules included automatically', () => {
		const all = expandAllModules();
		expect(all).toContain('realtime');
		expect(all).toContain('jobs');
		expect(all).toContain('chat');
		expect(all.length).toBeGreaterThanOrEqual(13);
		// Sorted and unique — deterministic plans.
		expect([...all].sort()).toEqual(all);
		expect(new Set(all).size).toBe(all.length);
	});
});

describe('composition rules before any file is written (#417)', () => {
	it('refuses --template base combined with --modules all', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'base', pm: 'bun', modules: 'all' }, { spawn })
			);
			expect(result.code).toBe(1);
			expect(result.aborted).toBe('invalid');
			expect(result.message).toMatch(/dashboard/);
			expect(calls).toEqual([]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('all-modules implies dashboard without asking redundantly', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', pm: 'bun', modules: 'all', runtime: 'long-lived-node' }, { spawn, validate: async () => 0 })
			);
			expect(result.code).toBe(0);
			expect(result.plan?.template).toBe('dashboard');
			expect(result.plan?.allModules).toBe(true);
			// sv create runs in the parent cwd, sv add in the target.
			expect(calls[0]!.options.cwd).toBe(cwd);
			expect(calls[1]!.options.cwd).toBe(join(cwd, 'app'));
			rmSync(cwd, { recursive: true, force: true });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('all-modules without a runtime choice fails before creating anything', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', pm: 'bun', modules: 'all' }, { spawn })
			);
			expect(result.code).toBe(1);
			expect(result.aborted).toBe('invalid');
			expect(result.message).toMatch(/long-lived Node runtime/);
			expect(calls).toEqual([]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('missing required flags fail without spawning (never a hidden prompt)', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(cwd, flagsToOptions({ dir: 'app' }, { spawn }));
			expect(result.code).toBe(1);
			expect(result.aborted).toBe('invalid');
			expect(result.message).toMatch(/--pm/);
			expect(result.message).toMatch(/--modules/);
			expect(calls).toEqual([]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe('target-directory safety (#417)', () => {
	it('refuses a non-empty target and never deletes it', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			mkdirSync(join(cwd, 'app'), { recursive: true });
			writeFileSync(join(cwd, 'app', 'precious.txt'), 'user data');
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'base', pm: 'bun', modules: ['dnd'] }, { spawn })
			);
			expect(result.code).toBe(1);
			expect(result.aborted).toBe('safety');
			expect(result.message).toMatch(/never deletes/i);
			expect(calls).toEqual([]);
			expect(existsSync(join(cwd, 'app', 'precious.txt'))).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe('two-stage orchestration (#417)', () => {
	it('runs official sv create then ONE grouped sv add with the right specs', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions(
					{ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd', 'ui_toast'], hooks: 'none', testing: 'vitest' },
					{ spawn, validate: async () => 0 }
				)
			);
			expect(result.code).toBe(0);
			expect(calls).toHaveLength(2);

			// Stage 1: the OFFICIAL generator, minimal, no add-ons, no install.
			expect(calls[0]!.args).toEqual([
				'sv', 'create', 'app', '--template', 'minimal', '--types', 'ts',
				'--no-add-ons', '--no-install', '--no-download-check'
			]);
			expect(calls[0]!.command).toBe('bunx');

			// Stage 2: ONE grouped sv add — template spec + modules, single install.
			expect(calls[1]!.args[0]).toBe('sv');
			expect(calls[1]!.args[1]).toBe('add');
			expect(calls[1]!.args[2]).toBe('svforge=template:dashboard+testing:vitest+hooks:none');
			expect(calls[1]!.args).toContain('@svforge/dnd');
			expect(calls[1]!.args).toContain('@svforge/ui_toast');
			expect(calls[1]!.args).toEqual([
				'sv',
				'add',
				'svforge=template:dashboard+testing:vitest+hooks:none',
				'@svforge/dnd',
				'@svforge/ui_toast',
				'--install',
				'bun',
				'--no-download-check'
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('a failed sv create stops the pipeline and reports the stage', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const spawn: SpawnPort = async () => 1;
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd'] }, { spawn })
			);
			expect(result.code).toBe(1);
			expect(result.failedStage).toBe('create');
			expect(result.message).toMatch(/not ready to use|sv create/i);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('a failed sv add is reported as a NOT-ready project', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			let first = true;
			const spawn: SpawnPort = async () => (first ? ((first = false), 0) : 1);
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd'] }, { spawn })
			);
			expect(result.code).toBe(1);
			expect(result.failedStage).toBe('add');
			expect(result.message).toMatch(/not fully configured/i);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe('runtime honesty is recorded (#417)', () => {
	it('patches deployment.profile in the created manifest', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			// The fake `sv create` produces the project + manifest, like reality.
			const spawn: SpawnPort = async (_command, args, options: { cwd: string; stdio: 'inherit' }) => {
				if (args[1] === 'create') {
					mkdirSync(join(options.cwd, 'app'), { recursive: true });
					writeFileSync(
						join(options.cwd, 'app', '.svforge.json'),
						JSON.stringify({ schema: 1, template: 'dashboard', modules: [], capabilities: [], deployment: { profile: 'serverless' } })
					);
				}
				return 0;
			};
			const result = await runCreateCommand(
				cwd,
				flagsToOptions(
					{ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['realtime', 'jobs'], runtime: 'long-lived-node' },
					{ spawn, validate: async () => 0 }
				)
			);
			expect(result.code).toBe(0);
			expect(result.plan?.runtime).toBe('long-lived-node');
			const manifest = JSON.parse(readFileSync(join(cwd, 'app', '.svforge.json'), 'utf8'));
			expect(manifest.deployment.profile).toBe('long-lived-node');
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe('flag parsing (#417)', () => {
	it('parses flags, comma lists and the all shorthand', () => {
		const parsed = parseCreateArgs([
			'my-app', '--template', 'dashboard', '--pm', 'bun',
			'--modules', 'audit,uploads', '--testing', 'vitest', '--hooks', 'none', '--yes'
		]);
		expect(parsed.dir).toBe('my-app');
		expect(parsed.template).toBe('dashboard');
		expect(parsed.pm).toBe('bun');
		expect(parsed.modules).toEqual(['audit', 'uploads']);
		expect(parsed.yes).toBe(true);

		const all = parseCreateArgs(['app', '--modules', 'all', '--pm', 'npm']);
		expect(all.modules).toBe('all');
	});
});
