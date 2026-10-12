import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';

/**
 * SvelteForge realtime transport (#229) — generic WebSocket hub.
 *
 * The business layer never depends on the WS implementation: it publishes and
 * subscribes through this stable API. Channels are isolated by an authorize
 * callback so a user cannot subscribe to a scope they may not read.
 *
 * Secure by default (#264): without an `authorize` callback every subscription
 * is refused (deny-all). Open channels explicitly, e.g. `authorize: () => true`
 * for development or a per-channel rule in production.
 */

export interface RealtimeEvent<T = unknown> {
	channel: string;
	event: string;
	payload: T;
}

export interface RealtimeClient {
	userId?: string;
	channels: Set<string>;
	pendingChannels: Set<string>;
	/** Generation tokens prevent an old async authorization from winning a retry. */
	pendingSubscriptions: Map<string, symbol>;
	subscriptionTimestamps: number[];
}

export interface RealtimeServerOptions {
	/** Maximum incoming frame size in bytes (default 16 KiB). */
	maxFrameBytes?: number;
	/** Maximum authorized channels retained by one connection (default 50). */
	maxChannelsPerClient?: number;
	/** Maximum subscribe requests per connection per minute (default 60). */
	maxSubscriptionsPerMinute?: number;
	/** Extract the authenticated user id from the upgrade request. */
	authenticate?: (req: IncomingMessage) => Promise<string | null | undefined> | string | null | undefined;
	/**
	 * Authorize a subscription: return false to refuse a channel.
	 * Defaults to deny-all when not provided (#264) — a hub never accepts a
	 * channel it was not explicitly told to accept.
	 */
	authorize?: (userId: string | undefined, channel: string) => boolean | Promise<boolean>;
}

type SocketEntry = { ws: WebSocket; client: RealtimeClient };

/**
 * The realtime hub. Instantiate once in `#lib/server/realtime/index.js` —
 * prefer the `createRealtimeHub` factory below.
 */
export class RealtimeHub {
	private wss: WebSocketServer | null = null;
	private sockets = new Map<WebSocket, SocketEntry>();
	private options: Required<Pick<RealtimeServerOptions, 'maxFrameBytes' | 'maxChannelsPerClient' | 'maxSubscriptionsPerMinute'>> & RealtimeServerOptions;

	constructor(options: RealtimeServerOptions = {}) {
		const positiveInteger = (value: number | undefined, fallback: number) =>
			Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
		this.options = {
			...options,
			maxFrameBytes: positiveInteger(options.maxFrameBytes, 16 * 1024),
			maxChannelsPerClient: positiveInteger(options.maxChannelsPerClient, 50),
			maxSubscriptionsPerMinute: positiveInteger(options.maxSubscriptionsPerMinute, 60)
		};
	}

	/** Attach the WS server to an HTTP server (e.g. adapter-node customServer). */
	attach(server: Server): void {
		this.wss = new WebSocketServer({ server, path: '/api/realtime', maxPayload: this.options.maxFrameBytes });
		this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
	}

	/** Start a standalone WS server on its own port (portable, no adapter hook). */
	listen(port: number, host = '0.0.0.0'): Promise<void> {
		return new Promise((resolve) => {
			this.wss = new WebSocketServer({ port, host, path: '/api/realtime', maxPayload: this.options.maxFrameBytes });
			this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
			this.wss.on('listening', () => resolve());
		});
	}

	private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
		let userId: string | undefined;
		try {
			userId = this.options.authenticate ? ((await this.options.authenticate(req)) ?? undefined) : undefined;
		} catch {
			ws.close(1011, 'authentication failed');
			return;
		}
		const client: RealtimeClient = {
			userId,
			channels: new Set(),
			pendingChannels: new Set(),
			pendingSubscriptions: new Map(),
			subscriptionTimestamps: []
		};
		this.sockets.set(ws, { ws, client });

		ws.on('message', (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === 'subscribe' && typeof msg.channel === 'string') {
					this.subscribe(ws, client, msg.channel);
				} else if (msg.type === 'unsubscribe' && typeof msg.channel === 'string') {
					client.channels.delete(msg.channel);
					// Invalidate an authorization that is still in flight. A retry may
					// start immediately with a new generation token.
					client.pendingChannels.delete(msg.channel);
					client.pendingSubscriptions.delete(msg.channel);
				}
			} catch {
				// ignore malformed frames
			}
		});

		ws.on('close', () => this.sockets.delete(ws));
		ws.on('error', () => this.sockets.delete(ws));
	}

	private async subscribe(ws: WebSocket, client: RealtimeClient, channel: string): Promise<void> {
		const now = Date.now();
		client.subscriptionTimestamps = client.subscriptionTimestamps.filter((timestamp) => now - timestamp < 60_000);
		if (client.subscriptionTimestamps.length >= this.options.maxSubscriptionsPerMinute) {
			ws.send(JSON.stringify({ type: 'error', channel, error: 'rate_limit' }));
			return;
		}
		client.subscriptionTimestamps.push(now);
		if (client.channels.has(channel) || client.pendingChannels.has(channel)) return;
		if (client.channels.size + client.pendingChannels.size >= this.options.maxChannelsPerClient) {
			ws.send(JSON.stringify({ type: 'error', channel, error: 'channel_limit' }));
			return;
		}

		// Reserve before awaiting authorization: concurrent async checks cannot
		// exceed the channel cap, and an unsubscribe during authorization wins.
		client.pendingChannels.add(channel);
		const generation = Symbol(channel);
		client.pendingSubscriptions.set(channel, generation);
		const authorize = this.options.authorize ?? (() => false);
		let authorized = false;
		try {
			authorized = await authorize(client.userId, channel);
		} catch {
			// Authorization failures are treated as a refusal, never as an
			// implicit allow or an unhandled rejection.
		}
		if (client.pendingSubscriptions.get(channel) !== generation || !this.sockets.has(ws)) return;
		client.pendingChannels.delete(channel);
		client.pendingSubscriptions.delete(channel);
		if (!authorized || client.channels.has(channel)) {
			if (!authorized && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', channel, error: 'unauthorized' }));
			return;
		}
		if (client.channels.size >= this.options.maxChannelsPerClient) {
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', channel, error: 'channel_limit' }));
			return;
		}
		client.channels.add(channel);
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribed', channel }));
	}

	/**
	 * Publish an event to all sockets subscribed to the channel (#264): the
	 * single canonical contract is the object form, identical to the envelope
	 * the client receives.
	 *
	 *   await realtime.publish({ channel: `org:${orgId}`, event: 'punch.created', payload: { punchId } });
	 */
	publish<T>(event: RealtimeEvent<T>): void {
		const msg = JSON.stringify({ type: 'event', ...event });
		for (const { ws, client } of this.sockets.values()) {
			if (client.channels.has(event.channel)) {
				ws.send(msg);
			}
		}
	}

	/** Number of connected sockets. */
	get connectionCount(): number {
		return this.sockets.size;
	}

	close(): void {
		for (const { ws } of this.sockets.values()) ws.close();
		this.sockets.clear();
		this.wss?.close();
	}
}

/**
 * Factory for the shared hub (#264) — configure auth at creation time instead
 * of mutating a read-only-looking instance:
 *
 *   export const realtime = createRealtimeHub({
 *     authenticate: async (req) => req.headers['x-user-id'] as string | undefined,
 *     authorize: (userId, channel) => userId != null && channel === `org:${userId}`
 *   });
 */
export function createRealtimeHub(options: RealtimeServerOptions = {}): RealtimeHub {
	return new RealtimeHub(options);
}
