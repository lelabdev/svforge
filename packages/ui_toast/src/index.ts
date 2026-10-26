import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planAddonContext, planCatalogMerges } from '@svforge/addon-kit';
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
		// Showcase copy (#586): the demo route is localized, so both catalogs get
		// its keys. Planned in memory first (#324): one invalid catalog cancels
		// the install and every file stays byte-for-byte identical.
		const catalogs = planCatalogMerges(cwd, [
			{
				path: 'messages/en.json',
				additions: {
					showcase_toast_title: 'Toasts',
					showcase_toast_description: 'Trigger the installed Toast component and watch how each variant behaves.',
					showcase_toast_hint: 'Every button fires the module’s real toaster store. Toasts close themselves or via their close control.',
					showcase_toast_success: 'Success',
					showcase_toast_error: 'Error',
					showcase_toast_info: 'Information',
					showcase_toast_warning: 'Warning',
					showcase_toast_body: 'Triggered from this page — nothing is sent or persisted.',
					showcase_toast_mount_note: 'This page mounts its own Toaster. In your app, mount it once in'
				}
			},
			{
				path: 'messages/fr.json',
				additions: {
					showcase_toast_title: 'Notifications toast',
					showcase_toast_description: 'Déclenchez le composant Toast installé et observez le comportement de chaque variante.',
					showcase_toast_hint: 'Chaque bouton appelle le vrai store de toasts du module. Les toasts se ferment seuls ou via leur bouton de fermeture.',
					showcase_toast_success: 'Succès',
					showcase_toast_error: 'Erreur',
					showcase_toast_info: 'Information',
					showcase_toast_warning: 'Avertissement',
					showcase_toast_body: 'Déclenché depuis cette page — rien n’est envoyé ni persisté.',
					showcase_toast_mount_note: 'Cette page monte son propre Toaster. Dans votre application, montez-le une fois dans'
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
		'@svforge/ui_toast installed!',
		'Import Toaster in your root layout:',
		"  import { Toaster } from '#lib/components/svforge/ui/Toaster.svelte';",
		'  <Toaster />',
		'Trigger toasts from anywhere:',
		"  import { toaster } from '#lib/components/svforge/ui/toaster.js';",
		'  toaster.success({ title: "Done!" });'
	]
});
