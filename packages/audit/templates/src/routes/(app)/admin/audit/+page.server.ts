import { isAdmin } from '#lib/server/admin.js';
import { audit } from '#lib/server/audit/index.js';
import { parsePagination } from '#lib/server/audit/pagination.js';
import { error, type RequestEvent } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Admin guard (same pattern as the other admin pages). */
async function requireAdmin(event: RequestEvent): Promise<string> {
	if (!event.locals.user) {
		throw error(401, { message: 'Authentication required' });
	}
	if (!(await isAdmin(event.locals.user.id))) {
		throw error(403, { message: 'Admin access required' });
	}
	return event.locals.user.id;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireAdmin({ locals } as RequestEvent);

	const { limit, offset } = parsePagination(url.searchParams);
	const action = url.searchParams.get('action') ?? undefined;
	const entityType = url.searchParams.get('entityType') ?? undefined;

	const entries = await audit.list({ limit, offset, action, entityType });
	return { entries, limit, offset };
};
