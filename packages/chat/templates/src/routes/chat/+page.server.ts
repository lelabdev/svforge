import { redirect, type RequestEvent } from '@sveltejs/kit';
import { chat } from '#lib/server/chat/index.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	const conversations = await chat.listConversations(locals.user.id);
	return { conversations };
};
