import { db } from '#lib/server/db/index.js';
import { notifications } from './schema';
import { desc, eq, and, isNull } from 'drizzle-orm';

/**
 * SvelteForge notifications (#230) — persistent business notifications.
 *
 *   await notifications.create({
 *     userId,
 *     type: 'export.ready',
 *     title: 'Export terminé',
 *     message: 'Votre export est prêt.',
 *     actionUrl: `/exports/${exportId}`
 *   });
 *   await notifications.markAsRead(id, userId);
 *   await notifications.markAllAsRead(userId);
 *
 * The DB is the source of truth. If @svforge/realtime is installed, publish
 * `notification.created` on `user:{userId}` after persist (optional).
 */

export interface NotificationInput {
	userId: string;
	type: string;
	title: string;
	message: string;
	actionUrl?: string;
	metadata?: Record<string, unknown>;
}

export interface NotificationListOptions {
	limit?: number;
	offset?: number;
	onlyUnread?: boolean;
}

export const notificationsApi = {
	/** Create a notification for a user. */
	async create(input: NotificationInput) {
		const [row] = await db
			.insert(notifications)
			.values({
				userId: input.userId,
				type: input.type,
				title: input.title,
				message: input.message,
				actionUrl: input.actionUrl ?? null,
				metadata: input.metadata ?? {},
				readAt: null,
				createdAt: new Date()
			})
			.returning();
		return row;
	},

	/** Recent notifications for a user (newest first). */
	async list(userId: string, opts: NotificationListOptions = {}) {
		const conditions = [eq(notifications.userId, userId)];
		if (opts.onlyUnread) conditions.push(isNull(notifications.readAt));
		return db
			.select()
			.from(notifications)
			.where(and(...conditions))
			.orderBy(desc(notifications.createdAt))
			.limit(opts.limit ?? 20)
			.offset(opts.offset ?? 0);
	},

	/** Count of unread notifications for a user. */
	async unreadCount(userId: string): Promise<number> {
		const rows = await db
			.select({ id: notifications.id })
			.from(notifications)
			.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
		return rows.length;
	},

	/** Mark one notification as read (ownership-checked). */
	async markAsRead(notificationId: string, userId: string) {
		await db
			.update(notifications)
			.set({ readAt: new Date() })
			.where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
	},

	/** Mark all notifications of a user as read. */
	async markAllAsRead(userId: string) {
		await db
			.update(notifications)
			.set({ readAt: new Date() })
			.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
	}
};
