import * as m from '#lib/paraglide/messages.js';

/**
 * Showcase metadata (#586): the index discovers installed demos through
 * `import.meta.glob('./*\/meta.ts')`. Copy functions keep it locale-aware.
 */
const meta = {
	order: 50,
	title: () => m.showcase_uploads_title(),
	description: () => m.showcase_uploads_description()
};

export default meta;
