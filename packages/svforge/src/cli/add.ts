import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	MODULE_CONTRACTS,
	readDeclaredProvides,
	resolveModules,
	snapshotProject,
	type ResolutionPlan,
	type ResolveInput
} from '@svforge/addon-kit';
import { COMPAT_MANIFEST } from '../compat';
import { plannedPackage, type PlannedCommand, type PlannedPackage } from './plan';

/**
 * `svforge add <modules...>` — the guided, dependency-aware install path
 * (#419). Pure decision logic lives in the planner (addon-kit/resolve); this
 * module adds I/O: state reading, prompting, and the single grouped
 * `sv add` invocation. Ports (prompts, spawn) are injectable for tests.
 */

export type AddResolvePolicy = 'install' | 'fail';

export interface PromptPort {
	confirm(message: string): Promise<boolean>;
	/** Resolve an ambiguity: pick one provider id from the list. */
	select(message: string, options: string[]): Promise<string>;
}

export interface SpawnPort {
	(command: string, args: string[], options: { cwd: string; stdio: 'inherit' }): Promise<number>;
}

export interface AddCommandOptions {
	modules: string[];
	/** Package manager for `sv add --install <pm>`. Detected from lockfiles. */
	pm?: string;
	/** Pinned `sv` binary (deterministic CI); default: the pm dlx runner. */
	svCmd?: string;
	/**
	 * Explicit runtime attestation (#419 review): required non-interactively
	 * when the plan carries runtime.* requirements. Only long-lived Node is
	 * supported today.
	 */
	runtime?: 'long-lived-node';
	/** Non-interactive policy for supporting modules. Default 'fail'. */
	resolve?: AddResolvePolicy;
	/** Skip every prompt (implies --resolve install). */
	yes?: boolean;
	/** Monorepo override: install addons from file:<devRoot>/packages/<id>. */
	devRoot?: string;
	/** Packaged-artifact override: install addons from file:<addonRoot>/<id>. */
	addonRoot?: string;
	/** Pin npm addon versions (post-release). Never an implicit `latest`. */
	addonVersion?: string;
	/** Per-package compatible versions (distro release validation). */
	compatVersions?: Record<string, string>;
	interactive?: boolean;
	prompt?: PromptPort;
	spawn?: SpawnPort;
}

export interface AddCommandResult {
	code: number;
	plan?: ResolutionPlan;
	specs?: string[];
	commands?: PlannedCommand[];
	packages?: PlannedPackage[];
	project?: { template?: 'base' | 'dashboard'; installedModules: string[] };
	requestedModules?: string[];
	alreadyInstalled?: string[];
	/** Why the command stopped without running `sv add`. */
	aborted?: 'declined' | 'policy' | 'errors' | 'unknown';
	message?: string;
}

/** Detect the package manager from the lockfile present in the project. */
export function detectPackageManager(cwd: string): string {
	if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
	if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
	if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
	return 'npm';
}

/** The dlx runner of a package manager (`sv` is not a project dependency). */
export function dlxRunner(pm: string): { command: string; prefix: string[] } {
	switch (pm) {
		case 'bun':
			return { command: 'bunx', prefix: [] };
		case 'pnpm':
			return { command: 'pnpm', prefix: ['dlx'] };
		case 'yarn':
			return { command: 'yarn', prefix: ['dlx'] };
		default:
			return { command: 'npx', prefix: [] };
	}
}

/**
 * How to invoke `sv`: via the package manager's dlx runner by default, or a
 * pinned binary (SVFORGE_SV_CMD / --sv-cmd flows) for deterministic CI.
 */
export function svRunner(pm: string, svCmd?: string): { command: string; prefix: string[] } {
	if (svCmd) return { command: svCmd, prefix: [] };
	const runner = dlxRunner(pm);
	return { command: runner.command, prefix: [...runner.prefix, 'sv'] };
}

/**
 * Addon spec for one module.
 *
 * Resolution order (first match wins):
 *   1. `file:` from a dev checkout (`--dev-root`, monorepo contributors);
 *   2. `file:` from a directory of EXTRACTED packaged artifacts (`--addon-root`,
 *      the release golden path / offline installs). FAILS CLOSED: a missing
 *      artifact is an error, never a silent npm fallback — otherwise a
 *      pre-publish run could validate an older registry package instead of the
 *      current artifacts (#470);
 *   3. the exact per-package compatible version from the compatibility manifest
 *      (embedded in the published `svforge`, or supplied for post-publish
 *      validation). A requested module missing from the map is an error, so the
 *      CLI never silently resolves an implicit `latest` (#470);
 *   4. an explicit single `version` override (legacy, all packages);
 *   5. an unpinned npm specifier (legacy fallback when no compatibility source is available).
 */
export interface AddonSpecOptions {
	devRoot?: string;
	addonRoot?: string;
	/** Single explicit version applied to the module (legacy override). */
	version?: string;
	/** Per-package compatible versions, keyed by npm package name. */
	compatVersions?: Record<string, string>;
}

export function addonSpec(moduleId: string, options: AddonSpecOptions = {}): string {
	const { devRoot, addonRoot, version, compatVersions } = options;
	if (devRoot && existsSync(join(devRoot, 'packages', moduleId))) {
		return `file:${join(devRoot, 'packages', moduleId)}`;
	}
	if (addonRoot) {
		const artifact = join(addonRoot, moduleId);
		if (!existsSync(artifact)) {
			throw new Error(
				`Required packaged add-on "${moduleId}" is missing from --addon-root "${addonRoot}" (expected ${artifact}). ` +
					`Refusing to fall back to npm: the pre-publish gate must only validate the current packaged artifacts.`
			);
		}
		return `file:${artifact}`;
	}
	if (compatVersions) {
		const resolved = compatVersions[`@svforge/${moduleId}`];
		if (!resolved) {
			throw new Error(
				`No compatible version for module "${moduleId}" in the SVForge compatibility manifest. ` +
					`Refusing to resolve an implicit \`latest\`.`
			);
		}
		return `@svforge/${moduleId}@${resolved}`;
	}
	return `@svforge/${moduleId}${version ? `@${version}` : ''}`;
}

interface ProjectState {
	template?: 'base' | 'dashboard';
	installed: string[];
	declaredProvides: string[];
	warnings: string[];
}

function readState(cwd: string): ProjectState {
	const state: ProjectState = { installed: [], declaredProvides: [], warnings: [] };
	const manifestPath = join(cwd, '.svforge.json');
	if (existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
				template?: 'base' | 'dashboard';
				modules?: string[];
			};
			state.template = manifest.template === 'base' || manifest.template === 'dashboard' ? manifest.template : undefined;
			if (manifest.template !== undefined && state.template === undefined) {
				state.warnings.push('Ignored unknown template in .svforge.json.');
			}
			state.installed = Array.isArray(manifest.modules)
				? manifest.modules.filter((id): id is string => typeof id === 'string')
				: [];
			if (manifest.modules !== undefined && !Array.isArray(manifest.modules)) {
				state.warnings.push('Ignored invalid modules list in .svforge.json.');
			}
		} catch {
			// Unreadable manifest: fall through — the resolver works from
			// structure and declarations alone, and readDeclaredProvides
			// below reports the corruption as a warning.
		}
	}
	const declared = readDeclaredProvides(cwd);
	state.declaredProvides = declared.provides;
	state.warnings.push(...declared.warnings);
	return state;
}

/** Flags that CONSUME the next argument — values must never become module ids. */
const ADD_FLAGS_WITH_VALUES = ['--pm', '--resolve', '--sv-cmd', '--dev-root', '--addon-root', '--addon-version', '--runtime'] as const;

export interface ParsedAddArgs {
	modules: string[];
	pm?: string;
	resolve?: AddResolvePolicy;
	svCmd?: string;
	devRoot?: string;
	addonRoot?: string;
	addonVersion?: string;
	runtime?: 'long-lived-node';
	yes?: boolean;
}

/**
 * Value-aware parser for `svforge add` (#419 review): `--pm bun` must never
 * turn `bun` into a module id.
 */
export function parseAddArgs(args: string[]): ParsedAddArgs {
	const parsed: ParsedAddArgs = { modules: [] };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if ((ADD_FLAGS_WITH_VALUES as readonly string[]).includes(arg)) {
			const value = args[++i];
			switch (arg) {
				case '--pm':
					parsed.pm = value;
					break;
				case '--resolve':
					parsed.resolve = value as AddResolvePolicy;
					break;
				case '--sv-cmd':
					parsed.svCmd = value;
					break;
				case '--dev-root':
					parsed.devRoot = value;
					break;
				case '--addon-root':
					parsed.addonRoot = value;
					break;
				case '--addon-version':
					parsed.addonVersion = value;
					break;
				case '--runtime':
					parsed.runtime = value as 'long-lived-node';
					break;
			}
			continue;
		}
		if (arg === '--yes') {
			parsed.yes = true;
			continue;
		}
		if (!arg.startsWith('-')) parsed.modules.push(arg);
	}
	return parsed;
}

export async function runAddCommand(cwd: string, options: AddCommandOptions): Promise<AddCommandResult> {
	const interactive = options.interactive ?? (process.stdin.isTTY === true && !options.yes);
	const policy: AddResolvePolicy = options.yes ? 'install' : (options.resolve ?? 'fail');
	const pm = options.pm ?? detectPackageManager(cwd);

	if (options.modules.length === 0) {
		return { code: 1, aborted: 'errors', message: 'Usage: svforge add <module> [more…]' };
	}
	if (options.modules.includes('svforge')) {
		return {
			code: 1,
			aborted: 'errors',
			message: 'The template installs with `sv add svforge=template:base|dashboard` (or `svforge create`). `svforge add` is for standalone modules.'
		};
	}
	const state = readState(cwd);
	const snapshot = snapshotProject(cwd);
	if (!existsSync(join(cwd, 'package.json'))) {
		state.warnings.push('package.json is missing; installed package versions and package-manager state cannot be verified.');
	}
	const packageModules = Object.keys(MODULE_CONTRACTS).filter((id) => snapshot.dependencies.has(`@svforge/${id}`));
	const installedModules = [...new Set([...state.installed, ...packageModules])].sort();
	for (const id of state.installed) {
		if (!packageModules.includes(id)) state.warnings.push(`.svforge.json marks ${id} installed, but package.json has no @svforge/${id} dependency.`);
	}
	for (const id of packageModules) {
		if (!state.installed.includes(id)) state.warnings.push(`package.json declares @svforge/${id}, but .svforge.json does not record it as installed.`);
	}
	const alreadyInstalled = options.modules.filter((id) => MODULE_CONTRACTS[id] && installedModules.includes(id));
	const requestedModules = options.modules.filter((id) => !MODULE_CONTRACTS[id] || !installedModules.includes(id));
	const resultContext = {
		project: { ...(state.template ? { template: state.template } : {}), installedModules },
		requestedModules: [...options.modules],
		alreadyInstalled
	};
	const compatibilityVersions = options.compatVersions ??
		(!options.devRoot && !options.addonRoot && !options.addonVersion ? COMPAT_MANIFEST.packages : undefined);
	const baseInput: ResolveInput = {
		requested: requestedModules,
		installed: installedModules,
		template: state.template,
		declaredProvides: state.declaredProvides as ResolveInput['declaredProvides'],
		snapshot
	};

	// Resolve ambiguities interactively before the final plan: first pass
	// detects them, the port collects one choice each, second pass applies.
	const firstPass = resolveModules(baseInput);
	const ambiguities = firstPass.errors.filter((e) => e.kind === 'ambiguous');
	let resolveInput = baseInput;
	if (ambiguities.length > 0 && interactive && options.prompt) {
		const choices = new Map<string, string>();
		for (const error of ambiguities) {
			if (error.kind !== 'ambiguous') continue;
			choices.set(
				error.capability,
				await options.prompt.select(`Several modules provide ${error.capability}:`, error.providers)
			);
		}
		resolveInput = {
			...baseInput,
			chooseProvider: (capability, providers) => {
				const remembered = choices.get(capability);
				return remembered && providers.includes(remembered) ? remembered : providers[0]!;
			}
		};
	}
	const plan = resolveModules(resolveInput);
	plan.warnings.unshift(...state.warnings);

	if (plan.unknownModules.length > 0) {
		return {
			code: 1,
			plan,
			...resultContext,
			aborted: 'unknown',
			message: `Unknown module(s): ${plan.unknownModules.join(', ')}. Available: ${Object.keys(MODULE_CONTRACTS).sort().join(', ')}.`
		};
	}
	if (plan.errors.length > 0) {
		const lines = plan.errors.map((e) =>
			e.kind === 'ambiguous'
				? `Capability ${e.capability} can be provided by several modules: ${e.providers.join(', ')} — pick one interactively.`
				: `No SVForge module provides ${e.capability}.`
		);
		return {
			code: 1,
			plan,
			...resultContext,
			aborted: 'errors',
			message: `Cannot resolve the installation plan:\n${lines.map((l) => `  - ${l}`).join('\n')}`
		};
	}

	if (plan.supporting.length > 0) {
		const names = plan.supporting.map((s) => s.moduleId).join(', ');
		if (interactive && options.prompt) {
			const approved = await options.prompt.confirm(
				`Installing ${plan.requested.join(', ')} also requires the supporting module(s): ${names}. Approve the plan?`
			);
			if (!approved) {
				return { code: 0, plan, ...resultContext, aborted: 'declined', message: 'Declined — nothing was written.' };
			}
		} else if (policy === 'fail') {
			return {
				code: 1,
				plan,
				...resultContext,
				aborted: 'policy',
				message: `Supporting module(s) required: ${names}. Re-run with --resolve install (or approve interactively). Nothing was written.`
			};
		}
	}

	for (const token of plan.runtimeAttestations) {
		if (interactive && options.prompt) {
			const ok = await options.prompt.confirm(
				`Installing ${plan.requested.join(', ')} requires ${token} — confirm your runtime supports it (serverless/edge do not).`
			);
			if (!ok) {
				return { code: 0, plan, ...resultContext, aborted: 'declined', message: 'Declined — nothing was written.' };
			}
		} else if (options.runtime === 'long-lived-node') {
			// #419 review: non-interactive installs need an EXPLICIT attestation,
			// not a silent warning.
			plan.warnings.push(`Runtime requirement ${token} attested via --runtime long-lived-node.`);
		} else {
			return {
				code: 1,
				plan,
				...resultContext,
				aborted: 'policy',
				message: `Runtime requirement(s) ${plan.runtimeAttestations.join(', ')}: a non-interactive install must attest the deployment target explicitly with --runtime long-lived-node (serverless/edge cannot host them). Nothing was written.`
			};
		}
	}

	const modulesToInstall = plan.order.filter((id) => !installedModules.includes(id));
	const specs = modulesToInstall.map((id) =>
		addonSpec(id, {
			devRoot: options.devRoot,
			addonRoot: options.addonRoot,
			version: options.addonVersion,
			compatVersions: compatibilityVersions
		})
	);
	const sourceForSpec = (spec: string): PlannedPackage['source'] => {
		if (spec.startsWith('file:')) return options.addonRoot ? 'packaged-artifact' : 'workspace';
		if (compatibilityVersions) return 'compatibility-manifest';
		if (options.addonVersion) return 'explicit-version';
		return 'registry';
	};
	const packages = modulesToInstall.map((id, index) => plannedPackage(`@svforge/${id}`, specs[index]!, sourceForSpec(specs[index]!)));
	const sv = svRunner(pm, options.svCmd);
	const commands: PlannedCommand[] = specs.length > 0
		? [{
			executable: sv.command,
			args: [...sv.prefix, 'add', ...specs, '--install', pm, '--no-download-check', '--no-git-check'],
			cwd
		}]
		: [];
	const result = { ...resultContext, plan, specs, packages, commands };
	if (!options.spawn || commands.length === 0) {
		// The CLI plan path omits spawn; the same exact command data is reused by apply.
		return { code: 0, ...result };
	}
	const command = commands[0]!;
	const code = await options.spawn(command.executable, command.args, { cwd: command.cwd, stdio: 'inherit' });
	return { code, ...result };
}
