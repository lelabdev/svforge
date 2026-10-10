import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planAddonContext } from '@svforge/addon-kit';
import { files } from './templates';



export default defineAddon({
	id: 'svforge-ui-toast',
	alias: 'forge-toast',
	shortDescription: 'SVForge Toast — notification toasts',
	homepage: 'https://github.com/lelabdev/svforge',
	// Empty options required: sv >= 0.15 crashes on addons without an
	// options object (Object.entries(undefined) in promptAddonQuestions).
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Toast requires SvelteKit');
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): the Skeleton Svelte Toaster needs the theme
		// wiring — on a bare SvelteKit project it would render unstyled.
		const gate = checkModuleCapabilities(cwd, 'ui_toast');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}

		// Toaster/toaster.ts import @skeletonlabs/skeleton-svelte — must be a
		// real dependency (peerDependencies installs nothing in the copy-sources
		// model) (#190).
		sv.dependency('@skeletonlabs/skeleton-svelte', '^5.0.0');

		const context = planAddonContext(cwd, { moduleId: 'ui_toast', capability: 'toasts (Skeleton Toast)', pattern: 'src/lib/components/svforge/ui/Toaster.svelte' });
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
		'@svforge/ui_toast installed!',
		'Import Toaster in your root layout:',
		"  import { Toaster } from '$lib/components/svforge/ui/Toaster.svelte';",
		'  <Toaster />',
		'Trigger toasts from anywhere:',
		"  import { toaster } from '$lib/components/svforge/ui/toaster';",
		'  toaster.success({ title: "Done!" });'
	]
});
