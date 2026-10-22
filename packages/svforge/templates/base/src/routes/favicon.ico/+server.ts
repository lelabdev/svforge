import type { RequestHandler } from './$types';
import { FAVICON_ICO } from '#lib/assets/brand-favicons.js';

/**
 * `/favicon.ico` — the canonical SVForge brand icon (#613).
 *
 * The canonical binary lives in `packages/svforge/brand/favicon.ico`; prebuild
 * embeds it as base64 because the template manifest is text-only. Decoding
 * here keeps ONE source of artwork instead of a second hand-written SVG.
 *
 * `prerender` makes the production build emit a real static `.ico`, while dev
 * answers direct requests (crawlers, legacy consumers) with the same bytes.
 */
export const prerender = true;

const BRAND_ICON = Uint8Array.from(atob(FAVICON_ICO), (char) => char.charCodeAt(0));

export const GET: RequestHandler = () =>
	new Response(BRAND_ICON, {
		headers: {
			'content-type': 'image/x-icon',
			'cache-control': 'public, max-age=86400'
		}
	});
