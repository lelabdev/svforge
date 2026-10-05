import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Runtime configuration consumed by the dashboard. Kit 3 requires explicit
 * declarations for values exposed through `$app/env/private`.
 */
export const variables = defineEnvVars({
	DATABASE_URL: { description: 'PostgreSQL connection URL' },
	ORIGIN: { description: 'Public origin used by Better Auth' },
	BETTER_AUTH_SECRET: { description: 'Secret used to sign Better Auth cookies' },
	SIGNUP_MODE: {
		description: 'Sign-up policy: closed, invite-only, or self-service',
		schema: (value) => value ?? 'closed'
	}
});
