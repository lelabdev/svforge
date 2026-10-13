import { getPost } from '#lib/utils/posts.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const post = await getPost(params.slug);
	if (!post) throw error(404, 'Post not found');
	return { post };
};
