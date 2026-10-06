/**
 * SVForge AI context generation (#234).
 *
 * Generates two outputs in the target project, derived from its REAL state
 * (template + installed modules), not from generic docs:
 *
 *   .svforge.json  — machine-readable manifest (schema: 1)
 *   llms.txt       — concise LLM/human-readable context
 *
 * The base/dashboard modes write the initial context at scaffold time; each
 * module ENRICHES it without overwriting user edits (merge semantics).
 * `svforge context` regenerates deterministically.
 */

import {
	JsonGuardError,
	parseJsonFile,
	planManifestEnrichContent,
	validateManifestShape,
	TEMPLATE_PROVIDES,
	MODULE_DEPLOYMENT_SUPPORT,
	type DeploymentProfile as AddonDeploymentProfile,
	type ModuleDeploymentSupport
} from '@svforge/addon-kit';
import { MODULES } from './module-composition';

export type DeploymentProfile = AddonDeploymentProfile;
export type ModuleProfileSupport = ModuleDeploymentSupport;
export const MODULE_PROFILE_SUPPORT = MODULE_DEPLOYMENT_SUPPORT;

export const DEPLOYMENT_PROFILES: Record<DeploymentProfile, string[]> = {
	'long-lived-node': ['persistent Node process', 'PostgreSQL pool', 'attached WebSocket server'],
	serverless: ['request-scoped functions', 'no in-process worker or WebSocket server'],
	edge: ['Web-standard runtime', 'no Node APIs or TCP PostgreSQL driver'],
	'separate-worker': ['dedicated long-lived process for jobs or WebSocket transport']
};

export interface SvforgeManifest {
	schema: 1;
	template: 'base' | 'dashboard';
	stack?: {
		framework: 'sveltekit';
		ui: 'skeleton';
		i18n: 'paraglide';
		test: 'vitest';
		auth?: 'better-auth';
		orm?: 'drizzle';
		database?: 'postgresql';
	};
	modules: string[];
	/** Human-selected UI strategy and generic external component registrations (#480). */
	ui: {
		preferred: string;
		libraries: Array<{ package: string; componentRoots?: string[] }>;
	};
	/**
	 * Canonical capability tokens (#323) granted by the template plus the
	 * tokens/features contributed by the installed modules. The template-level
	 * legacy labels (skeleton-ui, paraglide-fr-en, auth, db…) are replaced by
	 * the shared vocabulary from @svforge/addon-kit so .svforge.json, llms.txt
	 * and the install gates all speak the same capability language.
	 */
	capabilities: string[];
	patterns: Record<string, string>;
	/** Capability contracts of the installed modules (#323). */
	moduleCapabilities?: Record<string, { provides: string[]; requires: string[] }>;
	/** Declared deployment target and profile capabilities (#332). */
	deployment?: {
		profile: DeploymentProfile;
		profiles: Record<DeploymentProfile, string[]>;
	};
	/** Runtime compatibility for installed modules (#332). */
	moduleProfiles?: Record<string, ModuleProfileSupport>;
	/**
	 * i18n contract (#322): where the message catalogs live and which locale is
	 * the base. Values mirror the SCAFFOLD DEFAULT; the live configuration is
	 * the generated project's project.inlang/settings.json + messages/*.json —
	 * both are defaults an application may change, not framework constraints.
	 */
	i18n?: {
		adapter: 'paraglide';
		baseLocale: string;
		catalogs: string;
		settings: string;
	};
	generatedBy: string;
}

/**
 * Template-level canonical capability tokens come from TEMPLATE_PROVIDES
 * (@svforge/addon-kit) — the same source the install gates and
 * validateComposition use, so llms.txt/.svforge.json never drift from the
 * contract.
 */
const BASE_PATTERNS: Record<string, string> = {
	'UI components': 'src/lib/components/svforge/',
	'Skeleton theme': 'src/lib/styles/svelteforge-theme.css',
	'Global CSS entrypoint': 'src/routes/layout.css',
	'Fonts': 'src/routes/layout.css',
	'i18n messages': 'messages/',
	'SEO': 'src/lib/components/svforge/ui/Seo.svelte'
};

const DASHBOARD_PATTERNS: Record<string, string> = {
	'Auth guard': 'src/routes/(app)/admin/*/+page.server.ts',
	'DB access': 'src/lib/server/db/',
	'Schemas (zod)': 'src/lib/server/schemas.ts',
	'Setup': 'scripts/setup.sh'
};

/** Capabilities contributed by each module (#236 metadata + #234 context). */
export const MODULE_CAPABILITIES: Record<string, { capability: string; pattern?: string; note?: string }> = {
	email: { capability: 'email (Resend)', pattern: 'src/lib/server/email.ts', note: 'Transactional emails via RESEND_API_KEY' },
	uploads: { capability: 'uploads (S3-compatible: POST hard limit, PUT best-effort fallback)', pattern: 'src/routes/api/upload/+server.ts (S3_UPLOAD_SIZE_POLICY)', note: 'POST is storage-enforced; PUT is an explicit best-effort fallback' },
	oauth: { capability: 'oauth (Google/GitHub)', pattern: 'src/lib/components/svforge/ui/OAuthButtons.svelte', note: 'Requires dashboard' },
	ui_toast: { capability: 'toasts (Skeleton Toast)', pattern: 'src/lib/components/svforge/ui/Toaster.svelte', note: 'Add <Toaster /> to root layout' },
	dnd: { capability: 'drag & drop', pattern: 'src/lib/components/svforge/dnd/SortableList.svelte' },
	tiptap: { capability: 'rich text (Tiptap)', pattern: 'src/lib/components/svforge/tiptap/', note: 'Toolbar + preview' },
	graph: { capability: 'knowledge graph', pattern: 'src/lib/components/svforge/graph/KnowledgeGraph.svelte' },
	blog: { capability: 'blog (MDsveX)', pattern: 'src/routes/blog/', note: 'Posts as .md in src/posts/' },
	realtime: { capability: 'realtime (WebSocket)', pattern: 'src/lib/server/realtime/', note: 'Publish/subscribe hub + Svelte client' },
	audit: { capability: 'audit trail', pattern: 'src/lib/server/audit/', note: 'Append-only business action log' },
	notifications: { capability: 'notifications', pattern: 'src/lib/server/notifications/', note: 'Persistent read/unread inbox' },
	jobs: { capability: 'background jobs', pattern: 'src/lib/server/jobs/', note: 'Encapsulated queue, atomic claims + leases, bounded retries with backoff. Worker: `bun run jobs:worker` — never auto-started in the web runtime (#328)' },
	chat: { capability: 'chat', pattern: 'src/lib/server/chat/', note: 'Conversations + messages + read-state, membership-enforced' }
};

/** Build the manifest for a given template + installed modules. */
export function buildManifest(template: 'base' | 'dashboard', modules: string[]): SvforgeManifest {
	// Canonical capability tokens (#323): the template grants come from the
	// shared vocabulary — no legacy ad-hoc labels.
	const capabilities: string[] = [...TEMPLATE_PROVIDES[template]];
	const patterns = { ...BASE_PATTERNS };
	if (template === 'dashboard') {
		Object.assign(patterns, DASHBOARD_PATTERNS);
	}
	for (const mod of modules) {
		const meta = MODULE_CAPABILITIES[mod];
		if (!meta) continue;
		capabilities.push(meta.capability);
		if (meta.pattern) patterns[meta.capability] = meta.pattern;
		// Capability tokens the module itself provides (#323, e.g. uploads →
		// storage.object) so the manifest exposes the project's FULL canonical
		// capability list, not just per-module contracts.
		for (const token of MODULES[mod]?.provides ?? []) {
			if (!capabilities.includes(token)) capabilities.push(token);
		}
	}
	// Capability contracts (#323): expose each installed module's capability
	// tokens so AI agents can read the project's real capability graph.
	const moduleCapabilities: SvforgeManifest['moduleCapabilities'] = {};
	for (const mod of modules) {
		const contract = MODULES[mod];
		if (!contract) continue;
		moduleCapabilities[mod] = { provides: [...contract.provides], requires: [...contract.requires] };
	}
	return {
		schema: 1,
		template,
		stack: {
			framework: 'sveltekit',
			ui: 'skeleton',
			i18n: 'paraglide',
			test: 'vitest',
			...(template === 'dashboard' ? { auth: 'better-auth', orm: 'drizzle', database: 'postgresql' } : {})
		},
		modules,
		ui: { preferred: 'skeleton', libraries: [] },
		capabilities: [...new Set(capabilities)],
		patterns,
		moduleCapabilities,
		// Scaffold default (#322) — mirrors templates/base/root/project.inlang/
		// settings.json (baseLocale fr). The generated project's settings file
		// is the live source of truth once the application evolves.
		i18n: {
			adapter: 'paraglide',
			baseLocale: 'fr',
			catalogs: 'messages/',
			settings: 'project.inlang/settings.json'
		},
		deployment: { profile: 'serverless', profiles: DEPLOYMENT_PROFILES },
		moduleProfiles: Object.fromEntries(
			[...new Set([...(template === 'dashboard' ? ['dashboard'] : []), ...modules])]
				.filter((moduleId) => MODULE_PROFILE_SUPPORT[moduleId])
				.map((moduleId) => [moduleId, MODULE_PROFILE_SUPPORT[moduleId]])
		),
		generatedBy: 'svforge'
	};
}

/** Render the human/LLM-readable llms.txt from a manifest. */
export function renderLlmstxt(manifest: SvforgeManifest): string {
	const lines: string[] = [];
	lines.push('# SvelteForge project');
	lines.push('');
	lines.push(`Template: ${manifest.template}`);
	const ui = manifest.ui ?? { preferred: 'skeleton', libraries: [] };
	lines.push('Stack: SvelteKit + Skeleton UI v5 + Tailwind v4 + Paraglide i18n + Vitest');
	lines.push('');
	lines.push('## UI strategy');
	lines.push(`Preferred UI strategy: ${ui.preferred}`);
	if (ui.libraries.length) {
		lines.push('Project-selected UI/headless libraries:');
		for (const library of ui.libraries) {
			lines.push(`- ${library.package}${library.componentRoots?.length ? ` — source roots: ${library.componentRoots.join(', ')}` : ''}`);
		}
	} else {
		lines.push('- Skeleton is the recommended/default UI system; no external UI libraries are registered.');
	}
	if (manifest.stack?.auth) lines.push(`Auth: ${manifest.stack.auth}  •  ORM: ${manifest.stack.orm}`);
	if (manifest.stack?.database) lines.push(`Database: ${manifest.stack.database}`);
	const deployment = manifest.deployment;
	if (deployment) {
		lines.push('');
		lines.push('## Deployment profile');
		lines.push(`Declared profile: ${deployment.profile}`);
		for (const [profile, capabilities] of Object.entries(deployment.profiles)) {
			lines.push(`- ${profile}: ${capabilities.join('; ')}`);
		}
		const moduleProfiles = manifest.moduleProfiles ?? {};
		if (Object.keys(moduleProfiles).length > 0) {
			lines.push('### Installed module compatibility');
			for (const [moduleId, support] of Object.entries(moduleProfiles)) {
				lines.push(`- ${moduleId}: supported ${support.supported.join(', ') || 'none'}; unsupported ${support.unsupported.join(', ') || 'none'} — ${support.note}`);
			}
		}
	}
	lines.push('');
	lines.push('## Capabilities installed');
	for (const cap of manifest.capabilities) lines.push(`- ${cap}`);
	lines.push('');
	// Capability contracts (#323): the tokens each installed module requires
	// and provides — derived from the manifest, deterministic.
	const contracts = Object.entries(manifest.moduleCapabilities ?? {});
	if (contracts.length > 0) {
		lines.push('## Capability contracts');
		for (const [mod, caps] of contracts) {
			const requires = caps.requires.length > 0 ? caps.requires.join(', ') : '—';
			const provides = caps.provides.length > 0 ? caps.provides.join(', ') : '—';
			lines.push(`- ${mod}: requires ${requires}; provides ${provides}`);
		}
		lines.push('');
	}
	lines.push('## Canonical patterns');
	for (const [name, path] of Object.entries(manifest.patterns)) {
		lines.push(`- ${name}: ${path}`);
	}
	lines.push('');
	lines.push('## CSS architecture');
	lines.push('- src/routes/layout.css is the single global CSS entrypoint; keep it as framework/tooling wiring');
	lines.push('- src/lib/styles/svelteforge-theme.css is the complete Skeleton v5 theme and visual source of truth');
	lines.push('- fonts are @fontsource-variable/* imports in src/routes/layout.css (Inter body, Space Grotesk headings, Fira Code code); swap or remove them there');
	lines.push('- no generic tokens.css/index.css layer is scaffolded; use standard Tailwind utilities for local layout/spacing');
	lines.push('');
	// i18n contract (#322): defaults vs constraints — catalogs are the AI-first
	// source of truth, locales are initial values the application may change.
	const i18n = manifest.i18n ?? { adapter: 'paraglide', baseLocale: 'fr', catalogs: 'messages/', settings: 'project.inlang/settings.json' };
	lines.push('## i18n (Paraglide)');
	lines.push(`- message catalogs ${i18n.catalogs}<locale>.json are the source of truth for static UI copy — edit catalogs, never generated src/lib/paraglide`);
	lines.push(`- baseLocale: ${i18n.baseLocale} (scaffold default); locales are configured in ${i18n.settings}`);
	lines.push(`- the scaffolded locales (${i18n.baseLocale}/en at scaffold time) are initial defaults, not a limit — add a locale: create messages/<locale>.json with the full key set, then register it in ${i18n.settings}`);
	lines.push('- keep key parity across every configured locale; modules ship their keys for the scaffolded locales — port them into any locale you add');
	lines.push('- long-form editorial, business and CMS content does not belong in the catalogs');
	lines.push('');
	lines.push('## Rules for AI agents');
	lines.push('MUST:');
	lines.push('- reuse existing project components first');
	if (ui.libraries.length) {
		lines.push('- reuse the UI/headless libraries explicitly enabled by this project');
		lines.push('- prefer the configured project UI strategy over reimplementing its primitives');
	} else {
		lines.push('- prefer Skeleton/Skeleton Svelte when it covers the need');
		lines.push('- do not add a UI library unless the user explicitly requests one; ask before changing the project UI stack');
	}
	lines.push('- reuse installed SVForge components/modules before creating alternatives');
	lines.push('- change the Skeleton theme/presets first for global visual decisions that Skeleton supports');
	lines.push('- use standard Tailwind utilities for local structure, whitespace and responsive layout');
	lines.push('- use Paraglide messages for user-facing copy and keep key parity across every configured locale');
	lines.push('- follow the canonical patterns above');
	lines.push('MUST NOT:');
	lines.push('- install/register a new ORM, auth provider or UI library without explicit user request');
	if (ui.libraries.length) lines.push('- remove or replace a project-selected UI library merely because Skeleton has an overlapping primitive');
	lines.push('- recreate Button/Input/Card/Table primitives (they exist)');
	lines.push('- create a parallel global palette/token layer or visual overrides by default');
	lines.push('- modify generated internals (src/lib/paraglide, .svforge.json) without understanding the workflow');
	lines.push('');
	lines.push('## Inspect first');
	lines.push('- AGENTS.md (full conventions)');
	lines.push('- src/lib/components/svforge/ (component catalog)');
	lines.push('- svforge-catalog.json (machine-readable catalog)');
	lines.push('- svforge-modules.json (module metadata)');
	// Trailing newline so the file is byte-identical whether written by the
	// installer (sv.file) or regenerated by `svforge context` (#296).
	return lines.join('\n') + '\n';
}

/** Merge module contributions into an existing manifest (idempotent). */
export function mergeManifest(existing: SvforgeManifest, template: 'base' | 'dashboard', modules: string[]): SvforgeManifest {
	const merged = buildManifest(template, [...new Set([...existing.modules, ...modules])]);
	merged.ui = existing.ui ?? { preferred: 'skeleton', libraries: [] };
	// A user-selected target is configuration, not generated module metadata.
	// Preserve it when a legacy helper enriches an existing manifest.
	if (existing.deployment?.profile) {
		merged.deployment = { ...merged.deployment, profile: existing.deployment.profile, profiles: existing.deployment.profiles ?? DEPLOYMENT_PROFILES };
	}
	return merged;
}

/**
 * Enrichment callback for modules (#234): given the existing .svforge.json
 * content ('' on first write), return the merged manifest JSON.
 *
 * DEPRECATED (#324 remediation): the original helper swallowed parse errors
 * (`try { JSON.parse } catch { buildManifest('base', []) }`) and rewrote a
 * corrupt manifest from an empty base, destroying user content. The behavior
 * now lives in `planManifestEnrich` (@svforge/addon-kit), which validates the
 * file and fails the installation BEFORE anything is written. This alias is
 * kept ONLY so imports of the old name keep working: it delegates to the same
 * non-destructive planning core (planManifestEnrichContent) and warns once.
 * It does NOT reset an invalid manifest to an empty base — an invalid input
 * THROWS the diagnosable JsonGuardError instead.
 *
 * @deprecated Use `planManifestEnrich(rootDir, enrichment)` from
 *   @svforge/addon-kit (plan-then-write, non-destructive).
 */
let enrichManifestDeprecationWarned = false;
export function enrichManifest(content: string, moduleId: string): string {
	if (!enrichManifestDeprecationWarned) {
		enrichManifestDeprecationWarned = true;
		console.warn(
			'[svforge] enrichManifest() is deprecated and will be removed in the next major version — use planManifestEnrich() from @svforge/addon-kit (non-destructive, plan-before-write).'
		);
	}
	const meta = MODULE_CAPABILITIES[moduleId];
	const plan = planManifestEnrichContent(content ?? '', {
		moduleId,
		capability: meta?.capability ?? moduleId,
		pattern: meta?.pattern ?? ''
	});
	if (!plan.ok) {
		throw new JsonGuardError('.svforge.json', plan.error, 'use planManifestEnrich(rootDir, enrichment) — the diagnosable plan-then-write API');
	}
	return plan.writes[0].content;
}

/**
 * Regenerate llms.txt deterministically from the project's .svforge.json
 * (run via `svforge context`). Returns the new llms.txt content.
 *
 * Strict (#324): an invalid manifest THROWS a JsonGuardError carrying the
 * parse diagnostic and a remediation step — a corrupt manifest is never
 * silently treated as an empty base project (that would silently DROP every
 * module from the AI context).
 */
export function regenerateLlmstxt(manifestContent: string): string {
	const parsed = parseJsonFile('.svforge.json', manifestContent);
	if (!parsed.ok) throw parsed.error;
	if (parsed.empty) {
		throw new JsonGuardError(
			'.svforge.json',
			'the manifest file is empty',
			'restore a valid .svforge.json (it is generated by `sv add svforge=template:<template>`) or re-run the scaffold to regenerate it'
		);
	}
	const problems = validateManifestShape(parsed.value, '.svforge.json');
	if (problems.length > 0) {
		throw new JsonGuardError(
			'.svforge.json',
			problems.join(' '),
			'fix the manifest fields above (keep schema 1, template "base"|"dashboard", modules as a string array) — or delete .svforge.json and re-run `sv add svforge=template:<template>` to regenerate it, then re-install your modules'
		);
	}
	const manifest = parsed.value as SvforgeManifest;
	// Rebuild from the template + installed modules so capabilities/patterns
	// always reflect the real state (module enrich only adds its id).
	const rebuilt = buildManifest(manifest.template ?? 'base', manifest.modules ?? []);
	rebuilt.ui = manifest.ui ?? { preferred: 'skeleton', libraries: [] };
	if (manifest.deployment?.profile) {
		rebuilt.deployment = { ...rebuilt.deployment, profile: manifest.deployment.profile, profiles: manifest.deployment.profiles ?? DEPLOYMENT_PROFILES };
	}
	return renderLlmstxt(rebuilt);
}
