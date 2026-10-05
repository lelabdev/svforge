import { betterAuth } from 'better-auth/minimal';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import * as env from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user, session, account, verification } from '$lib/server/db/schema';
import { resolveSignupMode, type SignupMode } from '$lib/server/signup-mode';
import { acceptInvitation, findValidInvitation } from '$lib/server/invitations';

/**
 * Public sign-up policy (#318) — resolved once, enforced SERVER-side.
 *
 * Defaults to `closed`: the Better Auth sign-up endpoint is disabled
 * (`disableSignUp` blocks BOTH the HTTP route POST /api/auth/sign-up/email
 * and the server-side auth.api.signUpEmail). Users are created by an admin
 * from /admin/users; the initial administrator by bootstrapFirstAdmin only.
 *
 * Opening a mode is an explicit operator decision via SIGNUP_MODE — see
 * signup-mode.ts for the documented contract (closed | invite-only |
 * self-service). Unknown values fail closed. Changing the mode requires a
 * server restart (the value is read at module init, like ORIGIN).
 */
export const signupMode: SignupMode = resolveSignupMode(env.SIGNUP_MODE);

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	// Since better-auth 1.7 (#319) the drizzle adapter NO LONGER introspects
	// the drizzle instance — the model → table mapping must be passed
	// explicitly or every write fails with "Cannot convert undefined or null
	// to object". Kept in sync with src/lib/server/db/auth.schema.ts; the
	// scaffold gate diffs the CLI-generated schema against it.
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: { user, session, account, verification }
	}),
	emailAndPassword: {
		enabled: true,
		// #318: closed by default. `role` is deliberately NOT declared in
		// user.additionalFields, so a sign-up body can never influence it —
		// self-registered users always persist the column default 'user'.
		disableSignUp: signupMode === 'closed'
	},
	databaseHooks: {
		// invite-only (#318): the sign-up request itself carries no credential
		// an attacker can forge — the gate is the pre-approved email row.
		...(signupMode === 'invite-only'
			? {
					user: {
						create: {
							before: async (created: { email?: string }) => {
								// Server-side enforcement — no UI protection involved.
								if (!created.email || !(await findValidInvitation(created.email))) {
									throw new APIError('FORBIDDEN', {
										message: 'Sign-up requires an invitation',
										code: 'SIGNUP_INVITE_REQUIRED'
									});
								}
							},
							after: async (created: { email?: string } | null) => {
								if (!created?.email) return;
								// Atomic single-use claim. Best-effort by design: a missed
								// claim can only leave the invitation reusable, and the email
								// is already taken, so a second sign-up still fails on the
								// unique index. Fail-safe, never fail-open.
								try {
									await acceptInvitation(created.email);
								} catch {
									// the invitation stays unclaimed — see above
								}
							}
						}
					}
				}
			: {}),
		session: {
			create: {
				before: async (session) => {
					const [identity] = await db
						.select({ disabled: user.disabled })
						.from(user)
						.where(eq(user.id, session.userId))
						.limit(1);
					if (identity?.disabled) {
						throw new APIError('FORBIDDEN', {
							// Keep the lifecycle state private, as the login action does.
							message: 'Invalid credentials',
							code: 'USER_DISABLED'
						});
					}
				}
			}
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
