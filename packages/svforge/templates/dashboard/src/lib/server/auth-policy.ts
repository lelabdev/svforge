import type { BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import * as env from '$app/env/private';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema.js';
import { resolveSignupMode } from '#lib/server/signup-mode.js';
import { acceptInvitation, findValidInvitation } from '#lib/server/invitations.js';

/**
 * SVForge auth policy (#318, #547) — the ONLY SVForge-owned part of the auth
 * configuration. The foundation (Better Auth instance, Drizzle adapter,
 * session cookies, schema generation) belongs to the official `sv add`
 * integration; this fragment adds SVForge's product and security rules on top.
 *
 * It is spread into the official `auth.ts` by the scaffold
 * (`{...svforgeAuthPolicy, plugins: [...]}`), which keeps the upstream file
 * almost untouched and the policy testable on its own.
 *
 * SECURITY MODEL
 * --------------
 * - sign-up defaults to `closed` (`SIGNUP_MODE`); `disableSignUp` blocks both
 *   the HTTP endpoint and `auth.api.signUpEmail`;
 * - `role` and `disabled` are persisted user columns declared through the
 *   supported `additionalFields` config with `input: false`, so no sign-up
 *   body can assign a role or disable/enable an identity;
 * - `invite-only` is enforced server-side from the pre-approved invitation
 *   row, never from a client-side check;
 * - a disabled identity is rejected at session creation and its existing
 *   sessions are neutralized by the composed guard (`auth-guard.ts`).
 */
export const signupMode = resolveSignupMode(env.SIGNUP_MODE);

/**
 * Spread into the official `betterAuth({...})` BEFORE `plugins`. The signup
 * modes are applied by the scaffold to the official `emailAndPassword` entry,
 * so this fragment only carries user columns and server-side hooks (no
 * duplicate keys).
 */
export const svforgeAuthPolicy = {
	user: {
		additionalFields: {
			role: { type: 'string', required: true, defaultValue: 'user', input: false },
			disabled: { type: 'boolean', required: true, defaultValue: false, input: false }
		}
	},
	databaseHooks: {
		...(signupMode === 'invite-only'
			? {
					user: {
						create: {
							before: async (created) => {
								// Server-side enforcement — no UI protection involved.
								const email = (created as { email?: string }).email;
								if (!email || !(await findValidInvitation(email))) {
									throw new APIError('FORBIDDEN', {
										message: 'Sign-up requires an invitation',
										code: 'SIGNUP_INVITE_REQUIRED'
									});
								}
							},
							after: async (created) => {
								const email = (created as { email?: string } | null)?.email;
								if (!email) return;
								// Atomic single-use claim. Best-effort by design: a missed
								// claim can only leave the invitation reusable, and the email
								// is already taken, so a second sign-up still fails on the
								// unique index. Fail-safe, never fail-open.
								try {
									await acceptInvitation(email);
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
	}
} satisfies BetterAuthOptions;
