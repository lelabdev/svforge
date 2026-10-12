import { db } from '#lib/server/db/index.js';
import { user, account } from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';

/**
 * Admin user creation — the ONLY supported way to create a credential user
 * from the dashboard (#292).
 *
 * WHY NOT `auth.api.signUpEmail`?
 * -------------------------------
 * `signUpEmail` sets a session cookie for the newly created user, which would
 * silently replace the current admin's session. Admin-created users must not
 * hijack the admin's browser session.
 *
 * WHY NOT the official admin plugin (`auth.api.createUser`, #319 audit)?
 * ---------------------------------------------------------------------
 * Verified against better-auth 1.7.3 sources: the admin plugin's
 * `/admin/create-user` is session-safe (it creates NO session for the new
 * user) and reproduces the same credential contract (`linkAccount` with
 * `providerId: 'credential'`, `accountId: user.id`). BUT adopting it pulls
 * the whole admin permission model into the scaffold: the plugin schema adds
 * `role`/`banned`/`banReason`/`banExpires` columns to `user`, permission
 * checks assume a role system. The dashboard now HAS an explicit role model
 * (#318: persisted `user.role`, granted only by bootstrapFirstAdmin), but
 * adopting the plugin remains a product decision (see
 * docs/better-auth-upgrades.md), not a dependency upgrade — so the isolated
 * adapter below stays.
 *
 * Instead we reproduce the exact credential contract of Better Auth,
 * RE-VERIFIED against the 1.7.x package sources (`api/routes/sign-up.mjs`):
 *
 *   - `email` is stored LOWERCASED — `findUserByEmail` (used by sign-in)
 *     always looks up `email.toLowerCase()`, so a mixed-case stored email can
 *     never be logged into.
 *   - `providerId` is `'credential'` and `accountId` is the USER id (NOT the
 *     email) — that is what `linkAccount` does in the real sign-up flow
 *     (unchanged between 1.4.21 and 1.7.3).
 *   - the password is hashed with the same scrypt `hashPassword` that
 *     Better Auth's default `password.hash` uses (`better-auth/crypto`,
 *     exports unchanged in 1.7.x), so `signInEmail` can verify it.
 *   - `emailVerified` defaults to `false`, exactly like sign-up.
 *
 * The user row and the credential account row are created in ONE transaction:
 * a user without its credential account could never sign in (orphan row), so
 * the two inserts must be atomic.
 *
 * This helper NEVER creates a session — the admin's own session is untouched.
 * The behavioral contract (created user CAN sign in via the real Better Auth
 * sign-in endpoint) is proven by admin-users.test.ts, which runs against the
 * real installed better-auth version in the scaffold gate.
 */

export class DuplicateEmailError extends Error {
	constructor() {
		super('email already exists');
		this.name = 'DuplicateEmailError';
	}
}

export interface CreateCredentialUserInput {
	name: string;
	email: string;
	password: string;
}

export async function createCredentialUser({
	name,
	email,
	password
}: CreateCredentialUserInput): Promise<{ id: string; email: string }> {
	const normalizedEmail = email.toLowerCase();

	// Duplicate check — case-insensitive, matching Better Auth's lookup.
	const [existing] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, normalizedEmail))
		.limit(1);
	if (existing) {
		throw new DuplicateEmailError();
	}

	const hashedPassword = await hashPassword(password);
	const userId = crypto.randomUUID();

	try {
		await db.transaction(async (tx) => {
			await tx.insert(user).values({
				id: userId,
				name,
				email: normalizedEmail,
				emailVerified: false,
				// Defense in depth (#318): admin-created users are ALWAYS plain
				// users — the persisted role never depends on the column default.
				role: 'user',
				createdAt: new Date(),
				updatedAt: new Date()
			});

			await tx.insert(account).values({
				id: crypto.randomUUID(),
				userId,
				// Contract: accountId === userId for credential accounts (#292).
				accountId: userId,
				providerId: 'credential',
				password: hashedPassword,
				createdAt: new Date(),
				updatedAt: new Date()
			});
		});
	} catch (error) {
		if (error instanceof DuplicateEmailError) throw error;
		// A race on the unique email index or any other DB failure must roll
		// back BOTH rows — the transaction guarantees the user is not orphaned.
		// The cause stays server-side; callers expose only generic messages.
		throw new Error('failed to create user', { cause: error });
	}

	return { id: userId, email: normalizedEmail };
}
