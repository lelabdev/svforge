# @svforge/chat

Composable app chat for SvelteForge **dashboard** projects — conversations,
messages, read-state. Provides the repetitive 60–70%; it is not a full
messaging product (no Slack clone, no threads, no presence engine in v1).

## Install

```bash
npx sv add @svforge/chat
```

Requires the **dashboard** template (auth + Drizzle). Schemas auto-registered.

## Deployment profile

Supported: `long-lived-node`, `serverless`. Unsupported: `edge`, `separate-worker` because the module uses PostgreSQL. Realtime is an optional separately deployed integration.

## API

```ts
import { chat } from '#lib/server/chat/index.js';

// Create a conversation (≥2 participants, creator included)
const conv = await chat.createConversation({ participantIds: [userA, userB] });

// Send a message — authorId is set SERVER-SIDE (no client spoofing)
await chat.sendMessage({ conversationId: conv.id, authorId: currentUser.id, content: 'Bonjour' });

// Reads (membership-checked, paginated)
await chat.listConversations(userId);
await chat.listMessages(conversationId, userId, { limit: 50, offset: 0 });
await chat.markRead(conversationId, userId);
```

## UI

- `/chat` — conversation list: last message + timestamp + unread badge
- `/chat/[id]` — conversation view: paginated messages + send form (enhance)
- Empty/loading states; all copy via Paraglide FR/EN

## Security

- **Only participants can read a conversation** — `assertMember` server-side on
  every read/write
- **Only the current author can create a message under their identity** —
  `authorId` comes from `locals.user`, never from the client
- Messages are paginated

## Composition (all optional)

| Integration | What it adds |
|-------------|--------------|
| `@svforge/realtime` | publish `message.created` on `conversation:{id}` after persist — client refetches |
| `@svforge/uploads` | attachments via the existing upload primitives (no second upload system) |
| `@svforge/notifications` | notify non-active participants (simple hook pattern) |

The chat works fine **without** realtime — classic form/refetch flows.

## Model

```text
conversations            id, type (direct|group), createdAt
conversation_participants conversationId, userId, joinedAt
messages                id, conversationId, authorId, content, createdAt
message_reads           messageId, userId, readAt
```

## What's included

- `src/lib/server/chat/schema.ts` — 4 Drizzle tables
- `src/lib/server/chat/index.ts` — service layer (`chat.*`)
- `src/routes/chat/` and `src/routes/chat/[id]/` — demo pages (small, canonical)

## License

MIT
