import * as m from '#lib/paraglide/messages.js';

/**
 * Showcase metadata (#586): the index discovers installed demos through
 * `import.meta.glob('./*\/meta.ts')`, so a module only ships this file next to
 * its demo route. Copy functions keep it locale-aware.
 */
const meta = {
	order: 20,
	title: () => m.showcase_toast_title(),
	description: () => m.showcase_toast_description()
};

export default meta;
