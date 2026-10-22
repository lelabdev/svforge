import type { RequestHandler } from './$types';
import { FAVICON_16 } from '#lib/assets/brand-favicons.js';

/**
 * `/favicon/favicon-16x16.png` — canonical SVForge brand favicon (16×16, #613).
 *
 * Decoded from the embedded canonical binary (see packages/svforge/brand/),
 * so no second, independently maintained artwork exists.
 */
export const prerender = true;

const BRAND_ICON = Uint8Array.from(atob(FAVICON_16), (char) => char.charCodeAt(0));

export const GET: RequestHandler = () =>
	new Response(BRAND_ICON, {
		headers: {
			'content-type': 'image/png',
			'cache-control': 'public, max-age=86400'
		}
	});
