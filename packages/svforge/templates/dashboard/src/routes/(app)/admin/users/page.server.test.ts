import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the server modules
vi.mock('#lib/server/db/index.js', () => {
	const mockQuery = {
		select: vi.fn(() => mockQuery),
		from: vi.fn(() => mockQuery),
		where: vi.fn(() => mockQuery),
		limit: vi.fn(() => []),
		orderBy: vi.fn(() => []),
		insert: vi.fn(() => ({ values: vi.fn() })),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
		delete: vi.fn(() => ({ where: vi.fn() })),
		transaction: vi.fn(async (cb: Function) => cb({
			delete: vi.fn(() => ({ where: vi.fn() })),
			update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }))
		}))
	};
	return { db: mockQuery };
});

vi.mock('#lib/server/db/schema.js', () => ({
	user: { id: 'id', email: 'email', name: 'name', disabled: 'disabled' },
	account: { userId: 'userId' },
	session: { userId: 'userId' }
}));

vi.mock('#lib/server/admin.js', () => ({
	isAdmin: vi.fn()
}));

vi.mock('better-auth/crypto', () => ({
	hashPassword: vi.fn(() => 'hashed-pw')
}));

vi.mock('drizzle-orm', () => ({
	desc: vi.fn(),
	eq: vi.fn()
}));

/**
 * Tests for the admin users page server — authorization, validation,
 * and user management actions.
 */
describe('admin users +page.server — authorization', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects non-admin users with 403', async () => {
		const { isAdmin } = await import('#lib/server/admin.js');
		vi.mocked(isAdmin).mockResolvedValue(false);

		const mod = await import('./+page.server');
		await expect(
			mod.actions.create({
				locals: { user: { id: 'nonadmin' } },
				request: new Request('http://test', { method: 'POST' })
			} as any)
		).rejects.toThrow();
	});

	it('rejects anonymous users with 401', async () => {
		const mod = await import('./+page.server');
		await expect(
			mod.actions.update({
				locals: { user: null },
				request: new Request('http://test', { method: 'POST' })
			} as any)
		).rejects.toThrow();
	});
});

describe('admin users +page.server — validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 400 for missing fields on create', async () => {
		const { isAdmin } = await import('#lib/server/admin.js');
		vi.mocked(isAdmin).mockResolvedValue(true);

		const mod = await import('./+page.server');
		const formData = new FormData();
		// Missing name and password
		formData.set('email', 'test@test.com');

		const result = await mod.actions.create({
			locals: { user: { id: 'admin1' } },
			request: { formData: async () => formData }
		} as any);

		expect((result as { status: number }).status).toBe(400);
	});
});

describe('admin users +page.server — user management', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('deactivates a user without deleting their identity and revokes every session', async () => {
		const { isAdmin } = await import('#lib/server/admin.js');
		vi.mocked(isAdmin).mockResolvedValue(true);

		const { db } = await import('#lib/server/db/index.js');
		const { user } = await import('#lib/server/db/schema.js');
		const { eq } = await import('drizzle-orm');
		vi.mocked(eq).mockImplementation((column: unknown, value: unknown) => ({ column, value }) as never);
		const updateWhere = vi.fn();
		const setUser = vi.fn(() => ({ where: updateWhere }));
		const updateUser = vi.fn(() => ({ set: setUser }));
		const deleteSession = vi.fn(() => ({ where: vi.fn() }));
		(db.select as any).mockReturnValueOnce({
			from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => [{ id: 'user-1', disabled: false }]) })) }))
		});
		(db.transaction as any).mockImplementationOnce(async (callback: Function) =>
			callback({ delete: deleteSession, update: updateUser })
		);

		const mod = await import('./+page.server');
		const formData = new FormData();
		formData.set('id', 'user-1');
		formData.set('disabled', 'true');
		const result = await mod.actions.toggleStatus({
			locals: { user: { id: 'admin1' } },
			request: { formData: async () => formData }
		} as any);

		expect(result).toMatchObject({ success: true, code: 'deactivated' });
		expect(updateUser).toHaveBeenCalledWith(user);
		expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
		expect(updateWhere).toHaveBeenCalledWith({ column: user.id, value: 'user-1' });
		expect(deleteSession).toHaveBeenCalledTimes(1);
	});

	it('refuses self-deactivation before updating the user or deleting sessions', async () => {
		const { isAdmin } = await import('#lib/server/admin.js');
		vi.mocked(isAdmin).mockResolvedValue(true);

		const { db } = await import('#lib/server/db/index.js');
		const mod = await import('./+page.server');
		const formData = new FormData();
		formData.set('id', 'admin1');
		formData.set('disabled', 'true');
		const result = await mod.actions.toggleStatus({
			locals: { user: { id: 'admin1' } },
			request: { formData: async () => formData }
		} as any);

		expect(result).toMatchObject({ status: 400, data: { code: 'self_deactivate' } });
		expect(db.update).not.toHaveBeenCalled();
		expect(db.delete).not.toHaveBeenCalled();
		expect(db.transaction).not.toHaveBeenCalled();
	});

	it('reactivates a user without revoking sessions', async () => {
		const { isAdmin } = await import('#lib/server/admin.js');
		vi.mocked(isAdmin).mockResolvedValue(true);

		const { db } = await import('#lib/server/db/index.js');
		const deleteSession = vi.fn(() => ({ where: vi.fn() }));
		const updateUser = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }));
		(db.select as any).mockReturnValueOnce({
			from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => [{ id: 'user-1', disabled: true }]) })) }))
		});
		(db.transaction as any).mockImplementationOnce(async (callback: Function) =>
			callback({ delete: deleteSession, update: updateUser })
		);

		const mod = await import('./+page.server');
		const formData = new FormData();
		formData.set('id', 'user-1');
		formData.set('disabled', 'false');
		const result = await mod.actions.toggleStatus({
			locals: { user: { id: 'admin1' } },
			request: { formData: async () => formData }
		} as any);

		expect(result).toMatchObject({ success: true, code: 'reactivated' });
		expect(deleteSession).not.toHaveBeenCalled();
	});

	it('allows admin to toggle verification (success)', async () => {
		const { isAdmin } = await import('#lib/server/admin.js');
		vi.mocked(isAdmin).mockResolvedValue(true);

		const { db } = await import('#lib/server/db/index.js');
		// Mock that user exists
		(db.select as any).mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit: vi.fn(() => []) })),
				orderBy: vi.fn(() => [])
			}))
		});

		const mod = await import('./+page.server');
		const formData = new FormData();
		formData.set('id', 'user-1');
		formData.set('verified', 'false');

		const result = await mod.actions.toggleVerify({
			locals: { user: { id: 'admin1' } },
			request: { formData: async () => formData }
		} as any);

		expect(result).toHaveProperty('success', true);
	});
});
