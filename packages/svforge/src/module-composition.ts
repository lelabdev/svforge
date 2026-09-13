/**
 * SvelteForge module composition & presets (#236).
 *
 * Formalizes the philosophy: 2 templates only (base/dashboard), opt-in
 * composable modules, and light presets (meta-packages) that compose existing
 * modules WITHOUT duplicating their code. Presets are recipes, not
 * implementations.
 *
 * #323: prerequisites are no longer template names. Every module declares
 * CAPABILITIES (requires/provides/optional) — the single source of truth
 * lives in @svforge/addon-kit (MODULE_CONTRACTS) and is shared with the
 * install gates of each addon package. A module installs on ANY project that
 * provides its required capabilities, SVForge template or not.
 */
import {
	CAPABILITIES,
	MODULE_CONTRACTS,
	compositionGaps,
	type Capability,
	type ModuleCapabilityContract
} from '@svforge/addon-kit';

export type { Capability, ModuleCapabilityContract };
export { CAPABILITIES, MODULE_CONTRACTS };

/** Full public metadata of a module (#236 contract). */
export interface ModuleMeta extends ModuleCapabilityContract {
	id: string;
	description: string;
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
	/** Files/capabilities added (documentation + #234 manifest). */
	files: string[];
	/**
	 * Non-interactive addon options (sv add spec `pkg=opt:value`), so tools
	 * composing modules headlessly (svforge create, #417) never prompt. The
	 * values MUST mirror the addon's defineAddonOptions defaults — enforced
	 * by a contract test against the built addon dists.
	 */
	addonOptions?: Record<string, string>;
}

/** Build one module's metadata from its shared contract + local identity. */
function meta(id: string, description: string, files: string[]): ModuleMeta {
	const contract = MODULE_CONTRACTS[id];
	if (!contract) {
		throw new Error(`Module "${id}" has no capability contract in @svforge/addon-kit.`);
	}
	return { ...contract, id, description, files };
}

/** Contract for every svforge module (#236, capabilities from #323). */
export const MODULES: Record<string, ModuleMeta> = {
	ui_toast: meta('ui_toast', 'Toast notifications (Skeleton Toast)', [
		'src/lib/components/svforge/ui/Toaster.svelte',
		'src/lib/components/svforge/ui/toaster.ts'
	]),
	dnd: meta('dnd', 'Drag & drop sortable lists', ['src/lib/components/svforge/dnd/SortableList.svelte']),
	tiptap: meta('tiptap', 'Rich text editor (Tiptap, toolbar + preview)', ['src/lib/components/svforge/tiptap/']),
	graph: meta('graph', 'Knowledge graph visualization (force-graph)', ['src/lib/components/svforge/graph/']),
	email: meta('email', 'Transactional emails (Resend)', ['src/lib/server/email.ts', 'src/lib/server/templates/']),
	oauth: meta('oauth', 'Social auth buttons (Google, GitHub)', ['src/lib/components/svforge/ui/OAuthButtons.svelte']),
	uploads: {
		...meta('uploads', 'File uploads (S3-compatible POST hard limit, PUT best-effort fallback)', [
			'src/lib/components/svforge/uploads/',
			'src/lib/server/s3.ts',
			'src/routes/api/upload/'
		]),
		// Headless composition (#417): the test pack stays opt-in, as in the
		// interactive flow — the addon default (false) rendered as a spec.
		addonOptions: { testpack: 'no' }
	},
	blog: meta('blog', 'MDsveX blog (posts + list + detail)', ['src/posts/', 'src/lib/utils/posts.ts', 'src/routes/blog/']),
	realtime: meta('realtime', 'WebSocket transport (publish/subscribe, channels isolés)', [
		'src/lib/server/realtime/',
		'src/lib/realtime/client.ts'
	]),
	audit: meta('audit', 'Business action audit trail (append-only)', [
		'src/lib/server/audit/',
		'src/routes/(app)/admin/audit/'
	]),
	notifications: meta('notifications', 'Persistent business notifications (read/unread)', [
		'src/lib/server/notifications/',
		'src/lib/components/svforge/ui/NotificationsBell.svelte',
		'src/routes/api/notifications/'
	]),
	jobs: meta('jobs', 'Background job foundation (retry, progress, backend encapsulé)', ['src/lib/server/jobs/']),
	chat: meta('chat', 'Composable app chat (conversations, messages, read-state)', [
		'src/lib/server/chat/',
		'src/routes/chat/'
	])
};

/** Reference presets — recipes that compose existing modules (#236). */
export const PRESETS: Record<string, Preset> = {
	saas: {
		description: 'Dashboard SaaS de départ : auth + admin + email + uploads',
		requires: 'dashboard',
		modules: ['email', 'uploads'],
		optional: ['tiptap', 'oauth', 'dnd']
	},
	community: {
		description: 'Site communautaire : base + blog + toast',
		requires: 'base',
		modules: ['blog', 'ui_toast'],
		optional: ['tiptap', 'graph']
	}
};

export interface Preset {
	description: string;
	/** Template the preset is built on. */
	requires: string;
	/** Modules installed by the preset (composition, not copies). */
	modules: string[];
	/** Recommended extras, never installed automatically. */
	optional: string[];
}

/**
 * Expand a preset into the concrete `sv add` spec (template + module names).
 * The user runs it with `sv add` (no parallel CLI): e.g.
 *   sv add 'svforge=template:dashboard' email uploads
 *
 * @returns The list of addon specifiers composing this preset.
 */
export function expandPreset(presetId: string): string[] {
	const preset = PRESETS[presetId];
	if (!preset) throw new Error(`Unknown preset "${presetId}". Available: ${Object.keys(PRESETS).join(', ')}`);
	const specs: string[] = [];
	if (preset.requires === 'dashboard') {
		specs.push("svforge=template:dashboard+testing:vitest");
	} else {
		specs.push("svforge=template:base+testing:vitest");
	}
	for (const mod of preset.modules) {
		specs.push(`@svforge/${mod}`);
	}
	return specs;
}

/**
 * Validate a composition over the CAPABILITY contract (#323): every module
 * must exist, and each module's requires must be covered by the template's
 * grants plus the provides of the other selected modules — exactly what a
 * single `sv add svforge=template:<t> m1 m2 …` will check again at install
 * time, this time structurally on the real project.
 *
 * @throws with a readable, derived message naming the missing capability and
 *   how to install it.
 */
export function validateComposition(template: 'base' | 'dashboard', moduleIds: string[]): void {
	for (const id of moduleIds) {
		if (!MODULES[id]) {
			throw new Error(`Unknown module "${id}". Available: ${Object.keys(MODULES).join(', ')}`);
		}
	}
	const gaps = compositionGaps(
		template,
		moduleIds.map((id) => ({ ...MODULES[id], id }))
	);
	for (const gap of gaps) {
		const details = gap.missing
			.map((token) => `- ${token} — ${CAPABILITIES[token].title}\n  Fix: ${CAPABILITIES[token].remedy}`)
			.join('\n');
		throw new Error(
			`Composition invalid: module "${gap.moduleId}" is missing required capabilities on the ${template} template:\n${details}`
		);
	}
}
