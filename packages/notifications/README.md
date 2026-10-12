# @svforge/notifications

Persistent **business notifications** (read/unread, history) for SvelteForge
**dashboard** projects. Distinct from `ui_toast` — a toast is ephemeral UI
feedback; a notification is user data.

## Install

```bash
npx sv add @svforge/notifications
```

Requires the **dashboard** template (auth + Drizzle). `@svforge/realtime` and
`@svforge/email` are **optional** integrations.

## Deployment profile

Supported: `long-lived-node`, `serverless`. Unsupported: `edge`, `separate-worker` because the module uses PostgreSQL. Realtime and email remain optional integrations.

## Create

```ts
import { notificationsApi } from '#lib/server/notifications/index.js';

await notificationsApi.create({
	userId,
	type: 'export.ready',
	title: 'Export terminé',
	message: 'Votre export de paie est prêt.',
	actionUrl: `/exports/${exportId}`
});
```

## Read / update

```ts
await notificationsApi.list(userId, { limit: 20 });
await notificationsApi.unreadCount(userId);
await notificationsApi.markAsRead(notificationId, userId);   // ownership-checked
await notificationsApi.markAllAsRead(userId);
```

## UI

`<NotificationsBell items unreadCount />` — badge with unread count, recent
list, "mark all as read" (POST `/api/notifications/read-all`). Load data in a
layout:

```ts
// +layout.server.ts
const items = await notificationsApi.list(locals.user.id, { limit: 10 });
const unreadCount = await notificationsApi.unreadCount(locals.user.id);
```

## Optional: realtime (#229)

After a successful persist, publish a lightweight event — the client
refetches; the DB stays the source of truth:

```ts
import { realtime } from '#lib/server/realtime/index.js';
await notificationsApi.create({ ... });
await realtime.publish({ channel: `user:${userId}`, event: 'notification.created', payload: { notificationId } });
```

## Optional: email (#239/#236)

For specific types only (never all notifications): a job/route can check the
`type` and call `sendEmail` from `@svforge/email`.

## Model

```ts
{ id, userId, type, title, message, actionUrl?, metadata?, readAt?, createdAt }
```

`message` is **plain text** — no arbitrary HTML in v1.

## What's included

- `src/lib/server/notifications/schema.ts` — Drizzle schema (`notifications`)
- `src/lib/server/notifications/index.ts` — create/list/unreadCount/markAsRead/markAllAsRead
- `src/lib/components/svforge/ui/NotificationsBell.svelte` — bell + badge + list
- `src/routes/api/notifications/read-all/+server.ts` — mark-all endpoint

## Limits (v1)

- No push (web push / FCM) in v1 — delivery is in-app (bell) or via optional
  `realtime`/`email` integrations you wire yourself.
- `message` is plain text (no rich content / HTML).
- No per-notification preference engine (opt-in/out per type) in v1.

## License

MIT
