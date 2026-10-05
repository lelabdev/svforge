import { beforeEach, describe, expect, it, vi, beforeAll, afterAll } from 'vitest';

// $app/env/private is a SvelteKit virtual module — not resolvable by the
// bare vitest environment. Integration suites NEVER read the application
// .env (#312): the database comes exclusively from TEST_DATABASE_URL, a
// dedicated test database enforced by resolveTestDbUrl().
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
import { adminExists, bootstrapFirstAdmin, AdminExistsError } from './first-admin';
import { isAdmin } from './admin';
import { createCredentialUser } from './admin-users';
import { db } from '$lib/server/db';
import { user, account } from './db/schema';
import { eq, inArray, like, notLike, sql } from 'drizzle-orm';
import { runEmailDomain } from './test-db';

const PASSWORD = 'password123';
const RUN = crypto.randomUUID().slice(0, 8);
// PER-RUN domain (#312 review): cleanup and foreign-row checks never match
// another concurrently running process's identities.
const RUN_DOMAIN = runEmailDomain(RUN);
const email = (tag: string) => `${tag}-${RUN}@${RUN_DOMAIN}`;

/**
 * Refuses to run against a database holding rows this run did NOT create
 * (#312). The bootstrap requires an empty administrator table; instead of
 * silently demoting or deleting pre-existing identities, the suite fails
 * loudly and asks for a dedicated test database.
 */
async function assertNoForeignUsers(): Promise<void> {
	const [foreign] = await db
		.select({ count: sql<number>`count(*)::int`, roles: sql<string>`coalesce(string_agg(${user.role}, ','), '')` })
		.from(user)
		.where(notLike(user.email, `%@${RUN_DOMAIN}`));
	if (foreign.count > 0) {
		throw new Error(
			`[svelteforge:test-db] the dedicated test database is not empty (${foreign.count} foreign row(s), roles: ${foreign.roles}). ` +
				'bootstrapFirstAdmin tests require an empty database — point TEST_DATABASE_URL at an isolated test database. ' +
				'The suite never demotes or deletes rows it did not create (#312).'
		);
	}
}

/**
 * Makes "no administrator exists" deterministic WITHOUT touching other
 * identities: only this run's rows (the @sf-test.example marker) are deleted;
 * FK cascades wipe their account + session rows (#312).
 */
async function resetRunState(): Promise<void> {
	await db.delete(user).where(like(user.email, `%@${RUN_DOMAIN}`));
}

function signInAs(email: string, password: string): Promise<Response> {
	return auth.handler(
		new Request('http://localhost:5173/api/auth/sign-in/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
			body: JSON.stringify({ email, password })
		})
	);
}

describe('first-admin bootstrap (#318)', () => {
	/**
	 * First-admin bootstrap + explicit role authorization (#318).
	 *
	 * Runs against the DEDICATED test database (#312). The invariant under
	 * test: the admin role is EXPLICIT, granted only by bootstrapFirstAdmin,
	 * and concurrent bootstraps can never create two administrators.
	 */
	beforeAll(assertNoForeignUsers);

	beforeEach(resetRunState);

	afterAll(resetRunState);

	it('bootstraps the first admin with the explicit admin role and a working credential', async () => {
		const adminEmail = email('first');
		const created = await bootstrapFirstAdmin(db, {
			name: 'Root',
			email: adminEmail,
			password: PASSWORD
		});

		const [identity] = await db
			.select({ id: user.id, role: user.role, disabled: user.disabled })
			.from(user)
			.where(eq(user.id, created.id))
			.limit(1);
		expect(identity.role).toBe('admin');
		expect(identity.disabled).toBe(false);

		// Same credential contract as admin-created users: the admin can sign in
		// through the REAL Better Auth endpoint.
		const response = await signInAs(adminEmail, PASSWORD);
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toContain('better-auth.session_token');

		const [acc] = await db.select().from(account).where(eq(account.userId, created.id)).limit(1);
		expect(acc).toBeDefined();
		expect(acc.providerId).toBe('credential');
		expect(acc.accountId).toBe(created.id);

		expect(await adminExists(db)).toBe(true);
		expect(await isAdmin(created.id)).toBe(true);
	});

	it('refuses a second bootstrap once an administrator exists (AdminExistsError)', async () => {
		const adminEmail = email('exists');
		await bootstrapFirstAdmin(db, { name: 'Root', email: adminEmail, password: PASSWORD });

		await expect(
			bootstrapFirstAdmin(db, { name: 'Rival', email: email('rival'), password: PASSWORD })
		).rejects.toBeInstanceOf(AdminExistsError);

		const admins = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin'));
		expect(admins).toHaveLength(1);
		expect(await isAdmin(admins[0].id)).toBe(true);
	});

	it('two CONCURRENT bootstraps create exactly ONE administrator (atomicity)', async () => {
		const emailA = email('race-a');
		const emailB = email('race-b');
		const results = await Promise.allSettled([
			bootstrapFirstAdmin(db, { name: 'Race A', email: emailA, password: PASSWORD }),
			bootstrapFirstAdmin(db, { name: 'Race B', email: emailB, password: PASSWORD })
		]);

		const fulfilled = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r) => r.status === 'rejected');
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AdminExistsError);

		// Exactly one of the two identities exists, and it is THE administrator —
		// the loser must not have left a partially-created user behind.
		const created = await db
			.select({ email: user.email, role: user.role })
			.from(user)
			.where(inArray(user.email, [emailA, emailB]));
		expect(created).toHaveLength(1);
		expect(created[0].role).toBe('admin');

		const admins = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin'));
		expect(admins).toHaveLength(1);
	});
});

describe('explicit role authorization (#318)', () => {
	beforeEach(resetRunState);

	afterAll(resetRunState);

	it('createdAt ordering NEVER decides permissions — the older user with role user is not admin', async () => {
		// Created FIRST (oldest row) — under the removed first-user-is-admin
		// pattern this row would have been the administrator.
		const older = await createCredentialUser({
			name: 'Old User',
			email: email('older'),
			password: PASSWORD
		});
		const [olderRow] = await db
			.select({ createdAt: user.createdAt })
			.from(user)
			.where(eq(user.id, older.id));

		const adminEmail = email('younger-admin');
		const admin = await bootstrapFirstAdmin(db, {
			name: 'Young Admin',
			email: adminEmail,
			password: PASSWORD
		});
		const [adminRow] = await db
			.select({ createdAt: user.createdAt })
			.from(user)
			.where(eq(user.id, admin.id));
		expect(adminRow.createdAt.getTime()).toBeGreaterThanOrEqual(olderRow.createdAt.getTime());

		expect(await isAdmin(older.id)).toBe(false);
		expect(await isAdmin(admin.id)).toBe(true);
	});

	it('a disabled administrator loses authorization until re-enabled', async () => {
		const admin = await bootstrapFirstAdmin(db, {
			name: 'Off',
			email: email('disabled'),
			password: PASSWORD
		});
		expect(await isAdmin(admin.id)).toBe(true);

		await db.update(user).set({ disabled: true }).where(eq(user.id, admin.id));
		expect(await isAdmin(admin.id)).toBe(false);

		await db.update(user).set({ disabled: false }).where(eq(user.id, admin.id));
		expect(await isAdmin(admin.id)).toBe(true);
	});

	it('an unknown or plain user id is never authorized', async () => {
		const plain = await createCredentialUser({
			name: 'Plain',
			email: email('plain'),
			password: PASSWORD
		});
		expect(await isAdmin(plain.id)).toBe(false);
		expect(await isAdmin('does-not-exist')).toBe(false);
	});
});
