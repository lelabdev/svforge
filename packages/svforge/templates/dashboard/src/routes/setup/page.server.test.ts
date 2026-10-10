import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bootstrapFirstAdmin, AdminExistsError } = vi.hoisted(() => {
	class AdminExistsError extends Error {}
	return { bootstrapFirstAdmin: vi.fn(), AdminExistsError };
});

vi.mock('$app/env', () => ({ dev: true }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/first-admin', () => ({
	adminExists: vi.fn(),
	bootstrapFirstAdmin,
	AdminExistsError
}));

describe('setup action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function submit(fields: Record<string, string>) {
		const { actions } = await import('./+page.server');
		const formData = new FormData();
		for (const [name, value] of Object.entries(fields)) formData.set(name, value);
		return actions.default({ request: { formData: async () => formData } } as any);
	}

	it('preserves safe fields on validation errors and never echoes the password', async () => {
		const result = await submit({ name: 'Jean Dupont', email: 'not-an-email', password: 'private-password' });

		expect(result).toMatchObject({
			status: 400,
			data: { code: 'invalid_input', name: 'Jean Dupont', email: 'not-an-email' }
		});
		expect(JSON.stringify(result)).not.toContain('private-password');
		expect(bootstrapFirstAdmin).not.toHaveBeenCalled();
	});

	it('returns a stable generic code when bootstrap fails without exposing private details', async () => {
		bootstrapFirstAdmin.mockRejectedValueOnce(new Error('database internals'));
		const result = await submit({
			name: 'Jean Dupont',
			email: 'jean@example.com',
			password: 'private-password'
		});

		expect(result).toMatchObject({
			status: 400,
			data: { code: 'create_failed', name: 'Jean Dupont', email: 'jean@example.com' }
		});
		expect(JSON.stringify(result)).not.toContain('private-password');
		expect(JSON.stringify(result)).not.toContain('database internals');
	});

	it('reports an existing administrator using a stable error code', async () => {
		bootstrapFirstAdmin.mockRejectedValueOnce(new AdminExistsError());
		const result = await submit({
			name: 'Jean Dupont',
			email: 'jean@example.com',
			password: 'private-password'
		});

		expect(result).toMatchObject({
			status: 400,
			data: { code: 'admin_exists', name: 'Jean Dupont', email: 'jean@example.com' }
		});
		expect(JSON.stringify(result)).not.toContain('private-password');
	});
});
