/**
 * SVForge Doctor — read-only diagnostics for a project's INSTALLED SVForge
 * capabilities (#326).
 *
 * The doctor answers one question: "are the INSTALLED capabilities configured
 * and compatible?" The capability set comes from the project manifest
 * (.svforge.json — template + modules) when present, falling back to
 * package.json dependencies. Only the env vars those capabilities actually
 * need are checked:
 *
 *   dashboard → DATABASE_URL, BETTER_AUTH_SECRET, ORIGIN
 *   uploads   → S3_ENDPOINT, S3_BUCKET
 *   base-only → no capability-specific env vars
 *
 * Env vars are parsed properly (KEY=VALUE lines, # comments skipped) and
 * reported as missing / empty / placeholder / provided. process.env wins:
 * an existing-but-empty or placeholder process value is classified as such
 * ("empty"/"placeholder"), never silently re-read from .env. Dependency
 * checks compare the INSTALLED version (node_modules) against EVERY bound
 * of the declared range (lower AND upper), then the SVForge minimum with a
 * proper SemVer >= comparison (5.0.0-rc.1 is NOT >= 5.0.0): Svelte >= 5.0.0
 * and @skeletonlabs/skeleton-svelte >= 5.0.0 are required. Without
 * node_modules the range itself is analysed, upper bounds included.
 *
 * This command is strictly read-only: it never modifies project files.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_PROFILE_SUPPORT, type DeploymentProfile } from './ai-context';

export interface DiagnosticResult {
	/** Module or area being checked. */
	module: string;
	/** Check status. */
	status: 'ok' | 'warn' | 'error';
	/** Human-readable message with remediation advice. */
	message: string;
}

export interface DoctorReport {
	results: DiagnosticResult[];
	/** True when all checks pass (no warnings or errors). */
	healthy: boolean;
}

/** Capabilities the doctor knows how to verify. */
type Capability = 'dashboard' | 'uploads';

interface InstalledState {
	/** Where the capability set comes from. */
	source: 'manifest' | 'dependencies' | 'none';
	template: 'base' | 'dashboard' | null;
	modules: string[];
	capabilities: Capability[];
	deploymentProfile?: DeploymentProfile;
}

/**
 * Env vars required per installed capability (#326).
 * The dashboard uses BETTER_AUTH_SECRET — the old AUTH_SECRET check was wrong.
 */
const CAPABILITY_ENV_VARS: Record<Capability, string[]> = {
	dashboard: ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ORIGIN'],
	uploads: ['S3_ENDPOINT', 'S3_BUCKET']
};

const CAPABILITY_LABELS: Record<Capability, string> = {
	dashboard: 'the dashboard capability (Better Auth + Drizzle)',
	uploads: 'the uploads capability (S3-compatible storage)'
};

/** Installed SVForge modules that imply a capability in the manifest. */
const MODULE_CAPABILITIES: Record<string, Capability> = {
	uploads: 'uploads'
};

/**
 * Dependencies that imply the dashboard capability when no manifest exists
 * (matches what the dashboard mode scaffolds: Better Auth + Drizzle).
 *
 * `@better-auth/cli` is deliberately NOT in this list — since #319 the
 * scaffold no longer installs it (its nested @better-auth/core hoists over
 * the runtime's copy and breaks the SSR build); the generator runs via bunx.
 */
const DASHBOARD_DEPENDENCIES = ['better-auth', 'drizzle-orm', 'drizzle-kit'];

/**
 * S3-specific dependencies that imply the uploads capability when no manifest
 * exists. Deliberately NOT any @aws-sdk/* package: @aws-sdk/client-ses (email)
 * or the DynamoDB clients say nothing about S3 uploads and must not trigger
 * S3 warnings on projects without the uploads module.
 */
const UPLOADS_DEPENDENCIES = [
	'@aws-sdk/client-s3',
	'@aws-sdk/s3-presigned-post',
	'@aws-sdk/s3-request-presigner'
];

/**
 * Run SVForge diagnostics on the current project.
 *
 * @param projectRoot - Absolute path to the project root (defaults to cwd).
 * @returns A structured diagnostic report. Does not modify any files.
 */
export async function doctor(projectRoot: string = process.cwd()): Promise<DoctorReport> {
	const results: DiagnosticResult[] = [];

	// 1. Check for SVForge components directory
	results.push(checkSvforgeComponents(projectRoot));

	// 2. Check for SvelteKit project structure
	results.push(checkSvelteKit(projectRoot));

	// 3. Determine the INSTALLED capabilities (manifest, else deps)
	const state = readInstalledState(projectRoot, results);

	// 4. Check only the env vars the installed capabilities require
	results.push(...checkEnvVars(projectRoot, state.capabilities));

	// 5. Check dependency compatibility (real SemVer)
	results.push(...checkDependencies(projectRoot));

	// 6. Warn only for installed modules incompatible with the declared target.
	results.push(...checkDeploymentCompatibility(state));

	return {
		results,
		healthy: results.every((r) => r.status === 'ok')
	};
}

/** Check that the svforge components directory exists. */
function checkSvforgeComponents(root: string): DiagnosticResult {
	try {
		const svforgeDir = join(root, 'src/lib/components/svforge');
		if (existsSync(svforgeDir)) {
			return { module: 'svforge', status: 'ok', message: 'SVForge components directory found' };
		}
		return {
			module: 'svforge',
			status: 'warn',
			message: 'No src/lib/components/svforge/ directory found. Run `sv add svforge` to install.'
		};
	} catch {
		return { module: 'svforge', status: 'error', message: 'Cannot check svforge components' };
	}
}

/** Check that the project is a SvelteKit project. */
function checkSvelteKit(root: string): DiagnosticResult {
	try {
		// Modern sv create (SvelteKit 3 / vite-plugin-svelte 7) has no svelte.config.js
		// — the config lives in vite.config.ts (#185).
		const hasViteConfig = existsSync(join(root, 'vite.config.ts')) || existsSync(join(root, 'vite.config.js'));
		const hasSvelteConfig = existsSync(join(root, 'svelte.config.js')) || existsSync(join(root, 'svelte.config.ts'));
		const pkgPath = join(root, 'package.json');
		const hasSvelteKitDep = existsSync(pkgPath) &&
			/@sveltejs\/kit/.test(readFileSync(pkgPath, 'utf-8'));
		if (!hasViteConfig && !hasSvelteConfig && !hasSvelteKitDep) {
			return {
				module: 'sveltekit',
				status: 'error',
				message: 'No SvelteKit project detected (no vite.config / svelte.config / @sveltejs/kit). SVForge requires SvelteKit.'
			};
		}
		return { module: 'sveltekit', status: 'ok', message: 'SvelteKit project detected' };
	} catch {
		return { module: 'sveltekit', status: 'error', message: 'Cannot check SvelteKit config' };
	}
}

// ── Installed capabilities (#326) ───────────────────────────────────

/**
 * Read the installed capability set. The .svforge.json manifest is the source
 * of truth (template + modules); when it is absent or unreadable, fall back
 * to dependency detection. Emits the manifest diagnostic itself.
 */
function readInstalledState(root: string, results: DiagnosticResult[]): InstalledState {
	const manifestPath = join(root, '.svforge.json');
	if (existsSync(manifestPath)) {
		const manifest = parseManifest(manifestPath, results);
		if (manifest) {
			const capabilities = new Set<Capability>();
			if (manifest.template === 'dashboard') capabilities.add('dashboard');
			for (const moduleId of manifest.modules) {
				const capability = MODULE_CAPABILITIES[moduleId];
				if (capability) capabilities.add(capability);
			}
			results.push({
				module: 'svforge-manifest',
				status: 'ok',
				message: `Manifest found — template: ${manifest.template}, modules: ${manifest.modules.join(', ') || 'none'}.`
			});
			return {
				source: 'manifest',
				template: manifest.template,
				modules: manifest.modules,
				capabilities: [...capabilities],
				deploymentProfile: manifest.deploymentProfile
			};
		}
		// Invalid manifest: the error diagnostic was already emitted by
		// parseManifest — fall through to dependency detection.
	}

	const deps = readDependencies(root);
	const capabilities = new Set<Capability>();
	if (deps) {
		for (const dependency of Object.keys(deps)) {
			if (DASHBOARD_DEPENDENCIES.includes(dependency)) capabilities.add('dashboard');
			if (UPLOADS_DEPENDENCIES.includes(dependency)) capabilities.add('uploads');
		}
	}
	results.push({
		module: 'svforge-manifest',
		status: 'ok',
		message: deps
			? `No readable .svforge.json — capabilities detected from package.json: ${capabilities.size ? [...capabilities].join(', ') : 'none'}.`
			: 'No .svforge.json and no package.json — no SVForge capabilities detected.'
	});
	return { source: 'none', template: null, modules: [], capabilities: [...capabilities] };
}

interface ParsedManifest {
	template: 'base' | 'dashboard';
	modules: string[];
	deploymentProfile?: DeploymentProfile;
}

function isDeploymentProfile(value: unknown): value is DeploymentProfile {
	return value === 'long-lived-node' || value === 'serverless' || value === 'edge' || value === 'separate-worker';
}

/** Parse and validate .svforge.json. Emits a clear error diagnostic when invalid. */
function parseManifest(manifestPath: string, results: DiagnosticResult[]): ParsedManifest | null {
	const invalid = (reason: string): null => {
		results.push({
			module: 'svforge-manifest',
			status: 'error',
			message: `.svforge.json could not be read (${reason}). Falling back to package.json detection. Fix or delete the file, or reinstall with \`npx sv add svelteforge\`.`
		});
		return null;
	};
	try {
		const raw = readFileSync(manifestPath, 'utf-8');
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return invalid('expected a JSON object');
		}
		const record = parsed as Record<string, unknown>;
		const template = record.template === 'dashboard' ? 'dashboard' : record.template === 'base' ? 'base' : null;
		if (!template) return invalid('"template" must be "base" or "dashboard"');
		if (!Array.isArray(record.modules)) return invalid('"modules" must be an array');
		if (!record.modules.every((entry) => typeof entry === 'string')) {
			return invalid('every entry in "modules" must be a string');
		}
		let deploymentProfile: DeploymentProfile | undefined;
		if (record.deployment !== undefined) {
			if (record.deployment === null || typeof record.deployment !== 'object' || Array.isArray(record.deployment)) {
				return invalid('"deployment" must be an object');
			}
			const profile = (record.deployment as Record<string, unknown>).profile;
			if (profile !== undefined && !isDeploymentProfile(profile)) {
				return invalid('"deployment.profile" is not a supported deployment profile');
			}
			deploymentProfile = profile as DeploymentProfile | undefined;
		}
		// Unknown string module ids and unknown top-level fields stay accepted.
		return { template, modules: record.modules as string[], deploymentProfile };
	} catch (error) {
		return invalid(error instanceof Error ? error.message : 'invalid JSON');
	}
}

/** Read dependencies from package.json, or null when it cannot be read. */
function readDependencies(root: string): Record<string, string> | null {
	try {
		const pkg: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
		if (pkg === null || typeof pkg !== 'object') return null;
		const record = pkg as Record<string, unknown>;
		const deps: Record<string, string> = {};
		for (const section of ['dependencies', 'devDependencies']) {
			const entries = record[section];
			if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) continue;
			for (const [name, range] of Object.entries(entries as Record<string, unknown>)) {
				if (typeof range === 'string') deps[name] = range;
			}
		}
		return deps;
	} catch {
		return null;
	}
}

// ── Deployment compatibility ─────────────────────────────────────────

/** Warn only for installed modules incompatible with the declared profile. */
function checkDeploymentCompatibility(state: InstalledState): DiagnosticResult[] {
	const profile = state.deploymentProfile;
	if (!profile) return [];
	const installed = [...(state.template === 'dashboard' ? ['dashboard'] : []), ...state.modules];
	return installed.flatMap((moduleId) => {
		const support = MODULE_PROFILE_SUPPORT[moduleId];
		if (!support || !support.unsupported.includes(profile)) return [];
		return [{
			module: moduleId,
			status: 'warn' as const,
			message: `${moduleId} is incompatible with the declared ${profile} deployment profile. ${support.note}`
		}];
	});
}

// ── Environment checks (capability-derived) ─────────────────────────

/** Check ONLY the env vars required by the installed capabilities (#326). */
function checkEnvVars(root: string, capabilities: Capability[]): DiagnosticResult[] {
	const required = capabilities.flatMap((capability) =>
		CAPABILITY_ENV_VARS[capability].map((name) => ({ capability, name }))
	);
	if (required.length === 0) {
		return [{
			module: 'env',
			status: 'ok',
			message: 'No capability-specific environment variables required (base install).'
		}];
	}
	const envFile = parseDotEnv(safeReadFile(join(root, '.env')));
	return required.map(({ capability, name }) => checkEnvVar(name, capability, envFile));
}

/**
 * Classify one env var as missing / empty / placeholder / provided.
 * A process.env value is classified FIRST: what the app actually sees beats
 * what .env says. An existing-but-empty process var is "empty", a placeholder
 * one is "placeholder" — even when .env would provide a real value.
 */
function checkEnvVar(name: string, capability: Capability, envFile: Map<string, string>): DiagnosticResult {
	const processValue = process.env[name];
	if (typeof processValue === 'string') {
		const trimmed = processValue.trim();
		if (trimmed === '') {
			return {
				module: capability,
				status: 'warn',
				message: `${name} is set but empty in the environment. Required by ${CAPABILITY_LABELS[capability]}.`
			};
		}
		if (isPlaceholderValue(trimmed)) {
			return {
				module: capability,
				status: 'warn',
				message: `${name} still has a placeholder value ("${trimmed}") in the environment. Required by ${CAPABILITY_LABELS[capability]}. Replace it with a real value.`
			};
		}
		return { module: capability, status: 'ok', message: `${name} is set (environment).` };
	}
	if (!envFile.has(name)) {
		return {
			module: capability,
			status: 'warn',
			message: `${name} is not set. Required by ${CAPABILITY_LABELS[capability]}. Add it to .env (see .env.example).`
		};
	}
	const value = (envFile.get(name) ?? '').trim();
	if (value === '') {
		return {
			module: capability,
			status: 'warn',
			message: `${name} is empty in .env. Required by ${CAPABILITY_LABELS[capability]}.`
		};
	}
	if (isPlaceholderValue(value)) {
		return {
			module: capability,
			status: 'warn',
			message: `${name} still has a placeholder value ("${value}") in .env. Required by ${CAPABILITY_LABELS[capability]}. Replace it with a real value.`
		};
	}
	return { module: capability, status: 'ok', message: `${name} is configured.` };
}

/**
 * Values that clearly mean "not filled in yet" — the placeholder shipped in
 * the dashboard .env.example (changeme) and common convention variants.
 */
const PLACEHOLDER_PATTERNS = [
	/^change[-_]?me$/i,
	/^your[-_]/i,
	/^<.*>$/,
	/^x{3,}$/i,
	/^(placeholder|example)$/i
];

function isPlaceholderValue(value: string): boolean {
	return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function safeReadFile(path: string): string {
	try {
		return readFileSync(path, 'utf-8');
	} catch {
		// No such file (or unreadable) — treated as "no vars defined".
		return '';
	}
}

/**
 * Parse a .env file into KEY → VALUE pairs.
 * Skips blank lines and # comments (whole-line or inline for unquoted values),
 * strips surrounding quotes, and keeps empty values (KEY= / KEY="") so the
 * caller can distinguish "empty" from "missing".
 */
export function parseDotEnv(content: string): Map<string, string> {
	const vars = new Map<string, string>();
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;
		let work = line;
		if (work.startsWith('export ')) work = work.slice('export '.length).trim();
		const eq = work.indexOf('=');
		if (eq === -1) continue;
		const key = work.slice(0, eq).trim();
		if (key === '') continue;
		let value = work.slice(eq + 1).trim();
		if (value.startsWith('"') || value.startsWith("'")) {
			const quote = value[0];
			const end = value.indexOf(quote, 1);
			value = end === -1 ? value.slice(1) : value.slice(1, end);
		} else {
			// Unquoted: strip an inline comment (whitespace + #).
			const hash = value.indexOf(' #');
			if (hash !== -1) value = value.slice(0, hash).trim();
		}
		vars.set(key, value);
	}
	return vars;
}

// ── Dependency compatibility (real SemVer) ──────────────────────────

interface RequiredDependency {
	/** package.json dependency name. */
	pkg: string;
	/** Diagnostic module label (stable public contract of doctor()). */
	module: string;
	/** Minimum required major. */
	minMajor: number;
	/** Status when the dependency is entirely absent. */
	missingStatus: 'warn' | 'error';
}

const REQUIRED_DEPENDENCIES: RequiredDependency[] = [
	{ pkg: 'svelte', module: 'svelte', minMajor: 5, missingStatus: 'error' },
	{ pkg: '@skeletonlabs/skeleton-svelte', module: 'skeleton', minMajor: 5, missingStatus: 'warn' }
];

/** Check dependency versions for known compatibility issues. */
function checkDependencies(root: string): DiagnosticResult[] {
	const deps = readDependencies(root);
	if (!deps) {
		return [{
			module: 'dependencies',
			status: 'error',
			message: 'Cannot read package.json. Ensure you are in a project root.'
		}];
	}

	const results: DiagnosticResult[] = [];
	for (const { pkg, module, minMajor, missingStatus } of REQUIRED_DEPENDENCIES) {
		const range = deps[pkg];
		if (range === undefined) {
			results.push({
				module,
				status: missingStatus,
				message: `${pkg} is not installed. SVForge requires ${pkg} ${minMajor}+.`
			});
			continue;
		}
		const installed = readInstalledVersion(root, pkg);
		if (installed !== null && rangeIsParsable(range)) {
			// Real check: the INSTALLED version must satisfy EVERY bound of the
			// declared range (lower AND upper) AND meet the SVForge minimum
			// (proper >= comparison — a prerelease is lower than the release).
			const satisfiesRange = versionSatisfiesRange(installed, range);
			if (satisfiesRange && meetsMinimumVersion(installed, minMajor)) {
				results.push({
					module,
					status: 'ok',
					message: `${pkg} ${installed} (installed) satisfies ${range} and the ${minMajor}+ requirement.`
				});
			} else if (!satisfiesRange) {
				results.push({
					module,
					status: 'error',
					message: `${pkg} ${installed} (installed) does not satisfy the declared range "${range}". Reinstall dependencies — SVForge requires ${pkg} ${minMajor}+.`
				});
			} else {
				results.push({
					module,
					status: 'error',
					message: `${pkg} ${range} (installed: ${installed}) is incompatible — SVForge requires ${minMajor}+.`
				});
			}
			continue;
		}
		// No node_modules (or unreadable range) — analyse the range itself,
		// honouring upper bounds so compound ranges stay truthful.
		const verdict = rangeAllowsMajor(range, minMajor);
		if (verdict === null) {
			results.push({
				module,
				status: 'warn',
				message: `${pkg} ${range} — could not interpret the version range. SVForge requires ${minMajor}+.`
			});
		} else if (!verdict) {
			results.push({
				module,
				status: 'error',
				message: `${pkg} ${range} is incompatible — SVForge requires ${minMajor}+.`
			});
		} else {
			results.push({
				module,
				status: 'ok',
				message: `${pkg} ${range} satisfies the ${minMajor}+ requirement.`
			});
		}
	}
	return results;
}

/**
 * Does a semver range admit major `minMajor` or higher?
 *
 * Each `||` branch is evaluated independently: intersect the major interval
 * admitted by EVERY comparator of the branch — upper bounds included — then
 * ask whether any major ≥ `minMajor` survives. So `>=4.0.0 <5.0.0` can never
 * admit major 5. Returns null when no branch carries a parseable comparator.
 */
export function rangeAllowsMajor(range: string, minMajor: number): boolean | null {
	const branches = range.split('||').map((b) => b.trim()).filter(Boolean);
	if (branches.length === 0) return null;
	const verdicts = branches
		.map((branch) => branchAllowsMajor(branch, minMajor))
		.filter((v): v is boolean => v !== null);
	return verdicts.length === 0 ? null : verdicts.some(Boolean);
}

/**
 * Static branch analysis (used when the installed version is unreadable).
 */
function branchAllowsMajor(branch: string, minMajor: number): boolean | null {
	let sawComparator = false;
	let lowest = -Infinity; // inclusive lower major bound
	let highest = Infinity; // inclusive upper major bound
	for (const token of splitComparators(branch)) {
		const expanded = expandComparator(token);
		if (expanded === 'any') {
			sawComparator = true;
			continue;
		}
		// Unsupported syntax (e.g. hyphen ranges) → unknown verdict, never a
		// guessed true/false.
		if (expanded === null) return null;
		sawComparator = true;
		for (const bound of expanded) {
			const { major, minor, patch } = bound.version;
			switch (bound.op) {
				case '>=':
				case '>':
					// `>M.*` still admits later patches of major M.
					lowest = Math.max(lowest, major);
					break;
				case '<=':
					highest = Math.min(highest, major);
					break;
				case '<':
					// `<M.0.0` excludes EVERY version of major M; `<M.N.P` with
					// N or P non-zero still admits lower versions of major M.
					highest = Math.min(highest, minor === 0 && patch === 0 ? major - 1 : major);
					break;
			}
		}
	}
	if (!sawComparator) return null;
	return Math.max(lowest, minMajor) <= highest;
}

// ── Semver engine (comparators, bounds, installed versions) ─────────

interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	/** Prerelease identifiers without the leading `-` ('' when stable). */
	prerelease: string;
}

/** Parse a strict semver version (leading v and build metadata tolerated). */
function parseVersion(version: string): ParsedVersion | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(version.trim());
	if (!match) return null;
	return {
		major: parseInt(match[1]!, 10),
		minor: parseInt(match[2]!, 10),
		patch: parseInt(match[3]!, 10),
		prerelease: match[4] ?? ''
	};
}

/** Three-way SemVer precedence comparison (prereleases included). */
function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	if (a.patch !== b.patch) return a.patch - b.patch;
	if (a.prerelease === b.prerelease) return 0;
	if (a.prerelease === '') return 1; // stable > prerelease
	if (b.prerelease === '') return -1;
	const left = a.prerelease.split('.');
	const right = b.prerelease.split('.');
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const x = left[i];
		const y = right[i];
		if (x === undefined) return -1; // fewer identifiers sort lower
		if (y === undefined) return 1;
		const xNum = /^\d+$/.test(x);
		const yNum = /^\d+$/.test(y);
		if (xNum && yNum) {
			const delta = parseInt(x, 10) - parseInt(y, 10);
			if (delta !== 0) return delta;
		} else if (xNum !== yNum) {
			return xNum ? -1 : 1; // numeric identifiers < alphanumeric
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Proper minimum check: `version` must be >= `M.0.0` by SemVer precedence, so
 * a prerelease (5.0.0-rc.1 < 5.0.0) does NOT satisfy the minimum.
 */
function meetsMinimumVersion(version: string, minMajor: number): boolean {
	const parsed = parseVersion(version);
	if (!parsed) return false;
	return compareVersions(parsed, { major: minMajor, minor: 0, patch: 0, prerelease: '' }) >= 0;
}

/** One primitive comparison bound after desugaring (^, ~, x-ranges, =). */
interface SemverBound {
	op: '>=' | '>' | '<' | '<=';
	version: ParsedVersion;
}

const COMPARATOR_TOKEN = /^(>=|<=|>|<|=|\^|~)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([\w.-]+))?(?:\+[\w.-]+)?$/;

/** Split a branch into comparator tokens, closing `op version` spacing. */
function splitComparators(branch: string): string[] {
	return branch.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
}

/**
 * Desugar one comparator token into primitive bounds (ALL must hold), 'any'
 * when the token admits everything, or null when it is not parseable.
 */
function expandComparator(rawToken: string): SemverBound[] | 'any' | null {
	const token = rawToken.trim().replace(/^workspace:/, '');
	if (token === '' || /^[xX*]+$/.test(token) || /^(latest|next)$/i.test(token)) return 'any';
	const match = COMPARATOR_TOKEN.exec(token);
	if (!match) return null;
	if (/^[xX*]$/.test(match[2]!)) return 'any';
	const op = match[1];
	const isX = (part: string | undefined) => part === undefined || /^[xX*]$/.test(part);
	const major = parseInt(match[2]!, 10);
	const minorX = isX(match[3]);
	// When the minor is x/missing, the patch position is necessarily absent too
	// — treating it as x keeps `patch` at 0 instead of parseInt(undefined)=NaN.
	const patchX = minorX || isX(match[4]);
	const minor = minorX ? 0 : parseInt(match[3]!, 10);
	const patch = patchX ? 0 : parseInt(match[4]!, 10);
	const base: ParsedVersion = { major, minor, patch, prerelease: match[5] ?? '' };
	const nextMajor: ParsedVersion = { major: major + 1, minor: 0, patch: 0, prerelease: '' };

	if (op === '^') {
		return [{ op: '>=', version: base }, { op: '<', version: caretUpperBound(major, minor, patch, minorX, patchX) }];
	}
	if (op === '~') {
		// Per SemVer tilde semantics: ~5.1.2 / ~5.1 / ~5.1.x → >=5.1.0 <5.2.0;
		// ~5 / ~5.x → >=5.0.0 <6.0.0. A missing/x patch never widens the range.
		const upper = minorX ? nextMajor : { major, minor: minor + 1, patch: 0, prerelease: '' };
		return [{ op: '>=', version: base }, { op: '<', version: upper }];
	}
	if (op === '>' || op === '<=') {
		// Ordered comparators on a partial version round UP per SemVer:
		// `>X.Y` admits nothing inside X.Y, so it means `>=X.(Y+1).0`
		// (`>X` → `>=X+1.0.0`); `<=X.Y` admits all of X.Y, so it means
		// `<X.(Y+1).0` (`<=X` → `<X+1.0.0`). Naively zero-filling the patch
		// would wrongly admit 5.1.9 for `>5.1` and wrongly reject it for `<=5.1`.
		if (!patchX) return [{ op, version: base }];
		const rounded = minorX ? nextMajor : { major, minor: minor + 1, patch: 0, prerelease: '' };
		return [{ op: op === '>' ? '>=' : '<', version: rounded }];
	}
	if (op === '>=' || op === '<') {
		// These zero-fill correctly: `>=X.Y` → `>=X.Y.0`, `<X.Y` → `<X.Y.0`.
		return [{ op, version: base }];
	}
	// No operator: exact version pin or x-range.
	if (minorX) return [{ op: '>=', version: base }, { op: '<', version: nextMajor }];
	if (patchX) return [{ op: '>=', version: base }, { op: '<', version: { major, minor: minor + 1, patch: 0, prerelease: '' } }];
	return [{ op: '>=', version: base }, { op: '<=', version: base }];
}

/** Upper bound of a caret range per SemVer caret semantics. */
function caretUpperBound(major: number, minor: number, patch: number, minorX: boolean, patchX: boolean): ParsedVersion {
	if (major > 0 || minorX) return { major: major + 1, minor: 0, patch: 0, prerelease: '' };
	if (minor > 0 || patchX) return { major: 0, minor: minor + 1, patch: 0, prerelease: '' };
	return { major: 0, minor: 0, patch: patch + 1, prerelease: '' };
}

/**
 * Does `version` satisfy at least one `||` branch — and then EVERY bound of
 * that branch (lower AND upper)? Prerelease versions only satisfy a branch
 * when a comparator carries a prerelease on the same [major, minor, patch]
 * tuple: exact prerelease pins qualify, a plain `^5.0.0` does not.
 */
export function versionSatisfiesRange(version: string, range: string): boolean {
	const parsed = parseVersion(version);
	if (!parsed) return false;
	return range
		.split('||')
		.map((branch) => branch.trim())
		.filter(Boolean)
		.some((branch) => branchSatisfies(parsed, branch));
}

function branchSatisfies(version: ParsedVersion, branch: string): boolean {
	let sawComparator = false;
	let prereleaseAllowed = version.prerelease === '';
	for (const token of splitComparators(branch)) {
		const expanded = expandComparator(token);
		if (expanded === 'any') {
			sawComparator = true;
			continue;
		}
		if (expanded === null) return false;
		sawComparator = true;
		for (const bound of expanded) {
			if (!boundAllows(version, bound)) return false;
			if (bound.version.prerelease !== '' &&
				bound.version.major === version.major &&
				bound.version.minor === version.minor &&
				bound.version.patch === version.patch
			) {
				prereleaseAllowed = true;
			}
		}
	}
	return sawComparator && prereleaseAllowed;
}

function boundAllows(version: ParsedVersion, bound: SemverBound): boolean {
	const order = compareVersions(version, bound.version);
	switch (bound.op) {
		case '>=': return order >= 0;
		case '>': return order > 0;
		case '<=': return order <= 0;
		case '<': return order < 0;
	}
}

/**
 * True when at least one `||` branch consists entirely of supported
 * comparators. Unsupported syntax (hyphen ranges like "5.0.0 - 6.0.0") is
 * reported as unparsable so callers emit the explicit "could not interpret"
 * warning instead of a guessed verdict.
 */
function rangeIsParsable(range: string): boolean {
	return range
		.split('||')
		.map((branch) => branch.trim())
		.filter(Boolean)
		.some((branch) => {
			const tokens = splitComparators(branch);
			return tokens.length > 0 && tokens.every((token) => expandComparator(token) !== null);
		});
}

/** Read a package's INSTALLED version from node_modules, or null. */
function readInstalledVersion(root: string, pkg: string): string | null {
	try {
		const raw = readFileSync(join(root, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf-8');
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const version = (parsed as Record<string, unknown>).version;
		return typeof version === 'string' && parseVersion(version) !== null ? version : null;
	} catch {
		return null;
	}
}

/** Format and print a doctor report to the console. */
export function printReport(report: DoctorReport): void {
	console.log('\n SVForge Doctor\n');
	for (const result of report.results) {
		const icon = result.status === 'ok' ? '✓' : result.status === 'warn' ? '⚠' : '✗';
		const label = result.status === 'ok' ? 'OK' : result.status === 'warn' ? 'WARN' : 'ERROR';
		console.log(`  ${icon} [${result.module}] ${label}: ${result.message}`);
	}
	console.log(`\n${report.healthy ? '✓ All checks passed.' : '⚠ Some checks need attention.'}\n`);
}
