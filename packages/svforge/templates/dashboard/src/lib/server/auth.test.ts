import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Integration suites NEVER read the application .env (#312): the database
// comes exclusively from TEST_DATABASE_URL, a dedicated test database
// enforced by resolveTestDbUrl().
vi.mock('$app/server', () => ({ getRequestEvent: () => undefined }));

vi.mock('$app/env/private', async () => {
	const { resolveTestDbUrl } = await import('./test-db');
	return {
		DATABASE_URL: resolveTestDbUrl(),
		ORIGIN: 'http://localhost:5173',
		BETTER_AUTH_SECRET: 'sforge-integration-secret-0123456789abcdef',
		SIGNUP_MODE: 'closed'
	};
});

import { auth } from './auth';
import { createCredentialUser } from './admin-users';
import { db } from '$lib/server/db';
import { session, user } from '$lib/server/db/schema';
import { eq, like } from 'drizzle-orm';
import { runEmailDomain } from './test-db';

const PASSWORD = 'password123';
const RUN_DOMAIN = runEmailDomain(crypto.randomUUID().slice(0, 8));
let userId: string;
let email: string;

/** Deletes ONLY the current run's identities — FK cascades wipe their sessions (#312). */
async function cleanupRunUsers() {
	await db.delete(user).where(like(user.email, `%@${RUN_DOMAIN}`));
}

describe('disabled Better Auth identities (#337)', () => {
	beforeEach(async () => {
		// Do not clear the shared scaffold database: Vitest runs this alongside
		// the credential lifecycle suite, so each test owns a unique identity.
		email = `disabled-${crypto.randomUUID()}@${RUN_DOMAIN}`;
		const identity = await createCredentialUser({ name: 'Disabled', email, password: PASSWORD });
		userId = identity.id;
		await db.update(user).set({ disabled: true }).where(eq(user.id, userId));
	});

	afterAll(cleanupRunUsers);

	it('rejects the real email sign-in endpoint before it creates a session', async () => {
		const response = await auth.handler(
			new Request('http://localhost:5173/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
				body: JSON.stringify({ email, password: PASSWORD })
			})
		);

		expect(response.status).toBe(403);
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(await db.select({ id: session.id }).from(session).where(eq(session.userId, userId))).toHaveLength(0);
	});
});
