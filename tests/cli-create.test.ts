import { describe, it, expect } from 'vitest';
import { delimiter, join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	runCreateCommand,
	expandAllModules,
	selectableModulesForTemplate,
	parseCreateArgs,
} from '../packages/svforge/src/cli/create';
import type { SpawnPort } from '../packages/svforge/src/cli/add';
import type { CreatePromptPort } from '../packages/svforge/src/cli/create';
import { COMPAT_MANIFEST } from '../packages/svforge/src/compat';

/**
 * Tests for `svforge create` (#417): registry-driven all-modules expansion,
 * template implication, runtime honesty, target-dir safety, and the exact
 * two-stage orchestration (official `sv create` + ONE grouped `sv add`).
 * The spawn port is a fake — the real end-to-end runs in the CI scaffold
 * profile `create-cli`.
 */

/** Extract the template + module ids a given `sv add` invocation requested. */
function manifestFromAddArgs(args: string[]): { schema: number; template: string; modules: string[] } {
	const template = /template:([a-z]+)/.exec(args.join(' '))?.[1] ?? 'base';
	const modules: string[] = [];
	for (const spec of args.slice(2).filter((arg) => !arg.startsWith('--'))) {
		const scoped = /@svforge\/([a-z0-9_]+)/.exec(spec);
		if (scoped) {
			modules.push(scoped[1]);
			continue;
		}
		const file = /^file:(.+)$/.exec(spec);
		if (file && !spec.includes('=template:')) modules.push(file[1].split('=')[0].split('/').pop() as string);
	}
	return { schema: 1, template, modules };
}

function fakeSpawn(): { spawn: SpawnPort; calls: { command: string; args: string[]; options: { cwd: string } }[] } {
	const calls: { command: string; args: string[]; options: { cwd: string } }[] = [];
	const spawn: SpawnPort = async (command, args, options) => {
		calls.push({ command, args, options });
		// Faithful to the real sv add: the addons write the project manifest,
		// recording exactly the template and modules that were requested.
		if (args[1] === 'add') {
			mkdirSync(options.cwd, { recursive: true });
			writeFileSync(join(options.cwd, '.svforge.json'), JSON.stringify(manifestFromAddArgs(args)));
		}
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
		gitInit: flags.gitInit as boolean | undefined,
		graphify: flags.graphify as boolean | undefined,
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

describe('template-aware interactive module picker (#585)', () => {
	it('uses actual capabilities to filter Base, not a module template hint', () => {
		const base = selectableModulesForTemplate('base');
		expect(base).toContain('dnd');
		for (const id of ['oauth', 'uploads', 'audit', 'notifications', 'jobs', 'chat']) {
			expect(base).not.toContain(id);
		}
		expect(selectableModulesForTemplate('dashboard')).toEqual(expandAllModules());
	});

	it('Base shows only compatible optional modules, not All, and can install DnD', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-base-menu-'));
		try {
			const { spawn, calls } = fakeSpawn();
			let values: string[] = [];
			const result = await runCreateCommand(cwd, {
				dir: 'app', pm: 'bun', testing: 'vitest', hooks: 'none',
				gitInit: false, interactive: true,
				prompt: {
					text: async () => 'app',
					select: async () => 'base',
					multiselect: async (_question, choices) => {
						values = choices.map((item) => item.value);
						return ['dnd'];
					},
					confirm: async () => true
				},
				spawn, validate: async () => 0
			});
			expect(values).toContain('dnd');
			for (const id of ['__all__', 'oauth', 'uploads', 'audit', 'notifications', 'jobs', 'chat']) {
				expect(values).not.toContain(id);
			}
			expect(result.code).toBe(0);
			expect(result.plan?.template).toBe('base');
			expect(result.plan?.modules).toEqual(['dnd']);
			// create + official paraglide + grouped SVForge add.
			expect(calls).toHaveLength(3);
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	});

	it('Dashboard alone offers All modules and retains long-lived runtime confirmation', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-dashboard-menu-'));
		try {
			const { spawn, calls } = fakeSpawn();
			let values: string[] = [];
			const confirmations: string[] = [];
			const result = await runCreateCommand(cwd, {
				dir: 'app', pm: 'bun', testing: 'vitest', hooks: 'none',
				gitInit: false, interactive: true,
				prompt: {
					text: async () => 'app',
					select: async () => 'dashboard',
					multiselect: async (_question, choices) => {
						values = choices.map((item) => item.value);
						return ['__all__'];
					},
					confirm: async (message) => { confirmations.push(message); return true; }
				},
				spawn, validate: async () => 0
			});
			expect(values).toEqual([...expandAllModules(), '__all__']);
			expect(result.code).toBe(0);
			expect(result.plan?.template).toBe('dashboard');
			expect(result.plan?.allModules).toBe(true);
			expect(result.plan?.runtime).toBe('long-lived-node');
			expect(confirmations.some((message) => message.includes('long-lived Node runtime'))).toBe(true);
			// #547: dashboard = sv create + official paraglide + drizzle +
			// better-auth + ONE grouped SVForge sv add.
			expect(calls).toHaveLength(5);
		} finally { rmSync(cwd, { recursive: true, force: true }); }
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
			// sv create runs in the parent cwd; every add runs in the target.
			expect(calls[0]!.options.cwd).toBe(cwd);
			for (const call of calls.slice(1)) expect(call.options.cwd).toBe(join(cwd, 'app'));
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

describe('optional Graphify initialization (#469)', () => {
	it('keeps Graphify disabled by default even when its binary is available', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-graphify-default-'));
		const bin = mkdtempSync(join(tmpdir(), 'sf-graphify-bin-'));
		const executable = join(bin, 'graphify');
		const originalPath = process.env.PATH;
		writeFileSync(executable, '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });
		process.env.PATH = `${bin}${delimiter}${originalPath ?? ''}`;
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'base', pm: 'bun', modules: [] }, { spawn, validate: async () => 0 })
			);
			expect(result.code).toBe(0);
			expect(result.plan?.graphify).toBe(false);
			expect(calls.map((call) => call.command)).not.toContain(executable);
		} finally {
			process.env.PATH = originalPath;
			rmSync(cwd, { recursive: true, force: true });
			rmSync(bin, { recursive: true, force: true });
		}
	});

	it('explicit opt-in delegates installation and code-only extraction to the detected binary', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-graphify-opt-in-'));
		const bin = mkdtempSync(join(tmpdir(), 'sf-graphify-bin-'));
		const executable = join(bin, 'graphify');
		const originalPath = process.env.PATH;
		writeFileSync(executable, '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });
		process.env.PATH = `${bin}${delimiter}${originalPath ?? ''}`;
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'base', pm: 'bun', modules: [], graphify: true }, { spawn, validate: async () => 0 })
			);
			expect(result.code).toBe(0);
			expect(result.plan?.graphify).toBe(true);
			expect(calls.slice(-2)).toEqual([
				{ command: executable, args: ['install', '--project'], options: { cwd: join(cwd, 'app'), stdio: 'inherit' } },
				{ command: executable, args: ['extract', '.', '--code-only'], options: { cwd: join(cwd, 'app'), stdio: 'inherit' } }
			]);
		} finally {
			process.env.PATH = originalPath;
			rmSync(cwd, { recursive: true, force: true });
			rmSync(bin, { recursive: true, force: true });
		}
	});

	it('continues without installation when Graphify was requested but is absent', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-graphify-absent-'));
		const originalPath = process.env.PATH;
		process.env.PATH = '';
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'base', pm: 'bun', modules: [], graphify: true }, { spawn, validate: async () => 0 })
			);
			expect(result.code).toBe(0);
			expect(result.notice).toMatch(/Graphify.*not found.*continuing/i);
			expect(existsSync(join(cwd, 'app', '.svforge.json'))).toBe(true);
			expect(calls.map((call) => call.args[0])).not.toContain('install');
		} finally {
			process.env.PATH = originalPath;
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it.each([
		{ failingCommand: 'install', expectedArgs: ['install', '--project'] },
		{ failingCommand: 'extract', expectedArgs: ['extract', '.', '--code-only'] }
	])('reports a clear failure when Graphify $failingCommand fails', async ({ failingCommand, expectedArgs }) => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-graphify-failure-'));
		const bin = mkdtempSync(join(tmpdir(), 'sf-graphify-bin-'));
		const executable = join(bin, 'graphify');
		const originalPath = process.env.PATH;
		writeFileSync(executable, '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });
		process.env.PATH = `${bin}${delimiter}${originalPath ?? ''}`;
		try {
			const calls: { command: string; args: string[]; options: { cwd: string } }[] = [];
			const spawn: SpawnPort = async (command, args, options) => {
				calls.push({ command, args, options });
				if (args[1] === 'add') {
					mkdirSync(options.cwd, { recursive: true });
					writeFileSync(join(options.cwd, '.svforge.json'), JSON.stringify(manifestFromAddArgs(args)));
				}
				return command === executable && args[0] === failingCommand ? 7 : 0;
			};
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'base', pm: 'bun', modules: [], graphify: true }, { spawn, validate: async () => 0 })
			);
			expect(result.code).toBe(7);
			expect(result.failedStage).toBe('graphify');
			expect(result.message).toMatch(/Graphify.*failed.*scaffolded and usable/i);
			expect(calls.filter((call) => call.command === executable).map((call) => call.args)).toEqual(
				failingCommand === 'install' ? [expectedArgs] : [['install', '--project'], expectedArgs]
			);
		} finally {
			process.env.PATH = originalPath;
			rmSync(cwd, { recursive: true, force: true });
			rmSync(bin, { recursive: true, force: true });
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
					{ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd', 'ui_toast'], testing: 'vitest' },
					{ spawn, validate: async () => 0 }
				)
			);
			expect(result.code).toBe(0);
			expect(result.plan?.hooks).toBe('none');
			// create + paraglide + drizzle + better-auth + grouped add + git init.
			expect(calls).toHaveLength(6);

			// Stage 1: the OFFICIAL generator, minimal, no add-ons, no install.
			expect(calls[0]!.args).toEqual([
				'sv', 'create', 'app', '--template', 'minimal', '--types', 'ts',
				'--no-add-ons', '--no-install', '--no-download-check'
			]);
			expect(calls[0]!.command).toBe('bunx');

			// Stage 2-4 (#547): the OFFICIAL paraglide + auth/DB add-ons, no
			// install — their files are the foundation SVForge extends next.
			expect(calls[1]!.args).toEqual([
				'sv', 'add', 'paraglide=languageTags:fr,en+demo:no',
				'--no-install', '--no-download-check', '--no-git-check'
			]);
			expect(calls[2]!.args).toEqual([
				'sv', 'add', 'drizzle=database:postgresql+client:postgres.js+docker:no',
				'--no-install', '--no-download-check', '--no-git-check'
			]);
			expect(calls[3]!.args).toEqual([
				'sv', 'add', 'better-auth=demo:',
				'--no-install', '--no-download-check', '--no-git-check'
			]);

			// Stage 5: ONE grouped sv add — template spec + modules, single install.
			expect(calls[4]!.args[0]).toBe('sv');
			expect(calls[4]!.args[1]).toBe('add');
			// #470: an ordinary `svforge create` pins the exact compatible
			// versions from the embedded distribution manifest — never `latest`.
			const groupedAdd = calls.filter((call) => call.args[0] === 'sv' && call.args[1] === 'add').at(-1)!;
			expect(groupedAdd.args[2]).toBe(`svforge@${COMPAT_MANIFEST.packages.svforge}=template:dashboard+testing:vitest+hooks:none`);
			expect(groupedAdd.args).toContain(`@svforge/dnd@${COMPAT_MANIFEST.packages['@svforge/dnd']}`);
			expect(groupedAdd.args).toContain(`@svforge/ui_toast@${COMPAT_MANIFEST.packages['@svforge/ui_toast']}`);
			expect(groupedAdd.args).toEqual([
				'sv',
				'add',
				`svforge@${COMPAT_MANIFEST.packages.svforge}=template:dashboard+testing:vitest+hooks:none`,
				`@svforge/dnd@${COMPAT_MANIFEST.packages['@svforge/dnd']}`,
				`@svforge/ui_toast@${COMPAT_MANIFEST.packages['@svforge/ui_toast']}`,
				'--install',
				'bun',
				'--no-download-check',
				'--no-git-check'
			]);

			// #417: Git initialization is part of the orchestration (default on).
			const gitInit = calls.find((call) => call.command === 'git')!;
			expect(gitInit.args).toEqual(['init']);
			expect(gitInit.options.cwd).toBe(join(cwd, 'app'));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('forwards an explicit hooks choice instead of the default', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions(
					{ dir: 'app', template: 'base', pm: 'bun', modules: [], hooks: 'lefthook' },
					{ spawn, validate: async () => 0 }
				)
			);
			expect(result.code).toBe(0);
			expect(result.plan?.hooks).toBe('lefthook');
			const groupedAdd = calls.filter((call) => call.args[0] === 'sv' && call.args[1] === 'add').at(-1)!;
			expect(groupedAdd.args[2]).toContain('+hooks:lefthook');
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

describe('packaged-artifact and exact-version resolution (#470)', () => {
	it('resolves the template and module add-ons from an extracted artifact directory', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		const addonRoot = mkdtempSync(join(tmpdir(), 'sf-addons-'));
		try {
			for (const id of ['svforge', 'dnd', 'ui_toast']) mkdirSync(join(addonRoot, id), { recursive: true });
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions(
					{ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd', 'ui_toast'] },
					{ spawn, validate: async () => 0, addonRoot }
				)
			);
			expect(result.code).toBe(0);
			// The grouped SVForge add is the LAST `sv add` (git init may follow).
			const addArgs = calls.filter((call) => call.args[0] === 'sv' && call.args[1] === 'add').at(-1)!.args;
			expect(addArgs).toContain(`file:${join(addonRoot, 'svforge')}=template:dashboard+testing:vitest+hooks:none`);
			expect(addArgs).toContain(`file:${join(addonRoot, 'dnd')}`);
			expect(addArgs).toContain(`file:${join(addonRoot, 'ui_toast')}`);
			// No monorepo checkout path ever leaks into the composition.
			expect(addArgs.join(' ')).not.toMatch(/packages\//);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(addonRoot, { recursive: true, force: true });
		}
	});

	it('pins the exact npm version for the template and every module — never an implicit latest', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions(
					{ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd', 'ui_toast'] },
					{ spawn, validate: async () => 0, addonVersion: '2.0.1' }
				)
			);
			expect(result.code).toBe(0);
			// The grouped SVForge add is the LAST `sv add` (git init may follow).
			const addArgs = calls.filter((call) => call.args[0] === 'sv' && call.args[1] === 'add').at(-1)!.args;
			expect(addArgs).toContain('svforge@2.0.1=template:dashboard+testing:vitest+hooks:none');
			expect(addArgs).toContain('@svforge/dnd@2.0.1');
			expect(addArgs).toContain('@svforge/ui_toast@2.0.1');
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('parses --addon-root and --addon-version', () => {
		const parsed = parseCreateArgs(['app', '--addon-root', '/tmp/addons', '--addon-version', '2.0.1']);
		expect(parsed.addonRoot).toBe('/tmp/addons');
		expect(parsed.addonVersion).toBe('2.0.1');
		expect(parsed.dir).toBe('app');
	});
});

describe('compatibility manifest + fail-closed packaging (#470)', () => {
	it('applies the exact per-package versions from an explicit compatibility manifest', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const { spawn, calls } = fakeSpawn();
			const compatManifest = {
				schema: 1 as const,
				template: { name: 'svforge' as const, version: '2.1.0' },
				packages: { svforge: '2.1.0', '@svforge/dnd': '2.0.3', '@svforge/ui_toast': '2.0.1' }
			};
			const result = await runCreateCommand(
				cwd,
				flagsToOptions(
					{ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd', 'ui_toast'] },
					{ spawn, validate: async () => 0, compatManifest }
				)
			);
			expect(result.code).toBe(0);
			// The grouped SVForge add is the LAST `sv add` (git init may follow).
			const addArgs = calls.filter((call) => call.args[0] === 'sv' && call.args[1] === 'add').at(-1)!.args;
			// Intentionally divergent versions: each package keeps its own exact version.
			expect(addArgs).toContain('svforge@2.1.0=template:dashboard+testing:vitest+hooks:none');
			expect(addArgs).toContain('@svforge/dnd@2.0.3');
			expect(addArgs).toContain('@svforge/ui_toast@2.0.1');
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('fails before creating anything when --addon-root is missing a requested module', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		const addonRoot = mkdtempSync(join(tmpdir(), 'sf-addonroot-partial-'));
		try {
			mkdirSync(join(addonRoot, 'svforge'), { recursive: true });
			const { spawn, calls } = fakeSpawn();
			const result = await runCreateCommand(
				cwd,
				flagsToOptions(
					{ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd'] },
					{ spawn, validate: async () => 0, addonRoot }
				)
			);
			expect(result.code).toBe(1);
			expect(result.aborted).toBe('invalid');
			expect(result.message).toMatch(/missing the packaged artifact/);
			expect(result.message).toMatch(/dnd/);
			// Fail closed BEFORE any sv create / sv add spawn.
			expect(calls).toEqual([]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(addonRoot, { recursive: true, force: true });
		}
	});

	it('fails when a requested module is absent from the installed manifest', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const spawn: SpawnPort = async (_command, args, options) => {
				if (args[1] === 'create') mkdirSync(join(options.cwd, 'app'), { recursive: true });
				if (args[1] === 'add') {
					mkdirSync(options.cwd, { recursive: true });
					// ui_toast was requested but silently dropped.
					writeFileSync(join(options.cwd, '.svforge.json'), JSON.stringify({ schema: 1, template: 'dashboard', modules: ['dnd'] }));
				}
				return 0;
			};
			const result = await runCreateCommand(
				cwd,
				flagsToOptions(
					{ dir: 'app', template: 'dashboard', pm: 'bun', modules: ['dnd', 'ui_toast'] },
					{ spawn, validate: async () => 0 }
				)
			);
			expect(result.code).toBe(1);
			expect(result.failedStage).toBe('validate');
			expect(result.message).toMatch(/ui_toast/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('parses --compat-manifest', () => {
		const parsed = parseCreateArgs(['app', '--compat-manifest', '/tmp/compat.json']);
		expect(parsed.compatManifestPath).toBe('/tmp/compat.json');
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
						JSON.stringify({ schema: 1, template: 'dashboard', modules: ['realtime', 'jobs'], capabilities: [], deployment: { profile: 'serverless' } })
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

describe('git initialization choice (#417)', () => {
	it('a declined choice removes the .git OUR orchestration created — and spawns no git init', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-create-'));
		try {
			const spawn: SpawnPort = async (_command, args, options) => {
				if (args[1] === 'create') {
					mkdirSync(join(options.cwd, 'app', '.git'), { recursive: true }); // sv init'ed git
				}
				if (args[1] === 'add') {
					// the real sv add delivers the manifest (ground truth)
					mkdirSync(options.cwd, { recursive: true });
					writeFileSync(join(options.cwd, '.svforge.json'), JSON.stringify({ schema: 1, template: 'base', modules: ['dnd'] }));
				}
				return 0;
			};
			const result = await runCreateCommand(
				cwd,
				flagsToOptions({ dir: 'app', template: 'base', pm: 'bun', modules: ['dnd'], gitInit: false }, { spawn, validate: async () => 0 })
			);
			expect(result.code).toBe(0);
			expect(result.plan?.gitInit).toBe(false);
			expect(existsSync(join(cwd, 'app', '.git'))).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe('value-aware flag parsing (#419 review applies to create too)', () => {
	it('flag values never shadow the positional directory', () => {
		const parsed = parseCreateArgs(['--template', 'dashboard', '--pm', 'bun', 'my-app', '--modules', 'dnd']);
		expect(parsed.dir).toBe('my-app');
		expect(parsed.pm).toBe('bun');
		expect(parsed.template).toBe('dashboard');
	});

	it('parses the explicit Graphify opt-in', () => {
		expect(parseCreateArgs(['app', '--graphify']).graphify).toBe(true);
		expect(parseCreateArgs(['app']).graphify).toBeUndefined();
	});

	it('parses the git choice and the runtime flag', () => {
		const declined = parseCreateArgs(['app', '--no-git-init']);
		expect(declined.gitInit).toBe(false);
		const forced = parseCreateArgs(['app', '--git-init', '--runtime', 'long-lived-node', '--sv-cmd', '/bin/sv']);
		expect(forced.gitInit).toBe(true);
		expect(forced.runtime).toBe('long-lived-node');
		expect(forced.svCmd).toBe('/bin/sv');
	});
});

describe('addon options registry contract (#417)', () => {
	it('MODULES addonOptions mirror the built addons defaults — headless composition never prompts', { timeout: 120_000 }, async () => {
		const { MODULES } = await import('../packages/svforge/src/module-composition');
		const { join } = await import('node:path');
		const { ROOT } = await import('./helpers');
		for (const [id, meta] of Object.entries(MODULES)) {
			const distPath = join(ROOT, 'packages', id, 'dist', 'index.js');
			const addon = await import(distPath);
			const defaults: Record<string, unknown> = {};
			for (const [key, option] of Object.entries((addon.default?.options ?? {}) as Record<string, { default?: unknown }>)) {
				// sv renders boolean defaults as yes/no in the add-on spec.
				defaults[key] = typeof option.default === 'boolean' ? (option.default ? 'yes' : 'no') : String(option.default);
			}
			const declared = meta.addonOptions ?? {};
			expect(declared, `${id} must declare every addon option default`).toEqual(defaults);
		}
		// uploads is exactly why this contract exists: it is the only module
		// with an interactive option today.
		expect(MODULES.uploads.addonOptions).toEqual({ testpack: 'no' });
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


describe('optional local environment preparation (#589)', () => {
	function dashboardSpawn() {
		const calls: { command: string; args: string[]; options: { cwd: string; env?: NodeJS.ProcessEnv } }[] = [];
		const spawn: SpawnPort = async (command, args, options) => {
			calls.push({ command, args, options });
			if (args[1] === 'add') {
				mkdirSync(options.cwd, { recursive: true });
				writeFileSync(join(options.cwd, '.svforge.json'), JSON.stringify({ schema: 1, template: 'dashboard', modules: [] }));
			}
			if (command === 'bash' && options.env?.STUB_SETUP_FAIL === '1') return 1;
			return 0;
		};
		return { spawn, calls };
	}
	function prompt(selectChoice: string, confirmAnswers: boolean[]): CreatePromptPort {
		const answers = [...confirmAnswers];
		return {
			text: async () => '',
			select: async () => selectChoice,
			multiselect: async () => [],
			// First confirmation approves the create plan; later ones answer setup questions.
			confirm: async () => answers.shift() ?? false
		};
	}
	async function run(cwd: string, extra: Record<string, unknown>) {
		const { spawn, calls } = dashboardSpawn();
		const result = await runCreateCommand(cwd, {
			dir: 'app', template: 'dashboard', pm: 'bun', testing: 'vitest', hooks: 'none',
			gitInit: false, yes: false, interactive: true, validate: async () => 0,
			spawn, ...extra
		} as never);
		return { result, calls };
	}

	it('never prompts or starts services in non-interactive mode without explicit flags', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-setup-'));
		try {
			const { spawn, calls } = dashboardSpawn();
			const result = await runCreateCommand(cwd, {
				dir: 'app', template: 'dashboard', pm: 'bun', testing: 'vitest', hooks: 'none',
				gitInit: false, modules: [], yes: true, interactive: false, validate: async () => 0, spawn
			});
			expect(result.code).toBe(0);
			expect(calls.some((call) => call.command === 'bash')).toBe(false);
			expect(result.notice).toContain('scripts/setup.sh');
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('offers Compose and asks separately before initializing the schema', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-setup-'));
		try {
			const { result, calls } = await run(cwd, { prompt: prompt('compose', [true, false]) });
			expect(result.code, result.message).toBe(0);
			const setupCalls = calls.filter((call) => call.command === 'bash').map((call) => call.args);
			expect(setupCalls).toEqual([['scripts/setup.sh', '--compose']]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('runs schema initialization only after explicit consent', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-setup-'));
		try {
			const { result, calls } = await run(cwd, { prompt: prompt('compose', [true, true]) });
			expect(result.code, result.message).toBe(0);
			const setupCalls = calls.filter((call) => call.command === 'bash').map((call) => call.args);
			expect(setupCalls).toEqual([
				['scripts/setup.sh', '--compose'],
				['scripts/setup.sh', '--compose', '--init-schema']
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('accepts explicit headless setup flags and passes the URL through the environment', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-setup-'));
		const previous = process.env.SVFORGE_DATABASE_URL;
		process.env.SVFORGE_DATABASE_URL = 'postgres://app:pw@db.internal:5432/app';
		try {
			const { result, calls } = await run(cwd, { modules: [], setup: 'existing', initSchema: true, interactive: false, yes: true });
			expect(result.code, result.message).toBe(0);
			const setupCall = calls.find((call) => call.command === 'bash');
			expect(setupCall?.args).toEqual(['scripts/setup.sh']);
			expect(setupCall?.options.env?.SVFORGE_DATABASE_URL).toBe(process.env.SVFORGE_DATABASE_URL);
			expect(JSON.stringify(result)).not.toContain('db.internal');
		} finally {
			if (previous === undefined) delete process.env.SVFORGE_DATABASE_URL;
			else process.env.SVFORGE_DATABASE_URL = previous;
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('keeps the project successful when local setup fails, with an actionable notice', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-setup-'));
		try {
			process.env.STUB_SETUP_FAIL = '1';
			const { result } = await run(cwd, { modules: [], setup: 'compose', interactive: false, yes: true });
			expect(result.code).toBe(0);
			expect(result.notice).toContain('local environment setup failed');
		} finally {
			delete process.env.STUB_SETUP_FAIL;
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('respects an explicit "configure later" choice without side effects', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-setup-'));
		try {
			const { result, calls } = await run(cwd, { prompt: prompt('later', [true]) });
			expect(result.code).toBe(0);
			expect(calls.some((call) => call.command === 'bash')).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
