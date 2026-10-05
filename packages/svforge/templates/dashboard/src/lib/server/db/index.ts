import { createDb } from './client';
import * as env from '$app/env/private';

export { createDb } from './client';
export type { DatabaseOptions } from './client';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Long-lived Node default: one pool per process. Serverless handlers should
// call createDb(env.DATABASE_URL, { maxConnections: 1 }) instead.
const database = createDb(env.DATABASE_URL);
export const db = database.db;
export const closeDb = database.close;
