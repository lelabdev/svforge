import type { RequestHandler } from './$types';
import { ANDROID_CHROME_512 } from '#lib/assets/brand-favicons.js';

/**
 * `/favicon/android-chrome-512x512.png` — canonical SVForge brand icon (512×512, #613).
 *
 * Decoded from the embedded canonical binary (see packages/svforge/brand/),
 * so no second, independently maintained artwork exists.
 */
export const prerender = true;

const BRAND_ICON = Uint8Array.from(atob(ANDROID_CHROME_512), (char) => char.charCodeAt(0));

export const GET: RequestHandler = () =>
	new Response(BRAND_ICON, {
		headers: {
			'content-type': 'image/png',
			'cache-control': 'public, max-age=86400'
		}
	});
