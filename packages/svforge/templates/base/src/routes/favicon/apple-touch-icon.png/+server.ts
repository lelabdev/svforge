import type { RequestHandler } from './$types';
import { APPLE_TOUCH_ICON } from '#lib/assets/brand-favicons.js';

/**
 * `/favicon/apple-touch-icon.png` — canonical SVForge brand favicon (180×180, #613).
 *
 * Decoded from the embedded canonical binary (see packages/svforge/brand/),
 * so no second, independently maintained artwork exists.
 */
export const prerender = true;

const BRAND_ICON = Uint8Array.from(atob(APPLE_TOUCH_ICON), (char) => char.charCodeAt(0));

export const GET: RequestHandler = () =>
	new Response(BRAND_ICON, {
		headers: {
			'content-type': 'image/png',
			'cache-control': 'public, max-age=86400'
		}
	});
