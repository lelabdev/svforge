import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers';

/**
 * Tests for #233 — composable chat module. The architecture test of the
 * roadmap: composes foundations, no duplicate uploads/realtime/notifications.
 */
describe('chat module (#233)', () => {
	const chatDir = join(ROOT, 'packages/chat/templates/src/lib/server/chat');

	it('ships schema (conversations/participants/messages/reads) + service + UI', () => {
		expect(existsSync(join(chatDir, 'schema.ts'))).toBe(true);
		expect(existsSync(join(chatDir, 'index.ts'))).toBe(true);
		expect(existsSync(join(ROOT, 'packages/chat/templates/src/routes/chat/+page.svelte'))).toBe(true);
		expect(existsSync(join(ROOT, 'packages/chat/templates/src/routes/chat/[id]/+page.svelte'))).toBe(true);
	});

	it('model: conversations, conversationParticipants, messages, messageReads', () => {
		const schema = readFileSync(join(chatDir, 'schema.ts'), 'utf-8');
		expect(schema).toMatch(/conversations/);
		expect(schema).toMatch(/conversationParticipants/);
		expect(schema).toMatch(/messages/);
		expect(schema).toMatch(/messageReads/);
	});

	it('security: server-side membership check on reads AND writes', () => {
		const service = readFileSync(join(chatDir, 'index.ts'), 'utf-8');
		expect(service).toMatch(/assertMember/);
		expect(service).toMatch(/Forbidden: you are not a participant/);
		// membership checked before listing messages and before sending
		const listIdx = service.indexOf('listMessages');
		const sendIdx = service.indexOf('sendMessage');
		expect(service.indexOf('assertMember', listIdx)).toBeGreaterThan(listIdx);
		expect(service.indexOf('assertMember', sendIdx)).toBeGreaterThan(sendIdx);
	});

	it('no author spoofing: authorId comes from server session, not client', () => {
		const page = readFileSync(join(ROOT, 'packages/chat/templates/src/routes/chat/[id]/+page.server.ts'), 'utf-8');
		expect(page).toMatch(/authorId: (currentUser|locals\.user)\.id/);
		expect(page).not.toMatch(/form\.get\('author'\)|formData.*author/);
		expect(page).toMatch(/no client spoofing/);
	});

	it('messages are paginated', () => {
		const service = readFileSync(join(chatDir, 'index.ts'), 'utf-8');
		expect(service).toMatch(/limit/);
		expect(service).toMatch(/offset/);
	});

	it('read/unread state exists', () => {
		const service = readFileSync(join(chatDir, 'index.ts'), 'utf-8');
		expect(service).toMatch(/unreadCount/);
		expect(service).toMatch(/markRead/);
		expect(service).toMatch(/messageReads/);
	});

	it('uses the shared Badge for unread counts (#475)', () => {
		const page = readFileSync(join(ROOT, 'packages/chat/templates/src/routes/chat/+page.svelte'), 'utf-8');
		expect(page).toMatch(/import \{ Badge \} from '\$lib\/components\/svforge\/primitives'/);
		expect(page).toContain('<Badge>{conv.unreadCount}</Badge>');
		expect(page).not.toMatch(/bg-primary-500\s+text-white/);
	});

	it('works without realtime (classic forms/refetch)', () => {
		// The send flow uses SvelteKit actions (form), not a WS dependency
		const page = readFileSync(join(ROOT, 'packages/chat/templates/src/routes/chat/[id]/+page.server.ts'), 'utf-8');
		expect(page).toMatch(/export const actions/);
		const index = readFileSync(join(ROOT, 'packages/chat/src/index.ts'), 'utf-8');
		expect(index).not.toMatch(/sv\.dependency\('ws'/);
		expect(index).not.toMatch(/sv\.dependency\('@svforge\/realtime'/);
	});

	it('no duplicate uploads/realtime/notifications infrastructure', () => {
		const index = readFileSync(join(ROOT, 'packages/chat/src/index.ts'), 'utf-8');
		expect(index).not.toMatch(/s3|presign|WebSocketServer/i);
		const readme = readFileSync(join(ROOT, 'packages/chat/README.md'), 'utf-8');
		expect(readme).toMatch(/optional/);
	});

	it('module requires dashboard capabilities, registers schemas, enriches context', () => {
		const index = readFileSync(join(ROOT, 'packages/chat/src/index.ts'), 'utf-8');
		// #323: the gate is capability-based (structural check), not template-name based
		expect(index).toMatch(/checkModuleCapabilities\(cwd, 'chat'\)/);
		expect(index).toMatch(/conversationParticipants/);
		expect(index).toMatch(/schema\.ts/);
		// #324: JSON merges go through the shared kit, planned before any write
		expect(index).toMatch(/planAddonContext/);
		expect(index).toMatch(/planCatalogMerges/);
	});
});
