import { describe, it, expect, vi } from 'vitest';

// Mock the server modules so the test can run without a real database.
vi.mock('#lib/server/db/index.js', () => ({
	db: {
		select: vi.fn(() => ({ from: vi.fn(() => ({ orderBy: vi.fn(() => []) })) })),
		insert: vi.fn(() => ({ values: vi.fn() })),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
		delete: vi.fn(() => ({ where: vi.fn() }))
	}
}));

vi.mock('#lib/server/admin.js', () => ({
	isAdmin: vi.fn()
}));

/**
 * Tests for the (app) layout auth guard.
 * Anonymous users must be redirected to /login.
 */
describe('(app) layout auth guard', () => {
	it('redirects anonymous users to /login', async () => {
		const { isAdmin } = await import('#lib/server/admin.js');
		vi.mocked(isAdmin).mockResolvedValue(false);

		// Simulate an unauthenticated request
		const load = (await import('./+layout.server')).load;

		await expect(
			load({
				locals: { user: null, session: null },
				url: new URL('http://localhost/dashboard')
			} as any)
		).rejects.toThrow();

		try {
			await load({
				locals: { user: null, session: null },
				url: new URL('http://localhost/dashboard')
			} as any);
		} catch (e) {
			const err = e as { status: number; location: string };
			expect(err.status).toBe(302);
			expect(err.location).toMatch(/\/login/);
		}
	});

	it('returns user data for authenticated users', async () => {
		const { isAdmin } = await import('#lib/server/admin.js');
		vi.mocked(isAdmin).mockResolvedValue(true);

		const load = (await import('./+layout.server')).load;
		const result = await load({
			locals: {
				user: { id: 'u1', name: 'Admin', email: 'admin@test.com' },
				session: { id: 's1', userId: 'u1' }
			},
			url: new URL('http://localhost/dashboard')
		} as any);

		expect(result).toHaveProperty('user');
		expect(result).toHaveProperty('session');
	});
});
