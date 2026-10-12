import { db } from '#lib/server/db/index.js';
import { jobs } from './schema';
import { eq, and, or, lt, lte, isNull, inArray, sql, asc } from 'drizzle-orm';
import { DEFAULT_LEASE_MS, computeBackoffMs } from './leases';

/**
 * SvelteForge jobs foundation (#231) — background tasks without coupling the
 * business to a queue provider (BullMQ/Redis/etc.).
 *
 *   await jobs.enqueue('payroll.export', { organizationId, period });
 *   jobs.define('payroll.export', async (payload, ctx) => {
 *     await ctx.progress(10);
 *     // long work
 *     await ctx.progress(100);
 *     return { fileId };
 *   });
 *
 * Guarantees (v1, #328): at-least-once (a crashed handler may re-run →
 * handlers must be idempotent), bounded retries (maxAttempts, default 3) with
 * exponential backoff, atomic claims (FOR UPDATE SKIP LOCKED — many workers
 * can run concurrently without duplicate execution), lease-guarded running
 * jobs (a crashed worker's job is recoverable once the lease expires; long
 * handlers renew it through ctx.progress / ctx.heartbeat).
 *
 * Throw `NonRetryableJobError` from a handler to fail the job immediately.
 */

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobHandlerContext {
	jobId: string;
	/** Update progress 0–100 (also renews the claim lease). */
	progress: (value: number) => Promise<void>;
	/** Renew the claim lease without changing progress (long handlers). */
	heartbeat: () => Promise<void>;
}

export type JobHandler<T = Record<string, unknown>> = (payload: T, ctx: JobHandlerContext) => Promise<unknown>;

/** A permanent failure: the job is failed immediately, without retrying. */
export class NonRetryableJobError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NonRetryableJobError';
	}
}

const handlers = new Map<string, JobHandler>();

/** Register a typed handler for a job type. */
export function define<T = Record<string, unknown>>(type: string, handler: JobHandler<T>): void {
	handlers.set(type, handler as JobHandler);
}

export const jobsApi = {
	/** Enqueue a job. Returns immediately (processing happens in background). */
	async enqueue(type: string, payload: Record<string, unknown> = {}, maxAttempts = 3) {
		const [row] = await db
			.insert(jobs)
			.values({
				type,
				status: 'queued',
				payload,
				maxAttempts,
				createdAt: new Date(),
				updatedAt: new Date()
			})
			.returning();
		return row;
	},

	/** Progress update (0–100). With `leaseMs`, also renews the claim lease. */
	async progress(jobId: string, value: number, leaseMs?: number) {
		await db
			.update(jobs)
			.set({
				progress: Math.min(100, Math.max(0, value)),
				updatedAt: new Date(),
				...(leaseMs ? { leaseUntil: new Date(Date.now() + leaseMs) } : {})
			})
			.where(eq(jobs.id, jobId));
	},

	/** Renew the claim lease (long handlers, #328). */
	async heartbeat(jobId: string, leaseMs = DEFAULT_LEASE_MS) {
		await db
			.update(jobs)
			.set({ leaseUntil: new Date(Date.now() + leaseMs), updatedAt: new Date() })
			.where(eq(jobs.id, jobId));
	},

	/** Get a job by id (diagnostics). */
	async get(jobId: string) {
		const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
		return row;
	},

	/**
	 * Atomically claim up to `batchSize` jobs (#328): queued jobs whose
	 * backoff elapsed, or running jobs whose lease expired (crash recovery).
	 * `FOR UPDATE SKIP LOCKED` inside a transaction lets many workers poll the
	 * same queue concurrently — a claimed row is invisible to the next claim
	 * until this transaction commits (the row is `running` by then).
	 */
	async claimBatch(batchSize: number, leaseMs = DEFAULT_LEASE_MS) {
		const now = new Date();
		return db.transaction(async (tx) => {
			const claimable = await tx
				.select()
				.from(jobs)
				.where(
					or(
						and(eq(jobs.status, 'queued'), or(isNull(jobs.runAfter), lte(jobs.runAfter, now))),
						and(eq(jobs.status, 'running'), lt(jobs.leaseUntil, now))
					)
				)
				.orderBy(asc(jobs.createdAt))
				.limit(batchSize)
				.for('update', { skipLocked: true });
			if (claimable.length === 0) return [];
			const ids = claimable.map((job) => job.id);
			await tx
				.update(jobs)
				.set({
					status: 'running',
					attempts: sql`${jobs.attempts} + 1`,
					lockedAt: now,
					leaseUntil: new Date(now.getTime() + leaseMs),
					startedAt: sql`coalesce(${jobs.startedAt}, now())`,
					updatedAt: now
				})
				.where(inArray(jobs.id, ids));
			// The SELECT above read the rows BEFORE the increment (#391 review):
			// report the incremented attempt so retry bookkeeping in
			// runClaimed() sees 1..maxAttempts and a job runs at most
			// maxAttempts times.
			return claimable.map((job) => ({ ...job, attempts: job.attempts + 1 }));
		});
	},

	/**
	 * Claim and run one batch. Called by the runner — see `runner.ts`.
	 * Exposed for tests and manual triggering. `leaseMs` bounds how long a
	 * claim stays exclusive without a heartbeat.
	 */
	async processNextBatch(batchSize = 10, leaseMs = DEFAULT_LEASE_MS): Promise<number> {
		const claimed = await this.claimBatch(batchSize, leaseMs);
		let processed = 0;
		for (const job of claimed) {
			const handler = handlers.get(job.type);
			if (!handler) {
				await db
					.update(jobs)
					.set({ status: 'failed', error: 'Unknown handler', updatedAt: new Date(), finishedAt: new Date() })
					.where(eq(jobs.id, job.id));
				continue;
			}
			await this.runClaimed(job.id, job.payload as Record<string, unknown>, job.attempts, job.maxAttempts, handler, leaseMs);
			processed++;
		}
		return processed;
	},

	/** Execute a claimed job (already `running`, attempts already incremented). */
	async runClaimed(
		jobId: string,
		payload: Record<string, unknown>,
		attempts: number,
		maxAttempts: number,
		handler: JobHandler,
		leaseMs: number
	) {
		const context: JobHandlerContext = {
			jobId,
			progress: (value) => this.progress(jobId, value, leaseMs),
			heartbeat: () => this.heartbeat(jobId, leaseMs)
		};
		try {
			const result = await handler(payload, context);
			await db
				.update(jobs)
				.set({
					status: 'completed',
					progress: 100,
					result: (result ?? {}) as Record<string, unknown>,
					error: null,
					finishedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(jobs.id, jobId));
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			const nonRetryable = e instanceof NonRetryableJobError;
			const failed = nonRetryable || attempts >= maxAttempts;
			await db
				.update(jobs)
				.set({
					status: failed ? 'failed' : 'queued',
					error: message,
					updatedAt: new Date(),
					// retryable: exponential backoff before the next attempt (#328)
					...(failed ? { finishedAt: new Date() } : { runAfter: new Date(Date.now() + computeBackoffMs(attempts)) })
				})
				.where(eq(jobs.id, jobId));
		}
	}
};
