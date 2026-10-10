import type { RequestHandler } from './$types';

/**
 * Favicon endpoint (#325) — `/favicon.ico` must resolve on every scaffold.
 *
 * prebuild embeds ONLY the templates' src and root directories, so the
 * historical templates/base/static/favicon.ico was never delivered and the
 * app.html reference (`%sveltekit.assets%/favicon.ico`) 404'd. Binary assets
 * cannot survive the string-based manifest, so the icon ships as an SVG
 * served by this route: prerendered, `/favicon.ico` becomes a static file in
 * the production build and answers 200 in dev and for crawlers that request
 * it directly.
 */
export const prerender = true;

// Brand primary hue from src/lib/styles/svelteforge-theme.css, precomputed to
// hex — a favicon cannot read CSS custom properties.
const BRAND = '#00abd4';

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${BRAND}"/><path d="M16 8.5 23.5 23h-15Z" fill="#fff"/></svg>`;

export const GET: RequestHandler = () =>
	new Response(FAVICON_SVG, {
		headers: {
			'content-type': 'image/svg+xml',
			'cache-control': 'public, max-age=86400'
		}
	});
