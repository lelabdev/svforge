/**
 * First-admin bootstrap command (#318) — the production-safe way to create
 * the initial administrator. Production deployments should use THIS (or a
 * CI job wrapping it) instead of exposing any public sign-up.
 *
 * Shares the EXACT atomic bootstrap of the app (src/lib/server/first-admin.ts):
 * a transaction-scoped PostgreSQL advisory lock serializes concurrent runs and
 * the absence of an existing administrator is verified INSIDE the lock — two
 * concurrent invocations can never create two admins.
 *
 * Usage:
 *   <package manager> run admin:create -- --name "Admin" --email admin@example.com --password '…' (npm/bun/pnpm/…)
 *   (or ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD environment variables)
 *
 * Exit codes: 0 = created, 3 = an administrator already exists (dedicated,
 * non-destructive no-op for setup automation), 1 = invalid input or failure.
 * Safe to retry.
 */
import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/server/db/schema.js';
import { bootstrapFirstAdmin, AdminExistsError } from '../src/lib/server/first-admin.js';

/** Minimal .env loader — same lookup rules as drizzle-kit (KEY=VALUE lines). */
function loadDotEnv(): Record<string, string> {
	const path = '.env';
	if (!existsSync(path)) return {};
	const values: Record<string, string> = {};
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
		if (!match) continue;
		values[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
	}
	return values;
}

const dotEnv = loadDotEnv();
const env = (key: string): string | undefined => process.env[key] ?? dotEnv[key];

const { values } = parseArgs({
	options: {
		name: { type: 'string' },
		email: { type: 'string' },
		password: { type: 'string' }
	}
});

const name = values.name ?? env('ADMIN_NAME');
const email = values.email ?? env('ADMIN_EMAIL');
const password = values.password ?? env('ADMIN_PASSWORD');

const usage =
	'Usage: <package manager> run admin:create -- --name "Admin" --email admin@example.com --password \'…\'';

if (!name || !email || !password) {
	console.error(
		`✗ Missing ${[!name && '--name', !email && '--email', !password && '--password'].filter(Boolean).join(', ')}.\n${usage}`
	);
	process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
	console.error(`✗ Invalid email: ${email}`);
	process.exit(1);
}
if (password.length < 8) {
	console.error('✗ Password must be at least 8 characters (Better Auth minimum).');
	process.exit(1);
}

const databaseUrl = env('DATABASE_URL');
if (!databaseUrl) {
	console.error('✗ DATABASE_URL is not set — copy .env.example to .env or export it.');
	process.exit(1);
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client, { schema });

try {
	const admin = await bootstrapFirstAdmin(db, { name, email: email.toLowerCase(), password });
	console.log(`✓ Administrator created: ${admin.email} (role admin, id ${admin.id})`);
	console.log('  Sign in through /login. Keep SIGNUP_MODE closed unless you need invites.');
} catch (error) {
	if (error instanceof AdminExistsError) {
		console.error('✗ An administrator already exists — bootstrap refused (atomic, fail-closed).');
		process.exitCode = 3;
	} else {
		console.error('✗ Bootstrap failed:', error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
} finally {
	await client.end();
}
