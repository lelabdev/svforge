import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from './db/client';
import { user, session, account, verification } from './db/auth.schema';

/**
 * Kit-independent Better Auth config for the schema review CLI.
 *
 * The Better Auth CLI loads this file through jiti, outside SvelteKit's Vite
 * resolver, so `$app/*` virtual modules from the runtime auth.ts cannot be
 * imported here. Keep its adapter/model map in sync with auth.ts; this file is
 * only for generating a review schema and never used by the application.
 */
const { db } = createDb(
	process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/svforge_schema_review',
	{ maxConnections: 1 }
);

export const auth = betterAuth({
	baseURL: process.env.ORIGIN ?? 'http://localhost:3000',
	secret: process.env.BETTER_AUTH_SECRET ?? 'schema-review-only-secret-not-for-runtime-use',
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: { user, session, account, verification }
	}),
	emailAndPassword: { enabled: true }
});
