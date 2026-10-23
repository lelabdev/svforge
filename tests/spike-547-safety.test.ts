import { describe, expect, it } from 'vitest';
import {
	SPIKE_DB_PREFIX,
	assertDisposableTables,
	assertOwnedDatabaseName,
	parseAdminUrl,
	redactUrl,
	spikeDatabaseName,
	withDatabase,
	withOwnedDatabase
} from '../scripts/spike-547-safety.mjs';

/**
 * #547 POC safety guard (review blocker): the manual spike must never push a
 * schema to, or mutate rows in, a database supplied by the caller. These tests
 * prove the failure modes are closed BEFORE PostgreSQL exists: ambiguous URLs
 * are rejected, only spike-owned database names are accepted, a non-empty
 * working database aborts the run, and cleanup only ever drops the database the
 * spike itself created.
 */

const ADMIN_URL = 'postgres://postgres:secret@localhost:5432/postgres';

describe('spike #547 — admin URL validation', () => {
	it('accepts an explicit postgres URL and extracts its database', () => {
		expect(parseAdminUrl(ADMIN_URL).database).toBe('postgres');
		expect(parseAdminUrl('postgresql://u:p@db.internal:5432/postgres?sslmode=require').database).toBe('postgres');
		// The approved TLS/observability parameters are part of the contract.
		expect(parseAdminUrl('postgres://u:p@db:5432/postgres?application_name=sf_spike_547').database).toBe('postgres');
		expect(parseAdminUrl('postgres://u:p@db:5432/postgres?sslmode=require&application_name=sf_spike_547').database).toBe('postgres');
	});

	it('rejects ambiguous or non-postgres URLs before anything runs', () => {
		for (const url of [
			'',
			'not a url',
			'http://localhost:5432/postgres',
			'postgres://localhost:5432',
			'postgres://localhost:5432/',
			'postgres://a:5432,b:5432/postgres',
			'postgres://u:p@localhost:5432/postgres?options=-c%20search_path%3Dpublic'
		]) {
			expect(() => parseAdminUrl(url), url).toThrow();
		}
	});

	it('redacts credentials for logs', () => {
		const redacted = redactUrl(ADMIN_URL);
		expect(redacted).not.toContain('secret');
		expect(redacted).toContain('***');
	});

	it('logs every URL that validation accepts, including approved query parameters', () => {
		// Regression (review B-02): an accepted `?sslmode=require` URL used to
		// throw at log time because redaction re-validated with a stricter policy.
		for (const [url, expected] of [
			['postgres://postgres:secret@db.internal:5432/postgres?sslmode=require', 'sslmode=require'],
			['postgres://postgres:secret@db.internal:5432/postgres?application_name=sf_spike_547', 'application_name=sf_spike_547'],
			['postgres://postgres:secret@db.internal:5432/postgres?sslmode=require&application_name=sf_spike_547', 'sslmode=require']
		] as const) {
			const redacted = redactUrl(url);
			expect(redacted, url).not.toContain('secret');
			expect(redacted, url).toContain('***');
			expect(redacted, url).toContain(expected);
			expect(() => parseAdminUrl(url), url).not.toThrow();
		}
	});

	it('still rejects unknown parameters in both the validation and log paths', () => {
		const ambiguous = 'postgres://postgres:secret@db:5432/postgres?options=-c%20search_path%3Dpublic';
		expect(() => parseAdminUrl(ambiguous)).toThrow(/unsupported parameter/);
		expect(() => redactUrl(ambiguous)).toThrow(/unsupported parameter/);
	});
});

describe('spike #547 — owned database names', () => {
	it('generates only prefixed, SQL-safe names and keeps them unique', () => {
		const first = spikeDatabaseName(1_700_000_000_000, 0.25);
		const second = spikeDatabaseName(1_700_000_000_000, 0.75);
		expect(first.startsWith(SPIKE_DB_PREFIX)).toBe(true);
		expect(first).toMatch(/^[a-z0-9_]+$/);
		expect(first).not.toBe(second);
		expect(assertOwnedDatabaseName(first)).toBe(first);
	});

	it('refuses every foreign database name', () => {
		for (const name of ['myapp', 'postgres', 'sf_spike_547', 'sf_spike_547_', 'sf_spike_547_x; DROP DATABASE postgres', 'SF_SPIKE_547_1']) {
			expect(() => assertOwnedDatabaseName(name), name).toThrow(/only manages databases prefixed/);
		}
	});

	it('builds the working URL by replacing ONLY the database path', () => {
		const name = spikeDatabaseName(1_700_000_000_000, 0.5);
		const working = withDatabase('postgres://u:p@localhost:5432/postgres?sslmode=require', name);
		expect(working).toBe(`postgres://u:p@localhost:5432/${name}?sslmode=require`);
		expect(() => withDatabase(ADMIN_URL, 'myapp')).toThrow();
	});

	it('refuses a non-empty working database', () => {
		expect(() => assertDisposableTables([])).not.toThrow();
		expect(() => assertDisposableTables(['user'])).toThrow(/non-empty database/);
		expect(() => assertDisposableTables(['user', 'session'])).toThrow(/user, session/);
	});
});

describe('spike #547 — fail-closed provisioning', () => {
	const fakeDb = (tables: string[]) => {
		const calls: string[] = [];
		return {
			calls,
			adminUrl: ADMIN_URL,
			createDatabase: async (name: string) => {
				calls.push(`create:${name}`);
			},
			listTables: async (name: string) => {
				calls.push(`list:${name}`);
				return tables;
			},
			dropDatabase: async (name: string) => {
				calls.push(`drop:${name}`);
			}
		};
	};

	it('leaves a non-empty database entirely unchanged and never runs the workflow', async () => {
		const db = fakeDb(['user', 'session', 'account']);
		let ran = false;

		await expect(
			withOwnedDatabase(db, async () => {
				ran = true;
			})
		).rejects.toThrow(/non-empty database/);

		// Nothing was pushed or mutated (the workflow never ran) …
		expect(ran).toBe(false);
		// … and only the spike-created database was created, inspected and dropped.
		const owned = db.calls.map((call) => call.split(':')[1]);
		expect(new Set(owned).size).toBe(1);
		expect(owned[0].startsWith(SPIKE_DB_PREFIX)).toBe(true);
		expect(db.calls).toEqual([`create:${owned[0]}`, `list:${owned[0]}`, `drop:${owned[0]}`]);
	});

	it('runs the workflow against the owned database and drops only that one afterwards', async () => {
		const db = fakeDb([]);
		const seen: string[] = [];

		// The helper is a plain `.mjs` module; JSDoc generics are not inferred at
		// this call site, so the owned name is asserted after the call.
		const result = (await withOwnedDatabase(db, async ({ database, databaseUrl }) => {
			seen.push(databaseUrl);
			db.calls.push(`workflow:${database}`);
			return database;
		})) as string;

		expect(seen).toHaveLength(1);
		expect(new URL(seen[0]).pathname).toBe(`/${result}`);
		expect(result.startsWith(SPIKE_DB_PREFIX)).toBe(true);
		expect(db.calls.at(-1)).toBe(`drop:${result}`);
		expect(db.calls.filter((call) => call.startsWith('drop:'))).toHaveLength(1);
	});

	it('never drops a database it did not create', async () => {
		const db = fakeDb([]);
		db.createDatabase = async () => {
			throw new Error('database already exists');
		};

		await expect(withOwnedDatabase(db, async () => undefined)).rejects.toThrow(/already exists/);
		expect(db.calls.filter((call) => call.startsWith('drop:'))).toEqual([]);
	});
});
