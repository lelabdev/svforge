import { db } from '#lib/server/db/index.js';
import { auditLogs } from './schema';
import { desc, eq, and } from 'drizzle-orm';

/**
 * SvelteForge audit trail (#232) — append-only business action logging.
 *
 *   await audit.record({
 *     actorId: user.id,
 *     action: 'punch.corrected',
 *     entityType: 'punch',
 *     entityId: punch.id,
 *     metadata: { before: { time: oldTime }, after: { time: newTime }, reason }
 *   });
 *
 * Reads:
 *   await audit.forEntity('punch', punchId);
 *   await audit.byActor(userId, { limit: 50 });
 */

export interface AuditEntryInput {
	actorId?: string | null;
	action: string;
	entityType: string;
	entityId?: string | null;
	metadata?: Record<string, unknown>;
	ipAddress?: string | null;
	userAgent?: string | null;
}

export interface AuditListOptions {
	limit?: number;
	offset?: number;
}

export interface AuditFilters extends AuditListOptions {
	action?: string;
	entityType?: string;
}

export const audit = {
	/** Append an audit entry. Never updates/deletes existing rows. */
	async record(input: AuditEntryInput): Promise<typeof auditLogs.$inferSelect> {
		const [row] = await db
			.insert(auditLogs)
			.values({
				actorId: input.actorId ?? null,
				action: input.action,
				entityType: input.entityType,
				entityId: input.entityId ?? null,
				metadata: input.metadata ?? {},
				ipAddress: input.ipAddress ?? null,
				userAgent: input.userAgent ?? null,
				createdAt: new Date()
			})
			.returning();
		return row;
	},

	/** Full history for one entity (newest first). */
	async forEntity(entityType: string, entityId: string, opts: AuditListOptions = {}): Promise<typeof auditLogs.$inferSelect[]> {
		return db
			.select()
			.from(auditLogs)
			.where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
			.orderBy(desc(auditLogs.createdAt))
			.limit(opts.limit ?? 50)
			.offset(opts.offset ?? 0);
	},

	/** Actions by one actor (newest first). */
	async byActor(actorId: string, opts: AuditListOptions = {}): Promise<typeof auditLogs.$inferSelect[]> {
		return db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.actorId, actorId))
			.orderBy(desc(auditLogs.createdAt))
			.limit(opts.limit ?? 50)
			.offset(opts.offset ?? 0);
	},

	/** Recent actions with optional filters (admin view). */
	async list(filters: AuditFilters = {}): Promise<typeof auditLogs.$inferSelect[]> {
		const conditions = [];
		if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
		if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
		const where = conditions.length ? and(...conditions) : undefined;
		const q = db.select().from(auditLogs);
		if (where) q.where(where);
		return q.orderBy(desc(auditLogs.createdAt)).limit(filters.limit ?? 50).offset(filters.offset ?? 0);
	}
};
