import { defineAddon, defineAddonOptions } from 'sv';
import { checkModuleCapabilities, planCatalogMerges, planAddonContext } from '@svforge/addon-kit';
import { files } from './templates';



export default defineAddon({
	id: 'svforge-tiptap',
	alias: 'forge-tiptap',
	shortDescription: 'SVForge Tiptap — rich text editor',
	homepage: 'https://github.com/lelabdev/svforge',
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
					tiptap_edit_link: 'Modifier le lien',
					tiptap_link_description: 'Saisissez ou modifiez l’URL associée au texte sélectionné.',
					tiptap_link_invalid_url: 'Saisissez une URL ou un lien relatif valide.',
					tiptap_link_url: 'URL du lien',
					tiptap_link_apply: 'Appliquer le lien',
					tiptap_link_update: 'Mettre à jour le lien',
					tiptap_link_remove: 'Supprimer le lien',
					tiptap_link_cancel: 'Annuler',
					tiptap_toolbar: 'Barre de mise en forme',
					tiptap_toolbar_formatting: 'Mise en forme du texte',
					tiptap_toolbar_headings: 'Titres',
					tiptap_toolbar_lists: 'Listes',
					tiptap_toolbar_blocks: 'Blocs',
					showcase_tiptap_title: 'Texte enrichi',
					showcase_tiptap_description: 'Éditez un document local avec la barre de mise en forme installée et voyez le rendu assaini en dessous.',
					showcase_tiptap_hint: 'Sélectionnez du texte puis utilisez la barre : gras, titres, listes, citation et liens sont de vrais contrôles Tiptap.',
					showcase_tiptap_editor: 'Éditeur',
					showcase_tiptap_preview: 'Aperçu rendu',
					showcase_tiptap_reset: 'Réinitialiser l’exemple',
					showcase_tiptap_fixture: 'Contenu d’exemple local — rien n’est enregistré.',
					showcase_tiptap_sample_heading: 'Brief du projet',
					showcase_tiptap_sample_body: 'Modifiez ce texte avec la barre ci-dessus :',
					showcase_tiptap_sample_bold: 'l’aperçu ci-dessous rend le même document',
					showcase_tiptap_sample_tail: ', sans back-end.',
					showcase_tiptap_sample_item_1: 'Rédiger le plan',
					showcase_tiptap_sample_item_2: 'Relire avec l’équipe',
					showcase_tiptap_sample_quote: 'L’aperçu est assaini : seuls les nœuds et les liens autorisés sont conservés.',
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
					tiptap_edit_link: 'Edit link',
					tiptap_link_description: 'Set or update the destination URL for the selected text.',
					tiptap_link_invalid_url: 'Enter a valid URL or relative link.',
					tiptap_link_url: 'Link URL',
					tiptap_link_apply: 'Apply link',
					tiptap_link_update: 'Update link',
					tiptap_link_remove: 'Remove link',
					tiptap_link_cancel: 'Cancel',
					tiptap_toolbar: 'Text formatting toolbar',
					tiptap_toolbar_formatting: 'Inline formatting',
					tiptap_toolbar_headings: 'Headings',
					tiptap_toolbar_lists: 'Lists',
					tiptap_toolbar_blocks: 'Blocks',
					showcase_tiptap_title: 'Rich text',
					showcase_tiptap_description: 'Edit a local document with the installed formatting toolbar and see the sanitized render below.',
					showcase_tiptap_hint: 'Select text and use the toolbar: bold, headings, lists, blockquote and links are real Tiptap controls.',
					showcase_tiptap_editor: 'Editor',
					showcase_tiptap_preview: 'Rendered preview',
					showcase_tiptap_reset: 'Reset example',
					showcase_tiptap_fixture: 'Local example content — nothing is saved.',
					showcase_tiptap_sample_heading: 'Project brief',
					showcase_tiptap_sample_body: 'Edit this text with the toolbar above:',
					showcase_tiptap_sample_bold: 'the preview below renders the same document',
					showcase_tiptap_sample_tail: ', with no backend.',
					showcase_tiptap_sample_item_1: 'Write the outline',
					showcase_tiptap_sample_item_2: 'Review with the team',
					showcase_tiptap_sample_quote: 'The preview is sanitized: only allowed nodes and links survive.',
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
		"  import { TiptapEditor, TiptapPreview } from '#lib/components/svforge/tiptap/index.js';",
		'  <TiptapEditor content={content} onUpdate={(json) => content = json} />',
		'  <TiptapPreview content={content} />'
	]
});
