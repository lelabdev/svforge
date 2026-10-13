import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { invitation } from '#lib/server/db/schema.js';

/**
 * Sign-up invitations (#318) — the `invite-only` sign-up mode.
 *
 * An invitation is a pre-approval for ONE email address:
 * - created by an admin from `/admin/users` (see the `invite` action);
 * - consumed ONCE, atomically, when the invited email completes sign-up.
 *
 * The enforcement lives in `auth.ts` databaseHooks (server-side, not UI):
 * `user.create.before` rejects the sign-up when no valid invitation exists,
 * `user.create.after` claims it. Email matching follows the Better Auth
 * credential contract: lowercased on both write and lookup (#292).
 */

export class DuplicateInvitationError extends Error {
	constructor() {
		super('invitation already exists');
		this.name = 'DuplicateInvitationError';
	}
}

export interface CreateInvitationInput {
	email: string;
	/** Days until the invitation expires. Default 7. */
	expiresInDays?: number;
}

export type Invitation = typeof invitation.$inferSelect;

/** Normalizes an email exactly like Better Auth credential lookups (#292). */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export async function createInvitation({
	email,
	expiresInDays = 7
}: CreateInvitationInput): Promise<Invitation> {
	const normalized = normalizeEmail(email);
	const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);

	const [existing] = await db
		.select({ id: invitation.id })
		.from(invitation)
		.where(eq(invitation.email, normalized))
		.limit(1);
	if (existing) throw new DuplicateInvitationError();

	try {
		const [row] = await db.insert(invitation).values({ email: normalized, expiresAt }).returning();
		return row;
	} catch {
		// A concurrent invite for the same email hits the unique index —
		// re-check to give the caller the precise, expected error.
		const [raced] = await db
			.select({ id: invitation.id })
			.from(invitation)
			.where(eq(invitation.email, normalized))
			.limit(1);
		if (raced) throw new DuplicateInvitationError();
		throw new Error('failed to create invitation');
	}
}

/** Returns the invitation for `email` if it is still unaccepted AND unexpired. */
export async function findValidInvitation(email: string): Promise<Invitation | null> {
	const [row] = await db
		.select()
		.from(invitation)
		.where(
			and(
				eq(invitation.email, normalizeEmail(email)),
				isNull(invitation.acceptedAt),
				gt(invitation.expiresAt, new Date())
			)
		)
		.limit(1);
	return row ?? null;
}

/**
 * Atomically claims the invitation for `email`: the conditional
 * `UPDATE … WHERE accepted_at IS NULL AND expires_at > now()` makes
 * concurrent claims single-use — at most one sign-up consumes an invitation.
 */
export async function acceptInvitation(email: string): Promise<boolean> {
	const claimed = await db
		.update(invitation)
		.set({ acceptedAt: new Date() })
		.where(
			and(
				eq(invitation.email, normalizeEmail(email)),
				isNull(invitation.acceptedAt),
				gt(invitation.expiresAt, new Date())
			)
		)
		.returning({ id: invitation.id });
	return claimed.length > 0;
}
