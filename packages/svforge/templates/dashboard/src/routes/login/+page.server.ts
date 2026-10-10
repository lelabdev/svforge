import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { loginSchema } from '$lib/server/schemas';
import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.session) {
		throw redirect(302, '/admin');
	}
};

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const parsed = loginSchema.safeParse({
			email: formData.get('email'),
			password: formData.get('password')
		});

		if (!parsed.success) {
			const submittedEmail = formData.get('email');
			return fail(400, {
				code: 'invalid_input',
				email: typeof submittedEmail === 'string' ? submittedEmail : ''
			});
		}

		const { email, password } = parsed.data;
		const [identity] = await db
			.select({ disabled: user.disabled })
			.from(user)
			.where(eq(user.email, email.toLowerCase()))
			.limit(1);
		if (identity?.disabled) {
			// Use the same generic response as bad credentials: account status is private.
			return fail(401, { code: 'invalid_credentials', email });
		}

		try {
			await auth.api.signInEmail({
				body: { email, password },
				headers: request.headers
			});
			return { success: true };
		} catch {
			// Generic response — never leak account status or e.message internals (#188).
			return fail(401, { code: 'invalid_credentials', email });
		}
	}
};
