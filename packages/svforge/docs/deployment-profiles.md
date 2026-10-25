# Deployment profiles

Set `deployment.profile` in `.svforge.json` before selecting an adapter or adding runtime modules. For example: `{ "deployment": { "profile": "long-lived-node" } }`. `svforge doctor` warns only when an installed runtime module is incompatible with that declared target.

| Profile | Use it for | Do not assume |
| --- | --- | --- |
| `long-lived-node` | `@sveltejs/adapter-node` 6.x (SvelteKit 3), containers, a persistent Node process | horizontal WebSocket fan-out without a shared broker |
| `serverless` | request-scoped Node functions | process-local pools, polling workers, or a WebSocket server |
| `edge` | Cloudflare Workers or edge functions | Node APIs, TCP PostgreSQL drivers, or `ws` |
| `separate-worker` | a dedicated Node process for jobs or WebSockets | that it replaces the web adapter; it complements it |

## Minimal examples

### Node application with attached realtime

Use `@sveltejs/adapter-node` 6.x (the SvelteKit 3 line), declare `long-lived-node`, attach `realtime` to the Node HTTP server, and keep one PostgreSQL client per process. This is the only profile where the bundled `ws` hub can attach to the application server.

```ts
const hub = createRealtimeHub({
	authorize: (userId, channel) => userId !== undefined && channel === `user:${userId}`
});
hub.attach(server); // the long-lived Node HTTP server you own
```

### Serverless web app with a worker

Declare `serverless` for the web application. Use the dashboard DB factory with a small request-scoped pool and close it when the request finishes:

```ts
const connection = createDb(env.DATABASE_URL, { maxConnections: 1, idleTimeout: 20 });
try {
	return await loadData(connection.db);
} finally {
	await connection.close();
}
```

Keep uploads as direct-to-storage presigned requests. If jobs or realtime are needed, run them in a separately deployed `separate-worker` Node process and communicate through durable storage/broker infrastructure; do not start an interval or WebSocket server in a request handler.

## Runtime modules

The generated `.svforge.json` and `llms.txt` list supported and unsupported profiles for each installed runtime module. In summary:

- `realtime` supports `long-lived-node` or `separate-worker`; its `ws` server is not compatible with serverless or edge adapters.
- `jobs` supports `long-lived-node` or `separate-worker`. The runner is never auto-started in the web runtime: production deployments run the dedicated worker (`bun run jobs:worker`), claims are atomic (`FOR UPDATE SKIP LOCKED`) and lease-guarded, so several worker processes split the queue without duplicate execution (#328). In serverless, enqueue only and run the worker elsewhere.
- dashboard, audit, notifications, and chat use PostgreSQL and support Node/serverless, not edge.
- uploads supports Node/serverless. A presigned PUT's `ContentLength` is metadata, not a portable storage-level limit: enforce a bucket POST policy where available, record per-user quotas before signing, and trigger a malware/content scan callback before serving the object.

## Security and data lifecycle

Realtime defaults: incoming frames are capped at 16 KiB, each connection may retain 50 channels and request 60 subscriptions per minute. Authorization is deny-by-default and asynchronous checks reserve their channel before awaiting, so concurrent checks cannot bypass the cap. Tune the limits at hub construction for the product's traffic model.

Audit metadata must not contain secrets or unnecessary PII. Define retention and deletion/anonymization rules per product, restrict audit reads to administrators, and add a database trigger that rejects `UPDATE`/`DELETE` when an append-only guarantee is required. The included application API is append-only but does not itself create that database policy.
