import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// #419: the gate consults the resolver for declared capabilities and the
// guided-path hint. Function-level usage only — the ESM cycle is safe.
import { formatResolverHint, readDeclaredProvides } from './resolve';

/**
 * SVForge capability contract (#323).
 *
 * Modules no longer describe prerequisites through template names. Every
 * module declares WHAT it needs and WHAT it brings as capabilities, and the
 * contract is validated structurally against the REAL project (package.json
 * dependencies, conventional directories) — never against the project's
 * origin. A project that was NOT scaffolded by SVForge can install modules
 * as long as it provides the same capabilities with its own implementation.
 *
 * The vocabulary is intentionally small and composable. Runtime constraints
 * that cannot be read from files (`runtime.*`) are reported as
 * "unverifiable": they never hard-fail an installation, but they are surfaced
 * as warnings so the developer can check the deployment target.
 *
 * Origin-aware detection: a project scaffolded by SVForge (`.svforge.json`
 * present) is validated through its dependency list — the template wiring is
 * guaranteed by the repository's own scaffold gates. A project of ANY OTHER
 * origin is validated STRUCTURALLY (auth handler in hooks.server.ts, drizzle
 * config at the root…) whenever feasible; when only indirect evidence (a
 * dependency) is available, the capability is reported as "unverified" and
 * surfaced as a warning instead of silently pretending support.
 */

// ── Vocabulary ──

export type DeploymentProfile = 'long-lived-node' | 'serverless' | 'edge' | 'separate-worker';

export interface ModuleDeploymentSupport {
	supported: DeploymentProfile[];
	unsupported: DeploymentProfile[];
	note: string;
}

/** Runtime compatibility shared by install-time context and svforge doctor. */
export const MODULE_DEPLOYMENT_SUPPORT: Record<string, ModuleDeploymentSupport> = {
	dashboard: { supported: ['long-lived-node', 'serverless'], unsupported: ['edge', 'separate-worker'], note: 'The bundled postgres.js client needs a Node runtime; use a lifecycle-aware client in serverless.' },
	ui_toast: { supported: ['long-lived-node', 'serverless', 'edge', 'separate-worker'], unsupported: [], note: 'Client-side UI only.' },
	dnd: { supported: ['long-lived-node', 'serverless', 'edge', 'separate-worker'], unsupported: [], note: 'Client-side UI only.' },
	tiptap: { supported: ['long-lived-node', 'serverless', 'edge', 'separate-worker'], unsupported: [], note: 'Editor runs in the browser.' },
	graph: { supported: ['long-lived-node', 'serverless', 'edge', 'separate-worker'], unsupported: [], note: 'Client-side visualization only.' },
	email: { supported: ['long-lived-node', 'serverless', 'edge', 'separate-worker'], unsupported: [], note: 'Trigger delivery from the web request or a worker.' },
	oauth: { supported: ['long-lived-node', 'serverless'], unsupported: ['edge', 'separate-worker'], note: 'Uses the dashboard authentication wiring.' },
	uploads: { supported: ['long-lived-node', 'serverless'], unsupported: ['edge', 'separate-worker'], note: 'Presigned PUT ContentLength is not a storage limit; use a POST policy, quota, and scan callback when enforcement matters.' },
	blog: { supported: ['long-lived-node', 'serverless', 'edge', 'separate-worker'], unsupported: [], note: 'Static/content routes; no persistent process required.' },
	realtime: { supported: ['long-lived-node', 'separate-worker'], unsupported: ['serverless', 'edge'], note: 'Requires a WebSocket-capable Node server or a separate WS server.' },
	audit: { supported: ['long-lived-node', 'serverless'], unsupported: ['edge', 'separate-worker'], note: 'PostgreSQL-backed; define retention, PII access, and an optional DB append-only policy.' },
	notifications: { supported: ['long-lived-node', 'serverless'], unsupported: ['edge', 'separate-worker'], note: 'PostgreSQL-backed notifications.' },
	jobs: { supported: ['long-lived-node', 'separate-worker'], unsupported: ['serverless', 'edge'], note: 'Polling requires one long-lived owner: run `bun run jobs:worker` (separate-worker) or opt in via startJobRunner() in a single-instance deployment — never auto-started in the web runtime (#328).' },
	chat: { supported: ['long-lived-node', 'serverless'], unsupported: ['edge', 'separate-worker'], note: 'PostgreSQL-backed; realtime transport is a separate optional integration.' }
};

export const CAPABILITY_TOKENS = [
	'ui.skeleton',
	'ui.svforge',
	'i18n.messages',
	'auth.currentUser',
	'auth.admin',
	'database.drizzle.postgres',
	'storage.object',
	'runtime.longLivedWorker',
	'runtime.websocket'
] as const;

export type Capability = (typeof CAPABILITY_TOKENS)[number];

export interface CapabilityInfo {
	/** Human-readable name (error messages, llms.txt). */
	title: string;
	/** What the capability guarantees to a consumer. */
	description: string;
	/** The SVForge way to obtain the capability (next-step advice). */
	remedy: string;
	/** False for runtime constraints that cannot be verified from files. */
	verifiable?: boolean;
}

/**
 * The capability registry: the single source of truth describing every
 * capability, its detection and its remedy. Error messages are DERIVED from
 * this registry — never hand-written per module.
 */
export const CAPABILITIES: Record<Capability, CapabilityInfo> = {
	'ui.skeleton': {
		title: 'Skeleton v5 design system',
		description: 'Skeleton theme wiring (design tokens, presets) so Skeleton-styled components render correctly',
		remedy: 'install the SvelteForge base template (`sv add svforge=template:base`) or add @skeletonlabs/skeleton with a theme to your project'
	},
	'ui.svforge': {
		title: 'SVForge base UI kit',
		description: 'the canonical component structure (src/lib/components/svforge: primitives/, ui/) and shared utils such as cn()',
		remedy: 'install the SvelteForge base template (`sv add svforge=template:base`) — or vendor your own src/lib/components/svforge/ structure with the same exports'
	},
	'i18n.messages': {
		title: 'Paraglide message catalogs (FR/EN)',
		description: 'Paraglide i18n with messages/{locale}.json catalogs so modules can merge their UI copy without inventing keys',
		remedy: 'install the SvelteForge base template (`sv add svforge=template:base`), or set up @inlang/paraglide-js with at least one messages/*.json catalog'
	},
	'auth.currentUser': {
		title: 'Authenticated user (locals.user)',
		description: 'an authenticated user is available in server locals (Better Auth in SVForge) so endpoints can enforce identity',
		remedy: 'install the SvelteForge dashboard template (`sv add svforge=template:dashboard`) or set up Better Auth in your project'
	},
	'auth.admin': {
		title: 'Admin role helpers ($lib/server/admin)',
		description: 'role helpers such as isAdmin() guarding admin-only routes',
		remedy: 'install the SvelteForge dashboard template (`sv add svforge=template:dashboard`) or provide your own src/lib/server/admin module exporting isAdmin()'
	},
	'database.drizzle.postgres': {
		title: 'PostgreSQL via Drizzle ORM',
		description: 'a Drizzle client on PostgreSQL (src/lib/server/db) so modules can register their schemas in the barrel',
		remedy: 'install the SvelteForge dashboard template (`sv add svforge=template:dashboard`) or add drizzle-orm with a postgres driver (postgres or pg) to your project'
	},
	'storage.object': {
		title: 'S3-compatible object storage',
		description: 'an S3 client wiring (endpoint, bucket, credentials) for persistent object storage',
		remedy: 'install @svforge/uploads (provides storage.object) or configure your own S3-compatible storage'
	},
	'runtime.longLivedWorker': {
		title: 'Long-lived worker runtime',
		description: 'a runtime that keeps a background process alive (in-process runner) — serverless platforms terminate it',
		remedy: 'deploy on a long-lived runtime (VPS, container, classic Node server); not suitable for serverless/edge',
		verifiable: false
	},
	'runtime.websocket': {
		title: 'WebSocket-capable runtime',
		description: 'a runtime that allows keeping WebSocket server connections open — serverless platforms terminate them',
		remedy: 'deploy on a runtime that supports WebSocket servers (VPS, container, classic Node server)',
		verifiable: false
	}
};

/**
 * Capabilities each SVForge template grants out of the box. Used by
 * composition validation (a template satisfies the requires of its modules)
 * and by the install gate when composing in a single `sv add`.
 */
export const TEMPLATE_PROVIDES: Record<'base' | 'dashboard', Capability[]> = {
	base: ['ui.skeleton', 'ui.svforge', 'i18n.messages'],
	dashboard: [
		'ui.skeleton',
		'ui.svforge',
		'i18n.messages',
		'auth.currentUser',
		'auth.admin',
		'database.drizzle.postgres'
	]
};

/** Contract of a module: what it requires, provides, and what enhances it. */
export interface ModuleCapabilityContract {
	/** Template that grants every required capability out of the box. */
	template: 'base' | 'dashboard';
	/** Capabilities that MUST be present before installation. */
	requires: Capability[];
	/** Capabilities the project gains once the module is installed. */
	provides: Capability[];
	/** Capabilities that enhance the module but are never forced. */
	optional: Capability[];
	/** Related module ids (composition recommendations, never auto-installed). */
	optionalModules: string[];
}

/**
 * The capability contract of every @svforge module — the single source of
 * truth shared by the install gates, `validateComposition` and the AI
 * context (.svforge.json + llms.txt).
 */
export const MODULE_CONTRACTS: Record<string, ModuleCapabilityContract> = {
	ui_toast: {
		template: 'base',
		requires: ['ui.skeleton'],
		provides: [],
		optional: [],
		optionalModules: []
	},
	dnd: {
		template: 'base',
		requires: [],
		provides: [],
		optional: [],
		optionalModules: []
	},
	tiptap: {
		template: 'base',
		requires: ['ui.skeleton', 'i18n.messages'],
		provides: [],
		optional: [],
		optionalModules: []
	},
	graph: {
		template: 'base',
		requires: ['ui.svforge'],
		provides: [],
		optional: [],
		optionalModules: []
	},
	email: {
		template: 'base',
		requires: [],
		provides: [],
		optional: [],
		optionalModules: []
	},
	oauth: {
		template: 'dashboard',
		requires: ['auth.currentUser'],
		provides: [],
		optional: ['ui.skeleton'],
		optionalModules: []
	},
	uploads: {
		template: 'base',
		requires: ['auth.currentUser', 'i18n.messages'],
		provides: ['storage.object'],
		optional: ['ui.skeleton'],
		optionalModules: []
	},
	blog: {
		template: 'base',
		requires: ['ui.svforge'],
		provides: [],
		optional: [],
		optionalModules: []
	},
	realtime: {
		template: 'base',
		requires: ['runtime.websocket'],
		provides: [],
		optional: [],
		optionalModules: []
	},
	audit: {
		template: 'dashboard',
		requires: ['database.drizzle.postgres', 'auth.currentUser', 'auth.admin', 'i18n.messages', 'ui.svforge'],
		provides: [],
		optional: [],
		optionalModules: []
	},
	notifications: {
		template: 'dashboard',
		requires: ['database.drizzle.postgres', 'i18n.messages'],
		provides: [],
		optional: ['runtime.websocket'],
		optionalModules: ['realtime', 'email']
	},
	jobs: {
		template: 'dashboard',
		requires: ['database.drizzle.postgres', 'runtime.longLivedWorker'],
		provides: [],
		optional: ['runtime.websocket'],
		optionalModules: ['realtime', 'notifications', 'email']
	},
	chat: {
		template: 'dashboard',
		requires: ['database.drizzle.postgres', 'auth.currentUser', 'i18n.messages', 'ui.svforge'],
		provides: [],
		optional: ['runtime.websocket', 'storage.object'],
		optionalModules: ['realtime', 'uploads', 'notifications']
	}
};

// ── Structural detection ──

/**
 * Structural snapshot of a project. Pure data — easy to fake in tests — built
 * from package.json dependencies and the conventional filesystem layout.
 */
export interface ProjectSnapshot {
	/** dependencies + devDependencies of package.json (either placement counts). */
	dependencies: Set<string>;
	/** .json files found in messages/ (Paraglide catalogs). */
	messageCatalogs: number;
	/** Content of src/hooks.server.ts|js when the file exists (auth wiring checks). */
	hooksServer: string | undefined;
	/** A drizzle.config.{ts,mts,js,mjs} exists at the project root. */
	hasDrizzleConfig: boolean;
	/** True when the project was scaffolded by SVForge (.svforge.json present). */
	hasSvforgeOrigin: boolean;
	hasDir(rel: string): boolean;
	hasFile(...rels: string[]): boolean;
}

/** Read the structural snapshot of the project at `cwd`. */
export function snapshotProject(cwd: string): ProjectSnapshot {
	let dependencies = new Set<string>();
	let messageCatalogs = 0;
	try {
		const raw = readFileSync(join(cwd, 'package.json'), 'utf8');
		const pkg = JSON.parse(raw) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		dependencies = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
	} catch {
		// No readable package.json: every dependency-based detection fails.
	}
	try {
		messageCatalogs = readdirSync(join(cwd, 'messages')).filter((f) => f.endsWith('.json')).length;
	} catch {
		// No messages/ directory: the i18n.messages detection fails.
	}
	const exists = (...segments: string[]) => existsSync(join(cwd, ...segments));
	const readIfExists = (...segments: string[]): string | undefined => {
		try {
			return readFileSync(join(cwd, ...segments), 'utf8');
		} catch (e) {
			// Only ENOENT means "absent" — unreadable files must not silently
			// weaken the capability detection.
			if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
				throw new Error(`SVForge capability check cannot read "${join(cwd, ...segments)}": ${(e as Error).message}`, { cause: e });
			}
			return undefined;
		}
	};
	return {
		dependencies,
		messageCatalogs,
		hooksServer: readIfExists('src/hooks.server.ts') ?? readIfExists('src/hooks.server.js'),
		hasDrizzleConfig: ['drizzle.config.ts', 'drizzle.config.mts', 'drizzle.config.js', 'drizzle.config.mjs'].some(
			(name) => exists(name)
		),
		hasSvforgeOrigin: exists('.svforge.json'),
		hasDir: (rel) => exists(rel),
		hasFile: (...rels) => rels.some((rel) => exists(rel))
	};
}

/** Result of a structural detection for one capability. */
export type Detection = 'satisfied' | 'absent' | 'unknown' | 'unverified';

/** Signals proving an authenticated-user wiring inside hooks.server.ts. */
const AUTH_HOOKS_SIGNALS = [
	/locals\.user\s*=/,
	/auth\.handler/,
	/svelteKitHandler\s*\(/,
	/auth\.api\.getSession/,
	/betterAuth\s*\(/
];

/**
 * Detect one capability structurally.
 *
 * - `satisfied` — verified from the project's real structure;
 * - `absent` — structurally missing: required capabilities hard-fail;
 * - `unknown` — runtime constraint that cannot be read from files (warn);
 * - `unverified` — indirect evidence only (a dependency is installed) on a
 *   non-SVForge project without the expected wiring (warn, never silently
 *   treated as support).
 *
 * On an SVForge-origin project (`.svforge.json` present) the dependency list
 * IS the structural guarantee: the template wiring is validated by the
 * repository's own scaffold gates, so the fast path applies.
 */
export function detectCapability(token: Capability, project: ProjectSnapshot): Detection {
	switch (token) {
		case 'ui.skeleton':
			return project.dependencies.has('@skeletonlabs/skeleton') ? 'satisfied' : 'absent';
		case 'ui.svforge':
			return project.hasDir('src/lib/components/svforge') ? 'satisfied' : 'absent';
		case 'i18n.messages':
			return project.dependencies.has('@inlang/paraglide-js') && project.messageCatalogs > 0
				? 'satisfied'
				: 'absent';
		case 'auth.currentUser': {
			const hasAuthDep = project.dependencies.has('better-auth');
			if (project.hasSvforgeOrigin) return hasAuthDep ? 'satisfied' : 'absent';
			const hooks = project.hooksServer;
			if (hooks && AUTH_HOOKS_SIGNALS.some((signal) => signal.test(hooks))) return 'satisfied';
			return hasAuthDep ? 'unverified' : 'absent';
		}
		case 'auth.admin':
			// SVForge contract file — an external implementation vendors the same
			// path (the module imports $lib/server/admin).
			return project.hasFile(
				'src/lib/server/admin.ts',
				'src/lib/server/admin.js',
				'src/lib/server/admin/index.ts'
			)
				? 'satisfied'
				: 'absent';
		case 'database.drizzle.postgres': {
			const hasDrizzle = project.dependencies.has('drizzle-orm');
			const hasClient = project.dependencies.has('postgres') || project.dependencies.has('pg');
			if (project.hasSvforgeOrigin) {
				return hasDrizzle && hasClient ? 'satisfied' : 'absent';
			}
			if (hasDrizzle && project.hasDrizzleConfig && hasClient) return 'satisfied';
			return hasDrizzle ? 'unverified' : 'absent';
		}
		case 'storage.object':
			return project.dependencies.has('@aws-sdk/client-s3') ? 'satisfied' : 'absent';
		case 'runtime.longLivedWorker':
		case 'runtime.websocket':
			// Deployment property — deliberately not file-coupled.
			return 'unknown';
		default: {
			// Exhaustiveness guard: a token added to CAPABILITY_TOKENS without a
			// detector must fail loudly instead of silently passing.
			const exhaustive: never = token;
			throw new Error(`No detector for capability "${String(exhaustive)}".`);
		}
	}
}

export interface CapabilityEvaluation {
	/** Required capabilities structurally absent from the project. */
	missing: Capability[];
	/** Required capabilities that cannot be verified from files (runtime.*). */
	unverifiable: Capability[];
	/** Required capabilities with indirect evidence only (warn, install proceeds). */
	unverified: Capability[];
}

/**
 * Evaluate a capability requirement list against detected capabilities.
 * `satisfied` passes; `unknown` and `unverified` pass WITH a warning; only
 * structurally `absent` capabilities are missing (hard failure).
 */
export function evaluateRequirements(
	requires: readonly Capability[],
	project: ProjectSnapshot
): CapabilityEvaluation {
	const evaluation: CapabilityEvaluation = { missing: [], unverifiable: [], unverified: [] };
	for (const token of requires) {
		const detection = detectCapability(token, project);
		if (detection === 'absent') evaluation.missing.push(token);
		else if (detection === 'unknown') evaluation.unverifiable.push(token);
		else if (detection === 'unverified') evaluation.unverified.push(token);
	}
	return evaluation;
}

/** Human-readable, derived-from-registry description of one capability. */
export function describeCapability(token: Capability): string {
	const info = CAPABILITIES[token];
	return `- ${token} — ${info.title}: ${info.description}\n  Fix: ${info.remedy}`;
}

/**
 * Format a readable early failure for a module whose required capabilities
 * are missing. Derived from the registry (title, description, remedy) —
 * usable by a human or an AI agent, and explicit that nothing was written.
 */
export function formatCapabilityFailure(moduleId: string, evaluation: CapabilityEvaluation): string {
	const lines: string[] = [];
	lines.push(`@svforge/${moduleId} cannot be installed — missing required capabilit${evaluation.missing.length === 1 ? 'y' : 'ies'}:`);
	lines.push('');
	for (const token of evaluation.missing) {
		lines.push(describeCapability(token));
		lines.push('');
	}
	lines.push('No files were written. Fix the project state (or install the template that provides these capabilities), then re-run the installation.');
	return lines.join('\n');
}

/** Warning lines for required capabilities that could not be verified. */
export function formatCapabilityWarnings(
	moduleId: string,
	unverifiable: readonly Capability[],
	unverified: readonly Capability[] = []
): string[] {
	const runtimeWarnings = unverifiable.map((token) => {
		const info = CAPABILITIES[token];
		return `@svforge/${moduleId} requires ${token} (${info.title}) — this cannot be verified from your files. ${info.description[0].toUpperCase()}${info.description.slice(1)}. ${info.remedy[0].toUpperCase()}${info.remedy.slice(1)}.`;
	});
	const structuralWarnings = unverified.map((token) => {
		const info = CAPABILITIES[token];
		const expected =
			token === 'auth.currentUser'
				? 'a locals.user assignment or the auth handler in src/hooks.server.ts'
				: 'a drizzle.config.{ts,mts,js,mjs} at the project root and a "postgres" (or "pg") client dependency';
		return `@svforge/${moduleId} requires ${token} (${info.title}) — the dependency is installed, but the expected wiring could not be verified from your files (expected: ${expected}). The module installs anyway — verify this capability yourself before relying on it.`;
	});
	return [...runtimeWarnings, ...structuralWarnings];
}

export type CapabilityGate =
	| { ok: true; warnings: string[] }
	| { ok: false; message: string; warnings: string[] };

/**
 * Install gate for one module, run on the REAL project (the actual `sv add`
 * path): returns an ok=false result with a readable, derived failure message
 * when a required capability is structurally absent, and warning lines for
 * unverifiable runtime constraints.
 *
 * #419: capabilities declared externally by the project (.svforge.json
 * `capabilities.provides`) are honored as satisfied — a declared provider is
 * never replaced by a SVForge module — and the failure message carries a
 * resolver plan hint pointing at the guided `svforge add` path.
 */
export function checkModuleCapabilities(cwd: string, moduleId: string): CapabilityGate {
	const contract = MODULE_CONTRACTS[moduleId];
	if (!contract) {
		return {
			ok: false,
			warnings: [],
			message: `Unknown module "${moduleId}" — no capability contract is registered in @svforge/addon-kit. This is an SVForge packaging bug; please report it.`
		};
	}
	const declared = readDeclaredProvides(cwd);
	const warnings = [...declared.warnings];
	const effectiveRequires = contract.requires.filter((token) => !declared.provides.includes(token));
	const project = snapshotProject(cwd);
	const evaluation = evaluateRequirements(effectiveRequires, project);
	warnings.push(...formatCapabilityWarnings(moduleId, evaluation.unverifiable, evaluation.unverified));
	if (evaluation.missing.length > 0) {
		let template: 'base' | 'dashboard' | undefined;
		let installed: string[] = [];
		try {
			const manifest = JSON.parse(readFileSync(join(cwd, '.svforge.json'), 'utf8')) as {
				template?: 'base' | 'dashboard';
				modules?: string[];
			};
			template = manifest.template;
			installed = manifest.modules ?? [];
		} catch {
			// No manifest or unreadable: the resolver works from structure alone.
		}
		const hint = formatResolverHint(moduleId, {
			template,
			installed,
			declaredProvides: declared.provides,
			snapshot: project
		});
		const message = `${formatCapabilityFailure(moduleId, evaluation)}\n\n${hint}`;
		return { ok: false, warnings, message };
	}
	return { ok: true, warnings };
}

/** Capabilities granted by a template (composition-time helper). */
export function templateCapabilities(template: 'base' | 'dashboard'): Capability[] {
	return [...TEMPLATE_PROVIDES[template]];
}

/**
 * Compute the capabilities that remain uncovered when installing the given
 * module contracts on top of a template. Used by svforge's
 * `validateComposition` to derive readable errors at composition time.
 *
 * Unverifiable capabilities (`runtime.*`) never count as missing at
 * composition time — they cannot be known before looking at a real project,
 * and the install gate reports them as warnings instead.
 */
export function compositionGaps(
	template: 'base' | 'dashboard',
	contracts: (ModuleCapabilityContract & { id: string })[]
): { moduleId: string; missing: Capability[] }[] {
	const provided = new Set<Capability>(TEMPLATE_PROVIDES[template]);
	for (const contract of contracts) {
		for (const token of contract.provides) provided.add(token);
	}
	return contracts
		.map((contract) => ({
			moduleId: contract.id,
			missing: contract.requires.filter(
				(token) => !provided.has(token) && CAPABILITIES[token].verifiable !== false
			)
		}))
		.filter((gap) => gap.missing.length > 0);
}
