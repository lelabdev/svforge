import { json, error } from '@sveltejs/kit';
import { notificationsApi } from '#lib/server/notifications/index.js';
import type { RequestHandler } from './$types';

/** Mark all notifications of the current user as read. */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, { message: 'Authentication required' });
	await notificationsApi.markAllAsRead(locals.user.id);
	return json({ ok: true });
};
