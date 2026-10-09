import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	assertTestDatabaseUrl,
	isTestDatabaseUrl,
	resolveTestDbUrl,
	runEmailDomain,
	TEST_EMAIL_DOMAIN
} from '../packages/svforge/templates/dashboard/src/lib/server/test-db';

/**
 * #312 — the shipped integration suites are a SAFE reference: they only ever
 * run against an explicitly dedicated test database and only mutate rows
 * they created themselves. This contract is tested two ways:
 *
 * 1. BEHAVIORAL — the guard helpers shipped with the dashboard template
 *    (`src/lib/server/test-db.ts`) reject anything that is not a test
 *    database before a single row is touched.
 * 2. STRUCTURAL — the shipped suites must never read the application `.env`,
 *    never issue a global delete, and never demote pre-existing rows; the
 *    scaffold harness must provision a dedicated `*_test` database.
 */

const DASHBOARD = 'packages/svforge/templates/dashboard';
const read = (path: string) => readFileSync(path, 'utf8');

describe('test-database guard (#312 — behavioral)', () => {
	it('accepts database names carrying an explicit test segment', () => {
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/myapp_test')).toBe(true);
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/myapp-test')).toBe(true);
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/test_myapp')).toBe(true);
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/sf_dashboard_test?sslmode=require')).toBe(true);
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/tests')).toBe(true);
	});

	it('rejects application-looking databases before any mutation', () => {
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/myapp')).toBe(false);
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/sf_dashboard')).toBe(false);
		// near-misses that are NOT an explicit test segment
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/testing')).toBe(false);
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/latest')).toBe(false);
		expect(isTestDatabaseUrl('postgres://u:p@localhost:5432/prodtest')).toBe(false);
		expect(isTestDatabaseUrl('not a url')).toBe(false);
	});

	it('resolveTestDbUrl refuses to fall back to DATABASE_URL or .env', () => {
		// nothing set → actionable error
		expect(() => resolveTestDbUrl({})).toThrow(/TEST_DATABASE_URL is not set/);
		// the classic footgun: only the application URL is available → refused
		expect(() => resolveTestDbUrl({ DATABASE_URL: 'postgres://u:p@localhost:5432/myapp' })).toThrow(
			/TEST_DATABASE_URL is not set/
		);
		// a non-test target is refused even when explicitly provided
		expect(() => resolveTestDbUrl({ TEST_DATABASE_URL: 'postgres://u:p@localhost:5432/myapp' })).toThrow(
			/refusing to run against postgres:\/\/u:\*\*\*@localhost:5432\/myapp/
		);
		// the happy path returns the URL untouched
		expect(resolveTestDbUrl({ TEST_DATABASE_URL: 'postgres://u:p@localhost:5432/myapp_test' })).toBe(
			'postgres://u:p@localhost:5432/myapp_test'
		);
	});

	it('assertTestDatabaseUrl explains the fix in its message', () => {
		expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5432/prod')).toThrow(/createdb|"test" segment/);
	});
});

describe('shipped suites isolation contract (#312 — structural)', () => {
	const adminSuite = read(`${DASHBOARD}/src/lib/server/admin-users.test.ts`);
	const firstAdminSuite = read(`${DASHBOARD}/src/lib/server/first-admin.test.ts`);
	const authSuite = read(`${DASHBOARD}/src/lib/server/auth.test.ts`);
	const signupSuite = read(`${DASHBOARD}/src/lib/server/signup-mode.test.ts`);
	const jobsSuite = read('packages/jobs/templates/src/lib/server/jobs/jobs-claim.test.ts');

	it('no DB suite reads the application .env', () => {
		for (const [name, content] of Object.entries({ adminSuite, firstAdminSuite, authSuite, signupSuite, jobsSuite })) {
			expect(content, name).not.toMatch(/readFileSync\(['"`]\.env/);
			expect(content, name).not.toMatch(/existsSync\(['"`]\.env/);
			expect(content, name).toContain('TEST_DATABASE_URL');
			expect(content, name).toContain('resolveTestDbUrl');
		}
	});

	it('no DB suite issues a global delete — cleanup is always marker-scoped', () => {
		// the old bug: `await db.delete(user);` wiping EVERY identity
		for (const [name, content] of Object.entries({ adminSuite, firstAdminSuite, authSuite, signupSuite, jobsSuite })) {
			expect(content, name).not.toMatch(/db\.delete\((?:user|account|session|jobs)\)\s*;/);
		}
		// every shipped cleanup deletes through the PER-RUN domain — the bare
		// test domain would let a concurrent run delete another run's rows
		// (#312 review)
		for (const [name, content] of Object.entries({ adminSuite, firstAdminSuite, authSuite, signupSuite })) {
			expect(content, name).toContain('runEmailDomain');
			expect(content, name).toMatch(/RUN_DOMAIN = runEmailDomain\(/);
			expect(content, name).toMatch(/like\(user\.email, `%@\$\{RUN_DOMAIN\}`\)/);
			expect(content, name).not.toContain('`%@${TEST_EMAIL_DOMAIN}`');
		}
		expect(jobsSuite).toMatch(/delete\(jobs\)\.where\(like\(jobs\.type/);
	});

	it('the bootstrap suite never demotes pre-existing administrators', () => {
		// the old bug: role wipe across the WHOLE table to force a clean slate
		expect(firstAdminSuite).not.toContain("set({ role: 'user' })");
		expect(firstAdminSuite).not.toMatch(/\.update\(user\)\.set\(\{[^}]*role/);
		// the only allowed user updates are the run-scoped disabled flag
		expect(firstAdminSuite).toMatch(/set\(\{ disabled: (?:true|false) \}\)\.where\(eq\(user\.id, admin\.id\)\)/);
		// instead it REFUSES to run on a database holding foreign rows
		expect(firstAdminSuite).toContain('assertNoForeignUsers');
	});

	it('every suite namespaces its identities per run', () => {
		expect(adminSuite).toContain('crypto.randomUUID()');
		expect(firstAdminSuite).toContain('crypto.randomUUID()');
		expect(authSuite).toContain('crypto.randomUUID()');
		expect(signupSuite).toContain('crypto.randomUUID()');
		expect(jobsSuite).toMatch(/TEST_PREFIX = `claimtest-\$\{crypto\.randomUUID\(\)/);
		// shared per-run domain builder — cleanup can only ever match it
		for (const content of [adminSuite, firstAdminSuite, authSuite, signupSuite]) {
			expect(content).toContain('runEmailDomain');
		}
		// no shipped identity may target the bare example.com anymore
		for (const [name, content] of Object.entries({ adminSuite, firstAdminSuite, authSuite, signupSuite })) {
			expect(content, name).not.toMatch(/['"`]\w[\w.+-]*@example\.com['"`]/);
		}
	});

	it('the pre-existing data survival assertion exists', () => {
		// admin suite snapshots rows it did NOT create and asserts they survive
		expect(adminSuite).toContain('foreignRows');
		expect(adminSuite).toContain('notLike');
	});
});

describe('scaffold harness and CI provision a dedicated test database (#312)', () => {
	const harness = read('scripts/test-scaffold.sh');

	it('defaults TEST_DATABASE_URL to a *_test database', () => {
		expect(harness).toContain('postgres://postgres:postgres@localhost:5432/sf_dashboard_test');
		expect(harness).not.toContain('SF_TEST_DB_URL');
	});

	it('never wipes whole tables between phases', () => {
		expect(harness).not.toMatch(/DELETE FROM session/);
		expect(harness).not.toMatch(/DELETE FROM account/);
		expect(harness).not.toMatch(/DELETE FROM "user"\s*";?\s*$/m);
	});

	it('asserts the dedicated database is left empty', () => {
		expect(harness).toContain('leftover users');
	});

	it('CI services create the test database', () => {
		// PR CI no longer provisions PostgreSQL (#413); release + canary do.
		for (const workflow of ['canary.yml', 'publish.yml']) {
			const content = read(`.github/workflows/${workflow}`);
			expect(content, workflow).toContain('POSTGRES_DB: sf_dashboard_test');
		}
	});

	it('the environment example documents the guarded test database', () => {
		const envExample = read(`${DASHBOARD}/root/.env.example`);
		expect(envExample).toContain('TEST_DATABASE_URL');
		expect(envExample).toContain('must contain a "test" segment');
	});
});

describe('marker semantics stay strict', () => {
	it('the shipped marker regex matches exactly the documented examples', () => {
		// keep helper + suite in sync: the domain used for cleanup markers
		expect(TEST_EMAIL_DOMAIN).toBe('sf-test.example');
	});

	describe('per-run email domain (#312 review — parallel-safe cleanup)', () => {
		it('namespaces the domain with the run marker', () => {
			expect(runEmailDomain('abc123')).toBe('abc123.sf-test.example');
		});

		it('rejects markers that could break the LIKE predicate', () => {
			expect(() => runEmailDomain('')).toThrow(/invalid run marker/);
			expect(() => runEmailDomain('a b')).toThrow(/invalid run marker/);
			expect(() => runEmailDomain('%@sf-test.example')).toThrow(/invalid run marker/);
		});

		it('two different runs never match each other\'s cleanup predicate', () => {
			const runA = runEmailDomain('run-a');
			const runB = runEmailDomain('run-b');
			const runBIdentity = `admin@${runB}`;
			// the LIKE predicate run A builds cannot match run B's identity
			expect(runBIdentity.endsWith(`@${runA}`)).toBe(false);
			// …while its own identities always match
			expect(`admin@${runA}`.endsWith(`@${runA}`)).toBe(true);
		});
	});
});
