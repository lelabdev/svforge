import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = {
	select: vi.fn(() => query),
	from: vi.fn(() => query),
	where: vi.fn(() => query),
	limit: vi.fn<() => any[]>()
};

vi.mock('$lib/server/db', () => ({ db: query }));
vi.mock('$lib/server/db/schema', () => ({ user: { email: 'email', disabled: 'disabled' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('$lib/server/auth', () => ({ auth: { api: { signInEmail: vi.fn() } } }));

describe('login action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects a disabled identity without attempting to sign in', async () => {
		const { auth } = await import('$lib/server/auth');
		query.limit.mockReturnValueOnce([{ disabled: true }]);

		const { actions } = await import('./+page.server');
		const formData = new FormData();
		formData.set('email', 'disabled@example.com');
		formData.set('password', 'valid-password');
		const result = await actions.default({
			request: { formData: async () => formData, headers: new Headers() }
		} as any);

		expect(result).toMatchObject({ status: 401, data: { code: 'invalid_credentials', email: 'disabled@example.com' } });
		expect(result).not.toHaveProperty('data.password');
		expect(auth.api.signInEmail).not.toHaveBeenCalled();
	});

	it('returns the same generic code for bad credentials without echoing the password', async () => {
		const { auth } = await import('$lib/server/auth');
		vi.mocked(auth.api.signInEmail).mockRejectedValueOnce(new Error('private detail'));
		query.limit.mockReturnValueOnce([]);

		const { actions } = await import('./+page.server');
		const formData = new FormData();
		formData.set('email', 'person@example.com');
		formData.set('password', 'secret-password');
		const result = await actions.default({
			request: { formData: async () => formData, headers: new Headers() }
		} as any);

		expect(result).toMatchObject({ status: 401, data: { code: 'invalid_credentials', email: 'person@example.com' } });
		expect(result).not.toHaveProperty('data.password');
	});
});
