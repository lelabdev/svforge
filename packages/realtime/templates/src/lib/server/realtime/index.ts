import { createRealtimeHub } from './hub';

/**
 * Shared realtime hub instance — import from anywhere server-side:
 *   import { realtime } from '#lib/server/realtime/index.js';
 *   await realtime.publish({ channel, event, payload });
 *
 * Secure by default (#264): without an `authorize` callback every subscription
 * is refused. Configure your auth policy in this file when the app has one:
 *
 *   export const realtime = createRealtimeHub({
 *     authenticate: async (req) => req.headers['x-user-id'] as string | undefined,
 *     authorize: (userId, channel) =>
 *       userId != null && (channel === `org:${userId}` || channel.startsWith('public:'))
 *   });
 */
export const realtime = createRealtimeHub();

export type { RealtimeEvent, RealtimeServerOptions } from './hub';
