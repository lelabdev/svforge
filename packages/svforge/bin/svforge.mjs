#!/usr/bin/env node
/**
 * SVForge CLI — doctor (diagnostics), check (design-system harness),
 * preset (composition recipes), context (AI context), upgrade (module
 * upgrades), add (guided module install, #419) and create (one-command
 * project creator, #417).
 *
 * Exposed via the `svforge` bin (#189, #240):
 *   npx svforge doctor
 *   npx svforge check [--strict]
 *   npx svforge add <module…> [--pm <pm>] [--resolve install|fail] [--yes]
 *   npx svforge create <dir> [--template t] [--pm pm] [--testing x]
 *                            [--hooks h] [--modules a,b|all]
 *                            [--runtime long-lived-node] [--yes]
 *   npx svforge upgrade <module> [--to <version>] [--force]
 */



// The dist is bundled by tsdown; load it the same way the package exports do.
const api = await import('../dist/index.js');

const [, , command, ...args] = process.argv;

async function realPrompt() {
	// Zero-dependency prompts on raw stdin/stdout: the sv add packaging
	// contract forbids runtime dependencies on @svforge/* packages, and no
	// readline built-in is assumed (minimal node builds lack it).
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
	return {
		confirm: async (message) => {
			const answer = (await ask(`${message} [y/N] `)).trim().toLowerCase();
			return answer === 'y' || answer === 'yes';
		},
		select: async (message, options) => {
			console.log(message);
			options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
			const answer = Number((await ask('Choose [1]: ')).trim() || '1');
			return options[Number.isInteger(answer) && answer >= 1 && answer <= options.length ? answer - 1 : 0];
		},
		text: async (message, defaultValue) => {
			const answer = (await ask(`${message}${defaultValue ? ` [${defaultValue}]` : ''} `)).trim();
			return answer.length > 0 ? answer : (defaultValue ?? '');
		},
		multiselect: async (message, options) => {
			console.log(message);
			options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
			const answer = (await ask('Comma-separated numbers (empty = none): ')).trim();
			if (answer.length === 0) return [];
			return answer
				.split(',')
				.map((part) => Number(part.trim()))
				.filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
				.map((n) => options[n - 1]);
		}
	};
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

	if (command === 'doctor') {
		const report = await api.doctor(projectRoot);
		api.printReport(report);
		process.exitCode = report.healthy ? 0 : 1;
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

	if (command === 'add') {
		// Guided module install (#419): plan → confirm → ONE grouped sv add.
		// Parse with the TESTED value-aware parser (#426 review): option values
		// (--pm bun, --resolve install) must never become module ids.
		try {
			const { runAddCommand, parseAddArgs } = api;
			const parsed = parseAddArgs(args);
			const result = await runAddCommand(projectRoot, {
				...parsed,
				svCmd: parsed.svCmd ?? process.env.SVFORGE_SV_CMD,
				devRoot: parsed.devRoot ?? process.env.SVFORGE_DEV_ROOT,
				interactive: process.stdin.isTTY === true && !parsed.yes,
				prompt: await realPrompt(),
				spawn: await realSpawn()
			});
			if (result.message) console.error(result.message);
			process.exitCode = result.code;
		} catch (e) {
			console.error(`Add failed: ${e instanceof Error ? e.message : e}`);
			process.exitCode = 1;
		}
		return;
	}

	if (command === 'create') {
		// One-command project creator (#417): plan → official sv create →
		// ONE grouped sv add → validate. Parsing comes from the TESTED
		// value-aware parser (#426 review) — including --git-init/--no-git-init
		// and --runtime, which MUST reach the orchestration.
		try {
			const { runCreateCommand, parseCreateArgs } = api;
			const parsed = parseCreateArgs(args);
			const result = await runCreateCommand(projectRoot, {
				...parsed,
				svCmd: parsed.svCmd ?? process.env.SVFORGE_SV_CMD,
				devRoot: parsed.devRoot ?? process.env.SVFORGE_DEV_ROOT,
				interactive: process.stdin.isTTY === true && !parsed.yes,
				prompt: await realPrompt(),
				spawn: await realSpawn()
			});
			if (result.message) console.error(result.message);
			if (result.code === 0 && result.plan) {
				console.log(`\n✓ Project ready in ${result.plan.dir} — run \`${result.plan.pm} run dev\` to start developing.`);
			}
			process.exitCode = result.code;
		} catch (e) {
			console.error(`Create failed: ${e instanceof Error ? e.message : e}`);
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
		// Regenerate the AI context from the real project state (#234):
		// read .svforge.json, rewrite llms.txt deterministically.
		const fs = await import('node:fs');
		const path = await import('node:path');
		const manifestPath = path.join(projectRoot, '.svforge.json');
		const llmstxtPath = path.join(projectRoot, 'llms.txt');
		if (!fs.existsSync(manifestPath)) {
			console.error('.svforge.json not found — run this in a SvelteForge project root.');
			process.exitCode = 1;
			return;
		}
		const manifest = fs.readFileSync(manifestPath, 'utf-8');
		try {
			fs.writeFileSync(llmstxtPath, api.regenerateLlmstxt(manifest));
		} catch (error) {
			// #324: a corrupt manifest must fail loudly with its remediation,
			// never silently regenerate from an empty base project.
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
			return;
		}
		console.log('✓ llms.txt regenerated from .svforge.json (#234).');
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

	console.error('Usage: svforge <doctor|check [--strict]|preset|context|upgrade|add|create>');
	process.exitCode = 1;
}

main();
