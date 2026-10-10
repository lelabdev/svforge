import { defineAddon, defineAddonOptions } from 'sv';
import { planAddonContext } from '@svforge/addon-kit';
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
		"  import SortableList from '$lib/components/svforge/dnd/SortableList.svelte';",
		'  <SortableList items={items} onReorder={(v) => items = v}>',
		'    {#snippet children(item)}<span>{item.title}</span>{/snippet}',
		'  </SortableList>'
	]
});
