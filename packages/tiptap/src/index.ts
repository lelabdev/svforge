import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planCatalogMerges, planAddonContext } from '@svforge/addon-kit';
import { files } from './templates';



export default defineAddon({
	id: 'svforge-tiptap',
	alias: 'forge-tiptap',
	shortDescription: 'SVForge Tiptap — rich text editor',
	homepage: 'https://github.com/lelabdev/svelteforge',
	// Empty options required: sv >= 0.15 crashes on addons without an
	// options object (Object.entries(undefined) in promptAddonQuestions).
	options: defineAddonOptions().build(),

	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('SVForge Tiptap requires SvelteKit');
	},

	run: ({ sv, cancel, cwd }) => {
		// Capability gate (#323): the toolbar imports Paraglide messages and
		// renders Skeleton-styled controls — both contracts must be present.
		const gate = checkModuleCapabilities(cwd, 'tiptap');
		if (!gate.ok) {
			cancel(gate.message);
			return;
		}

		sv.dependency('@tiptap/core', '^3.30.1');
		sv.dependency('@tiptap/starter-kit', '^3.30.1');
		sv.dependency('@tiptap/extension-underline', '^3.30.1');
		sv.dependency('@tiptap/extension-link', '^3.30.1');

		const catalogs = planCatalogMerges(cwd, [
			{
				path: 'messages/fr.json',
				additions: {
					tiptap_bold: 'Gras',
					tiptap_italic: 'Italique',
					tiptap_underline: 'Souligné',
					tiptap_strikethrough: 'Barré',
					tiptap_blockquote: 'Citation',
					tiptap_code_block: 'Bloc de code',
					tiptap_bullet_list: 'Liste à puces',
					tiptap_ordered_list: 'Liste numérotée',
					tiptap_heading: 'Titre {level}',
					tiptap_link: 'Lien',
					tiptap_insert_link: 'Insérer un lien',
					tiptap_link_prompt: "Saisissez l'URL du lien :",
					tiptap_toolbar: 'Barre de mise en forme',
					tiptap_toolbar_formatting: 'Mise en forme du texte',
					tiptap_toolbar_headings: 'Titres',
					tiptap_toolbar_lists: 'Listes',
					tiptap_toolbar_blocks: 'Blocs',
					tiptap_loading: 'Chargement…'
				}
			},
			{
				path: 'messages/en.json',
				additions: {
					tiptap_bold: 'Bold',
					tiptap_italic: 'Italic',
					tiptap_underline: 'Underline',
					tiptap_strikethrough: 'Strikethrough',
					tiptap_blockquote: 'Blockquote',
					tiptap_code_block: 'Code block',
					tiptap_bullet_list: 'Bullet list',
					tiptap_ordered_list: 'Ordered list',
					tiptap_heading: 'Heading {level}',
					tiptap_link: 'Link',
					tiptap_insert_link: 'Insert link',
					tiptap_link_prompt: 'Enter the link URL:',
					tiptap_toolbar: 'Text formatting toolbar',
					tiptap_toolbar_formatting: 'Inline formatting',
					tiptap_toolbar_headings: 'Headings',
					tiptap_toolbar_lists: 'Lists',
					tiptap_toolbar_blocks: 'Blocks',
					tiptap_loading: 'Loading…'
				}
			}
		]);
		if (!catalogs.ok) {
			cancel(catalogs.error);
			return;
		}
		const context = planAddonContext(cwd, { moduleId: 'tiptap', capability: 'rich text (Tiptap)', pattern: 'src/lib/components/svforge/tiptap/' });
		if (!context.ok) {
			cancel(context.error);
			return;
		}
		for (const [path, content] of Object.entries(files)) {
			sv.file(`src${path}`, () => content);
		}

		// Paraglide messages (#239) + manifest (#234): PLANNED in memory before
		// any write (#324) — one invalid catalog or manifest cancels the whole
		// install and every file stays byte-for-byte identical.

		for (const write of [...catalogs.writes, ...context.writes]) {
			sv.file(write.path, () => write.content);
		}
	},

	nextSteps: () => [
		'@svforge/tiptap installed!',
		'Usage:',
		"  import { TiptapEditor, TiptapPreview } from '$lib/components/svforge/tiptap';",
		'  <TiptapEditor content={content} onUpdate={(json) => content = json} />',
		'  <TiptapPreview content={content} />'
	]
});
