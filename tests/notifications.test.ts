import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers';

/**
 * Tests for #230 — persistent notifications module.
 * Distinct from toasts: user data with history + read/unread state.
 */
describe('notifications module (#230)', () => {
	const apiDir = join(ROOT, 'packages/notifications/templates/src/lib/server/notifications');

	it('ships schema, API, UI bell and mark-all endpoint', () => {
		expect(existsSync(join(apiDir, 'schema.ts'))).toBe(true);
		expect(existsSync(join(apiDir, 'index.ts'))).toBe(true);
		expect(existsSync(join(ROOT, 'packages/notifications/templates/src/lib/components/svforge/ui/NotificationsBell.svelte'))).toBe(true);
		expect(existsSync(join(ROOT, 'packages/notifications/templates/src/routes/api/notifications/read-all/+server.ts'))).toBe(true);
	});

	it('model has readAt (read/unread) + history fields', () => {
		const schema = readFileSync(join(apiDir, 'schema.ts'), 'utf-8');
		expect(schema).toMatch(/readAt/);
		expect(schema).toMatch(/createdAt/);
		expect(schema).toMatch(/userId/);
		expect(schema).toMatch(/actionUrl/);
		expect(schema).toMatch(/type/);
	});

	it('API provides create, list, unreadCount, markAsRead, markAllAsRead', () => {
		const api = readFileSync(join(apiDir, 'index.ts'), 'utf-8');
		expect(api).toMatch(/async create/);
		expect(api).toMatch(/async list/);
		expect(api).toMatch(/unreadCount/);
		expect(api).toMatch(/markAsRead/);
		expect(api).toMatch(/markAllAsRead/);
		// unread filtering
		expect(api).toMatch(/onlyUnread/);
		expect(api).toMatch(/isNull\(notifications\.readAt\)/);
	});

	it('markAsRead is ownership-checked (userId in WHERE)', () => {
		const api = readFileSync(join(apiDir, 'index.ts'), 'utf-8');
		expect(api).toMatch(/eq\(notifications\.id, notificationId\), eq\(notifications\.userId, userId\)/);
	});

	it('bell UI shows unread badge and mark-all action', () => {
		const bell = readFileSync(join(ROOT, 'packages/notifications/templates/src/lib/components/svforge/ui/NotificationsBell.svelte'), 'utf-8');
		expect(bell).toMatch(/unreadCount/);
		expect(bell).toMatch(/read-all/);
		expect(bell).toMatch(/notif_mark_all/);
	});

	it('uses Skeleton Popover and SVForge Badge contracts (#475)', () => {
		const bell = readFileSync(join(ROOT, 'packages/notifications/templates/src/lib/components/svforge/ui/NotificationsBell.svelte'), 'utf-8');
		expect(bell).toContain("import { Popover, Portal } from '@skeletonlabs/skeleton-svelte'");
		expect(bell).toContain('<Popover.Trigger');
		expect(bell).toContain('<Popover.Content');
		expect(bell).toContain('closeOnInteractOutside={true}');
		expect(bell).toContain('restoreFocus={true}');
		expect(bell).toContain('<Badge class="absolute -top-1 -right-1">{unreadCount}</Badge>');
		expect(bell).not.toMatch(/\{#if open\}|absolute right-0/);
		expect(bell).not.toMatch(/bg-primary-500\s+text-white/);
	});

	it('module requires DB capability (dashboard) and enriches context/messages', () => {
		const index = readFileSync(join(ROOT, 'packages/notifications/src/index.ts'), 'utf-8');
		// #323: the gate is capability-based (structural check), not template-name based
		expect(index).toMatch(/checkModuleCapabilities\(cwd, 'notifications'\)/);
		// #324: JSON merges go through the shared kit, planned before any write
		expect(index).toMatch(/planAddonContext/);
		expect(index).toMatch(/planCatalogMerges/);
		expect(index).toMatch(/notif_title/);
	});

	it('realtime/email are OPTIONAL (documented, not required)', () => {
		const readme = readFileSync(join(ROOT, 'packages/notifications/README.md'), 'utf-8');
		expect(readme).toMatch(/optional/);
		const index = readFileSync(join(ROOT, 'packages/notifications/src/index.ts'), 'utf-8');
		expect(index).not.toMatch(/sv\.dependency\('@svforge\/realtime'/);
		expect(index).not.toMatch(/sv\.dependency\('@svforge\/email'/);
	});
});
