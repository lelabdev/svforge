import { auth } from '#lib/server/auth.js';
import { changePasswordSchema } from '#lib/server/schemas.js';
import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		user: locals.user!
	};
};

export const actions: Actions = {
	changePassword: async ({ request }) => {
		const formData = await request.formData();
		const parsed = changePasswordSchema.safeParse({
			currentPassword: formData.get('currentPassword'),
			newPassword: formData.get('newPassword')
		});

		if (!parsed.success) {
			return fail(400, { message: parsed.error.issues[0]?.message ?? 'Invalid input' });
		}

		const { currentPassword, newPassword } = parsed.data;

		try {
			await auth.api.changePassword({
				headers: request.headers,
				body: { currentPassword, newPassword }
			});
			return { success: true };
		} catch {
			// Generic message — never leak e.message internals to the UI (#188).
			return fail(400, { message: 'Failed to change password' });
		}
	}
};
