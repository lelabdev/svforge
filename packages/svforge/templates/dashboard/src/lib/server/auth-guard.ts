import type { Handle } from '@sveltejs/kit/hooks';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema.js';

/**
 * SVForge session guard (#547) — the ONE SVForge-owned request hook.
 *
 * Better Auth owns session creation, cookies and the request handler; it does
 * not reject a session whose user was disabled afterwards. SVForge composes
 * this handle AFTER the official one (see the scaffolded
 * `hooks.server.ts` sequence) so a disabled identity never reaches the app
 * through an old session.
 */
export const handleSvforgePolicy: Handle = async ({ event, resolve }) => {
	if (event.locals.user) {
		const [identity] = await db
			.select({ disabled: user.disabled })
			.from(user)
			.where(eq(user.id, event.locals.user.id))
			.limit(1);
		if (!identity || identity.disabled) {
			event.locals.user = undefined;
			event.locals.session = undefined;
		}
	}
	return resolve(event);
};
