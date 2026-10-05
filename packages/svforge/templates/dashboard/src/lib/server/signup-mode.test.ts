import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Public sign-up policy — the three documented modes (#318).
 *
 * Behavioral, against the REAL Better Auth endpoint: each mode gets a fresh
 * auth instance built from a SIGNUP_MODE override (the mode is resolved at
 * module init, exactly like in the app). The shared database connection is
 * frozen across re-imports so mode switching cannot leak pools.
 */

const state = vi.hoisted(() => ({ overrides: {} as Record<string, string | undefined> }));

vi.mock('$app/env/private', async () => {
	// #312 — no .env read: the database comes exclusively from the dedicated
	// TEST_DATABASE_URL; the other variables are hermetic literals.
	const { resolveTestDbUrl } = await import('./test-db');
	const value = (key: string) => {
		const override = state.overrides[key];
		if (override !== undefined) return override;
		if (key === 'DATABASE_URL') return resolveTestDbUrl();
		if (key === 'ORIGIN') return 'http://localhost:5173';
		if (key === 'BETTER_AUTH_SECRET') return 'sforge-integration-secret-0123456789abcdef';
		return undefined;
	};
	// Getters, not values: the mock factory result is cached across
	// vi.resetModules() re-imports, but auth.ts re-reads env.SIGNUP_MODE at
	// every module init — the getter makes each init see the CURRENT mode.
	return {
		get DATABASE_URL() {
			return value('DATABASE_URL');
		},
		get ORIGIN() {
			return value('ORIGIN');
		},
		get BETTER_AUTH_SECRET() {
			return value('BETTER_AUTH_SECRET');
		},
		get SIGNUP_MODE() {
			return state.overrides.SIGNUP_MODE;
		}
	};
});

vi.mock('$app/server', () => ({ getRequestEvent: () => undefined }));

// One real db instance, frozen for every module graph below (mode switching
// re-evaluates ./auth and ./invitations, which must keep using THIS pool).
const dbModule = await import('$lib/server/db');
const envModule = await import('$app/env/private');
vi.doMock('$lib/server/db', () => ({ db: dbModule.db, closeDb: dbModule.closeDb }));

import { createInvitation, findValidInvitation } from './invitations';
import { db } from '$lib/server/db';
import { user } from './db/schema';
import { eq, like } from 'drizzle-orm';
import { runEmailDomain } from './test-db';

afterAll(function cleanupRunUsers() {
	// Deletes ONLY this suite's CURRENT-RUN identities — the predicate is
	// built from the per-run domain, so a second concurrently running
	// process is never touched; FK cascades wipe their accounts/sessions
	// (#312 review).
	return db.delete(user).where(like(user.email, `%@${RUN_DOMAIN}`));
});

const ORIGIN = envModule.ORIGIN ?? 'http://localhost:5173';
const RUN_DOMAIN = runEmailDomain(crypto.randomUUID().slice(0, 8));
const uniqueEmail = (tag: string) => `signup-${tag}-${crypto.randomUUID()}@${RUN_DOMAIN}`;

/** Re-imports ./auth with SIGNUP_MODE resolved from the given raw value. */
async function authWithMode(mode?: string) {
	state.overrides.SIGNUP_MODE = mode;
	vi.resetModules();
	vi.doMock('$lib/server/db', () => ({ db: dbModule.db, closeDb: dbModule.closeDb }));
	const { auth } = await import('./auth');
	return auth;
}

function postSignUp(
	auth: Awaited<ReturnType<typeof authWithMode>>,
	body: Record<string, unknown>
): Promise<Response> {
	return auth.handler(
		new Request(`${ORIGIN}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: ORIGIN },
			body: JSON.stringify(body)
		})
	);
}

async function userRow(email: string) {
	const [row] = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return row ?? null;
}

describe('sign-up mode: closed (DEFAULT — fresh deployments)', () => {
	it('missing SIGNUP_MODE closes the real sign-up endpoint and creates NO user', async () => {
		const email = uniqueEmail('closed-default');
		const auth = await authWithMode(undefined);

		const response = await postSignUp(auth, { name: 'Attacker', email, password: 'password123' });
		expect(response.status).toBe(400);
		const body = (await response.json()) as { code?: string };
		expect(body.code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(await userRow(email)).toBeNull();
	});

	it('an explicit closed mode behaves identically', async () => {
		const email = uniqueEmail('closed-explicit');
		const auth = await authWithMode('closed');

		const response = await postSignUp(auth, { name: 'Attacker', email, password: 'password123' });
		expect(response.status).toBe(400);
		expect(await userRow(email)).toBeNull();
	});

	it('an UNKNOWN mode value fails closed', async () => {
		const email = uniqueEmail('closed-bogus');
		const auth = await authWithMode('open-to-everyone-please');

		const response = await postSignUp(auth, { name: 'Attacker', email, password: 'password123' });
		expect(response.status).toBe(400);
		expect(await userRow(email)).toBeNull();
	});
});

describe('sign-up mode: self-service', () => {
	it('anyone may register — as role user, NEVER admin, even with a role in the body', async () => {
		const email = uniqueEmail('self');
		const auth = await authWithMode('self-service');

		const response = await postSignUp(auth, {
			name: 'Self Registered',
			email,
			password: 'password123',
			// Client-side attempts to grant the role are ignored: `role` is not
			// part of the Better Auth user input model (#318).
			role: 'admin'
		});
		expect(response.status).toBe(200);

		const row = await userRow(email);
		expect(row).not.toBeNull();
		expect(row!.role).toBe('user');
	});
});

describe('sign-up mode: invite-only', () => {
	it('rejects sign-up without a valid invitation — server-side, no user created', async () => {
		const email = uniqueEmail('uninvited');
		const auth = await authWithMode('invite-only');

		const response = await postSignUp(auth, { name: 'Uninvited', email, password: 'password123' });
		expect(response.status).toBe(403);
		expect(await userRow(email)).toBeNull();
	});

	it('an invited email may register exactly once — as role user', async () => {
		const email = uniqueEmail('invited');
		const auth = await authWithMode('invite-only');
		await createInvitation({ email });

		const response = await postSignUp(auth, { name: 'Invited', email, password: 'password123' });
		expect(response.status).toBe(200);

		const row = await userRow(email);
		expect(row).not.toBeNull();
		expect(row!.role).toBe('user');

		// The invitation was consumed: no longer valid for another attempt.
		expect(await findValidInvitation(email)).toBeNull();
	});

	it('an expired invitation is worthless', async () => {
		const email = uniqueEmail('expired');
		const auth = await authWithMode('invite-only');
		await createInvitation({ email, expiresInDays: -1 });

		const response = await postSignUp(auth, { name: 'Late', email, password: 'password123' });
		expect(response.status).toBe(403);
		expect(await userRow(email)).toBeNull();
	});
});
