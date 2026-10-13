import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Database lifecycle configuration (#332).
 *
 * The factory is the serverless escape hatch: create a short-lived client in a
 * request and close it in a finally block. A long-lived Node process should
 * create one client and reuse it for the life of the process (the `db` export
 * of `#lib/server/db/index.js` keeps that convenient default for dashboard routes).
 *
 * This module is intentionally free of SvelteKit virtual modules: the
 * first-admin bootstrap command (`scripts/create-admin.ts`, #318) shares the
 * exact same connection factory and schema as the app.
 */
export interface DatabaseOptions {
	/** postgres.js pool size. Use 1 for request-scoped/serverless work. */
	maxConnections?: number;
	/** Idle timeout in seconds. Short values help serverless clients drain. */
	idleTimeout?: number;
}

export function createDb(databaseUrl: string, options: DatabaseOptions = {}) {
	if (!databaseUrl) throw new Error('DATABASE_URL is not set');
	const client = postgres(databaseUrl, {
		...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
		...(options.idleTimeout === undefined ? {} : { idle_timeout: options.idleTimeout })
	});
	return {
		db: drizzle(client, { schema }),
		close: () => client.end()
	};
}
