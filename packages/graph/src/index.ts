import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planAddonContext, planCatalogMerges } from '@svforge/addon-kit';
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
		// base kit (#lib/utils) — the project must provide the ui.svforge kit.
		const gate = checkModuleCapabilities(cwd, 'graph');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}

		sv.dependency('force-graph', '^1.51.4');

		// Showcase copy (#586): the demo route is localized, so both catalogs get
		// its keys. Planned in memory first (#324): one invalid catalog cancels
		// the install and every file stays byte-for-byte identical.
		const catalogs = planCatalogMerges(cwd, [
			{
				path: 'messages/en.json',
				additions: {
					showcase_graph_title: 'Knowledge graph',
					showcase_graph_description: 'Explore a small local graph with the installed KnowledgeGraph component.',
					showcase_graph_hint: 'Click a node — or use the node buttons below — to inspect it. Drag to pan, scroll to zoom.',
					showcase_graph_selection: 'Selected node',
					showcase_graph_connections: '{count} connections',
					showcase_graph_clear: 'Clear selection',
					showcase_graph_no_selection: 'No node selected yet.',
					showcase_graph_nodes: 'Graph nodes',
					showcase_graph_node_home: 'Home',
					showcase_graph_node_showcase: 'Showcase',
					showcase_graph_node_modules: 'Modules',
					showcase_graph_node_auth: 'Auth',
					showcase_graph_node_db: 'Database',
					showcase_graph_fixture: 'Local fixture only — the graph data lives in this page and is never fetched.'
				}
			},
			{
				path: 'messages/fr.json',
				additions: {
					showcase_graph_title: 'Graphe de connaissances',
					showcase_graph_description: 'Explorez un petit graphe local avec le composant KnowledgeGraph installé.',
					showcase_graph_hint: 'Cliquez sur un nœud — ou utilisez les boutons ci-dessous — pour l’inspecter. Glissez pour déplacer, faites défiler pour zoomer.',
					showcase_graph_selection: 'Nœud sélectionné',
					showcase_graph_connections: '{count} connexions',
					showcase_graph_clear: 'Effacer la sélection',
					showcase_graph_no_selection: 'Aucun nœud sélectionné pour l’instant.',
					showcase_graph_nodes: 'Nœuds du graphe',
					showcase_graph_node_home: 'Accueil',
					showcase_graph_node_showcase: 'Vitrine',
					showcase_graph_node_modules: 'Modules',
					showcase_graph_node_auth: 'Authentification',
					showcase_graph_node_db: 'Base de données',
					showcase_graph_fixture: 'Données locales uniquement — le graphe vit dans cette page et n’est jamais chargé à distance.'
				}
			}
		]);
		if (!catalogs.ok) {
			cancel(catalogs.error);
			return;
		}

		const context = planAddonContext(cwd, { moduleId: 'graph', capability: 'knowledge graph', pattern: 'src/lib/components/svforge/graph/KnowledgeGraph.svelte' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// AI context (#234) + catalogs: PLANNED in memory before any write
		// (#324) — one invalid catalog or manifest cancels the whole install and
		// every file stays byte-for-byte identical.
		for (const write of [...catalogs.writes, ...context.writes]) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: () => [
		'@svforge/graph installed!',
		'Usage:',
		"  import { KnowledgeGraph } from '#lib/components/svforge/graph/index.js';",
		'  <KnowledgeGraph nodes={nodes} links={links} />',
		'  nodes: { id: string, label?: string, group?: string }[]',
		'  links: { source: string, target: string }[]'
	]
});
