import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * #547 — fixtures for the OFFICIAL `sv add drizzle better-auth` output.
 *
 * The dashboard add-on no longer generates the auth/DB foundation: it extends
 * the files produced by the official integrations. Tests that scaffold the
 * dashboard in memory must therefore seed those files first — exactly like a
 * real `svforge create` run, where the official add-ons run before SVForge.
 *
 * The contents mirror the published `sv@1.1.1` output (drizzle with
 * postgres.js + better-auth without demo pages); the scaffold test profile is
 * the authority for real drift.
 */
export const OFFICIAL_FOUNDATION_FILES: Record<string, string> = {
	'src/app.d.ts': `import type { User, Session } from 'better-auth';

declare global {
	namespace App {
		interface Locals { user?: User; session?: Session }
	}
}

export {};
`,
	'src/env.ts': `import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'The database connection string.' },
	ORIGIN: {
		description: 'The app origin (base URL), e.g. \`http://localhost:5173\`.'
	},
	BETTER_AUTH_SECRET: {
		description: 'Secret used to sign tokens.'
	}
});
`,
	'src/hooks.server.ts': `import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { auth } from '#lib/server/auth.ts';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
`,
	'src/lib/server/auth.ts': `import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.ts';

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true },
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
`,
	'src/lib/server/db/index.ts': `import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { DATABASE_URL } from '$app/env/private';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(DATABASE_URL);

export const db = drizzle(client, { schema });
`,
	'src/lib/server/db/schema.ts': `import { pgTable, serial, integer, text } from 'drizzle-orm/pg-core';

export const task = pgTable('task', {
	id: serial('id').primaryKey(),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export *  from './auth.schema';
`,
	'drizzle.config.ts': `import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL },
	verbose: true,
	strict: true
});
`,
	'.env': `DATABASE_URL="postgres://user:password@host:port/db-name"

ORIGIN="http://localhost:5173"

BETTER_AUTH_SECRET=""
`,
	'.env.example': `# Drizzle
DATABASE_URL="postgres://user:password@host:port/db-name"

ORIGIN=""

# Better Auth
BETTER_AUTH_SECRET=""
`
};

/** Seed the official output into an in-memory `sv` workspace. */
export function seedOfficialFoundation(files: Map<string, string>): void {
	for (const [path, content] of Object.entries(OFFICIAL_FOUNDATION_FILES)) files.set(path, content);
}

/** Seed the official output onto a real directory (disk-based `sv` fakes). */
export function seedOfficialFoundationOnDisk(root: string): void {
	for (const [path, content] of Object.entries(OFFICIAL_FOUNDATION_FILES)) {
		const target = join(root, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
}
