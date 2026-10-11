import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITIES, MODULE_CONTRACTS, type Capability, type ResolutionPlan } from '@svforge/addon-kit';

export interface PlannedCommand {
	executable: string;
	args: string[];
	cwd: string;
}

export interface PlannedPackage {
	name: string;
	spec: string;
	version: string | null;
	exact: boolean;
	source: 'compatibility-manifest' | 'explicit-version' | 'workspace' | 'packaged-artifact' | 'registry';
}

export interface CliPlanDocument {
	schemaVersion: 1;
	command: 'create' | 'add';
	status: 'ready' | 'noop' | 'blocked';
	exitCode: number;
	choices: Record<string, unknown>;
	project: {
		workingDirectory: string;
		directory?: string;
		template?: string;
		installedModules: string[];
	};
	modules: {
		explicit: string[];
		transitive: { moduleId: string; forCapabilities: Capability[] }[];
		installOrder: string[];
		alreadyInstalled: string[];
		optional: string[];
	};
	capabilities: {
		required: { token: Capability; title: string; description: string }[];
		satisfied: { token: Capability; provider: ResolutionPlan['satisfied'][number]['provider'] }[];
		missing: { token: Capability; kind: string; providers: string[]; title: string }[];
		runtimeConstraints: { token: Capability; title: string; selected?: string }[];
	};
	packages: PlannedPackage[];
	commands: PlannedCommand[];
	warnings: string[];
	conflicts: { code: string; message: string }[];
	errors: { code: string; message: string }[];
}

export interface PlanDocumentInput {
	command: 'create' | 'add';
	status: CliPlanDocument['status'];
	exitCode: number;
	choices: Record<string, unknown>;
	workingDirectory: string;
	directory?: string;
	template?: string;
	installedModules?: string[];
	explicitModules?: string[];
	installOrder?: string[];
	transitive?: { moduleId: string; forCapabilities: Capability[] }[];
	alreadyInstalled?: string[];
	optional?: string[];
	resolution?: ResolutionPlan;
	requiredModules?: string[];
	packages?: PlannedPackage[];
	commands?: PlannedCommand[];
	warnings?: string[];
	conflicts?: { code: string; message: string }[];
	errors?: { code: string; message: string }[];
}

const unique = <T,>(values: T[]): T[] => [...new Set(values)];
const shellQuote = (value: string): string =>
	/^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

/** Build the versioned, deterministic JSON document shared by create and add. */
export function buildCliPlanDocument(input: PlanDocumentInput): CliPlanDocument {
	const moduleIds = input.requiredModules ?? input.installOrder ?? input.explicitModules ?? [];
	const requiredTokens = unique(
		moduleIds.flatMap((id) => MODULE_CONTRACTS[id]?.requires ?? [])
	).sort();
	const required = requiredTokens.map((token) => ({
		token,
		title: CAPABILITIES[token].title,
		description: CAPABILITIES[token].description
	}));
	const requiredSet = new Set(requiredTokens);
	const satisfied = (input.resolution?.satisfied ?? [])
		.filter((item) => requiredSet.has(item.capability))
		.map((item) => ({ token: item.capability, provider: item.provider }));
	const missing = (input.resolution?.errors ?? []).map((error) => ({
		token: error.capability,
		kind: error.kind,
		providers: [...error.providers],
		title: CAPABILITIES[error.capability].title
	}));
	const runtimeTokens = unique([
		...(input.resolution?.runtimeAttestations ?? []),
		...requiredTokens.filter((token) => token.startsWith('runtime.'))
	]).sort();
	const runtimeConstraints = runtimeTokens.map((token) => ({
		token,
		title: CAPABILITIES[token].title,
		...(input.choices.runtime ? { selected: String(input.choices.runtime) } : {})
	}));

	const packageWarnings = (input.packages ?? [])
		.filter((pkg) => !pkg.exact)
		.map((pkg) => `No exact package version is known for ${pkg.name} (${pkg.spec}).`);
	const resolverConflicts = [
		...(input.resolution?.unknownModules ?? []).map((moduleId) => ({
			code: 'unknown-module',
			message: `Unknown module "${moduleId}".`
		})),
		...(input.resolution?.errors ?? []).map((error) => ({
			code: error.kind,
			message: `${error.capability}: ${error.kind}${error.providers.length ? ` (${error.providers.join(', ')})` : ''}.`
		}))
	];
	return {
		schemaVersion: 1,
		command: input.command,
		status: input.status,
		exitCode: input.exitCode,
		choices: input.choices,
		project: {
			workingDirectory: input.workingDirectory,
			...(input.directory ? { directory: input.directory } : {}),
			...(input.template ? { template: input.template } : {}),
			installedModules: [...(input.installedModules ?? [])].sort()
		},
		modules: {
			explicit: [...(input.explicitModules ?? [])],
			transitive: input.transitive ?? [],
			installOrder: [...(input.installOrder ?? [])],
			alreadyInstalled: [...(input.alreadyInstalled ?? [])].sort(),
			optional: [...(input.optional ?? [])].sort()
		},
		capabilities: {
			required,
			satisfied,
			missing,
			runtimeConstraints
		},
		packages: input.packages ?? [],
		commands: input.commands ?? [],
		warnings: unique([...(input.resolution?.warnings ?? []), ...(input.warnings ?? []), ...packageWarnings]),
		conflicts: [...resolverConflicts, ...(input.conflicts ?? [])],
		errors: input.errors ?? []
	};
}

/** Convert a package spec into a non-secret package/version record. */
export function plannedPackage(
	name: string,
	spec: string,
	source: PlannedPackage['source']
): PlannedPackage {
	let version: string | null = null;
	if (spec.startsWith('file:')) {
		const packagePath = spec.slice('file:'.length).split('=')[0]!;
		try {
			const manifest = JSON.parse(readFileSync(join(packagePath, 'package.json'), 'utf8')) as { name?: string; version?: string };
			if (manifest.name === name && typeof manifest.version === 'string') version = manifest.version;
		} catch {
			// Local source metadata may be incomplete; report an explicit unknown.
		}
	} else if (spec.startsWith(`${name}@`)) {
		const candidate = spec.slice(name.length + 1).split('=')[0]!;
		if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(candidate)) version = candidate;
	}
	return { name, spec, version, exact: version !== null, source };
}

/** Human-readable preview; JSON remains the canonical machine contract. */
export function formatCliPlan(document: CliPlanDocument): string {
	const lines = [
		`${document.command} plan (schema ${document.schemaVersion}) — ${document.status}`,
		`Working directory: ${document.project.workingDirectory}`,
		document.project.directory ? `Project directory: ${document.project.directory}` : undefined,
		document.project.template ? `Template: ${document.project.template}` : undefined,
		`Modules: ${document.modules.installOrder.join(', ') || '(none)'}`,
		document.modules.transitive.length ? `Supporting modules: ${document.modules.transitive.map((entry) => entry.moduleId).join(', ')}` : undefined,
		...document.packages.map((pkg) => `Package: ${pkg.name} ${pkg.version ?? '(version unknown)'} [${pkg.source}]`),
		...document.commands.map((command) => `Command: (cd ${shellQuote(command.cwd)} && ${[command.executable, ...command.args].map(shellQuote).join(' ')})`),
		...document.capabilities.missing.map((entry) => `Missing capability: ${entry.token} (${entry.title})`),
		...document.capabilities.runtimeConstraints.map((entry) => `Runtime constraint: ${entry.token}${entry.selected ? ` — selected ${entry.selected}` : ''}`),
		...document.warnings.map((warning) => `Warning: ${warning}`),
		...document.conflicts.map((conflict) => `Conflict [${conflict.code}]: ${conflict.message}`),
		...document.errors.map((error) => `Error [${error.code}]: ${error.message}`)
	].filter(Boolean);
	return `${lines.join('\n')}\n`;
}
