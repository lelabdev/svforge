import { error, redirect, fail } from '@sveltejs/kit';
import { chat } from '#lib/server/chat/index.js';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) throw redirect(302, '/login');
	const currentUser = locals.user; // capture — TS narrows are lost after awaits
	const conversationId = params.id; // uuid (#255)

	try {
		const messages = await chat.listMessages(conversationId, currentUser.id, { limit: 50 });
		await chat.markRead(conversationId, currentUser.id);
		return { conversationId, messages };
	} catch (e) {
		throw error(403, { message: e instanceof Error ? e.message : 'Forbidden' });
	}
};

export const actions: Actions = {
	send: async ({ locals, params, request }) => {
		if (!locals.user) throw redirect(302, '/login');
		const currentUser = locals.user; // capture — TS narrows are lost after awaits
		const conversationId = params.id; // uuid (#255)
		const form = await request.formData();
		const content = String(form.get('content') ?? '').trim();
		if (!content) return fail(400, { error: 'Message is required' });

		try {
			const message = await chat.sendMessage({
				conversationId,
				authorId: currentUser.id, // server-side identity — no client spoofing
				content
			});
			return { message };
		} catch (e) {
			return fail(403, { error: e instanceof Error ? e.message : 'Forbidden' });
		}
	}
};
