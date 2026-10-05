import { describe, it, expect, beforeAll, vi } from 'vitest';
import type postgres from 'postgres';

// $app/env/private is a SvelteKit virtual module — not resolvable by the
// bare vitest environment. Read DATABASE_URL from the project .env (created
// by scripts/setup.sh before the CI runs `bun run test`).
vi.mock('$app/env/private', async () => {
	const { readFileSync } = await import('node:fs');
	const dotenv = readFileSync('.env', 'utf8');
	const m = dotenv.match(/^DATABASE_URL="?([^"\n]+)"?$/m);
	return { DATABASE_URL: m ? m[1].trim() : undefined };
});

// #401 — thin recorder: a Proxy over the real drizzle instance that snapshots
// every SELECT the service builds via toSQL() right before it executes. The
// tests then replay a captured query raw (db.$client.unsafe) to prove facts
// about the SQL itself (row volume, DISTINCT ON) that results alone cannot.
const recorded = vi.hoisted(() => [] as { sql: string; params: unknown[] }[]);

vi.mock('$lib/server/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/db')>();
	// Wraps a drizzle query builder: chained builders (objects returned by
	// .from()/.where()/…) get wrapped too; awaiting (`then`) snapshots the
	// fully built query first, then delegates to the real execution.
	const recordBuilder = (builder: object): object =>
		new Proxy(builder, {
			get(target, prop) {
				if (prop === 'then') {
					const query = (target as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
					recorded.push(query);
					return (target as { then: (...args: unknown[]) => unknown }).then.bind(target);
				}
				const value = Reflect.get(target, prop, target);
				if (typeof value === 'function') {
					return (...args: unknown[]) => {
						const result = (value as (...a: unknown[]) => unknown).apply(target, args);
						return result !== null && typeof result === 'object'
							? recordBuilder(result as object)
							: result;
					};
				}
				return value;
			}
		});
	return {
		...actual,
		db: new Proxy(actual.db, {
			get(target, prop) {
				if (prop === 'select') {
					return (...args: unknown[]) =>
						recordBuilder((target as { select: (...a: unknown[]) => object }).select(...args));
				}
				return Reflect.get(target, prop, target);
			}
		})
	};
});

import { chat } from './index';
import { db } from '$lib/server/db';
import { conversations } from './schema';

/**
 * Membership & per-user read state (#281) — runs inside the
 * dashboard-foundations scaffold against the REAL PostgreSQL database
 * (the CI profile performs a drizzle push before `bun run test`).
 *
 * Users are opaque ids (the chat schema does not FK to the user table):
 * A and B are participants, OUTSIDER is not.
 */
const A = crypto.randomUUID();
const B = crypto.randomUUID();
const OUTSIDER = crypto.randomUUID();

describe('chat membership & per-user read state (#281)', () => {
	beforeAll(async () => {
		// Clean slate — FK cascades wipe participants/messages/reads.
		await db.delete(conversations);
	});

	it('unread counts are per-user: reading as A never marks messages read for B', async () => {
		const conv = await chat.createConversation({ participantIds: [A, B], type: 'direct' });
		await chat.sendMessage({ conversationId: conv.id, authorId: A, content: 'hello from A' });
		await chat.sendMessage({ conversationId: conv.id, authorId: B, content: 'hello from B' });

		// Nobody has read anything yet.
		const before = await chat.listConversations(A);
		expect(before[0].unreadCount).toBe(2);

		// A marks the whole conversation as read.
		await chat.markRead(conv.id, A);

		const afterA = await chat.listConversations(A);
		expect(afterA[0].unreadCount).toBe(0);

		// B's counter is UNAFFECTED by A's reads (#281).
		const afterB = await chat.listConversations(B);
		expect(afterB[0].unreadCount).toBe(2);
	});

	it('an outsider cannot read or modify a conversation through ANY public method', async () => {
		const conv = await chat.createConversation({ participantIds: [A, B], type: 'direct' });
		await chat.sendMessage({ conversationId: conv.id, authorId: A, content: 'secret' });

		// listMessages: read → refused
		await expect(chat.listMessages(conv.id, OUTSIDER, { limit: 10 })).rejects.toThrow(/Forbidden/);

		// sendMessage: write → refused (identity is server-side, no spoof)
		await expect(
			chat.sendMessage({ conversationId: conv.id, authorId: OUTSIDER, content: 'intrusion' })
		).rejects.toThrow(/Forbidden/);

		// markRead: state mutation → refused
		await expect(chat.markRead(conv.id, OUTSIDER)).rejects.toThrow(/Forbidden/);

		// listConversations: the outsider does not see the conversation at all
		const theirs = await chat.listConversations(OUTSIDER);
		expect(theirs.find((c) => c.id === conv.id)).toBeUndefined();
	});

	it('the last-message helper is not exposed as an unguarded public method', () => {
		// The public API surface is exactly the documented methods; helpers
		// backing listConversations must NOT be reachable without membership.
		const api = Object.keys(chat).sort();
		expect(api).toEqual(['createConversation', 'listConversations', 'listMessages', 'markRead', 'sendMessage']);
		expect((chat as any).getLastMessage).toBeUndefined();
		expect((chat as any).unreadCount).toBeUndefined();
	});

	describe('#401 — bounded queries & pagination', () => {
		it('listConversations is bounded-query and paginated (#401)', async () => {
			// Clean slate — cascade wipes participants/messages/reads left by
			// the tests above.
			await db.delete(conversations);

			// Small delays guarantee distinct created_at (ms precision), so
			// "newest first" and "last message = 2nd" are deterministic.
			const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
			const expected: { id: string; last: string; unread: number }[] = [];
			for (let i = 0; i < 3; i++) {
				const conv = await chat.createConversation({ participantIds: [A, B], type: 'direct' });
				await chat.sendMessage({ conversationId: conv.id, authorId: A, content: `conv${i}-first` });
				await sleep(5);
				await chat.sendMessage({ conversationId: conv.id, authorId: A, content: `conv${i}-second` });
				await sleep(5);
				expected.push({ id: conv.id, last: `conv${i}-second`, unread: 2 });
			}

			// conv0 becomes a busy conversation: 6 messages total. The
			// last-message read must stay bounded by the CONVERSATION count,
			// never grow with the messages table (#401).
			const busy = expected[0].id;
			await chat.sendMessage({ conversationId: busy, authorId: A, content: 'conv0-extra1' });
			await sleep(5);
			await chat.sendMessage({ conversationId: busy, authorId: A, content: 'conv0-extra2' });
			await sleep(5);
			await chat.sendMessage({ conversationId: busy, authorId: A, content: 'conv0-extra3' });
			await sleep(5);
			await chat.sendMessage({ conversationId: busy, authorId: A, content: 'conv0-last' });
			expected[0].last = 'conv0-last';
			expected[0].unread = 6;

			// Capture the queries listConversations builds.
			recorded.length = 0;
			const list = await chat.listConversations(A);

			// Exactly the 3 conversations.
			expect(list).toHaveLength(3);

			// Ordered newest conversation first.
			expect(list.map((c) => c.id)).toEqual([...expected].reverse().map((c) => c.id));

			// Last message per conversation = the newest message (conv0 has
			// 6, the others 2); unread = message count (no read entry BY A
			// yet — authorship is not a read).
			for (const conv of list) {
				const exp = expected.find((e) => e.id === conv.id);
				expect(conv.lastMessage?.content).toBe(exp!.last);
				expect(conv.unreadCount).toBe(exp!.unread);
			}

			// The last-message read is a DISTINCT ON query (one id per
			// conversation_id), so replaying it raw returns exactly 3 rows —
			// the conversation count — even though conv0 holds 6 messages and
			// the table holds 10. The old implementation returned EVERY
			// message and deduplicated in JS: unbounded rows (#401).
			const lastQuery = recorded.find((q) => /distinct on/i.test(q.sql));
			expect(lastQuery).toBeDefined();
			// postgres.js `unsafe` expects ParameterOrJSON[] — the recorder stores
		// drizzle's toSQL() params as unknown[] (they are values like uuids and
		// counts here), so cast them at the replay call site.
		const rawRows = await db.$client.unsafe(
			lastQuery!.sql,
			lastQuery!.params as postgres.ParameterOrJSON<never>[]
		);
			expect(rawRows.length).toBe(3);
		});
	});
});
