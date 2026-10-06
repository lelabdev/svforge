import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT } from './helpers';
import { COMPAT_MANIFEST } from '../packages/svforge/src/compat';
import { buildManifest } from '../packages/svforge/src/ai-context';

/**
 * REAL-BIN behavioral coverage (#426 review): the previous review round
 * fixed the TypeScript functions but the distributed bin kept its own
 * manual parsing — the tests were green while the executable was broken.
 *
 * These tests spawn `node packages/svforge/bin/svforge.mjs` (the actual
 * shipped entry) against a STUB `sv` binary (SVFORGE_SV_CMD) that records
 * its arguments, so every assertion runs through the real CLI wiring:
 * parsing, option pass-through, exit codes.
 */

const BIN = join(ROOT, 'packages/svforge/bin/svforge.mjs');

const STUB_SV = [
	'#!/usr/bin/env bash',
	'printf \'%s\\n\' "$*" >> "$SV_STUB_LOG"',
	'if [ "$1" = "create" ]; then',
	'  mkdir -p "$2"',
	'  printf \'{"dependencies":{"@sveltejs/kit":"2","svelte":"^5"},"name":"stub"}\' > "$2/package.json"',
	'  printf \'export default {};\\n\' > "$2/vite.config.ts"',
	'  if [ -n "$SV_STUB_CREATE_GIT" ]; then mkdir -p "$2/.git"; fi',
	'fi',
	'if [ "$1" = "add" ]; then printf \'{"schema":1,"template":"dashboard","modules":["chat"],"capabilities":["ui.skeleton","ui.svforge","i18n.messages","auth.currentUser","auth.admin","database.drizzle.postgres"],"deployment":{"profile":"long-lived-node"}}\' > .svforge.json; fi',
	'exit 0'
].join('\n');

interface BinRun {
	code: number;
	stdout: string;
	stderr: string;
	stubLog: string[];
}

function runBin(args: string[], cwd: string, env: Record<string, string> = {}): BinRun {
	const logPath = join(cwd, 'sv-stub-calls.log');
	const result = spawnSync(process.execPath, [BIN, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, SV_STUB_LOG: logPath, ...env }
	});
	const stubLog = existsSync(logPath)
		? readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
		: [];
	return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', stubLog };
}

function scaffoldedProject(): string {
	const dir = mkdtempSync(join(tmpdir(), 'sf-realbin-'));
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: 'fixture', dependencies: {} })
	);
	writeFileSync(
		join(dir, '.svforge.json'),
		JSON.stringify({ schema: 1, template: 'dashboard', modules: [], capabilities: [] })
	);
	return dir;
}

describe('real bin — project UI strategy (#480)', () => {
	it('registers any installed package and sets it as preferred through the shipped CLI', () => {
		const cwd = scaffoldedProject();
		const packageName = '@example/arbitrary-widgets';
		writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { [packageName]: '^1.0.0' } }));
		writeFileSync(join(cwd, '.svforge.json'), JSON.stringify(buildManifest('base', []), null, 2));
		writeFileSync(join(cwd, 'llms.txt'), 'original llms\\n');
		writeFileSync(join(cwd, 'AGENTS.md'), 'original agent guidance\\n');
		const contextFiles = ['.svforge.json', 'llms.txt', 'AGENTS.md'];
		const before = new Map(contextFiles.map((file) => [file, readFileSync(join(cwd, file), 'utf8')]));

		const dotRoot = runBin(['ui', 'register', packageName, '--component-root', '.'], cwd);
		expect(dotRoot.code).toBe(1);
		const multipleRoots = runBin(['ui', 'register', packageName, '--component-root', 'src/lib/components/valid', '--component-root', 'src'], cwd);
		expect(multipleRoots.code).toBe(1);
		for (const file of contextFiles) expect(readFileSync(join(cwd, file), 'utf8'), file).toBe(before.get(file));

		const registered = runBin(['ui', 'register', packageName, '--component-root', 'src/lib/components/external'], cwd);
		expect(registered.code).toBe(0);
		expect(JSON.parse(readFileSync(join(cwd, '.svforge.json'), 'utf8')).ui.libraries).toEqual([
			{ package: packageName, componentRoots: ['src/lib/components/external'] }
		]);

		const preferred = runBin(['ui', 'prefer', packageName], cwd);
		expect(preferred.code).toBe(0);
		expect(JSON.parse(readFileSync(join(cwd, '.svforge.json'), 'utf8')).ui.preferred).toBe(packageName);
		rmSync(cwd, { recursive: true, force: true });
	});
});

describe('real bin — svforge add (#426 review)', () => {
	it('the documented command reaches ONE sv add for the right module only', () => {
		const cwd = scaffoldedProject();
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });

		// The EXACT reviewer scenario, through the distributed bin:
		const run = runBin(['add', 'chat', '--pm', 'bun', '--resolve', 'install', '--sv-cmd', stub, '--yes'], cwd);

		expect(run.code).toBe(0);
		expect(run.stubLog).toHaveLength(1);
		expect(run.stubLog[0]).toBe('add @svforge/chat --install bun --no-download-check --no-git-check');
		// The module list of the invocation is exactly the requested one.
		const tokens = run.stubLog[0]!.split(' ');
		const modules = tokens.slice(1, tokens.indexOf('--install'));
		expect(modules).toEqual(['@svforge/chat']);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('SVFORGE_SV_CMD alone (no --sv-cmd flag) drives the sv invocation (#426 review)', () => {
		const cwd = scaffoldedProject();
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });

		const run = runBin(['add', 'dnd', '--yes'], cwd, { SVFORGE_SV_CMD: stub });
		expect(run.code).toBe(0);
		expect(run.stubLog).toHaveLength(1);
		expect(run.stubLog[0]).toBe('add @svforge/dnd --install npm --no-download-check --no-git-check');
		rmSync(cwd, { recursive: true, force: true });
	});

	it('realtime without an attestation fails through the bin; with --runtime it installs', () => {
		const cwd = scaffoldedProject();
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });

		const refused = runBin(['add', 'realtime', '--sv-cmd', stub, '--yes'], cwd);
		expect(refused.code).toBe(1);
		expect(refused.stderr).toMatch(/--runtime long-lived-node/);
		expect(refused.stubLog).toEqual([]);

		const attested = runBin(['add', 'realtime', '--runtime', 'long-lived-node', '--sv-cmd', stub, '--yes'], cwd);
		expect(attested.code).toBe(0);
		expect(attested.stubLog).toHaveLength(1);
		expect(attested.stubLog[0]).toContain('@svforge/realtime');
		rmSync(cwd, { recursive: true, force: true });
	});
});

describe('real bin — svforge create (#426 review)', () => {
	it('--git-init ends with a repository; --no-git-init removes the .git sv created', () => {
		const withGit = mkdtempSync(join(tmpdir(), 'sf-realbin-git-'));
		const stub = join(withGit, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const kept = runBin(
			['create', 'app', '--template', 'dashboard', '--pm', 'bun', '--modules', 'chat', '--git-init', '--sv-cmd', stub, '--yes'],
			withGit
		);
		expect(kept.code).toBe(0);
		expect(existsSync(join(withGit, 'app', '.git'))).toBe(true);
		expect(kept.stubLog[0]).toContain('create app');
		expect(kept.stubLog[1]).toContain(
			`add svforge@${COMPAT_MANIFEST.packages.svforge}=template:dashboard+testing:vitest+hooks:none`
		);
		// Module versions come from the embedded compatibility manifest — never
		// hardcoded and never an implicit `latest`.
		expect(kept.stubLog[1]).toContain(`@svforge/chat@${COMPAT_MANIFEST.packages['@svforge/chat']}`);
		// Git init went through the real git binary.
		expect(kept.stubLog.every((line) => !line.startsWith('init'))).toBe(true);

		const withoutGit = mkdtempSync(join(tmpdir(), 'sf-realbin-nogit-'));
		const stub2 = join(withoutGit, 'stub-sv.sh');
		writeFileSync(stub2, STUB_SV, { mode: 0o755 });
		const removed = runBin(
			['create', 'app', '--template', 'dashboard', '--pm', 'bun', '--modules', 'chat', '--no-git-init', '--sv-cmd', stub2, '--yes'],
			withoutGit,
			{ SV_STUB_CREATE_GIT: '1' }
		);
		if (removed.code !== 0) console.error('DEBUG removed.stderr:', removed.stderr);
		expect(removed.code).toBe(0);
		expect(existsSync(join(withoutGit, 'app', '.git'))).toBe(false);
		rmSync(withGit, { recursive: true, force: true });
		rmSync(withoutGit, { recursive: true, force: true });
	});

	it('explicit --graphify delegates both upstream commands through the shipped bin (#469)', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-realbin-graphify-'));
		const bin = mkdtempSync(join(tmpdir(), 'sf-realbin-graphify-bin-'));
		const graphify = join(bin, 'graphify');
		const graphifyLog = join(cwd, 'graphify-calls.log');
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		writeFileSync(
			graphify,
			`#!/bin/sh
printf '%s|%s\\n' "$PWD" "$*" >> "$GRAPHIFY_STUB_LOG"
`,
			{ mode: 0o755 }
		);

		try {
			const result = runBin(
				['create', 'app', '--template', 'dashboard', '--pm', 'bun', '--modules', 'chat', '--graphify', '--sv-cmd', stub, '--yes'],
				cwd,
				{
					PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
					GRAPHIFY_STUB_LOG: graphifyLog
				}
			);
			expect(result.code).toBe(0);
			expect(readFileSync(graphifyLog, 'utf8').trim().split('\n')).toEqual([
				`${join(cwd, 'app')}|install --project`,
				`${join(cwd, 'app')}|extract . --code-only`
			]);
			expect(JSON.parse(readFileSync(join(cwd, 'app', 'package.json'), 'utf8')).dependencies).not.toHaveProperty('graphify');
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(bin, { recursive: true, force: true });
		}
	});

	it('create --runtime is honored: all-modules without it fails through the bin', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-realbin-all-'));
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const refused = runBin(
			['create', 'app', '--template', 'base', '--pm', 'bun', '--modules', 'all', '--sv-cmd', stub, '--yes'],
			cwd
		);
		expect(refused.code).toBe(1);
		expect(refused.stderr).toMatch(/dashboard/);
		rmSync(cwd, { recursive: true, force: true });
	});
});
