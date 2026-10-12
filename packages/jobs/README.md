# @svforge/jobs

Background job foundation for SvelteKit — retry, progress, atomic claims, and an encapsulated backend. The business never imports a queue provider (BullMQ/Redis/etc.): handlers and enqueues go through one small API.

## Quick start

```ts
// src/lib/server/jobs/handlers.ts (or anywhere server-side)
import { define } from '#lib/server/jobs/index.js';

define('payroll.export', async (payload, ctx) => {
	await ctx.progress(10);
	// long work — call ctx.heartbeat() to keep the claim alive
	await ctx.progress(100);
	return { fileId };
});
```

```ts
await jobs.enqueue('payroll.export', { organizationId });
```

## Running the worker (the only place jobs execute)

Installing the module **never** starts a poller inside the web runtime (#328): no background process is silently added to every web process, serverless instance, or hot reload.

Jobs execute where a runner is explicitly started:

```sh
bun run jobs:worker
```

`jobs:worker` runs the dedicated worker process (`src/lib/server/jobs/worker.ts`): it polls every 5s, drains the in-flight batch on SIGTERM/SIGINT, and exits cleanly under systemd/Docker stop sequences.

### Deployment profiles

| Profile | Runner | Notes |
|---|---|---|
| `long-lived-node` (single instance) | `startJobRunner()` explicitly in `src/hooks.server.ts` | Acceptable only while ONE server process exists. |
| `separate-worker` (recommended) | `bun run jobs:worker` in its own process/deployment | Several worker processes are safe: claims are atomic and lease-guarded — work is split, never duplicated. |
| `serverless` | none — enqueue only, run the worker elsewhere (or use an external queue) | Request handlers must not poll. |

See `docs/deployment-profiles.md` in the scaffold for the full matrix.

## Guarantees

- **At-least-once**: a crashed worker's job is re-claimed after its lease expires → handlers must be **idempotent**.
- **Atomic claims**: `FOR UPDATE SKIP LOCKED` inside a transaction — two workers can never claim the same job.
- **Leases**: a claim is exclusive for 60s (default). `ctx.progress()` and `ctx.heartbeat()` renew it; long handlers should heartbeat.
- **Bounded retries**: `maxAttempts` (default 3) with exponential backoff (1s → 2s → 4s… capped at 60s via `runAfter`).
- **Non-retryable**: throw `NonRetryableJobError` to fail a job immediately, without consuming retries on a permanent error.
- **Unknown handler**: the job fails cleanly with `Unknown handler`.

## API

| Export | Purpose |
|---|---|
| `define(type, handler)` | Register a typed handler. |
| `jobs.enqueue(type, payload, maxAttempts?)` | Queue a job, returns the row. |
| `jobs.get(jobId)` | Diagnostics. |
| `jobs.processNextBatch(batchSize?, leaseMs?)` | Claim + run one batch (used by the runner; also handy in tests). |
| `startJobRunner(intervalMs?, batchSize?, { leaseMs? })` | Start polling — **explicit opt-in only**. |
| `stopJobRunner()` | Stop + drain: resolves after the in-flight batch. |
| `NonRetryableJobError` | Throw from a handler to skip retries. |
