import { defineAddon, defineAddonOptions } from 'sv';
import { planAddonContext, planCatalogMerges } from '@svforge/addon-kit';
import { files } from './templates';



export default defineAddon({
	id: 'svforge-dnd',
	alias: 'forge-dnd',
	shortDescription: 'SVForge Drag & Drop — sortable lists',
	homepage: 'https://github.com/lelabdev/svforge',
	// Empty options required: sv >= 0.15 crashes on addons without an
	// options object (Object.entries(undefined) in promptAddonQuestions).
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge DnD requires SvelteKit');
	},

	run: ({ sv, cancel, cwd }) => {
		sv.dependency('@thisux/sveltednd', '^0.7.0');

		const context = planAddonContext(cwd, { moduleId: 'dnd', capability: 'drag & drop', pattern: 'src/lib/components/svforge/dnd/SortableList.svelte' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		// Showcase copy (#586): the demo route is localized, so both catalogs
		// receive its keys. Planned in memory first (#324): one invalid catalog
		// cancels the install and every file stays byte-for-byte identical.
		const catalogs = planCatalogMerges(cwd, [
			{
				path: 'messages/en.json',
				additions: {
					showcase_dnd_title: 'Drag & drop',
					showcase_dnd_description: 'Reorder a list with the installed SortableList component; the resulting order updates live.',
					showcase_dnd_hint: 'Drag an item — mouse, touch or keyboard — and drop it on another position.',
					showcase_dnd_order: 'Current order',
					showcase_dnd_reset: 'Reset order',
					showcase_dnd_fixture: 'Sample data only: the order lives in this page and is never persisted.',
					showcase_dnd_item_1: 'Draft the change',
					showcase_dnd_item_2: 'Review with the team',
					showcase_dnd_item_3: 'Run the checks',
					showcase_dnd_item_4: 'Ship it'
				}
			},
			{
				path: 'messages/fr.json',
				additions: {
					showcase_dnd_title: 'Glisser-déposer',
					showcase_dnd_description: 'Réordonnez une liste avec le composant SortableList installé ; l’ordre obtenu se met à jour en direct.',
					showcase_dnd_hint: 'Glissez un élément — souris, tactile ou clavier — puis déposez-le à une autre position.',
					showcase_dnd_order: 'Ordre actuel',
					showcase_dnd_reset: 'Réinitialiser l’ordre',
					showcase_dnd_fixture: 'Données d’exemple uniquement : l’ordre vit dans cette page et n’est jamais persisté.',
					showcase_dnd_item_1: 'Rédiger la modification',
					showcase_dnd_item_2: 'Relire avec l’équipe',
					showcase_dnd_item_3: 'Lancer les vérifications',
					showcase_dnd_item_4: 'Livrer'
				}
			}
		]);
		if (!catalogs.ok) {
			cancel(catalogs.error);
			return;
		}
		for (const write of catalogs.writes) {
			sv.file(write.path, () => write.content);
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
		'@svforge/dnd installed!',
		'Usage:',
		"  import SortableList from '#lib/components/svforge/dnd/SortableList.svelte';",
		'  <SortableList items={items} onReorder={(v) => items = v}>',
		'    {#snippet children(item)}<span>{item.title}</span>{/snippet}',
		'  </SortableList>'
	]
});
