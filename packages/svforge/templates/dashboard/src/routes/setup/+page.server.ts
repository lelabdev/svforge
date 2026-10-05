import { dev } from '$app/env';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { setupSchema } from '$lib/server/schemas';
import { adminExists, bootstrapFirstAdmin, AdminExistsError } from '$lib/server/first-admin';
import type { Actions, PageServerLoad } from './$types';

/**
 * First-admin bootstrap — DEV-ONLY convenience (#318).
 *
 * The PRODUCTION path is the operator command:
 *   <package manager> run admin:create -- --name "Admin" --email you@example.com --password '…'
 * Both share the SAME atomic bootstrap (first-admin.ts): a transaction-scoped
 * advisory lock + an in-lock verification that NO administrator exists, so
 * two concurrent bootstraps can never create two admins.
 *
 * The `dev` gate here is server-side — the page being unreachable in a
 * production browser is never the actual protection (#318).
 */
export const load: PageServerLoad = async () => {
	if (!dev) {
		throw redirect(302, '/login');
	}
	// Once bootstrapped, stop advertising the setup screen.
	if (await adminExists(db)) {
		throw redirect(302, '/login');
	}
};

export const actions: Actions = {
	default: async ({ request }) => {
		// Server-side gate — never rely on the UI (#318).
		if (!dev) {
			throw redirect(302, '/login');
		}

		const formData = await request.formData();
		const parsed = setupSchema.safeParse({
			name: formData.get('name'),
			email: formData.get('email'),
			password: formData.get('password')
		});

		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid input' });
		}

		const { name, email, password } = parsed.data;

		try {
			// Atomic bootstrap: refuses (AdminExistsError) when an admin already
			// exists and persists role 'admin' — never derivable from ordering.
			await bootstrapFirstAdmin(db, { name, email, password });
		} catch (error) {
			if (error instanceof AdminExistsError) {
				return fail(400, { error: 'An administrator already exists' });
			}
			// Generic message — never leak e.message internals to the UI (#188).
			return fail(400, { error: 'Failed to create admin' });
		}

		throw redirect(302, '/login');
	}
};
