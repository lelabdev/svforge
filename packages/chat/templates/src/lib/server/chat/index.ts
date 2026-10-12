import { db } from '#lib/server/db/index.js';
import {
	conversations,
	conversationParticipants,
	messages,
	messageReads
} from './schema';
import { desc, eq, and, inArray, sql } from 'drizzle-orm';

/**
 * SvelteForge chat (#233) — composable app chat.
 *
 * Membership is the security rule (#281): every PUBLIC read/write method
 * verifies server-side that the caller is a participant. listConversations
 * is membership-isolated by construction (#401): every query is scoped to
 * conversations the caller participates in (IN over the user's own ids), so
 * an outsider cannot read anything through the service.
 *
 * #401: listConversations runs a BOUNDED number of queries (3 max) instead
 * of per-conversation N+1 lookups.
 *
 * Works without realtime (classic refetch). If @svforge/realtime is installed,
 * publish `message.created` on `conversation:{id}` after persist (optional).
 */

// ── private helpers (NOT part of the public API) ───────────────────────────

/** Server-side membership check — throws if the user cannot access. */
async function assertMember(conversationId: string, userId: string): Promise<void> {
	const rows = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.userId, userId)
			)
		);
	if (rows.length === 0) {
		throw new Error('Forbidden: you are not a participant of this conversation');
	}
}

// ── public API ──────────────────────────────────────────────────────────────

export const chat = {
	/** Create a conversation with participants (creator included). */
	async createConversation(input: { participantIds: string[]; type?: 'direct' | 'group' }) {
		const ids = [...new Set([...input.participantIds])];
		if (ids.length < 2) throw new Error('A conversation needs at least 2 participants');
		return db.transaction(async (tx) => {
			const [conv] = await tx
				.insert(conversations)
				.values({ type: input.type ?? 'direct', createdAt: new Date() })
				.returning();
			for (const userId of ids) {
				await tx.insert(conversationParticipants).values({
					conversationId: conv.id,
					userId,
					joinedAt: new Date()
				});
			}
			return conv;
		});
	},

	/** Conversations of a user, with last message + per-user unread count. */
	async listConversations(userId: string) {
		// #401 — bounded number of queries (3 max), membership-isolated by
		// construction: every query is scoped to conversations the user
		// participates in, so per-row assertMember calls are unnecessary.

		// 1) The user's conversations (newest first, conservative page size).
		const rows = await db
			.select({
				id: conversations.id,
				type: conversations.type,
				createdAt: conversations.createdAt
			})
			.from(conversationParticipants)
			.innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
			.where(eq(conversationParticipants.userId, userId))
			.orderBy(desc(conversations.createdAt))
			.limit(50);
		if (rows.length === 0) return [];
		const convIds = rows.map((r) => r.id);

		// 2) Last message per conversation — ONE query whose row volume is
		// bounded by the conversation count (≤ page size), never by the size of
		// the messages table: a DISTINCT ON subquery selects exactly one id per
		// conversation_id (the newest by created_at) and the outer IN reads only
		// those rows. No full-message dump, no filtering kept in JS.
		const lastRows = await db
			.select()
			.from(messages)
			.where(
				sql`${messages.id} in (
					select distinct on (${messages.conversationId}) ${messages.id}
					from ${messages}
					where ${inArray(messages.conversationId, convIds)}
					order by ${messages.conversationId}, ${messages.createdAt} desc
				)`
			);
		// The subquery guarantees at most one row per conversation.
		const lastByConv = new Map(lastRows.map((row) => [row.conversationId, row]));

		// 3) Unread counts in ONE query. Per-user read state (#281) is kept
		// exact: the left join matches only THIS user's read entries, so a
		// message with no read entry BY THAT USER counts as unread via
		// COUNT(*) FILTER. Conversations with no messages produce no group
		// and default to 0 below.
		const unreadRows = await db
			.select({
				conversationId: messages.conversationId,
				unread: sql<number>`count(*) filter (where ${messageReads.messageId} is null)`
			})
			.from(messages)
			.leftJoin(
				messageReads,
				and(eq(messageReads.messageId, messages.id), eq(messageReads.userId, userId))
			)
			.where(inArray(messages.conversationId, convIds))
			.groupBy(messages.conversationId);
		// PostgreSQL returns count(...) as a string — coerce to number.
		const unreadByConv = new Map(unreadRows.map((r) => [r.conversationId, Number(r.unread)]));

		return rows.map((row) => ({
			...row,
			lastMessage: lastByConv.get(row.id) ?? null,
			unreadCount: unreadByConv.get(row.id) ?? 0
		}));
	},

	/** Paginated messages of a conversation (membership-checked). */
	async listMessages(
		conversationId: string,
		userId: string,
		opts: { limit?: number; offset?: number } = {}
	) {
		await assertMember(conversationId, userId);
		return db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(desc(messages.createdAt))
			.limit(opts.limit ?? 50)
			.offset(opts.offset ?? 0);
	},

	/** Send a message as the current author (server-side identity, no spoof). */
	async sendMessage(input: { conversationId: string; authorId: string; content: string }) {
		if (!input.content?.trim()) throw new Error('Message content is required');
		await assertMember(input.conversationId, input.authorId);
		const [row] = await db
			.insert(messages)
			.values({
				conversationId: input.conversationId,
				authorId: input.authorId,
				content: input.content.trim(),
				createdAt: new Date()
			})
			.returning();
		return row;
	},

	/** Mark messages of a conversation as read for a user. */
	async markRead(conversationId: string, userId: string) {
		await assertMember(conversationId, userId);
		const msgs = await db
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.conversationId, conversationId));
		for (const m of msgs) {
			await db
				.insert(messageReads)
				.values({ messageId: m.id, userId, readAt: new Date() })
				.onConflictDoNothing();
		}
	}
};
