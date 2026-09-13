import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	runAddCommand,
	detectPackageManager,
	dlxRunner,
	addonSpec,
	type SpawnPort,
	type PromptPort
} from '../packages/svforge/src/cli/add';

/**
 * Tests for the `svforge add` guided install (#419): policies, prompts,
 * single grouped invocation, deterministic specs. The spawn and prompt
 * ports are fakes — no real `sv add` runs here (a real e2e runs in the
 * scaffold CI profile).
 */

function tempProject(manifest?: Record<string, unknown>): string {
	const dir = mkdtempSync(join(tmpdir(), 'sf-add-'));
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
	if (manifest) writeFileSync(join(dir, '.svforge.json'), JSON.stringify(manifest));
	return dir;
}

function fakeSpawn(): { spawn: SpawnPort; calls: { command: string; args: string[] }[] } {
	const calls: { command: string; args: string[] }[] = [];
	const spawn: SpawnPort = async (command, args) => {
		calls.push({ command, args });
		return 0;
	};
	return { spawn, calls };
}

const silentPrompt: PromptPort = {
	confirm: async () => true,
	select: async (_message, options) => options[0]!
};

describe('svforge add — policies (#419)', () => {
	it('fails with the policy message when supporting modules are needed non-interactively', async () => {
		// Synthetic override is not available through the command (it reads the
		// real registry) — use a dashboard-only capability on a base project:
		// chat requires auth.currentUser, which no module provides on base.
		const dir = tempProject({ template: 'base', modules: [] });
		const { spawn, calls } = fakeSpawn();
		const result = await runAddCommand(dir, {
			modules: ['chat'],
			interactive: false,
			spawn
		});
		expect(result.code).toBe(1);
		expect(result.aborted).toBe('errors');
		expect(calls).toEqual([]);
		expect(result.message).toMatch(/database\.drizzle\.postgres|auth\.currentUser/);
		rmSync(dir, { recursive: true, force: true });
	});

	it('unknown modules fail with the available list', async () => {
		const dir = tempProject();
		const result = await runAddCommand(dir, { modules: ['nope'], interactive: false });
		expect(result.code).toBe(1);
		expect(result.aborted).toBe('unknown');
		expect(result.message).toMatch(/dnd/);
		rmSync(dir, { recursive: true, force: true });
	});

	it('refuses the template id — svforge add is for standalone modules', async () => {
		const dir = tempProject();
		const result = await runAddCommand(dir, { modules: ['svforge'], interactive: false });
		expect(result.code).toBe(1);
		expect(result.message).toMatch(/template:base\|dashboard/);
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('svforge add — confirmations (#419)', () => {
	it('a declined plan writes nothing and exits cleanly', async () => {
		const dir = tempProject({ template: 'base', modules: [] });
		let confirmed = false;
		const result = await runAddCommand(dir, {
			modules: ['realtime'],
			interactive: true,
			prompt: { confirm: async () => ((confirmed = true), false), select: silentPrompt.select },
			spawn: fakeSpawn().spawn
		});
		expect(result.aborted).toBe('declined');
		expect(result.code).toBe(0);
		expect(result.message).toMatch(/nothing was written/i);
		expect(confirmed).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});

	it('runtime attestation declined → nothing written', async () => {
		const dir = tempProject({ template: 'dashboard', modules: [] });
		const result = await runAddCommand(dir, {
			modules: ['realtime'],
			interactive: true,
			prompt: { confirm: async () => false, select: silentPrompt.select },
			spawn: fakeSpawn().spawn
		});
		expect(result.aborted).toBe('declined');
		expect(result.code).toBe(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it('runtime attestation approved → installs the requested module only', async () => {
		const dir = tempProject({ template: 'dashboard', modules: [] });
		const { spawn, calls } = fakeSpawn();
		const result = await runAddCommand(dir, {
			modules: ['realtime'],
			interactive: true,
			prompt: silentPrompt,
			spawn
		});
		expect(result.code).toBe(0);
		expect(result.specs).toEqual(['@svforge/realtime']);
		expect(calls).toHaveLength(1);
		rmSync(dir, { recursive: true, force: true });
	});

	it('non-interactive WITHOUT attestation fails before any mutation (#419 review)', async () => {
		const dir = tempProject({ template: 'dashboard', modules: [] });
		const { spawn, calls } = fakeSpawn();
		const result = await runAddCommand(dir, { modules: ['realtime'], interactive: false, spawn });
		expect(result.code).toBe(1);
		expect(result.aborted).toBe('policy');
		expect(result.message).toMatch(/--runtime long-lived-node/);
		expect(result.message).toMatch(/nothing was written/i);
		expect(calls).toEqual([]);
		rmSync(dir, { recursive: true, force: true });
	});

	it('non-interactive WITH the explicit --runtime attestation proceeds', async () => {
		const dir = tempProject({ template: 'dashboard', modules: [] });
		const { spawn, calls } = fakeSpawn();
		const result = await runAddCommand(dir, {
			modules: ['realtime'],
			interactive: false,
			runtime: 'long-lived-node',
			spawn
		});
		expect(result.code).toBe(0);
		expect(result.plan?.warnings.join(' ')).toMatch(/attested via --runtime long-lived-node/);
		expect(calls).toHaveLength(1);
		rmSync(dir, { recursive: true, force: true });
	});

	it('parses value-aware flags — option values never become module ids (#419 review)', async () => {
		const { parseAddArgs } = await import('../packages/svforge/src/cli/add');
		const parsed = parseAddArgs(['chat', '--pm', 'bun', '--resolve', 'install']);
		expect(parsed.modules).toEqual(['chat']);
		expect(parsed.pm).toBe('bun');
		expect(parsed.resolve).toBe('install');

		const full = parseAddArgs([
			'chat', '--pm', 'pnpm', '--resolve', 'fail', '--sv-cmd', '/bin/sv',
			'--dev-root', '/repo', '--runtime', 'long-lived-node', '--yes'
		]);
		expect(full.modules).toEqual(['chat']);
		expect(full.svCmd).toBe('/bin/sv');
		expect(full.devRoot).toBe('/repo');
		expect(full.runtime).toBe('long-lived-node');
		expect(full.yes).toBe(true);
	});

	it('end-to-end: the documented command reaches ONE sv add for the right module', async () => {
		// The exact reviewer scenario: svforge add chat --pm bun --resolve install
		// on a dashboard project (all capabilities satisfied) must install chat.
		const dir = tempProject({ template: 'dashboard', modules: [] });
		const { spawn, calls } = fakeSpawn();
		const { parseAddArgs } = await import('../packages/svforge/src/cli/add');
		const parsed = parseAddArgs(['chat', '--pm', 'bun', '--resolve', 'install']);
		const result = await runAddCommand(dir, { ...parsed, interactive: false, spawn });
		expect(result.code).toBe(0);
		expect(result.specs).toEqual(['@svforge/chat']);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.args).toEqual(['sv', 'add', '@svforge/chat', '--install', 'bun', '--no-download-check', '--no-git-check']);
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('svforge add — invocation shape (#419)', () => {
	it('runs ONE grouped sv add with the pm install flags', async () => {
		const dir = tempProject({ template: 'dashboard', modules: [] });
		const { spawn, calls } = fakeSpawn();
		const result = await runAddCommand(dir, { modules: ['dnd', 'ui_toast'], interactive: false, pm: 'bun', spawn });
		expect(result.code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.command).toBe('bunx');
		expect(calls[0]!.args).toEqual([
			'sv',
			'add',
			'@svforge/dnd',
			'@svforge/ui_toast',
			'--install',
			'bun',
			'--no-download-check',
			'--no-git-check'
		]);
		rmSync(dir, { recursive: true, force: true });
	});

	it('dev checkouts use file: specs pointing into the monorepo', () => {
		const repo = mkdtempSync(join(tmpdir(), 'sf-devroot-'));
		try {
			mkdirSync(join(repo, 'packages', 'dnd'), { recursive: true });
			expect(addonSpec('dnd', repo)).toBe(`file:${join(repo, 'packages', 'dnd')}`);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
		expect(addonSpec('dnd')).toBe('@svforge/dnd');
	});

	it('dlx runner matches the package manager', () => {
		expect(dlxRunner('bun').command).toBe('bunx');
		expect(dlxRunner('pnpm')).toMatchObject({ command: 'pnpm', prefix: ['dlx'] });
		expect(dlxRunner('yarn')).toMatchObject({ command: 'yarn', prefix: ['dlx'] });
		expect(dlxRunner('npm').command).toBe('npx');
	});
});

describe('package manager detection (#419)', () => {
	it('detects from the lockfile', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-pm-'));
		try {
			writeFileSync(join(dir, 'bun.lock'), '');
			expect(detectPackageManager(dir)).toBe('bun');
			rmSync(join(dir, 'bun.lock'));
			writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
			expect(detectPackageManager(dir)).toBe('pnpm');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('defaults to npm without a lockfile', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sf-pm-'));
		try {
			expect(detectPackageManager(dir)).toBe('npm');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
