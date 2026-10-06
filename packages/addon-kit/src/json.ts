/**
 * Safe JSON merges for @svforge addons (#324).
 *
 * The old per-module helpers swallowed parse errors
 * (`try { JSON.parse } catch { {} }`): a syntax error in .svforge.json or
 * messages/{locale}.json silently reset the file to an empty object, and the
 * install rewrote it — DESTROYING user content.
 *
 * The contract implemented here:
 *  1. invalid JSON → a JsonGuardError carrying the file path, the parse
 *     diagnostic and a remediation step usable by a human or an AI agent;
 *  2. the minimal schema of .svforge.json and of message catalogs is
 *     validated BEFORE merging;
 *  3. ALL reads, validations and merges happen in memory FIRST — the plan
 *     either covers every file or fails without producing writes;
 *  4. on failure the caller installs nothing, so every source file stays
 *     byte-for-byte identical;
 *  5. merges are never destructive: existing keys always win, and re-running
 *     an install is idempotent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CONTRACTS, MODULE_DEPLOYMENT_SUPPORT, type ModuleDeploymentSupport } from './capabilities';

/** Error raised for an invalid JSON file: path + diagnostic + remediation. */
export class JsonGuardError extends Error {
	readonly filePath: string;
	readonly diagnostic: string;
	readonly remediation: string;

	constructor(filePath: string, diagnostic: string, remediation: string) {
		super(
			`SVForge addon cannot read "${filePath}": ${diagnostic}\n` +
				`Remediation: ${remediation}\n` +
				`No files were written — the file on disk is unchanged.`
		);
		this.name = 'JsonGuardError';
		this.filePath = filePath;
		this.diagnostic = diagnostic;
		this.remediation = remediation;
	}
}

export type JsonGuardResult<T> = { ok: true; value: T } | { ok: false; error: JsonGuardError };

/** Compute a human line/column from a character offset. */
function lineColumnOf(content: string, position: number): { line: number; column: number } | undefined {
	if (!Number.isInteger(position) || position < 0) return undefined;
	const before = content.slice(0, position);
	const lines = before.split('\n');
	return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

export type ParsedJson = { ok: true; value: unknown; empty: boolean } | { ok: false; error: JsonGuardError };

/**
 * Strict JSON.parse with a diagnosable failure: the error message carries the
 * file path, the underlying parse diagnostic (with line/column when the
 * engine exposes a position) and a remediation step. An empty (or absent)
 * file is reported as `{ empty: true }` — there is no user content to lose.
 */
export function parseJsonFile(filePath: string, content: string): { ok: true; value: unknown; empty: true } | { ok: true; value: unknown; empty: false } | { ok: false; error: JsonGuardError } {
	if (!content || !content.trim()) return { ok: true, value: undefined, empty: true };
	try {
		return { ok: true, value: JSON.parse(content) as unknown, empty: false };
	} catch (e) {
		const raw = e instanceof Error ? e.message : String(e);
		const positionMatch = /position (\d+)/i.exec(raw);
		const location = positionMatch ? lineColumnOf(content, Number(positionMatch[1])) : undefined;
		const where = location ? ` (line ${location.line}, column ${location.column})` : '';
		return {
			ok: false,
			error: new JsonGuardError(
				filePath,
				`invalid JSON syntax${where}: ${raw}`,
				`fix the JSON syntax error in "${filePath}" — the file must contain valid JSON (check a trailing comma, an unquoted key or an unclosed brace near the reported position). Valid example: {"key": "value"}`
			)
		};
	}
}

/**
 * Minimal schema of a Paraglide message catalog: a flat JSON object whose
 * values are all strings (the $schema header included). Returns a list of
 * problems (empty = valid).
 */
export function validateMessageCatalog(value: unknown, filePath: string): string[] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return [
			`"${filePath}": expected a JSON object (a message catalog mapping message keys to strings), got ${Array.isArray(value) ? 'an array' : value === null ? 'null' : typeof value}.`
		];
	}
	const problems: string[] = [];
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry !== 'string') {
			problems.push(
				`"${filePath}": message "${key}" must map to a string, got ${Array.isArray(entry) ? 'an array' : typeof entry}. Paraglide catalogs are flat string → string maps — move nested data to separate keys.`
			);
		}
	}
	return problems;
}

export interface ManifestModuleCapabilities {
	provides?: string[];
	requires?: string[];
}

/**
 * Minimal schema of the project's .svforge.json manifest. Unknown keys are
 * allowed (user extensions are preserved) but the core fields, when present,
 * must have the documented shape. Returns a list of problems (empty = valid).
 */
export function validateManifestShape(value: unknown, filePath: string): string[] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return [
			`"${filePath}": expected a JSON object (the SVForge manifest), got ${Array.isArray(value) ? 'an array' : value === null ? 'null' : typeof value}.`
		];
	}
	const manifest = value as Record<string, unknown>;
	const problems: string[] = [];
	if (manifest.schema !== undefined && manifest.schema !== 1) {
		problems.push(`"${filePath}": unsupported manifest schema (${String(manifest.schema)}) — this SVForge version understands schema 1.`);
	}
	if (manifest.template !== undefined && manifest.template !== 'base' && manifest.template !== 'dashboard') {
		problems.push(`"${filePath}": template must be "base" or "dashboard", got ${JSON.stringify(manifest.template)}.`);
	}
	if (manifest.modules !== undefined) {
		if (!Array.isArray(manifest.modules) || manifest.modules.some((m) => typeof m !== 'string')) {
			problems.push(`"${filePath}": modules must be an array of module id strings.`);
		}
	}
	if (manifest.ui !== undefined) {
		const ui = manifest.ui;
		if (typeof ui !== 'object' || ui === null || Array.isArray(ui)) {
			problems.push(`"${filePath}": ui must be an object with preferred and libraries fields.`);
		} else {
			const block = ui as Record<string, unknown>;
			if (block.preferred !== undefined && (typeof block.preferred !== 'string' || !block.preferred.trim())) {
				problems.push(`"${filePath}": ui.preferred must be a non-empty string.`);
			}
			if (block.libraries !== undefined) {
				if (!Array.isArray(block.libraries)) {
					problems.push(`"${filePath}": ui.libraries must be an array of { package, componentRoots? } objects.`);
				} else {
					for (const [index, library] of block.libraries.entries()) {
						if (typeof library !== 'object' || library === null || Array.isArray(library)) {
							problems.push(`"${filePath}": ui.libraries[${index}] must be an object.`);
							continue;
						}
						const entry = library as Record<string, unknown>;
					if (typeof entry.package !== 'string' || !entry.package.trim()) {
							problems.push(`"${filePath}": ui.libraries[${index}].package must be a non-empty package name.`);
						}
						if (entry.componentRoots !== undefined && (!Array.isArray(entry.componentRoots) || entry.componentRoots.some((root) => {
							if (typeof root !== 'string' || !root.trim() || root.startsWith('/') || /^[a-z]:[\\/]/i.test(root) || /^[/\\]{2}/.test(root) || /(^|[\\/])\.\.([\\/]|$)/.test(root) || /[*?{}]/.test(root)) return true;
							const normalizedRoot = root.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.').join('/');
							const segments = normalizedRoot.split('/');
							const sharedComponentDir = ['ui', 'primitives', 'layout'].includes(segments[3]);
							return segments.length < 4 || !normalizedRoot.startsWith('src/lib/components/') || segments[3] === 'svforge' || (sharedComponentDir && segments.length === 4);
						}))) {
							problems.push(`"${filePath}": ui.libraries[${index}].componentRoots must be narrow directories under src/lib/components/<library>, without traversal or glob patterns.`);
						}
					}
				}
			}
		}
	}
	if (manifest.capabilities !== undefined) {
		if (!Array.isArray(manifest.capabilities) || manifest.capabilities.some((c) => typeof c !== 'string')) {
			problems.push(`"${filePath}": capabilities must be an array of strings.`);
		}
	}
	if (manifest.patterns !== undefined) {
		if (
			typeof manifest.patterns !== 'object' ||
			manifest.patterns === null ||
			Array.isArray(manifest.patterns) ||
			Object.values(manifest.patterns).some((p) => typeof p !== 'string')
		) {
			problems.push(`"${filePath}": patterns must be an object mapping capability names to pattern strings.`);
		}
	}
	if (manifest.i18n !== undefined) {
		const i18n = manifest.i18n;
		if (typeof i18n !== 'object' || i18n === null || Array.isArray(i18n)) {
			problems.push(
				`"${filePath}": i18n must be an object ({ adapter, baseLocale, catalogs, settings }), got ${Array.isArray(i18n) ? 'an array' : i18n === null ? 'null' : typeof i18n}.`
			);
		} else {
			const block = i18n as Record<string, unknown>;
			for (const field of ['adapter', 'baseLocale', 'catalogs', 'settings'] as const) {
				if (block[field] !== undefined && typeof block[field] !== 'string') {
					problems.push(`"${filePath}": i18n.${field} must be a string when present (got ${typeof block[field]}).`);
				}
			}
		}
	}
	if (manifest.deployment !== undefined) {
		const deployment = manifest.deployment;
		if (typeof deployment !== 'object' || deployment === null || Array.isArray(deployment)) {
			problems.push(`"${filePath}": deployment must be an object with a supported profile.`);
		} else if (
			(deployment as Record<string, unknown>).profile !== undefined &&
			!['long-lived-node', 'serverless', 'edge', 'separate-worker'].includes(String((deployment as Record<string, unknown>).profile))
		) {
			problems.push(`"${filePath}": deployment.profile must be one of long-lived-node, serverless, edge, separate-worker.`);
		}
	}
	if (manifest.moduleProfiles !== undefined) {
		const moduleProfiles = manifest.moduleProfiles;
		if (typeof moduleProfiles !== 'object' || moduleProfiles === null || Array.isArray(moduleProfiles)) {
			problems.push(`"${filePath}": moduleProfiles must be an object mapping module ids to profile support.`);
		} else {
			for (const [id, entry] of Object.entries(moduleProfiles as Record<string, unknown>)) {
				if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
					problems.push(`"${filePath}": moduleProfiles["${id}"] must be an object.`);
					continue;
				}
				const block = entry as Record<string, unknown>;
				if (!Array.isArray(block.supported) || !block.supported.every((p) => typeof p === 'string') || !Array.isArray(block.unsupported) || !block.unsupported.every((p) => typeof p === 'string') || typeof block.note !== 'string') {
					problems.push(`"${filePath}": moduleProfiles["${id}"] must contain supported/unsupported string arrays and a note.`);
				}
			}
		}
	}
	if (manifest.moduleCapabilities !== undefined) {
		const moduleCapabilities = manifest.moduleCapabilities;
		if (typeof moduleCapabilities !== 'object' || moduleCapabilities === null || Array.isArray(moduleCapabilities)) {
			problems.push(
				`"${filePath}": moduleCapabilities must be an object mapping module ids to { provides?: string[], requires?: string[] }, got ${Array.isArray(moduleCapabilities) ? 'an array' : moduleCapabilities === null ? 'null' : typeof moduleCapabilities}.`
			);
		} else {
			for (const [id, entry] of Object.entries(moduleCapabilities as Record<string, unknown>)) {
				if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
					problems.push(
						`"${filePath}": moduleCapabilities["${id}"] must be an object {{ provides?: string[], requires?: string[] }}, got ${Array.isArray(entry) ? 'an array' : entry === null ? 'null' : typeof entry}.`
					);
					continue;
				}
				const block = entry as ManifestModuleCapabilities;
				const providesValid =
					block.provides === undefined ||
					(Array.isArray(block.provides) && block.provides.every((token) => typeof token === 'string'));
				const requiresValid =
					block.requires === undefined ||
					(Array.isArray(block.requires) && block.requires.every((token) => typeof token === 'string'));
				if (!providesValid || !requiresValid) {
					problems.push(
						`"${filePath}": moduleCapabilities["${id}"].provides and .requires must be arrays of strings when present (got ${!providesValid ? `provides: ${JSON.stringify(block.provides)}` : `requires: ${JSON.stringify(block.requires)}`}).`
					);
					continue;
				}
				if (block.provides === undefined && block.requires === undefined) {
					problems.push(
						`"${filePath}": moduleCapabilities["${id}"] is an empty capability block ({}) — declare at least provides or requires as arrays of capability-token strings.`
					);
				}
			}
		}
	}
	return problems;
}

export interface PlannedWrite {
	/** Project-relative path (e.g. "messages/fr.json"). */
	path: string;
	/** Exact content to write. */
	content: string;
}

export type MergePlan = { ok: true; writes: PlannedWrite[] } | { ok: false; error: string };

function readProjectFile(rootDir: string, relPath: string): string | undefined {
	const full = join(rootDir, relPath);
	try {
		return readFileSync(full, 'utf8');
	} catch (e) {
		// Only a missing file means "absent" — every other read error (EACCES,
		// EISDIR…) must surface with its path instead of being swallowed as an
		// absent file (which would let the merge start from an empty base and
		// rewrite over unreadable user content).
		if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
		throw new Error(`SVForge addon cannot read "${full}": ${(e as Error).message}`, { cause: e });
	}
}

const MANIFEST_PATH = '.svforge.json';

export interface ManifestEnrichment {
	moduleId: string;
	/** Human capability label contributed to capabilities/patterns (e.g. "audit trail"). */
	capability: string;
	/** Canonical pattern path contributed to patterns (e.g. "src/lib/server/audit/"). */
	pattern: string;
}

/**
 * Plan the enrichment of the project's .svforge.json for one module
 * (#234/#296/#324). Reads the CURRENT file, validates its shape, computes the
 * merged result in memory and returns the write — or a failure naming the
 * file, the exact invalid field and the remediation. Never touches disk.
 *
 * The merge is idempotent and non-destructive: unknown user keys, existing
 * modules/capabilities and customized patterns are preserved.
 */
export function planManifestEnrich(rootDir: string, enrichment: ManifestEnrichment): MergePlan {
	return planManifestEnrichContent(readProjectFile(rootDir, MANIFEST_PATH), enrichment);
}

/**
 * Pure core of planManifestEnrich: enrich manifest CONTENT in memory — no
 * disk access. `existing` is the current file content (undefined when the
 * file is absent, '' when empty). Splitting the pure core from the fs read
 * lets deprecated/legacy callers that hold content in hand share the exact
 * same planning logic.
 */
export function planManifestEnrichContent(existing: string | undefined, enrichment: ManifestEnrichment): MergePlan {
	const freshManifest = () => ({
		schema: 1,
		template: 'base',
		modules: [],
		ui: { preferred: 'skeleton', libraries: [] },
		capabilities: [] as string[],
		patterns: {},
		moduleCapabilities: {},
		generatedBy: 'svforge'
	});

	let manifest: Record<string, unknown>;
	if (existing === undefined || !existing.trim()) {
		// Absent (non-SVForge project) or empty: start from the minimal schema-1
		// manifest. No user content exists to lose.
		manifest = freshManifest();
	} else {
		const parsed = parseJsonFile(MANIFEST_PATH, existing);
		if (!parsed.ok) return { ok: false, error: parsed.error.message };
		if (parsed.empty) {
			manifest = freshManifest();
		} else {
			manifest = parsed.value as Record<string, unknown>;
			const problems = validateManifestShape(parsed.value, MANIFEST_PATH);
			if (problems.length > 0) {
				return {
					ok: false,
					error: `${problems.join('\n')}\nRemediation: fix or delete "${MANIFEST_PATH}" (it is regenerated from the real project state by \`svforge context\`), then re-run the installation. No files were written.`
				};
			}
		}
	}

	// Enrich (never overwrite user content).
	const modules = (manifest.modules as string[] | undefined) ?? [];
	if (!modules.includes(enrichment.moduleId)) modules.push(enrichment.moduleId);
	manifest.modules = modules;

	const capabilities = (manifest.capabilities as string[] | undefined) ?? [];
	if (!capabilities.includes(enrichment.capability)) capabilities.push(enrichment.capability);
	manifest.capabilities = capabilities;

	const patterns = (manifest.patterns as Record<string, string> | undefined) ?? {};
	if (patterns[enrichment.capability] === undefined) {
		patterns[enrichment.capability] = enrichment.pattern;
	}
	manifest.patterns = patterns;

	// Capability tokens (#323): the module's contract is canonical data owned
	// by @svforge/addon-kit, recorded so AI agents can read the project's real
	// capability graph straight from .svforge.json. The tokens the module
	// PROVIDES also join the top-level capabilities list, so the manifest
	// exposes the project's FULL canonical capability list (same rule as
	// svforge's buildManifest).
	const contract = MODULE_CONTRACTS[enrichment.moduleId];
	if (contract) {
		const moduleCapabilities =
			(manifest.moduleCapabilities as Record<string, ManifestModuleCapabilities> | undefined) ?? {};
		moduleCapabilities[enrichment.moduleId] = {
			provides: [...contract.provides],
			requires: [...contract.requires]
		};
		manifest.moduleCapabilities = moduleCapabilities;
		const capabilities = (manifest.capabilities as string[] | undefined) ?? [];
		for (const token of contract.provides) {
			if (!capabilities.includes(token)) capabilities.push(token);
		}
		manifest.capabilities = capabilities;
	}

	// Keep deployment compatibility in the manifest even when a standalone
	// module is installed after the base/dashboard scaffold. This makes the
	// constraint available to humans and agents before architecture work.
	const profileIds = [...new Set([...(manifest.template === 'dashboard' ? ['dashboard'] : []), enrichment.moduleId])];
	const moduleProfiles = (manifest.moduleProfiles as Record<string, ModuleDeploymentSupport> | undefined) ?? {};
	for (const moduleId of profileIds) {
		const support = MODULE_DEPLOYMENT_SUPPORT[moduleId];
		if (support) moduleProfiles[moduleId] = support;
	}
	if (Object.keys(moduleProfiles).length > 0) manifest.moduleProfiles = moduleProfiles;

	return {
		ok: true,
		writes: [{ path: MANIFEST_PATH, content: `${JSON.stringify(manifest, null, 2)}\n` }]
	};
}

/**
 * Plan the module's WHOLE AI-context contribution (#234/#296/#323/#324): the
 * .svforge.json manifest enrichment (module id, capability, pattern,
 * capability tokens) AND the llms.txt merge (capability/pattern lines plus
 * the module's capability-token contract line). Both are computed from the
 * CURRENT files in memory; if any validation fails, the plan fails and
 * nothing is written.
 */
export function planAddonContext(rootDir: string, enrichment: ManifestEnrichment): MergePlan {
	const manifestPlan = planManifestEnrich(rootDir, enrichment);
	if (!manifestPlan.ok) return manifestPlan;

	// Capability-token contract line — format must match svforge's
	// renderLlmstxt byte-for-byte so `svforge context` stays a no-op (#296).
	const contract = MODULE_CONTRACTS[enrichment.moduleId];
	const contractLine = contract
		? `- ${enrichment.moduleId}: requires ${contract.requires.length > 0 ? contract.requires.join(', ') : '—'}; provides ${
				contract.provides.length > 0 ? contract.provides.join(', ') : '—'
		  }`
		: undefined;

	const writes = [...manifestPlan.writes];
	const existingLlms = readProjectFile(rootDir, 'llms.txt');
	if (existingLlms !== undefined) {
		// No llms.txt (non-SVForge project): skip — it is created by the next
		// scaffold or `svforge context` regeneration, not by a bare module.
		const deployment = MODULE_DEPLOYMENT_SUPPORT[enrichment.moduleId];
		const deploymentLine = deployment
			? `- ${enrichment.moduleId}: supported ${deployment.supported.join(', ') || 'none'}; unsupported ${deployment.unsupported.join(', ') || 'none'} — ${deployment.note}`
			: undefined;
		const llms = mergeLlmstxt(existingLlms, enrichment.capability, enrichment.pattern, contractLine, deploymentLine);
		if (llms !== existingLlms) writes.push({ path: 'llms.txt', content: llms });
	}
	return { ok: true, writes };
}

export interface CatalogMerge {
	/** Project-relative path of the catalog (e.g. "messages/fr.json"). */
	path: string;
	/** Message keys to add. Existing keys are NEVER overwritten. */
	additions: Record<string, string>;
}

/**
 * Merge one module's AI-context lines into the scaffolded llms.txt
 * (#258/#296/#323): the capability line in "## Capabilities installed", the
 * pattern line in "## Canonical patterns", and the capability-token contract
 * line in "## Capability contracts" (created on demand). Plain string
 * insertion — llms.txt is not JSON, so this cannot fail destructively.
 *
 * The layout must stay byte-compatible with svforge's `renderLlmstxt` so a
 * later `svforge context` regeneration is a no-op (#296).
 */
export function mergeLlmstxt(content: string, capability: string, pattern: string, contract?: string, deploymentLine?: string): string {
	const lines = (content || '').split('\n');

	const insertAtSectionEnd = (header: string): number => {
		const headerIndex = lines.findIndex((l) => l === header);
		if (headerIndex < 0) return lines.length;
		const nextSection = lines.findIndex((l, i) => i > headerIndex && l.startsWith('## '));
		const end = nextSection >= 0 ? nextSection : lines.length;
		// insert BEFORE the blank line that closes the section, so the byte
		// layout matches renderLlmstxt exactly (#296)
		return end > headerIndex + 1 && lines[end - 1] === '' ? end - 1 : end;
	};

	const capLine = `- ${capability}`;
	if (!lines.some((l) => l === capLine)) {
		lines.splice(insertAtSectionEnd('## Capabilities installed'), 0, capLine);
	}
	if (deploymentLine && lines.some((l) => l === '## Deployment profile') && !lines.some((l) => l === deploymentLine)) {
		if (!lines.some((l) => l === '### Installed module compatibility')) {
			const capabilitiesIndex = lines.findIndex((l) => l === '## Capabilities installed');
			const insertAt = capabilitiesIndex >= 0 ? capabilitiesIndex : lines.length;
			lines.splice(insertAt, 0, '### Installed module compatibility', '');
		}
		lines.splice(insertAtSectionEnd('### Installed module compatibility'), 0, deploymentLine);
	}
	if (contract && !lines.some((l) => l === contract)) {
		// Create the section on demand, in renderLlmstxt order: directly
		// before "## Canonical patterns" (or at EOF for minimal llms.txt).
		if (!lines.some((l) => l === '## Capability contracts')) {
			const canonicalIndex = lines.findIndex((l) => l === '## Canonical patterns');
			let insertAt = canonicalIndex >= 0 ? canonicalIndex : lines.length;
			// renderLlmstxt layout: exactly one blank BEFORE the header and one
			// after it — normalize instead of duplicating separators (#296).
			if (insertAt > 0 && lines[insertAt - 1] === '') {
				lines.splice(insertAt - 1, 1);
				insertAt -= 1;
			}
			lines.splice(insertAt, 0, '', '## Capability contracts', '');
		}
		lines.splice(insertAtSectionEnd('## Capability contracts'), 0, contract);
	}
	const patLine = `- ${capability}: ${pattern}`;
	if (!lines.some((l) => l === patLine)) {
		lines.splice(insertAtSectionEnd('## Canonical patterns'), 0, patLine);
	}
	return lines.join('\n');
}

/**
 * Plan the merge of message additions into one or more catalogs (#239/#324).
 * Every catalog is read, parsed and validated BEFORE any write is produced:
 * if the second catalog is invalid, the plan fails and the first catalog is
 * left byte-for-byte identical on disk (the caller installs nothing).
 */
export function planCatalogMerges(rootDir: string, merges: CatalogMerge[]): MergePlan {
	const errors: string[] = [];
	const writes: PlannedWrite[] = [];

	for (const merge of merges) {
		const existing = readProjectFile(rootDir, merge.path);
		if (existing === undefined && !merge.path.startsWith('messages/')) {
			// A catalog outside messages/ that does not exist is suspicious.
			errors.push(`"${merge.path}": file does not exist and this addon only merges into existing catalogs.`);
			continue;
		}
		let catalog: Record<string, unknown> = {};
		if (existing !== undefined && existing.trim()) {
			const parsed = parseJsonFile(merge.path, existing);
			if (!parsed.ok) {
				errors.push(parsed.error.message);
				continue;
			}
			if (!parsed.empty) {
				const problems = validateMessageCatalog(parsed.value, merge.path);
				if (problems.length > 0) {
					errors.push(...problems);
					continue;
				}
				catalog = parsed.value as Record<string, unknown>;
			}
		}
		// Non-destructive merge: existing keys win (user customizations and the
		// $schema header stay exactly where and what they are).
		for (const [key, value] of Object.entries(merge.additions)) {
			if (!(key in catalog)) catalog[key] = value;
		}
		const content = `${JSON.stringify(catalog, null, 2)}\n`;
		if (content !== existing) writes.push({ path: merge.path, content });
	}

	if (errors.length > 0) {
		return {
			ok: false,
			error: `${errors.join('\n')}\nRemediation: fix the JSON above so the addon can merge its message keys without destroying your customizations. No files were written — every catalog on disk is unchanged.`
		};
	}
	return { ok: true, writes };
}
