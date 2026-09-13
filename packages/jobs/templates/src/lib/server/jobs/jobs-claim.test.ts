import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// #312 — integration suites NEVER read the application .env: the database
// comes exclusively from TEST_DATABASE_URL (a dedicated test database,
// enforced by resolveTestDbUrl). Without it the suite skips cleanly.
const hasDb = !!process.env.TEST_DATABASE_URL;
const d = hasDb ? describe : describe.skip;

vi.mock('$env/dynamic/private', async () => {
	const { resolveTestDbUrl } = await import('../test-db');
	return {
		env: {
			DATABASE_URL: resolveTestDbUrl(),
			ORIGIN: 'http://localhost:5173',
			BETTER_AUTH_SECRET: 'sforge-integration-secret-0123456789abcdef'
		}
	};
});

import { db } from '$lib/server/db';
import { jobs } from './schema';
import { jobsApi, define, NonRetryableJobError } from './index';
import { startJobRunner, stopJobRunner, runnerState } from './runner';
import { eq, like } from 'drizzle-orm';

/**
 * #328 — real-PostgreSQL behavioral contract of the jobs foundation:
 * atomic claims (FOR UPDATE SKIP LOCKED), lease expiry recovery, heartbeat,
 * idempotent replay, backoff, non-retryable errors and a graceful worker
 * shutdown. Runs in the dashboard-foundations profile (CI provides PostgreSQL);
 * skips cleanly when no database is configured.
 */

// Run-scoped type prefix (#312): two concurrent runs on the same dedicated
// test database never claim or delete each other's rows.
const TEST_PREFIX = `claimtest-${crypto.randomUUID().slice(0, 8)}-`;

d('jobs claim contract (#328, real PostgreSQL)', () => {
	const executed: Record<string, number> = {};

	const count = (id: string) => (executed[id] ?? 0);
	const record = (id: string) => {
		executed[id] = (executed[id] ?? 0) + 1;
	};

	beforeAll(async () => {
		await db.delete(jobs).where(like(jobs.type, `${TEST_PREFIX}%`));
	});

	afterAll(async () => {
		await db.delete(jobs).where(like(jobs.type, `${TEST_PREFIX}%`));
	});

	it('two concurrent workers never claim the same job', async () => {
		define(`${TEST_PREFIX}race`, async (payload) => {
			record(String((payload as { i: number }).i));
			return { ok: true };
		});
		for (let i = 0; i < 4; i++) await jobsApi.enqueue(`${TEST_PREFIX}race`, { i });
		// Two workers claim and run batches concurrently. The claim runs inside
		// a transaction holding FOR UPDATE SKIP LOCKED row locks, so overlapping
		// batches must split the queue — never share a job.
		const [a, b] = await Promise.all([jobsApi.processNextBatch(2), jobsApi.processNextBatch(2)]);
		expect(a + b).toBe(4);
		// 4 distinct payloads, each executed exactly once across both workers
		expect(Object.keys(executed).sort()).toEqual(['0', '1', '2', '3']);
		for (const n of Object.values(executed)) expect(n).toBe(1);
		const rows = await db.select().from(jobs).where(eq(jobs.type, `${TEST_PREFIX}race`));
		for (const row of rows) expect(row.status).toBe('completed');
	});

	it('an expired lease makes a claimed job claimable again (crash recovery) and the idempotent handler is replayed', async () => {
		await jobsApi.enqueue(`${TEST_PREFIX}lease`, { n: 1 });
		let runs = 0;
		define(`${TEST_PREFIX}lease`, async (_payload, ctx) => {
			runs += 1;
			await ctx.progress(10);
			if (runs === 1) await new Promise((r) => setTimeout(r, 200)); // first "worker" dies mid-flight
			return { ok: runs };
		});
		const first = jobsApi.processNextBatch(1, 50); // 50ms lease, dies at +200ms
		// Wait for the first claim to actually hold the lease, then expire it
		// IN THE DATABASE — racing real timers (sleep 120 vs a progress()
		// renewal at t+50..70) was flaky under load (#426 CI).
		await vi.waitFor(async () => {
			const [claimed] = await db.select().from(jobs).where(eq(jobs.type, `${TEST_PREFIX}lease`));
			expect(claimed?.status).toBe('running');
		});
		await db
			.update(jobs)
			.set({ leaseUntil: new Date(Date.now() - 1000) })
			.where(eq(jobs.type, `${TEST_PREFIX}lease`));
		const second = jobsApi.processNextBatch(1, 50); // second worker reclaims the expired lease
		await Promise.all([first, second]);
		expect(runs).toBe(2); // at-least-once: replayed after crash
		const [row] = await db.select().from(jobs).where(eq(jobs.type, `${TEST_PREFIX}lease`));
		expect(row.status).toBe('completed');
		expect(row.attempts).toBe(2);
	}, 15000);

	it('a live heartbeat keeps the lease alive — no duplicate execution', async () => {
		await jobsApi.enqueue(`${TEST_PREFIX}heartbeat`, { n: 1 });
		let runs = 0;
		define(`${TEST_PREFIX}heartbeat`, async (_payload, ctx) => {
			runs += 1;
			// long work keeps renewing the claim through heartbeats (60ms lease):
			// last renewal at ≈t+55 keeps the lease alive past t+80.
			await ctx.heartbeat();
			await new Promise((r) => setTimeout(r, 50));
			await ctx.heartbeat();
			await new Promise((r) => setTimeout(r, 70));
			return { ok: true };
		});
		const first = jobsApi.processNextBatch(1, 60);
		await new Promise((r) => setTimeout(r, 80)); // without the renewals, the lease would have expired here
		const second = jobsApi.processNextBatch(1, 60); // …but the heartbeats renewed it
		await Promise.all([first, second]);
		expect(runs).toBe(1);
	});

	it('retryable failures back off before the next attempt', async () => {
		await jobsApi.enqueue(`${TEST_PREFIX}backoff`, { n: 1 }, 3);
		let calls = 0;
		define(`${TEST_PREFIX}backoff`, async () => {
			calls += 1;
			if (calls === 1) throw new Error('transient');
			return { ok: true };
		});
		await jobsApi.processNextBatch(1);
		let [row] = await db.select().from(jobs).where(eq(jobs.type, `${TEST_PREFIX}backoff`));
		expect(row.status).toBe('queued');
		expect(row.attempts).toBe(1);
		expect(row.error).toContain('transient');
		expect(row.runAfter).not.toBeNull();
		// backoff: an immediate second batch must NOT pick it up
		const claimed = await jobsApi.processNextBatch(1);
		expect(claimed).toBe(0);
		// once the backoff elapsed, the job runs again and completes
		await new Promise((r) => setTimeout(r, 1100));
		await jobsApi.processNextBatch(1);
		[row] = await db.select().from(jobs).where(eq(jobs.type, `${TEST_PREFIX}backoff`));
		expect(row.status).toBe('completed');
		expect(row.attempts).toBe(2);
		expect(row.error).toBeNull();
	});

	it('bounded retries: the handler runs EXACTLY maxAttempts times (#391 regression)', async () => {
		await jobsApi.enqueue(`${TEST_PREFIX}bounded`, { n: 1 }, 3);
		let runs = 0;
		define(`${TEST_PREFIX}bounded`, async () => {
			runs += 1;
			throw new Error('always fails');
		});
		for (let attempt = 1; attempt <= 3; attempt++) {
			await jobsApi.processNextBatch(1);
			expect(runs).toBe(attempt);
			const [row] = await db.select().from(jobs).where(eq(jobs.type, `${TEST_PREFIX}bounded`));
			if (attempt < 3) {
				// skip the backoff window deterministically between attempts
				await db.update(jobs).set({ runAfter: new Date(Date.now() - 1) }).where(eq(jobs.type, `${TEST_PREFIX}bounded`));
			}
		}
		const fourth = await jobsApi.processNextBatch(1);
		expect(fourth).toBe(0);
		expect(runs).toBe(3);
		const [row] = await db.select().from(jobs).where(eq(jobs.type, `${TEST_PREFIX}bounded`));
		expect(row.status).toBe('failed');
		expect(row.attempts).toBe(3);
	});

	it('a NonRetryableJobError fails the job immediately (no retry)', async () => {
		await jobsApi.enqueue(`${TEST_PREFIX}permanent`, { n: 1 }, 3);
		let calls = 0;
		define(`${TEST_PREFIX}permanent`, async () => {
			calls += 1;
			throw new NonRetryableJobError('bad payload shape');
		});
		await jobsApi.processNextBatch(1);
		expect(calls).toBe(1);
		const [row] = await db.select().from(jobs).where(eq(jobs.type, `${TEST_PREFIX}permanent`));
		expect(row.status).toBe('failed');
		expect(row.attempts).toBe(1);
		expect(row.finishedAt).not.toBeNull();
	});

	it('the worker drains gracefully: stopJobRunner resolves after the in-flight batch', async () => {
		for (let i = 0; i < 3; i++) await jobsApi.enqueue(`${TEST_PREFIX}runner`, { i });
		let handlerRuns = 0;
		define(`${TEST_PREFIX}runner`, async () => {
			handlerRuns += 1;
			await new Promise((r) => setTimeout(r, 120));
			return { ok: true };
		});
		startJobRunner(15, 1, { leaseMs: 5_000 });
		// wait until the first tick is mid-handler
		for (let i = 0; i < 50 && handlerRuns === 0; i++) await new Promise((r) => setTimeout(r, 10));
		expect(handlerRuns).toBeGreaterThanOrEqual(1);
		const inFlightEnd = Date.now() + 120; // roughly when the active handler finishes
		await stopJobRunner(); // must NOT resolve before the active batch completes
		expect(Date.now()).toBeGreaterThanOrEqual(inFlightEnd - 20);
		expect(runnerState().active).toBe(false);
		const after = handlerRuns;
		await new Promise((r) => setTimeout(r, 80));
		expect(handlerRuns).toBe(after); // no new tick after stop
	});

	it('the web runtime never auto-starts the poller (#328)', async () => {
		const { readFileSync: rf } = await import('node:fs');
		const hooks = rf('src/hooks.server.ts', 'utf8');
		expect(hooks).not.toContain('startJobRunner');
	});
});
