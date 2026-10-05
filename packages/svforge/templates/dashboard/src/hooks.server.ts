import type { Handle } from '@sveltejs/kit/hooks';
// `building` is used to skip auth during prerender/build (SvelteKit builds pages statically).
import { building } from '$app/env';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { svelteKitHandler } from 'better-auth/svelte-kit';

/**
 * Single composed handle (#280).
 *
 * Order matters:
 * 1. `paraglideMiddleware` negotiates the locale and rewrites `event.request`
 *    (cookie / accept-language handling).
 * 2. Better Auth reads the session from the REWRITTEN request and populates
 *    `locals.session` / `locals.user`; auth paths are routed to the auth
 *    handler, every other request resolves through the app.
 * 3. The Paraglide transform rewrites the `%paraglide.lang%` /
 *    `%paraglide.dir%` placeholders of app.html in the FINAL html — this must
 *    survive the composition: the #268 fix (composing handleBetterAuth) had
 *    dropped it, leaving the placeholders in the rendered HTML (#280).
 */
export const handle: Handle = async ({ event, resolve }) =>
	paraglideMiddleware(event.request, async ({ request, locale }) => {
		const localizedEvent = { ...event, request };

		const session = await auth.api.getSession({ headers: localizedEvent.request.headers });
		if (session) {
			// A disabled identity may be retained for domain/audit references, but
			// it must never retain access through an old or newly-created session.
			const [currentUser] = await db
				.select({ disabled: user.disabled })
				.from(user)
				.where(eq(user.id, session.user.id))
				.limit(1);
			if (!currentUser?.disabled) {
				event.locals.session = session.session;
				event.locals.user = session.user;
			}
		}

		return svelteKitHandler({
			event: localizedEvent,
			auth,
			building,
			// svelteKitHandler calls resolve(event) with a single argument — the
			// Paraglide transform is applied here so the i18n placeholders of
			// app.html are rewritten in the final html.
			resolve: (event) =>
				resolve(event, {
					transformPageChunk: ({ html }) =>
						html
							.replace('%paraglide.lang%', locale)
							.replace('%paraglide.dir%', getTextDirection(locale))
				})
		});
	});
