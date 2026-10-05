import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// $app/env/private is a SvelteKit virtual module — not resolvable by the
// bare vitest environment. Integration suites NEVER read the application
// .env (#312): the database comes exclusively from TEST_DATABASE_URL, which
// must point at a dedicated test database — resolveTestDbUrl() refuses
// anything else before a single row is touched.
vi.mock('$app/env/private', async () => {
	const { resolveTestDbUrl } = await import('./test-db');
	return {
		DATABASE_URL: resolveTestDbUrl(),
		ORIGIN: 'http://localhost:5173',
		BETTER_AUTH_SECRET: 'sforge-integration-secret-0123456789abcdef',
		SIGNUP_MODE: 'closed'
	};
});

// The real auth instance wires sveltekitCookies(getRequestEvent); outside a
// request the event is simply absent, exactly like auth.test.ts (#337).
vi.mock('$app/server', () => ({ getRequestEvent: () => undefined }));

import { createCredentialUser, DuplicateEmailError } from './admin-users';
import { verifyPassword } from 'better-auth/crypto';
import { auth } from './auth';
import { db } from '$lib/server/db';
import { user, account, session } from '$lib/server/db/schema';
import { eq, like, notLike, sql } from 'drizzle-orm';
import { runEmailDomain } from './test-db';

/**
 * Better Auth credential lifecycle (#292) — runs inside the dashboard
 * scaffold against a DEDICATED PostgreSQL test database (the CI profile
 * performs a drizzle push before `bun run test`).
 *
 * Isolation contract (#312):
 * - the database comes from TEST_DATABASE_URL only — never .env, never the
 *   application DATABASE_URL;
 * - every identity created here is namespaced with the per-run
 *   `@sf-test.example` marker and ONLY those rows are ever deleted;
 * - rows the run did not create must survive unchanged (asserted in
 *   afterAll).
 *
 * Proves the admin-created user matches the exact credential contract that
 * `signInEmail` expects: lowercase email lookup, `providerId: 'credential'`,
 * `accountId === userId`, scrypt hash verifiable by Better Auth, atomic
 * user+account creation, and NO session side-effect (the admin's own session
 * must survive the creation).
 */
const RUN = crypto.randomUUID().slice(0, 8);
// Cleanup predicates are built from the PER-RUN domain, never from the bare
// test domain: a second concurrently running process must never have its
// identities deleted by this suite's cleanup (#312 review).
const RUN_DOMAIN = runEmailDomain(RUN);
const runEmail = (local: string) => `${local}@${RUN_DOMAIN}`;
const PASSWORD = 'password123';

/** Deletes ONLY the CURRENT run's identities — FK cascades wipe their account + session rows. */
async function cleanupRunUsers() {
	await db.delete(user).where(like(user.email, `%@${RUN_DOMAIN}`));
}

/** Rows this run did NOT create (incl. other runs' identities) — must survive byte-for-byte. */
const foreignRows = () =>
	db
		.select({
			count: sql<number>`count(*)::int`,
			ids: sql<string>`coalesce(string_agg(${user.id}::text, ',' ORDER BY ${user.id}), '')`
		})
		.from(user)
		.where(notLike(user.email, `%@${RUN_DOMAIN}`));

let foreignBefore: { count: number; ids: string };
// An identity belonging to a SECOND concurrent run (same test domain, other
// run marker): the cleanup above must NEVER delete it.
const OTHER_RUN = crypto.randomUUID().slice(0, 8);
const otherRunEmail = `other-run@${runEmailDomain(OTHER_RUN)}`;
let otherRunId: string | undefined;

describe('admin-created credential users (#292)', () => {
	beforeAll(async () => {
		// Seed the second-run identity BEFORE the foreign snapshot: it is
		// foreign data this suite must leave untouched.
		[otherRunId] = (
			await db
				.insert(user)
				.values({ id: crypto.randomUUID(), name: 'Other Run', email: otherRunEmail })
				.returning({ id: user.id })
		).map((r) => r.id);
		[foreignBefore] = await foreignRows();
		// Seed a regular user (admin-created users are ALWAYS role 'user' —
		// the admin role is granted only by bootstrapFirstAdmin, #318).
		await createCredentialUser({ name: 'Admin', email: runEmail('admin'), password: PASSWORD });
	});

	afterAll(async () => {
		await cleanupRunUsers();
		// The second-run identity SURVIVED our cleanup — asserted while it is
		// still present, then removed explicitly by id (our own probe, never
		// through the run-domain predicate).
		const [survivor] = await db.select({ id: user.id }).from(user).where(eq(user.email, otherRunEmail));
		expect(survivor?.id).toBe(otherRunId);
		// Pre-existing data survived the run untouched (#312) — snapshot taken
		// BEFORE the probe's own id-scoped removal.
		const [foreignAfter] = await foreignRows();
		expect(foreignAfter.count).toBe(foreignBefore.count);
		expect(foreignAfter.ids).toBe(foreignBefore.ids);
		if (otherRunId) await db.delete(user).where(eq(user.id, otherRunId));
	});

	/** Signs in through the REAL Better Auth endpoint (same pattern as auth.test.ts #337). */
	function signInAs(email: string, password: string): Promise<Response> {
		const origin = 'http://localhost:5173';
		return auth.handler(
			new Request(`${origin}/api/auth/sign-in/email`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin },
				body: JSON.stringify({ email, password })
			})
		);
	}

	it('admin A creates B without losing their own session; B can sign in (#319)', async () => {
		// A (admin) signs in and owns a live session.
		const adminResponse = await signInAs(runEmail('admin'), PASSWORD);
		expect(adminResponse.status).toBe(200);
		const adminSessionCookie = adminResponse.headers.get('set-cookie');
		expect(adminSessionCookie).toContain('better-auth.session_token');

		const sessionsWhenAdminActive = await db.select({ id: session.id }).from(session);

		// A creates B — the creation must not create, drop, or replace any session.
		const created = await createCredentialUser({ name: 'Ivy', email: runEmail('ivy'), password: PASSWORD });
		const sessionsAfterCreate = await db.select({ id: session.id }).from(session);
		expect(sessionsAfterCreate).toHaveLength(sessionsWhenAdminActive.length);

		// B signs in with the real Better Auth credential flow (hash verified
		// by signInEmail against the account row the helper created).
		const ivyResponse = await signInAs(runEmail('ivy'), PASSWORD);
		expect(ivyResponse.status).toBe(200);
		expect(ivyResponse.headers.get('set-cookie')).toContain('better-auth.session_token');
		const body = (await ivyResponse.json()) as { user?: { id?: string; email?: string } };
		expect(body.user?.id).toBe(created.id);
		expect(body.user?.email).toBe(runEmail('ivy'));

		// B's session exists in the DB and belongs to the created user id.
		const graceSessions = await db.select({ id: session.id, userId: session.userId }).from(session).where(eq(session.userId, created.id));
		expect(graceSessions).toHaveLength(1);
	});

	it('rejects a wrong password through the real sign-in endpoint (#319)', async () => {
		await createCredentialUser({ name: 'Heidi', email: runEmail('heidi'), password: PASSWORD });
		const response = await signInAs(runEmail('heidi'), 'wrong-password-123');
		expect(response.status).toBe(401);
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	it('stores the email lowercased exactly like Better Auth sign-up (#292)', async () => {
		await createCredentialUser({ name: 'Bob', email: `BOB@${RUN.toUpperCase()}.SF-TEST.EXAMPLE`, password: PASSWORD });

		const [byLowerCase] = await db.select({ id: user.id }).from(user).where(eq(user.email, runEmail('bob'))).limit(1);
		expect(byLowerCase).toBeDefined();

		// Mixed case never matches: signInEmail looks up email.toLowerCase(),
		// so a stored mixed-case email could never be logged into.
		const [byMixedCase] = await db.select({ id: user.id }).from(user).where(eq(user.email, `BOB@${RUN.toUpperCase()}.SF-TEST.EXAMPLE`));
		expect(byMixedCase).toBeUndefined();
	});

	it('creates the credential account per the BA contract: providerId credential, accountId = userId (#292)', async () => {
		const created = await createCredentialUser({ name: 'Carol', email: runEmail('carol'), password: PASSWORD });

		const [acc] = await db.select().from(account).where(eq(account.userId, created.id)).limit(1);
		expect(acc).toBeDefined();
		expect(acc.providerId).toBe('credential');
		expect(acc.accountId).toBe(created.id); // NOT the email — sign-up contract
	});

	it('hashes the password so Better Auth verifyPassword accepts it (#292)', async () => {
		const created = await createCredentialUser({ name: 'Dan', email: runEmail('dan'), password: PASSWORD });

		const [acc] = await db.select().from(account).where(eq(account.userId, created.id)).limit(1);
		expect(acc).toBeDefined();
		// password is nullable in the schema — the credential contract guarantees
		// it is set for credential accounts.
		const hash = acc!.password!;
		const ok = await verifyPassword({ hash, password: PASSWORD });
		expect(ok).toBe(true);
		const ko = await verifyPassword({ hash: acc!.password!, password: 'wrong-password' });
		expect(ko).toBe(false);
	});

	it('duplicate email in ANY case is rejected and creates no second user (#292)', async () => {
		await expect(
			createCredentialUser({ name: 'Bob Clone', email: `BOB@${RUN.toUpperCase()}.SF-TEST.EXAMPLE`, password: PASSWORD })
		).rejects.toBeInstanceOf(DuplicateEmailError);

		const count = await db.select({ id: user.id }).from(user).where(eq(user.email, runEmail('bob')));
		expect(count).toHaveLength(1);
	});

	it('admin-created users NEVER hold the admin role (#318)', async () => {
		await createCredentialUser({ name: 'Plain', email: runEmail('plain'), password: PASSWORD });
		const [identity] = await db.select({ role: user.role }).from(user).where(eq(user.email, runEmail('plain'))).limit(1);
		expect(identity.role).toBe('user');
	});

	it('creates the user and account atomically — a failed insert leaves NO orphan user (#292)', async () => {
		// Race two identical creates: the pre-check may pass for both, so the
		// second insert hits the unique email index inside the transaction and
		// must roll back BOTH rows — never a user without its account.
		const results = await Promise.allSettled([
			createCredentialUser({ name: 'Eve', email: runEmail('eve'), password: PASSWORD }),
			createCredentialUser({ name: 'Eve Clone', email: runEmail('eve'), password: PASSWORD })
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

		const eves = await db.select({ id: user.id }).from(user).where(eq(user.email, runEmail('eve')));
		expect(eves).toHaveLength(1);
		const evesAccounts = await db.select().from(account).where(eq(account.userId, eves[0].id));
		expect(evesAccounts).toHaveLength(1);
	});

	it('never creates a session — the admin session is untouched (#292)', async () => {
		const sessionsBefore = await db.select({ id: session.id }).from(session);

		await createCredentialUser({ name: 'Frank', email: runEmail('frank'), password: PASSWORD });

		const sessionsAfter = await db.select({ id: session.id }).from(session);
		expect(sessionsAfter).toHaveLength(sessionsBefore.length);
	});

	it('the creation helper uses a DB transaction (structural atomicity guard) (#292)', async () => {
		const txSpy = vi.spyOn(db, 'transaction');
		await createCredentialUser({ name: 'Grace', email: runEmail('grace'), password: PASSWORD });
		expect(txSpy).toHaveBeenCalled();
		txSpy.mockRestore();
	});

	it('cleanup NEVER deletes identities from another concurrent run (#312 review)', async () => {
		// otherRunEmail belongs to a DIFFERENT run marker (seeded in beforeAll,
		// before the foreign snapshot). The old domain-wide cleanup deleted it;
		// the per-run predicate must leave it standing.
		await cleanupRunUsers();
		const [survivor] = await db.select({ id: user.id }).from(user).where(eq(user.email, otherRunEmail));
		expect(survivor?.id).toBe(otherRunId);
	});
});
