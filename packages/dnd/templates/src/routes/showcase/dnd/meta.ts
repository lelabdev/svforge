import * as m from '#lib/paraglide/messages.js';

/**
 * Showcase metadata (#586): the index in `/showcase/+page.svelte` discovers
 * installed demos through `import.meta.glob('./*\/meta.ts')`, so a module only
 * has to ship this file next to its demo route. Copy functions (not strings) so
 * the copy follows the active locale.
 */
const meta = {
	order: 10,
	title: () => m.showcase_dnd_title(),
	description: () => m.showcase_dnd_description()
};

export default meta;
