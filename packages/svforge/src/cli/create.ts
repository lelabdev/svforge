import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MODULES } from '../module-composition';
import { regenerateLlmstxt } from '../ai-context';
import { resolveModules, type ResolutionPlan } from '@svforge/addon-kit';
import { addonSpec, svRunner, type SpawnPort } from './add';

/**
 * `svforge create <dir>` — the one-command project creator (#417).
 *
 * An ORCHESTRATOR, never a second SvelteKit generator: it collects the
 * product-level choices once, builds an inspectable plan (through the same
 * resolver as `svforge add`), invokes the official `sv create`, applies the
 * SVForge template + modules with ONE grouped `sv add`, installs once, then
 * validates the result. Failures happen BEFORE the target is touched
 * whenever possible, and a partially configured project is never reported
 * as success.
 */

export interface CreateCommandOptions {
	dir?: string;
	template?: 'base' | 'dashboard';
	pm?: string;
	/** Pinned `sv` binary (deterministic CI); default: the pm dlx runner. */
	svCmd?: string;
	testing?: 'vitest' | 'playwright';
	hooks?: 'none' | 'lefthook';
	/** Module ids, or 'all' for the complete canonical set. */
	modules?: string[] | 'all';
	/** Explicit runtime attestation — currently only 'long-lived-node'. */
	runtime?: 'long-lived-node';
	yes?: boolean;
	interactive?: boolean;
	devRoot?: string;
	prompt?: CreatePromptPort;
	spawn?: SpawnPort;
	/** Post-create validation (defaults to `svforge doctor`). */
	validate?: (dir: string) => Promise<number>;
}

export interface CreatePromptPort {
	text(message: string, defaultValue?: string): Promise<string>;
	select(message: string, options: { value: string; label: string }[]): Promise<string>;
	multiselect(message: string, options: { value: string; label: string }[]): Promise<string[]>;
	confirm(message: string): Promise<boolean>;
}

export interface CreatePlan {
	dir: string;
	template: 'base' | 'dashboard';
	pm: string;
	testing: 'vitest' | 'playwright';
	hooks: 'none' | 'lefthook';
	/** Final module list in deterministic install order. */
	modules: string[];
	/** True when the user picked the implicit "All modules" mode. */
	allModules: boolean;
	/** Chosen (or attested) runtime profile, when one is required. */
	runtime?: 'long-lived-node';
	plan: ResolutionPlan;
}

export interface CreateCommandResult {
	code: number;
	plan?: CreatePlan;
	/** The stage that failed: create | add | record | validate. */
	failedStage?: 'create' | 'add' | 'record' | 'validate';
	aborted?: 'declined' | 'invalid' | 'safety';
	message?: string;
}

/** Every official module, from the canonical registry — never a hard list. */
export function expandAllModules(): string[] {
	return Object.keys(MODULES).sort();
}

const RUNTIME_CAPABILITY_MODULES = ['realtime', 'jobs'];

/** Non-interactive flag parser for `svforge create`. */
export function parseCreateArgs(args: string[]): CreateCommandOptions & { dir?: string } {
	const flag = (name: string): string | undefined => {
		const index = args.indexOf(name);
		return index === -1 ? undefined : args[index + 1];
	};
	const modulesFlag = flag('--modules');
	return {
		dir: args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--modules'),
		template: flag('--template') as 'base' | 'dashboard' | undefined,
		pm: flag('--pm'),
		testing: flag('--testing') as 'vitest' | 'playwright' | undefined,
		hooks: flag('--hooks') as 'none' | 'lefthook' | undefined,
		modules: modulesFlag === 'all' ? 'all' : modulesFlag ? modulesFlag.split(',').map((m) => m.trim()) : undefined,
		runtime: flag('--runtime') as 'long-lived-node' | undefined,
		yes: args.includes('--yes'),
		devRoot: flag('--dev-root')
	};
}

export async function runCreateCommand(
	cwd: string,
	options: CreateCommandOptions
): Promise<CreateCommandResult> {
	const interactive = options.interactive ?? (process.stdin.isTTY === true && !options.yes);
	const prompt = options.prompt;

	// ── 1. Gather the product-level choices ──
	let dir = options.dir;
	let template = options.template;
	let pm: string | undefined = options.pm;
	let testing = options.testing ?? 'vitest';
	let hooks = options.hooks ?? 'none';
	let modulesChoice = options.modules;
	const wantsAll = modulesChoice === 'all';

	if (interactive && prompt) {
		if (!dir) dir = await prompt.text('Project directory?', 'my-app');
		if (!template && !wantsAll) {
			template = (await prompt.select('Which SvelteForge template?', [
				{ value: 'base', label: 'Base — UI kit + layouts + forms (landing, portfolio, marketing…)' },
				{ value: 'dashboard', label: 'Dashboard — base + admin dashboard + auth + DB' }
			])) as 'base' | 'dashboard';
		}
		if (!pm) {
			pm = (await prompt.select('Which package manager?', [
				{ value: 'bun', label: 'Bun' },
				{ value: 'npm', label: 'npm' },
				{ value: 'pnpm', label: 'pnpm' },
				{ value: 'yarn', label: 'Yarn' }
			])) as string;
		}
		if (!options.testing) {
			testing = (await prompt.select('Which testing profile?', [
				{ value: 'vitest', label: 'Vitest — unit and server behavior tests' },
				{ value: 'playwright', label: 'Playwright — Vitest plus full browser tests' }
			])) as 'vitest' | 'playwright';
		}
		if (!options.hooks) {
			hooks = (await prompt.select('Run strict SVForge design checks before Git commits?', [
				{ value: 'none', label: 'None — no automatic commit check' },
				{ value: 'lefthook', label: 'Lefthook — block commits containing design-system errors or warnings' }
			])) as 'none' | 'lefthook';
		}
		if (!modulesChoice) {
			const choices = [
				...Object.keys(MODULES).sort().map((id) => ({ value: id, label: `${id} — ${MODULES[id].description}` })),
				{ value: '__all__', label: 'All modules — the complete stack (implies dashboard)' }
			];
			const picked = await prompt.multiselect('Which modules?', choices);
			modulesChoice = picked.includes('__all__') ? 'all' : picked;
		}
	}

	// ── 2. Non-interactive completeness: never pause for a hidden prompt ──
	const missing: string[] = [];
	if (!dir) missing.push('--dir (positional)');
	if (!pm) missing.push('--pm');
	if (!modulesChoice) missing.push('--modules');
	if (missing.length > 0) {
		return {
			code: 1,
			aborted: 'invalid',
			message: `Missing required choices: ${missing.join(', ')}. Provide them as flags for non-interactive use.`
		};
	}

	// ── 3. All-modules mode: implicit dashboard, explicit refusal otherwise ──
	const allModules = modulesChoice === 'all';
	const requestedModules: string[] = allModules ? expandAllModules() : (modulesChoice as string[]);
	let effectiveTemplate = template;
	if (allModules) {
		if (template === 'base') {
			return {
				code: 1,
				aborted: 'invalid',
				message: 'All-modules mode requires the dashboard template (auth, admin and PostgreSQL foundations). Drop --template base or pick explicit modules.'
			};
		}
		effectiveTemplate = 'dashboard';
	}
	if (!effectiveTemplate) {
		return { code: 1, aborted: 'invalid', message: 'Missing required choices: --template.' };
	}

	// ── 4. Runtime honesty: realtime/jobs cannot live on serverless (#417) ──
	const runtimeCaps = requestedModules.filter((id) => RUNTIME_CAPABILITY_MODULES.includes(id));
	let runtime: 'long-lived-node' | undefined = options.runtime;
	if (runtimeCaps.length > 0) {
		if (!runtime && interactive && prompt) {
			const approved = await prompt.confirm(
				`The selected module(s) ${runtimeCaps.join(', ')} require a long-lived Node runtime (WebSocket servers and/or a background worker). Serverless and edge platforms CANNOT host them. Continue with a long-lived runtime?`
			);
			if (!approved) {
				return { code: 0, aborted: 'declined', message: 'Declined — nothing was created. Choose a long-lived runtime or drop the realtime/jobs modules.' };
			}
			runtime = 'long-lived-node';
		}
		if (!runtime) {
			return {
				code: 1,
				aborted: 'invalid',
				message: `The module(s) ${runtimeCaps.join(', ')} require a long-lived Node runtime. Pass --runtime long-lived-node (or choose modules that fit serverless). Nothing was created.`
			};
		}
		if (runtime !== 'long-lived-node') {
			return { code: 1, aborted: 'invalid', message: `Unsupported runtime "${runtime}". Only 'long-lived-node' is supported today.` };
		}
	}

	// ── 5. Plan through the shared resolver (#419) ──
	const resolution = resolveModules({ requested: requestedModules, template: effectiveTemplate });
	if (resolution.errors.length > 0) {
		return {
			code: 1,
			aborted: 'invalid',
			message: `Invalid composition: ${resolution.errors.map((e) => `${e.kind}:${e.capability}`).join(', ')}.`
		};
	}

	// ── 6. Safety: never touch an existing non-empty directory ──
	const target = resolve(cwd, dir!);
	if (existsSync(target) && readdirSync(target).length > 0) {
		return {
			code: 1,
			aborted: 'safety',
			message: `Target directory "${target}" already exists and is not empty. Remove it manually if intended — SVForge never deletes existing files.`
		};
	}

	const createPlan: CreatePlan = {
		dir: target,
		template: effectiveTemplate,
		pm: pm!,
		testing,
		hooks,
		modules: resolution.order,
		allModules,
		runtime,
		plan: resolution
	};

	// ── 7. Inspectable plan, then confirm ──
	const summary = [
		`Directory:        ${target}`,
		`Template:         ${effectiveTemplate}${allModules ? ' (implied by all-modules)' : ''}`,
		`Package manager:  ${pm}`,
		`Testing:          ${testing}`,
		`Pre-commit hook:  ${hooks}`,
		`Modules (${resolution.order.length}): ${resolution.order.join(', ')}`,
		runtime ? `Runtime:          ${runtime} (realtime/jobs require it)` : undefined
	].filter(Boolean) as string[];
	if (interactive && prompt && !options.yes) {
		const approved = await prompt.confirm(`Create the project with this plan?\n${summary.map((l) => `  ${l}`).join('\n')}`);
		if (!approved) {
			return { code: 0, plan: createPlan, aborted: 'declined', message: 'Declined — nothing was created.' };
		}
	}

	const spawn = options.spawn;
	if (!spawn) {
		// No spawn port: plan-only mode (test seam; the CLI always spawns).
		return { code: 0, plan: createPlan };
	}

	// ── 8. Execute: official sv create, then ONE grouped sv add ──
	const sv = svRunner(pm!, options.svCmd);
	const createCode = await spawn(
		sv.command,
		[...sv.prefix, 'create', dir!, '--template', 'minimal', '--types', 'ts', '--no-add-ons', '--no-install', '--no-download-check'],
		{ cwd, stdio: 'inherit' }
	);
	if (createCode !== 0) {
		return {
			code: createCode,
			plan: createPlan,
			failedStage: 'create',
			message: '`sv create` failed — see its output above. Nothing else was run; remove the partial directory manually if needed (SVForge never deletes it).'
		};
	}

	// Dev checkouts install the template addon from file: too — npm otherwise.
	// NOTE: the template package is the UNSCOPED `svforge`, unlike @svforge/*.
	const templateAddon = options.devRoot && existsSync(join(options.devRoot, 'packages', 'svforge'))
		? `file:${join(options.devRoot, 'packages', 'svforge')}`
		: 'svforge';
	const templateSpec = `${templateAddon}=template:${effectiveTemplate}+testing:${testing}+hooks:${hooks}`;
	const moduleSpecs = resolution.order.map((id) => addonSpec(id, options.devRoot));
	const addCode = await spawn(
		sv.command,
		[...sv.prefix, 'add', templateSpec, ...moduleSpecs, '--install', pm!, '--no-download-check'],
		{ cwd: target, stdio: 'inherit' }
	);
	if (addCode !== 0) {
		return {
			code: addCode,
			plan: createPlan,
			failedStage: 'add',
			message: '`sv add` failed — see its output above. The project exists but is not fully configured; it is NOT ready to use.'
		};
	}

	// ── 9. Record the chosen runtime honestly ──
	const manifestPath = join(target, '.svforge.json');
	if (runtime && existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
				deployment?: { profile?: string; profiles?: unknown };
				[key: string]: unknown;
			};
			manifest.deployment = { ...(manifest.deployment ?? {}), profile: runtime };
			writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
			try {
				writeFileSync(join(target, 'llms.txt'), regenerateLlmstxt(JSON.stringify(manifest)));
			} catch {
				// Cosmetic: the manifest is patched (the honest record); a stale
				// llms.txt can be regenerated with `npx svforge context`.
			}
		} catch {
			return {
				code: 1,
				plan: createPlan,
				failedStage: 'record',
				message: 'Could not record the runtime profile in .svforge.json — fix the manifest, then run `npx svforge context`.'
			};
		}
	}

	// ── 10. Validate: a partially configured project is never a success ──
	const validate = options.validate ?? (async (dir: string) => {
		const { doctor } = await import('../doctor');
		const report = await doctor(dir);
		return report.healthy ? 0 : 1;
	});
	const validateCode = await validate(target);
	if (validateCode !== 0) {
		return {
			code: validateCode,
			plan: createPlan,
			failedStage: 'validate',
			message: 'Post-create validation failed (`svforge doctor`) — inspect the report above before using the project.'
		};
	}

	return { code: 0, plan: createPlan };
}
