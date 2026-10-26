import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT } from './helpers';
import { COMPAT_MANIFEST } from '../packages/svforge/src/compat';
import { buildManifest } from '../packages/svforge/src/ai-context';
import { scaffoldedAgents } from '../packages/svforge/src/scaffolded-agents';

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

describe('CLI file-mode release guard', () => {
	it('tracks the shipped executable as 100755, not a non-executable regular file', () => {
		// Git preserves the actual executable bit in release checkouts.
		// #579 accidentally changed this mode and broke the create-cli release gate.
		if (process.platform === 'win32') return;
		const indexEntry = execFileSync('git', ['ls-files', '--stage', '--', 'packages/svforge/bin/svforge.mjs'], {
			cwd: ROOT, encoding: 'utf8'
		});
		expect(indexEntry).toMatch(/^100755 [0-9a-f]{40} 0\t/);
		expect(statSync(BIN).mode & 0o111).not.toBe(0);
	});
});

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

function scaffoldedProject(
	manifest: Record<string, unknown> = { schema: 1, template: 'dashboard', modules: [], capabilities: [] },
	dependencies: Record<string, string> = {}
): string {
	const dir = mkdtempSync(join(tmpdir(), 'sf-realbin-'));
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name: 'fixture', dependencies })
	);
	writeFileSync(join(dir, '.svforge.json'), JSON.stringify(manifest));
	return dir;
}

describe('real bin — Paraglide locale context synchronization (#438)', () => {
	it('refreshes manifest, AGENTS.md, and llms.txt from non-default Inlang settings', () => {
		const cwd = scaffoldedProject();
		mkdirSync(join(cwd, 'project.inlang'), { recursive: true });
		const manifest = buildManifest('base', ['email']);
		writeFileSync(join(cwd, '.svforge.json'), JSON.stringify(manifest, null, 2));
		writeFileSync(join(cwd, 'project.inlang/settings.json'), JSON.stringify({ baseLocale: 'en', locales: ['en', 'fr', 'de'] }));
		const generatedAgents = scaffoldedAgents('base');
		const defaultLocaleBlock = [
			'<!-- svforge:i18n-config:start -->',
			'- baseLocale: `fr`',
			'- locales: `fr`, `en`',
			'<!-- svforge:i18n-config:end -->'
		].join('\n');
		const legacyConfig = `The scaffold starts with\n**fr** (baseLocale) and **en** — SVForge's initial locales, NOT a system limit.`;
		const oldAgents = generatedAgents.replace(`The scaffold's initial locales are defaults, not a system limit. Current configured locale values are:\n${defaultLocaleBlock}`, legacyConfig);
		writeFileSync(join(cwd, 'AGENTS.md'), `${oldAgents}\n## User notes\nKeep this section.\n`);
		writeFileSync(join(cwd, 'llms.txt'), 'stale locale data');

		const run = runBin(['context'], cwd);
		expect(run.code).toBe(0);
		expect(run.stdout).toMatch(/drift detected.*baseLocale en.*en, fr, de/);
		const updatedManifest = JSON.parse(readFileSync(join(cwd, '.svforge.json'), 'utf8'));
		expect(updatedManifest.i18n.baseLocale).toBe('en');
		expect(updatedManifest.i18n.locales).toEqual(['en', 'fr', 'de']);
		const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
		const llms = readFileSync(join(cwd, 'llms.txt'), 'utf8');
		expect(agents).toContain('baseLocale: `en`');
		expect(agents).toContain('locales: `en`, `fr`, `de`');
		expect(llms).toContain('baseLocale: en');
		expect(llms).toContain('configured locales: en, fr, de');
		for (const content of [agents, llms]) expect(content).not.toContain('scaffold starts with');
		expect(agents).toContain('## User notes\nKeep this section.');
		expect(llms).toContain('- email (Resend)');
		const idempotent = runBin(['context'], cwd);
		expect(idempotent.code).toBe(0);
		expect(idempotent.stdout).toMatch(/already matches/);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('reports invalid canonical settings without partially refreshing metadata (#438)', () => {
		const cwd = scaffoldedProject();
		mkdirSync(join(cwd, 'project.inlang'), { recursive: true });
		writeFileSync(join(cwd, '.svforge.json'), JSON.stringify(buildManifest('base', []), null, 2));
		writeFileSync(join(cwd, 'project.inlang/settings.json'), JSON.stringify({ baseLocale: 'en', locales: ['fr'] }));
		writeFileSync(join(cwd, 'AGENTS.md'), scaffoldedAgents('base'));
		writeFileSync(join(cwd, 'llms.txt'), 'keep existing context');
		const files = ['.svforge.json', 'AGENTS.md', 'llms.txt'];
		const before = new Map(files.map((file) => [file, readFileSync(join(cwd, file), 'utf8')]));

		const run = runBin(['context'], cwd);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/baseLocale.*locales/);
		for (const file of files) expect(readFileSync(join(cwd, file), 'utf8'), file).toBe(before.get(file));
		rmSync(cwd, { recursive: true, force: true });
	});
});

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
		expect(run.stubLog[0]).toBe(`add @svforge/chat@${COMPAT_MANIFEST.packages['@svforge/chat']} --install bun --no-download-check --no-git-check`);
		// The module list of the invocation is exactly the requested one.
		const tokens = run.stubLog[0]!.split(' ');
		const modules = tokens.slice(1, tokens.indexOf('--install'));
		expect(modules).toEqual([`@svforge/chat@${COMPAT_MANIFEST.packages['@svforge/chat']}`]);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('SVFORGE_SV_CMD alone (no --sv-cmd flag) drives the sv invocation (#426 review)', () => {
		const cwd = scaffoldedProject();
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });

		const run = runBin(['add', 'dnd', '--yes'], cwd, { SVFORGE_SV_CMD: stub });
		expect(run.code).toBe(0);
		expect(run.stubLog).toHaveLength(1);
		expect(run.stubLog[0]).toBe(`add @svforge/dnd@${COMPAT_MANIFEST.packages['@svforge/dnd']} --install npm --no-download-check --no-git-check`);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('realtime plans expose runtime requirements and apply requires an attestation', () => {
		const cwd = scaffoldedProject();
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });

		const planWithoutRuntime = runBin(['add', 'realtime', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const blockedPlan = JSON.parse(planWithoutRuntime.stdout);
		expect(planWithoutRuntime.code).toBe(1);
		expect(blockedPlan.capabilities.runtimeConstraints.map((entry: { token: string }) => entry.token)).toContain('runtime.websocket');
		expect(blockedPlan.commands).toEqual([]);
		expect(planWithoutRuntime.stubLog).toEqual([]);

		const planWithRuntime = runBin(['add', 'realtime', '--runtime', 'long-lived-node', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const readyPlan = JSON.parse(planWithRuntime.stdout);
		expect(planWithRuntime.code).toBe(0);
		expect(readyPlan.capabilities.runtimeConstraints[0].selected).toBe('long-lived-node');
		expect(readyPlan.commands).toHaveLength(1);
		expect(planWithRuntime.stubLog).toEqual([]);

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

	it('add --plan --json reports exact command and versions without writing or spawning', () => {
		const cwd = scaffoldedProject();
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const originalManifest = readFileSync(join(cwd, '.svforge.json'), 'utf8');
		const originalFiles = readdirSync(cwd).sort();

		const run = runBin(['add', 'chat', '--pm', 'bun', '--resolve', 'install', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const plan = JSON.parse(run.stdout);
		const version = COMPAT_MANIFEST.packages['@svforge/chat'];
		expect(run.code).toBe(0);
		expect(plan.schemaVersion).toBe(1);
		expect(plan.command).toBe('add');
		expect(plan.status).toBe('ready');
		expect(plan.modules).toMatchObject({ explicit: ['chat'], installOrder: ['chat'], alreadyInstalled: [] });
		expect(plan.packages).toContainEqual(expect.objectContaining({
			name: '@svforge/chat', version, spec: `@svforge/chat@${version}`, source: 'compatibility-manifest'
		}));
		expect(plan.commands).toEqual([{
			executable: stub,
			args: ['add', `@svforge/chat@${version}`, '--install', 'bun', '--no-download-check', '--no-git-check'],
			cwd
		}]);
		expect(run.stubLog).toEqual([]);
		expect(readFileSync(join(cwd, '.svforge.json'), 'utf8')).toBe(originalManifest);
		expect(readdirSync(cwd).sort()).toEqual(originalFiles);
		expect(existsSync(join(cwd, 'sv-stub-calls.log'))).toBe(false);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('add plan reports incompatible project capabilities and never spawns sv', () => {
		const cwd = scaffoldedProject({ schema: 1, template: 'base', modules: [] });
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });

		const run = runBin(['add', 'chat', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const plan = JSON.parse(run.stdout);
		expect(run.code).toBe(1);
		expect(plan.status).toBe('blocked');
		expect(plan.capabilities.missing.map((entry: { token: string }) => entry.token)).toContain('auth.currentUser');
		expect(plan.commands).toEqual([]);
		expect(run.stubLog).toEqual([]);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('add --json without --plan is rejected before invoking sv', () => {
		const cwd = scaffoldedProject();
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const run = runBin(['add', 'chat', '--sv-cmd', stub, '--json'], cwd);
		expect(run.code).toBe(2);
		expect(run.stderr).toMatch(/only supported with --plan/);
		expect(run.stubLog).toEqual([]);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('dependency-only declaration plans and applies the missing add-on scaffold', () => {
		const cwd = scaffoldedProject(
			{ schema: 1, template: 'dashboard', modules: [] },
			{ '@svforge/dnd': COMPAT_MANIFEST.packages['@svforge/dnd'] }
		);
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const originalFiles = readdirSync(cwd).sort();

		const planned = runBin(['add', 'dnd', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const plan = JSON.parse(planned.stdout);
		const spec = `@svforge/dnd@${COMPAT_MANIFEST.packages['@svforge/dnd']}`;
		expect(planned.code).toBe(0);
		expect(plan.status).toBe('ready');
		expect(plan.modules.alreadyInstalled).toEqual([]);
		expect(plan.modules.installOrder).toEqual(['dnd']);
		expect(plan.commands).toEqual([{
			executable: stub,
			args: ['add', spec, '--install', 'npm', '--no-download-check', '--no-git-check'],
			cwd
		}]);
		expect(plan.warnings).toContainEqual(expect.stringContaining('no application record or generated scaffold files exist'));
		expect(readdirSync(cwd).sort()).toEqual(originalFiles);
		expect(planned.stubLog).toEqual([]);

		const applied = runBin(['add', 'dnd', '--sv-cmd', stub, '--yes'], cwd);
		expect(applied.code).toBe(0);
		expect(applied.stubLog).toEqual([`add ${spec} --install npm --no-download-check --no-git-check`]);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('add plan preserves manifest warnings instead of silently ignoring them', () => {
		const cwd = scaffoldedProject({ schema: 1, template: 'dashboard', modules: [], capabilities: { provides: ['unknown.capability'] } });
		const run = runBin(['add', 'dnd', '--plan', '--json'], cwd);
		const plan = JSON.parse(run.stdout);
		expect(run.code).toBe(0);
		expect(plan.warnings).toContainEqual(expect.stringContaining('Ignored unknown declared capability'));
		rmSync(cwd, { recursive: true, force: true });
	});

	it('add plan recognizes an application record plus generated files as an idempotent no-op', () => {
		const cwd = scaffoldedProject(
			{ schema: 1, template: 'dashboard', modules: ['dnd'] },
			{ '@svforge/dnd': COMPAT_MANIFEST.packages['@svforge/dnd'] }
		);
		// Every file the add-on delivers exists (component + showcase demo route
		// with its discovery metadata): that is what makes the plan a no-op.
		for (const path of [
			'src/lib/components/svforge/dnd/SortableList.svelte',
			'src/routes/showcase/dnd/+page.svelte',
			'src/routes/showcase/dnd/meta.ts'
		]) {
			mkdirSync(dirname(join(cwd, path)), { recursive: true });
			writeFileSync(join(cwd, path), '<!-- installed by @svforge/dnd -->');
		}
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const run = runBin(['add', 'dnd', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const plan = JSON.parse(run.stdout);
		expect(run.code).toBe(0);
		expect(plan.status).toBe('noop');
		expect(plan.modules.alreadyInstalled).toEqual(['dnd']);
		expect(plan.commands).toEqual([]);
		expect(run.stubLog).toEqual([]);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('blocks re-adding a manifest-recorded module when its generated files are missing', () => {
		const cwd = scaffoldedProject({ schema: 1, template: 'dashboard', modules: ['dnd'] });
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });

		const planned = runBin(['add', 'dnd', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const plan = JSON.parse(planned.stdout);
		expect(planned.code).toBe(1);
		expect(plan.status).toBe('blocked');
		expect(plan.conflicts).toContainEqual(expect.objectContaining({ code: 'incomplete' }));
		expect(plan.commands).toEqual([]);

		const applied = runBin(['add', 'dnd', '--sv-cmd', stub, '--yes'], cwd);
		expect(applied.code).toBe(1);
		expect(applied.stubLog).toEqual([]);
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
		// #547: the official auth/DB add-ons run first; the grouped SVForge add
		// is the LAST `sv add` line.
		const groupedAdd = [...kept.stubLog].reverse().find((line) => line.includes(`svforge@${COMPAT_MANIFEST.packages.svforge}`))!;
		expect(groupedAdd).toContain(
			`add svforge@${COMPAT_MANIFEST.packages.svforge}=template:dashboard+testing:vitest+hooks:none`
		);
		// Module versions come from the embedded compatibility manifest — never
		// hardcoded and never an implicit `latest`.
		expect(groupedAdd).toContain(`@svforge/chat@${COMPAT_MANIFEST.packages['@svforge/chat']}`);
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

	it('create plan leaves an existing non-empty target untouched', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-realbin-existing-plan-'));
		const target = join(cwd, 'app');
		mkdirSync(target);
		writeFileSync(join(target, 'keep.txt'), 'preserve me');
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const originalFiles = readdirSync(target).sort();
		const run = runBin(['create', 'app', '--template', 'dashboard', '--pm', 'npm', '--modules', 'chat', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const plan = JSON.parse(run.stdout);
		expect(run.code).toBe(1);
		expect(plan.status).toBe('blocked');
		expect(readdirSync(target).sort()).toEqual(originalFiles);
		expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('preserve me');
		expect(run.stubLog).toEqual([]);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('create plan reports unknown modules as conflicts without invoking sv', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-realbin-unknown-plan-'));
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const run = runBin(['create', 'app', '--template', 'dashboard', '--pm', 'npm', '--modules', 'does-not-exist', '--sv-cmd', stub, '--plan', '--json'], cwd);
		const plan = JSON.parse(run.stdout);
		expect(run.code).toBe(1);
		expect(plan.conflicts).toContainEqual(expect.objectContaining({ code: 'unknown-module' }));
		expect(plan.commands).toEqual([]);
		expect(run.stubLog).toEqual([]);
		rmSync(cwd, { recursive: true, force: true });
	});

	it('create --plan --json is deterministic and side-effect free, with exact sv commands', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'sf-realbin-create-plan-'));
		const stub = join(cwd, 'stub-sv.sh');
		writeFileSync(stub, STUB_SV, { mode: 0o755 });
		const originalFiles = readdirSync(cwd).sort();
		const args = ['create', 'app', '--template', 'dashboard', '--pm', 'bun', '--modules', 'chat', '--sv-cmd', stub, '--plan', '--json'];

		const first = runBin(args, cwd);
		const second = runBin(args, cwd);
		const plan = JSON.parse(first.stdout);
		const templateVersion = COMPAT_MANIFEST.packages.svforge;
		const chatVersion = COMPAT_MANIFEST.packages['@svforge/chat'];
		expect(first.code).toBe(0);
		expect(first.stdout).toBe(second.stdout);
		expect(plan.schemaVersion).toBe(1);
		expect(plan.command).toBe('create');
		expect(plan.status).toBe('ready');
		expect(plan.choices).toMatchObject({ template: 'dashboard', packageManager: 'bun', explicitModules: ['chat'] });
		expect(plan.commands).toEqual([
			{
				executable: stub,
				args: ['create', 'app', '--template', 'minimal', '--types', 'ts', '--no-add-ons', '--no-install', '--no-download-check'],
				cwd
			},
			// #547: official foundation first (no install), then the grouped add.
			{
				executable: stub,
				args: [
					'add', 'paraglide=languageTags:en,fr+demo:no',
					'--no-install', '--no-download-check', '--no-git-check'
				],
				cwd: join(cwd, 'app')
			},
			{
				executable: stub,
				args: [
					'add', 'drizzle=database:postgresql+client:postgres.js+docker:no',
					'--no-install', '--no-download-check', '--no-git-check'
				],
				cwd: join(cwd, 'app')
			},
			{
				executable: stub,
				args: ['add', 'better-auth=demo:', '--no-install', '--no-download-check', '--no-git-check'],
				cwd: join(cwd, 'app')
			},
			{
				executable: stub,
				args: [
					'add', `svforge@${templateVersion}=template:dashboard+testing:vitest+hooks:none`,
					`@svforge/chat@${chatVersion}`, '--install', 'bun', '--no-download-check', '--no-git-check'
				],
				cwd: join(cwd, 'app')
			}
		]);
		expect(plan.packages).toEqual(expect.arrayContaining([
			expect.objectContaining({ name: 'svforge', version: templateVersion }),
			expect.objectContaining({ name: '@svforge/chat', version: chatVersion })
		]));
		expect(first.stubLog).toEqual([]);
		expect(existsSync(join(cwd, 'app'))).toBe(false);
		expect(readdirSync(cwd).sort()).toEqual(originalFiles);
		expect(existsSync(join(cwd, 'sv-stub-calls.log'))).toBe(false);
		rmSync(cwd, { recursive: true, force: true });
	});
});
