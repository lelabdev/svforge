import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planAddonContext } from '@svforge/addon-kit';
import { files } from './templates';



export default defineAddon({
	id: 'svforge-graph',
	alias: 'forge-graph',
	shortDescription: 'SVForge Graph — interactive knowledge graph visualization (Obsidian-style)',
	homepage: 'https://github.com/lelabdev/svforge',
	// Empty options required: sv >= 0.15 crashes on addons without an
	// options object (Object.entries(undefined) in promptAddonQuestions).
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Graph requires SvelteKit');
		// #323: the cn()/ui.svforge requirement is enforced by the capability
		// gate in run() — structurally, with a derived error message.
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): KnowledgeGraph imports cn() from the SVForge
		// base kit ($lib/utils) — the project must provide the ui.svforge kit.
		const gate = checkModuleCapabilities(cwd, 'graph');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}

		sv.dependency('force-graph', '^1.51.4');

		const context = planAddonContext(cwd, { moduleId: 'graph', capability: 'knowledge graph', pattern: 'src/lib/components/svforge/graph/KnowledgeGraph.svelte' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// AI context (#234): planned in memory first (#324) — an invalid
		// .svforge.json cancels the install instead of resetting the file.
		for (const write of context.writes) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: () => [
		'@svforge/graph installed!',
		'Usage:',
		"  import { KnowledgeGraph } from '$lib/components/svforge/graph';",
		'  <KnowledgeGraph nodes={nodes} links={links} />',
		'  nodes: { id: string, label?: string, group?: string }[]',
		'  links: { source: string, target: string }[]'
	]
});
