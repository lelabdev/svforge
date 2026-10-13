# @svforge/audit

Business action audit trail for SvelteForge **dashboard** projects — who did
what, on which entity, when, with what context. Append-only at the application
level.

## Install

```bash
npx sv add @svforge/audit
```

Requires the **dashboard** template (auth + Drizzle). The audit schema is
auto-registered in `src/lib/server/db/schema.ts`.

## Deployment profile

Supported: `long-lived-node`, `serverless`. Unsupported: `edge`, `separate-worker` (the module uses PostgreSQL).

Set a product retention period, classify metadata/PII, and limit read access to administrators. The included API is append-only at application level; where regulatory integrity is required, add a PostgreSQL trigger that rejects `UPDATE` and `DELETE` for `audit_logs`.

## Record

```ts
import { audit } from '#lib/server/audit/index.js';

await audit.record({
	actorId: user.id, // null → system action
	action: 'punch.corrected',
	entityType: 'punch',
	entityId: punch.id,
	metadata: {
		before: { time: oldTime },
		after: { time: newTime },
		reason
	},
	ipAddress: event.getClientAddress(),
	userAgent: event.request.headers.get('user-agent')
});
```

## Read

```ts
await audit.forEntity('punch', punchId);       // full history, newest first
await audit.byActor(userId, { limit: 50 });    // actions by one actor
await audit.list({ action: 'punch.corrected', entityType: 'punch', limit: 50, offset: 0 });
```

## Admin view

`/admin/audit` — filter by action/entity, paginated, admin-only (same guard as
the other admin pages).

## Model

```ts
{ id, actorId?, action, entityType, entityId?, metadata?, ipAddress?, userAgent?, createdAt }
```

## 🔒 Confidentiality — what must NEVER go in `metadata`

- passwords, tokens, session secrets
- full object dumps containing sensitive data
- PII beyond what the feature genuinely needs
- card numbers / billing details

The audit log is a business trail, not a technical log and not an event-sourcing
store. No update/delete is exposed by the API — the table stays append-only at
the application level.

For a database-enforced policy, run this product-owned migration (adapt the
retention window to your legal requirements):

```sql
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
-- Example retention job, not a module default:
-- DELETE FROM audit_logs WHERE created_at < now() - interval '2 years';
```

## What's included

- `src/lib/server/audit/schema.ts` — Drizzle schema (`audit_logs`)
- `src/lib/server/audit/index.ts` — `audit.record` / `forEntity` / `byActor` / `list`
- `src/routes/(app)/admin/audit/` — paginated admin view (FR/EN via Paraglide)

## Limits (v1)

- Append-only at the application level only — there is no retention policy /
  pruning in v1. Add a cleanup job when volume grows.
- `metadata` is a JSONB free-form map: keep it small and non-sensitive (see
  confidentiality above).
- List endpoint is a simple page-based read; no search/indexing in v1.

## License

MIT
