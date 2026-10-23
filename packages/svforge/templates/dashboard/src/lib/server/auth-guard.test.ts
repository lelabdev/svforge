import { describe, expect, it, vi } from 'vitest';

const query = {
	select: vi.fn(() => query),
	from: vi.fn(() => query),
	where: vi.fn(() => query),
	limit: vi.fn<() => any[]>()
};

vi.mock('#lib/server/db/index.js', () => ({ db: query }));
vi.mock('#lib/server/db/schema.js', () => ({ user: { id: 'id', disabled: 'disabled' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

/**
 * #547 — the official Better Auth hook populates locals.session/user; SVForge
 * only owns the disabled-identity guard composed after it. The guard is
 * tested directly (Kit's `sequence` needs a request store outside the app).
 */
describe('SVForge disabled-identity guard', () => {
	it('clears locals for a session owned by a disabled user', async () => {
		query.limit.mockReturnValueOnce([{ disabled: true }]);
		const { handleSvforgePolicy } = await import('./auth-guard');
		const event: any = {
			locals: { user: { id: 'disabled-user' }, session: { id: 'session-1' } }
		};
		const resolve = vi.fn(async () => new Response('ok'));

		await handleSvforgePolicy({ event, resolve } as any);

		expect(event.locals.session).toBeUndefined();
		expect(event.locals.user).toBeUndefined();
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it('keeps an active identity untouched', async () => {
		query.limit.mockReturnValueOnce([{ disabled: false }]);
		const { handleSvforgePolicy } = await import('./auth-guard');
		const user = { id: 'active-user' };
		const session = { id: 'session-2' };
		const event: any = { locals: { user, session } };

		await handleSvforgePolicy({ event, resolve: async () => new Response('ok') } as any);

		expect(event.locals.user).toEqual(user);
		expect(event.locals.session).toEqual(session);
	});
});
