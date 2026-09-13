import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	CAPABILITY_TOKENS,
	MODULE_CONTRACTS,
	TEMPLATE_PROVIDES,
	detectCapability,
	type Capability,
	type ModuleCapabilityContract,
	type ProjectSnapshot
} from './capabilities';

/**
 * Module dependency resolution (#419).
 *
 * The #323 gate FAILS when a required capability is structurally absent.
 * This planner is the guided layer on top: it resolves the missing
 * capabilities through the canonical registry (MODULE_CONTRACTS — never a
 * second dependency list) BEFORE anything is written, and produces an
 * explicit, deterministic installation plan.
 *
 * Provider evidence, in precedence order:
 *   1. declared external capabilities (.svforge.json `capabilities.provides`)
 *   2. structural evidence from the real project (snapshot, `satisfied`)
 *   3. the active SVForge template
 *   4. already-installed SVForge modules
 *   5. structural evidence with indirect confidence only (`unverified`)
 * Anything still missing is proposed as a SUPPORTING SVForge module —
 * except `runtime.*`, which no module can provide: those become explicit
 * runtime attestations.
 *
 * The contract's `template` field is NEVER used as proof of satisfaction
 * (uploads is marked template:'base' but requires auth.currentUser, which
 * base does not provide). Only requires/provides drive the resolution.
 */

export interface ResolveInput {
	/** Module ids the user explicitly asked for, in the user's order. */
	requested: string[];
	/** Module ids already installed in the project. */
	installed?: string[];
	/** Active SVForge template, when the project declares one. */
	template?: 'base' | 'dashboard';
	/** External capabilities declared by the project (.svforge.json). */
	declaredProvides?: Capability[];
	/** Structural snapshot of the project (optional evidence). */
	snapshot?: ProjectSnapshot;
	/** Registry override (tests). Defaults to the canonical MODULE_CONTRACTS. */
	contracts?: Record<string, ModuleCapabilityContract>;
	/**
	 * Interactive ambiguity hook: when several modules can provide a missing
	 * capability, the caller may inject a choice (UI prompt). Without it,
	 * ambiguities are reported as errors (non-interactive policy).
	 */
	chooseProvider?: (capability: Capability, providers: string[]) => string;
}

export type PlanProvider =
	| { kind: 'declared' }
	| { kind: 'structural'; confidence: 'satisfied' | 'unverified' }
	| { kind: 'template' }
	| { kind: 'installed'; moduleId: string }
	| { kind: 'module'; moduleId: string };

export interface PlanError {
	kind: 'unsatisfiable' | 'ambiguous' | 'cycle';
	capability: Capability;
	providers: string[];
}

export interface ResolutionPlan {
	/** The ids the user asked for (filtered of unknown modules). */
	requested: string[];
	/** Final deterministic install order — dependencies before dependents. */
	order: string[];
	/** Modules NOT requested but required, with the capabilities that pulled them in. */
	supporting: { moduleId: string; forCapabilities: Capability[] }[];
	/** How each required capability is satisfied. */
	satisfied: { capability: Capability; provider: PlanProvider }[];
	/** Modules offered as recommendations only — never auto-installed. */
	optionalUninstalled: string[];
	/** Runtime constraints no module can provide — need explicit attestation. */
	runtimeAttestations: Capability[];
	warnings: string[];
	/** Requested ids absent from the registry. */
	unknownModules: string[];
	/** Blocking problems, before any file is written. */
	errors: PlanError[];
}

/** Read `capabilities.provides` from .svforge.json, validating the tokens. */
export function readDeclaredProvides(cwd: string): { provides: Capability[]; warnings: string[] } {
	const path = join(cwd, '.svforge.json');
	if (!existsSync(path)) return { provides: [], warnings: [] };
	try {
		const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
			capabilities?: { provides?: string[] };
		};
		const raw = manifest.capabilities?.provides ?? [];
		const provides: Capability[] = [];
		const warnings: string[] = [];
		for (const token of raw) {
			if ((CAPABILITY_TOKENS as readonly string[]).includes(token)) {
				provides.push(token as Capability);
			} else {
				warnings.push(`Ignored unknown declared capability "${token}" in .svforge.json (capabilities.provides).`);
			}
		}
		return { provides, warnings };
	} catch (e) {
		// A corrupt manifest must not silently weaken the resolution.
		return {
			provides: [],
			warnings: [`Ignored unreadable .svforge.json: ${(e as Error).message}`]
		};
	}
}

export function resolveModules(input: ResolveInput): ResolutionPlan {
	const contracts = input.contracts ?? MODULE_CONTRACTS;
	const installed = new Set(input.installed ?? []);
	const warnings: string[] = [];
	const errors: PlanError[] = [];

	const satisfied = new Map<Capability, PlanProvider>();
	const satisfiedLog: { capability: Capability; provider: PlanProvider }[] = [];
	function satisfy(token: Capability, provider: PlanProvider): boolean {
		if (!satisfied.has(token)) {
			satisfied.set(token, provider);
			satisfiedLog.push({ capability: token, provider });
			if (provider.kind === 'structural' && provider.confidence === 'unverified') {
				warnings.push(
					`${token}: dependency installed but the expected wiring could not be verified — the module installs, verify this capability yourself.`
				);
			}
		}
		return true;
	}

	// ── Seed evidence, in precedence order ──
	const allCaps = Object.keys(CAPABILITY_TOKENS_MAP()) as Capability[];
	if (input.declaredProvides?.length) {
		for (const token of input.declaredProvides) satisfy(token, { kind: 'declared' });
	}
	if (input.snapshot) {
		for (const token of allCaps) {
			if (satisfied.has(token)) continue;
			const detection = detectCapability(token, input.snapshot);
			if (detection === 'satisfied') satisfy(token, { kind: 'structural', confidence: 'satisfied' });
		}
	}
	if (input.template) {
		for (const token of TEMPLATE_PROVIDES[input.template]) {
			if (!satisfied.has(token)) satisfy(token, { kind: 'template' });
		}
	}
	for (const id of input.installed ?? []) {
		const contract = contracts[id];
		if (!contract) continue;
		for (const token of contract.provides) {
			if (!satisfied.has(token)) satisfy(token, { kind: 'installed', moduleId: id });
		}
	}
	if (input.snapshot) {
		for (const token of allCaps) {
			if (satisfied.has(token)) continue;
			const detection = detectCapability(token, input.snapshot);
			if (detection === 'unverified') satisfy(token, { kind: 'structural', confidence: 'unverified' });
		}
	}

	// ── Walk the requested modules, pulling supporting modules transitively ──
	const order: string[] = [];
	const supporting = new Map<string, { moduleId: string; forCapabilities: Capability[] }>();
	const inProgress = new Set<string>();
	const runtimeAttestations = new Set<Capability>();

	function ensureModule(id: string): void {
		if (!contracts[id]) {
			if (!unknownSeen.has(id)) unknownSeen.add(id);
			return;
		}
		if (order.includes(id) || inProgress.has(id)) return;
		inProgress.add(id);
		try {
			const errorsBefore = errors.length;
			for (const token of contracts[id].requires) {
				if (satisfied.has(token)) continue;
				if (token.startsWith('runtime.')) {
					// No SVForge module can provide a runtime property — the user
					// (or their deployment target) must attest it explicitly.
					runtimeAttestations.add(token);
					continue;
				}
				const providers = Object.keys(contracts)
					.filter((candidate) => contracts[candidate].provides.includes(token))
					.sort();
				if (providers.length === 0) {
					errors.push({ kind: 'unsatisfiable', capability: token, providers: [] });
					continue;
				}
				// A provider already fully planned settles the capability — its own
				// requirements were resolved when it was planned.
				const settled = providers.find((p) => order.includes(p));
				if (settled) {
					satisfy(token, { kind: 'module', moduleId: settled });
					continue;
				}
				const undecided = providers.filter((p) => !inProgress.has(p));
				if (undecided.length === 0) {
					// Every provider is still being resolved → dependency cycle.
					errors.push({ kind: 'cycle', capability: token, providers: [...inProgress].sort() });
					continue;
				}
				let chosen: string | undefined;
				if (undecided.length > 1) {
					if (input.chooseProvider) {
						chosen = input.chooseProvider(token, undecided);
					} else {
						errors.push({ kind: 'ambiguous', capability: token, providers: undecided });
						continue;
					}
				} else {
					chosen = undecided[0];
				}
				if (!chosen || !contracts[chosen]) {
					errors.push({ kind: 'unsatisfiable', capability: token, providers: [] });
					continue;
				}
				const entry = supporting.get(chosen) ?? { moduleId: chosen, forCapabilities: [] };
				entry.forCapabilities.push(token);
				supporting.set(chosen, entry);
				ensureModule(chosen);
				satisfy(token, { kind: 'module', moduleId: chosen });
			}
			// A module whose requirements could not be resolved is NOT ordered —
			// the plan is invalid anyway, and ordering it would be misleading.
			if (errors.length === errorsBefore && !order.includes(id)) order.push(id);
		} finally {
			inProgress.delete(id);
		}
	}

	const unknownSeen = new Set<string>();
	for (const id of input.requested) ensureModule(id);

	// ── Recommendations only ──
	const optionalUninstalled = new Set<string>();
	for (const id of order) {
		for (const candidate of contracts[id]?.optionalModules ?? []) {
			if (!order.includes(candidate) && !installed.has(candidate)) optionalUninstalled.add(candidate);
		}
	}

	return {
		requested: input.requested.filter((id) => contracts[id]),
		order,
		supporting: [...supporting.values()],
		satisfied: satisfiedLog,
		optionalUninstalled: [...optionalUninstalled].sort(),
		runtimeAttestations: [...runtimeAttestations].sort(),
		warnings,
		unknownModules: [...unknownSeen],
		errors
	};
}

/** Capability token map helper — keeps the token list the single source. */
function CAPABILITY_TOKENS_MAP(): Record<string, true> {
	return Object.fromEntries(CAPABILITY_TOKENS.map((token) => [token, true as const]));
}

/**
 * Human-readable hint appended to the #323 gate failure: the guided path
 * (`svforge add`) with the supporting modules the planner would install.
 * Derived from the same registry — never hand-written per module.
 */
export function formatResolverHint(
	moduleId: string,
	input: Omit<ResolveInput, 'requested' | 'chooseProvider'>
): string {
	const plan = resolveModules({ ...input, requested: [moduleId] });
	const lines: string[] = [];
	const unsatisfiable = plan.errors.filter(
		(e): e is { kind: 'unsatisfiable'; capability: Capability; providers: string[] } => e.kind === 'unsatisfiable'
	);
	const templateOffered = unsatisfiable.filter((e) => {
		// Capabilities no module provides may still come from a template.
		return (TEMPLATE_PROVIDES.base as Capability[]).includes(e.capability) || (TEMPLATE_PROVIDES.dashboard as Capability[]).includes(e.capability);
	});
	if (templateOffered.length > 0) {
		const caps = templateOffered.map((e) => e.capability);
		lines.push(
			`No SVForge module provides: ${caps.join(', ')}. Install the template that provides it (\`sv add svforge=template:base\` or \`sv add svforge=template:dashboard\`), or declare your own implementation in .svforge.json under capabilities.provides.`
		);
	}
	const other = unsatisfiable.filter((e) => !templateOffered.includes(e));
	if (other.length > 0) {
		lines.push(
			`No SVForge module or template provides: ${other.map((e) => e.capability).join(', ')}. Provide it with your own implementation and declare it in .svforge.json under capabilities.provides.`
		);
	}
	if (plan.supporting.length > 0) {
		const names = plan.supporting.map((s) => s.moduleId).join(', ');
		lines.push(`Guided install: \`npx svforge add ${moduleId}\` — it will also install the supporting module(s): ${names}.`);
	} else if (plan.errors.length === 0 && plan.runtimeAttestations.length > 0) {
		lines.push(`Guided install: \`npx svforge add ${moduleId}\` — you will be asked to attest: ${plan.runtimeAttestations.join(', ')}.`);
	}
	return lines.join('\n');
}
