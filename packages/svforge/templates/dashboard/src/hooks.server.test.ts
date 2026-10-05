import { describe, expect, it, vi } from 'vitest';

const query = {
	select: vi.fn(() => query),
	from: vi.fn(() => query),
	where: vi.fn(() => query),
	limit: vi.fn<() => any[]>()
};

vi.mock('$app/env', () => ({ building: false }));
vi.mock('$lib/paraglide/runtime', () => ({ getTextDirection: vi.fn(() => 'ltr') }));
vi.mock('$lib/paraglide/server', () => ({
	paraglideMiddleware: vi.fn(async (request, next) => next({ request, locale: 'en' }))
}));
vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			getSession: vi.fn(async () => ({
				session: { id: 'session-1', userId: 'disabled-user' },
				user: { id: 'disabled-user', email: 'disabled@example.com' }
			}))
		}
	}
}));
vi.mock('$lib/server/db', () => ({ db: query }));
vi.mock('$lib/server/db/schema', () => ({ user: { id: 'id', disabled: 'disabled' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('better-auth/svelte-kit', () => ({
	// Faithful to the real handler: resolve is called with the transform object.
	svelteKitHandler: vi.fn(({ event, resolve }) => resolve(event, { transformPageChunk: (f: any) => f.html ?? f }))
}));

describe('dashboard auth hook', () => {
	it('does not populate locals for a session owned by a disabled user', async () => {
		query.limit.mockReturnValueOnce([{ disabled: true }]);
		const { handle } = await import('./hooks.server');
		const event: any = {
			request: new Request('http://localhost/admin'),
			locals: {}
		};
		const resolve = vi.fn(async () => new Response('ok'));

		await handle({ event, resolve } as any);

		expect(event.locals.session).toBeUndefined();
		expect(event.locals.user).toBeUndefined();
		expect(resolve).toHaveBeenCalledWith(
			expect.objectContaining({ request: event.request, locals: event.locals }),
			expect.any(Object)
		);
	});
});
