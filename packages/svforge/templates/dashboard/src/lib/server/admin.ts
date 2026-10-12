import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * The persisted authorization role (#318).
 *
 * Admin status is an EXPLICIT column on the user row — never derived from row
 * ordering. The value is granted exclusively by `bootstrapFirstAdmin`
 * (first-admin.ts); every other creation path (admin UI, self-service or
 * invite-only sign-up) produces `role = 'user'`, the column default.
 */
export const ADMIN_ROLE = 'admin';

/**
 * Check if a user is an administrator (#318).
 *
 * The answer depends ONLY on the persisted role and the lifecycle flag: any
 * ordering (createdAt, insertion race, deletions of earlier users) yields the
 * same decision, server-side. The previous "oldest user is admin" pattern was
 * removed: on a fresh deployment it let an anonymous sign-up take over the
 * administrator role.
 */
export async function isAdmin(userId: string): Promise<boolean> {
	const [identity] = await db
		.select({ role: user.role, disabled: user.disabled })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return identity?.role === ADMIN_ROLE && !identity.disabled;
}
