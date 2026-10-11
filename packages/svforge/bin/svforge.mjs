#!/usr/bin/env node
/**
 * SVForge CLI — doctor (diagnostics), check (design-system harness),
 * preset (composition recipes), context (AI context), ui (project UI strategy),
 * upgrade (module upgrades), add (guided module install, #419), create
 * (one-command project creator, #417) and verify (project readiness, #470).
 *
 * Exposed via the `svforge` bin (#189, #240):
 *   npx svforge doctor
 *   npx svforge check [--strict]
 *   npx svforge verify
 *   npx svforge add <module…> [--pm <pm>] [--resolve install|fail] [--yes]
 *                            [--plan [--json]]
 *   npx svforge create <dir> [--template t] [--pm pm] [--testing x]
 *                            [--hooks h] [--modules a,b|all]
 *                            [--runtime long-lived-node] [--graphify] [--yes]
 *                            [--plan [--json]]
 *   npx svforge upgrade <module> [--to <version>] [--force]
 */



// The dist is bundled by tsdown; load it the same way the package exports do.
const api = await import('../dist/index.js');

const [, , command, ...args] = process.argv;

import { createCliPrompt } from './prompts.mjs';

async function realPrompt() {
	// Zero-dependency prompts, compatible with the shipped npm package.
	const ask = (question) =>
		new Promise((resolvePromise) => {
			process.stdout.write(question);
			let buffer = '';
			const onData = (chunk) => {
				buffer += chunk;
				if (buffer.includes('\n')) {
					process.stdin.removeListener('data', onData);
					resolvePromise(buffer.split('\n')[0].trim());
				}
			};
			process.stdin.on('data', onData);
		});
	return createCliPrompt(ask);
}

async function realSpawn() {
	const { spawn } = await import('node:child_process');
	return (command, args, options) =>
		new Promise((resolvePromise, rejectPromise) => {
			const child = spawn(command, args, { cwd: options.cwd, stdio: 'inherit', shell: false });
			child.on('exit', (code) => resolvePromise(code ?? 1));
			child.on('error', rejectPromise);
		});
}

async function main() {
	const projectRoot = process.cwd();
	const path = await import('node:path');

	if (command === 'doctor') {
		const report = await api.doctor(projectRoot);
		api.printReport(report);
		process.exitCode = report.healthy ? 0 : 1;
		return;
	}

	if (command === 'ui') {
		const [action, ...uiArgs] = args;
		const packageName = uiArgs[0];
		if (action === 'register' && packageName && !packageName.startsWith('-')) {
			const componentRoots = [];
			for (let index = 1; index < uiArgs.length; index++) {
				if (uiArgs[index] !== '--component-root') {
					console.error('Usage: svforge ui register <package> [--component-root <path>]');
					process.exitCode = 1;
					return;
				}
				const value = uiArgs[index + 1];
				if (!value || value.startsWith('-')) {
					console.error('Usage: svforge ui register <package> [--component-root <path>]');
					process.exitCode = 1;
					return;
				}
				componentRoots.push(value);
				index++;
			}
			if (uiArgs.some((arg, index) => index > 0 && arg.startsWith('--') && arg !== '--component-root')) {
				console.error('Usage: svforge ui register <package> [--component-root <path>]');
				process.exitCode = 1;
				return;
			}
			try {
				api.registerUiLibrary(projectRoot, packageName, componentRoots);
				console.log(`✓ ${packageName} registered in .svforge.json; llms.txt refreshed.`);
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exitCode = 1;
			}
			return;
		}
		if (action === 'prefer' && packageName && uiArgs.length === 1) {
			try {
				api.setPreferredUi(projectRoot, packageName);
				console.log(`✓ Preferred UI strategy set to ${packageName}; llms.txt refreshed.`);
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exitCode = 1;
			}
			return;
		}
		console.error('Usage: svforge ui register <package> [--component-root <path>] | svforge ui prefer <skeleton|registered-package>');
		process.exitCode = 1;
		return;
	}

	if (command === 'check') {
		// Strict mode (#344): WARN is blocking too, for opt-in Git hooks.
		const strict = args.includes('--strict');
		const results = await api.checkDesignSystem(projectRoot);
		const errors = results.filter((r) => r.status === 'error');
		const warnings = results.filter((r) => r.status === 'warn');
		console.log('\n SVForge check (design system)\n');
		for (const r of results) {
			const icon = r.status === 'ok' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
			console.log(`  ${icon} [${r.module}] ${r.status.toUpperCase()}: ${r.message}`);
		}
		if (errors.length || (strict && warnings.length)) {
			console.log(`\n✗ ${errors.length + (strict ? warnings.length : 0)} design-system violation(s). Fix them before proceeding.`);
		} else if (warnings.length) {
			console.log(`\n⚠ ${warnings.length} warning(s) — review, not blocking.`);
		} else {
			console.log('\n✓ Design system is clean.');
		}
		process.exitCode = errors.length || (strict && warnings.length) ? 1 : 0;
		return;
	}

	if (command === 'modules') {
		// Canonical module registry (#470): the release golden path derives the
		// expected `--modules all` set from here instead of a duplicated list.
		const ids = api.expandAllModules();
		if (args.includes('--json')) console.log(JSON.stringify(ids));
		else for (const id of ids) console.log(id);
		return;
	}

	if (command === 'verify') {
		// Project readiness (#470): doctor → check → project check → build →
		// test. The same light validation a human or agent runs by hand.
		try {
			const { runVerify, printVerifyResult } = api;
			const result = await runVerify(projectRoot, { spawn: await realSpawn() });
			printVerifyResult(result);
			process.exitCode = result.ok ? 0 : 1;
		} catch (e) {
			console.error(`Verify failed: ${e instanceof Error ? e.message : e}`);
			process.exitCode = 1;
		}
		return;
	}

	if (command === 'add') {
		// Guided module install (#419): plan → confirm → ONE grouped sv add.
		// --plan disables prompts and spawn; --json only changes its output format.
		const planOnly = args.includes('--plan');
		const jsonOutput = args.includes('--json');
		const parsed = api.parseAddArgs(args);
		if (jsonOutput && !planOnly) {
			console.error('--json is only supported with --plan.');
			process.exitCode = 2;
			return;
		}
		try {
			const result = await api.runAddCommand(projectRoot, {
				...parsed,
				svCmd: parsed.svCmd ?? process.env.SVFORGE_SV_CMD,
				devRoot: parsed.devRoot ?? process.env.SVFORGE_DEV_ROOT,
				interactive: planOnly ? false : process.stdin.isTTY === true && !parsed.yes,
				prompt: planOnly ? undefined : await realPrompt(),
				spawn: planOnly ? undefined : await realSpawn()
			});
			if (planOnly) {
				const plan = api.buildCliPlanDocument({
					command: 'add',
					status: result.code !== 0 ? 'blocked' : result.specs?.length ? 'ready' : 'noop',
					exitCode: result.code,
					choices: {
						explicitModules: parsed.modules,
						packageManager: parsed.pm ?? api.detectPackageManager(projectRoot),
						resolveSupportingModules: parsed.resolve ?? 'fail',
						runtime: parsed.runtime ?? null
					},
					workingDirectory: projectRoot,
					template: result.project?.template,
					installedModules: result.project?.installedModules,
					explicitModules: result.requestedModules ?? parsed.modules,
					installOrder: result.plan?.order,
					transitive: result.plan?.supporting,
					alreadyInstalled: result.alreadyInstalled,
					optional: result.plan?.optionalUninstalled,
					resolution: result.plan,
					requiredModules: result.plan?.order ?? parsed.modules,
					packages: result.packages,
					commands: result.code === 0 ? result.commands : [],
					conflicts: result.message && result.code !== 0 ? [{ code: result.aborted ?? 'blocked', message: result.message }] : [],
					errors: result.message && result.code !== 0 ? [{ code: result.aborted ?? 'blocked', message: result.message }] : []
				});
				process.stdout.write(jsonOutput ? `${JSON.stringify(plan, null, 2)}\n` : api.formatCliPlan(plan));
			} else {
				if (result.message) console.error(result.message);
			}
			process.exitCode = result.code;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (planOnly) {
				const plan = api.buildCliPlanDocument({
					command: 'add', status: 'blocked', exitCode: 1,
					choices: { explicitModules: parsed.modules, packageManager: parsed.pm ?? api.detectPackageManager(projectRoot) },
					workingDirectory: projectRoot, explicitModules: parsed.modules,
					errors: [{ code: 'error', message }]
				});
				process.stdout.write(jsonOutput ? `${JSON.stringify(plan, null, 2)}\n` : api.formatCliPlan(plan));
			} else console.error(`Add failed: ${message}`);
			process.exitCode = 1;
		}
		return;
	}

	if (command === 'create') {
		// One-command project creator (#417): plan → official sv create →
		// ONE grouped sv add → validate. Plan mode reuses the same orchestration
		// and exact command builder but never creates a prompt or spawn port.
		const planOnly = args.includes('--plan');
		const jsonOutput = args.includes('--json');
		const parsed = api.parseCreateArgs(args);
		if (jsonOutput && !planOnly) {
			console.error('--json is only supported with --plan.');
			process.exitCode = 2;
			return;
		}
		try {
			const result = await api.runCreateCommand(projectRoot, {
				...parsed,
				svCmd: parsed.svCmd ?? process.env.SVFORGE_SV_CMD,
				devRoot: parsed.devRoot ?? process.env.SVFORGE_DEV_ROOT,
				interactive: planOnly ? false : process.stdin.isTTY === true && !parsed.yes,
				prompt: planOnly ? undefined : await realPrompt(),
				spawn: planOnly ? undefined : await realSpawn()
			});
			if (planOnly) {
				const createPlan = result.plan;
				const requestedModules = parsed.modules === 'all' ? api.expandAllModules() : parsed.modules ?? [];
				const plan = api.buildCliPlanDocument({
					command: 'create',
					status: result.code !== 0 ? 'blocked' : 'ready',
					exitCode: result.code,
					choices: {
						directory: parsed.dir ?? null,
						template: createPlan?.template ?? parsed.template ?? null,
						packageManager: createPlan?.pm ?? parsed.pm ?? null,
						testing: createPlan?.testing ?? parsed.testing ?? 'vitest',
						hooks: createPlan?.hooks ?? parsed.hooks ?? 'none',
						explicitModules: parsed.modules ?? null,
						allModules: createPlan?.allModules ?? parsed.modules === 'all',
						runtime: createPlan?.runtime ?? parsed.runtime ?? null,
						gitInit: createPlan?.gitInit ?? parsed.gitInit ?? true,
						graphify: createPlan?.graphify ?? parsed.graphify ?? false
					},
					workingDirectory: projectRoot,
					directory: createPlan?.dir ?? (parsed.dir ? path.resolve(projectRoot, parsed.dir) : undefined),
					template: createPlan?.template ?? parsed.template,
					explicitModules: createPlan?.plan.requested ?? requestedModules,
					installOrder: createPlan?.modules,
					transitive: createPlan?.plan.supporting,
					optional: createPlan?.plan.optionalUninstalled,
					resolution: createPlan?.plan ?? result.resolution,
					requiredModules: createPlan?.modules ?? requestedModules,
					packages: createPlan?.packages,
					commands: result.code === 0 ? createPlan?.commands : [],
					warnings: createPlan?.plan.warnings ?? result.resolution?.warnings,
					errors: result.message && result.code !== 0 ? [{ code: result.aborted ?? 'blocked', message: result.message }] : []
				});
				process.stdout.write(jsonOutput ? `${JSON.stringify(plan, null, 2)}\n` : api.formatCliPlan(plan));
			} else {
				if (result.notice) console.log(result.notice);
				if (result.message) console.error(result.message);
				if (result.code === 0 && result.plan) {
					console.log(`\n✓ Project ready in ${result.plan.dir} — run \`${result.plan.pm} run dev\` to start developing.`);
				}
			}
			process.exitCode = result.code;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (planOnly) {
				const requestedModules = parsed.modules === 'all' ? api.expandAllModules() : parsed.modules ?? [];
				const plan = api.buildCliPlanDocument({
					command: 'create', status: 'blocked', exitCode: 1,
					choices: { directory: parsed.dir ?? null, template: parsed.template ?? null, packageManager: parsed.pm ?? null, explicitModules: parsed.modules ?? null },
					workingDirectory: projectRoot,
					directory: parsed.dir ? path.resolve(projectRoot, parsed.dir) : undefined,
					template: parsed.template,
					explicitModules: requestedModules,
					requiredModules: requestedModules,
					errors: [{ code: 'error', message }]
				});
				process.stdout.write(jsonOutput ? `${JSON.stringify(plan, null, 2)}\n` : api.formatCliPlan(plan));
			} else console.error(`Create failed: ${message}`);
			process.exitCode = 1;
		}
		return;
	}

	if (command === 'preset') {
		// Preset recipe (#236): print the exact sv add composition.
		const presetName = args.find((a) => !a.startsWith('-'));
		if (!presetName || !api.PRESETS[presetName]) {
			console.error('Usage: svforge preset <name>');
			console.error(`Available presets: ${Object.keys(api.PRESETS ?? {}).join(', ')}`);
			process.exitCode = 1;
			return;
		}
		const specs = api.expandPreset(presetName);
		console.log(`\n Preset: ${presetName} — ${api.PRESETS[presetName].description}\n`);
		console.log('  Composition (run with sv add, no parallel CLI):\n');
		console.log(`  sv add ${specs.join(' ')}`);
		const preset = api.PRESETS[presetName];
		if (preset.optional?.length) {
			console.log(`\n  Optional (never auto-installed): ${preset.optional.join(', ')}\n`);
		}
		return;
	}

	if (command === 'context') {
		// Synchronize all generated locale context from the canonical Inlang
		// settings before writing any output (#438).
		const fs = await import('node:fs');
		const path = await import('node:path');
		const manifestPath = path.join(projectRoot, '.svforge.json');
		const settingsPath = path.join(projectRoot, 'project.inlang/settings.json');
		const agentsPath = path.join(projectRoot, 'AGENTS.md');
		const llmstxtPath = path.join(projectRoot, 'llms.txt');
		for (const [filePath, label] of [[manifestPath, '.svforge.json'], [settingsPath, 'project.inlang/settings.json'], [agentsPath, 'AGENTS.md']]) {
			if (!fs.existsSync(filePath)) {
				console.error(`${label} not found — run this in a scaffolded SvelteForge project root.`);
				process.exitCode = 1;
				return;
			}
		}
		try {
			const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
			const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
			const agentsContent = fs.readFileSync(agentsPath, 'utf-8');
			const manifestSync = api.synchronizeManifestI18n(manifestContent, settingsContent);
			const settings = manifestSync.settings;
			const agentsSync = api.syncAgentLocaleContext(agentsContent, settings);
			const llmsContent = api.regenerateLlmstxt(manifestSync.content);
			const oldLlms = fs.existsSync(llmstxtPath) ? fs.readFileSync(llmstxtPath, 'utf-8') : undefined;
			const drift = manifestSync.drift || agentsSync.drift || oldLlms !== llmsContent;

			// All inputs are parsed and validated before any generated file is written.
			if (manifestSync.content !== manifestContent) fs.writeFileSync(manifestPath, manifestSync.content);
			if (agentsSync.content !== agentsContent) fs.writeFileSync(agentsPath, agentsSync.content);
			if (oldLlms !== llmsContent) fs.writeFileSync(llmstxtPath, llmsContent);

			const localeSummary = `baseLocale ${settings.baseLocale}; locales ${settings.locales.join(', ')}`;
			if (drift) {
				console.log(`⚠ Locale context drift detected; refreshed .svforge.json, AGENTS.md, and llms.txt from project.inlang/settings.json (${localeSummary}).`);
			} else {
				console.log(`✓ Generated locale context already matches project.inlang/settings.json (${localeSummary}).`);
			}
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
			return;
		}
		return;
	}

	if (command === 'upgrade') {
		const moduleName = args.find((a) => !a.startsWith('-'));
		const force = args.includes('--force');
		const dryRun = args.includes('--dry-run');
		const json = args.includes('--json');
		const targetIndex = args.indexOf('--to');
		const targetVersion = targetIndex === -1 ? undefined : args[targetIndex + 1];
		if (targetIndex !== -1 && !targetVersion) {
			console.error('Usage: svforge upgrade <module> [--to <version>] [--force] [--dry-run] [--json]');
			process.exitCode = 1;
			return;
		}
		if (!moduleName) {
			console.error('Usage: svforge upgrade <module> [--to <version>] [--force] [--dry-run] [--json]');
			console.error(`Available modules: ${Object.keys(api.MODULE_RECIPES ?? {}).join(', ')}`);
			process.exitCode = 1;
			return;
		}
		try {
			const result = await api.upgrade(moduleName, projectRoot, { force, targetVersion, dryRun });
			if (json) {
				// Machine-readable plan/result (#327): the full operation list with
				// resolutions, diffs and summary — safe to pipe or diff.
				console.log(JSON.stringify(result, null, 2));
			} else {
				api.printUpgradeResult(result);
			}
			const conflicts = result.operations.filter((op) => op.resolution === 'conflict').length;
			process.exitCode = conflicts > 0 && !force ? 1 : 0;
		} catch (e) {
			console.error(`Upgrade failed: ${e instanceof Error ? e.message : e}`);
			process.exitCode = 1;
		}
		return;
	}

	console.error('Usage: svforge <doctor|check [--strict]|verify|modules|preset|context|ui|upgrade|add|create>');
	process.exitCode = 1;
}

main();
