#!/usr/bin/env node
/**
 * Spike #547 — reproducible proof-of-concept for the official `sv` foundation.
 *
 * MANUAL TOOL, NOT A CI GATE. It generates a disposable fixture and asserts the
 * facts the migration depends on:
 *
 *   1. `sv add drizzle|better-auth|paraglide` run non-interactively and compose.
 *      (hooks are already `sequence(handleBetterAuth, handleParaglide)`);
 *   2. the official install resolves under the selected package manager without
 *      `--force` / `--legacy-peer-deps`;
 *   3. `role` / `disabled` are expressible through Better Auth `additionalFields`
 *      and the official `auth:schema` script generates the NOT NULL columns;
 *   4. a signup body cannot set `role` / `disabled` (`input: false`);
 *   5. `disableSignUp` enforces the closed mode server-side;
 *   6. Better Auth alone keeps a disabled user's session alive, so an app-level
 *      composed handle is required — and adding one is additive.
 *
 * DATABASE SAFETY (see `scripts/spike-547-safety.mjs`): the URL you pass is an
 * ADMIN URL. It is used ONLY to create and drop a unique database owned by the
 * spike (`sf_spike_547_*`); schema pushes and row mutations never target a
 * database you supplied, and an ambiguous URL is rejected before anything runs.
 * The spike-owned database must be empty before `db:push`, and is always
 * dropped afterwards (even on failure). The run ends by asserting the supplied
 * database's table list is unchanged.
 *
 * Usage:
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *     node scripts/spike-547.mjs [--pm npm|bun] [--dir <path>] [--keep] [--port 5470]
 *
 * Requires PostgreSQL. `--keep` keeps the fixture directory (the database is
 * still dropped). Nothing in the repository is modified: all patches are
 * applied to the disposable fixture.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
	assertOwnedDatabaseName,
	parseAdminUrl,
	redactUrl,
	withDatabase,
	withOwnedDatabase
} from './spike-547-safety.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? fallback : (args[index + 1] ?? true);
};
const has = (name) => args.includes(`--${name}`);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sv = join(repoRoot, 'node_modules', '.bin', 'sv');
const pm = String(flag('pm', 'npm'));
const keep = has('keep');
const adminUrl = String(flag('database-url', process.env.DATABASE_URL ?? ''));
const workdir = String(flag('dir', mkdtempSync(join(tmpdir(), 'sf-547-'))));
const app = join(workdir, 'app');
const port = Number(flag('port', 5470));

// Fail closed before creating anything: an ambiguous admin URL is rejected here.
parseAdminUrl(adminUrl);

const results = [];
const failures = [];
function check(name, condition, detail = '') {
	results.push({ name, ok: Boolean(condition), detail });
	if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
	console.log(`${condition ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(command, commandArgs, options = {}) {
	const result = spawnSync(command, commandArgs, {
		cwd: options.cwd ?? app,
		encoding: 'utf8',
		env: { ...process.env, ...(options.env ?? {}) },
		stdio: options.inherit ? 'inherit' : 'pipe'
	});
	if (result.error) throw result.error;
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`${command} ${commandArgs.join(' ')} failed (${result.status})\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
	}
	return result;
}

function patch(relativePath, replacements) {
	const file = join(app, relativePath);
	let content = readFileSync(file, 'utf8');
	for (const [from, to] of replacements) {
		if (!content.includes(from)) throw new Error(`patch anchor not found in ${relativePath}: ${from.slice(0, 60)}`);
		content = content.replace(from, to);
	}
	writeFileSync(file, content);
}

function read(relativePath) {
	return readFileSync(join(app, relativePath), 'utf8');
}

// Runs SQL through the fixture's own `postgres` client. SQL and URL travel via
// env vars so no shell quoting can alter them.
function pg(databaseUrl, sql) {
	const result = run(process.execPath, [
		'--input-type=module',
		'-e',
		`import postgres from 'postgres';
		 const sql = postgres(process.env.PG_URL, { max: 1 });
		 try {
		   const rows = await sql.unsafe(process.env.PG_SQL);
		   console.log(JSON.stringify(rows));
		 } finally {
		   await sql.end();
		 }`
	], { env: { PG_URL: databaseUrl, PG_SQL: sql } });
	return JSON.parse(result.stdout.trim().split('\n').pop());
}

const database = {
	createDatabase: async (name) => {
		assertOwnedDatabaseName(name);
		await pg(adminUrl, `CREATE DATABASE "${name}"`);
	},
	listTables: async (name) => {
		assertOwnedDatabaseName(name);
		const rows = await pg(
			withDatabase(adminUrl, name),
			`select table_name from information_schema.tables
			 where table_schema not in ('pg_catalog', 'information_schema')
			 order by table_name;`
		);
		return rows.map((row) => row.table_name);
	},
	dropDatabase: async (name) => {
		assertOwnedDatabaseName(name);
		await pg(
			adminUrl,
			`select pg_terminate_backend(pid) from pg_stat_activity
			 where datname = '${name}' and pid <> pg_backend_pid();`
		);
		await pg(adminUrl, `DROP DATABASE IF EXISTS "${name}"`);
	}
};

async function waitFor(url, timeoutMs = 90_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			/* not ready */
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`dev server never became ready at ${url}`);
}

const server = { child: undefined };
function startServer(extraEnv = {}) {
	stopServer();
	server.child = spawn(pm, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
		cwd: app,
		detached: true,
		stdio: 'ignore',
		env: { ...process.env, ...extraEnv }
	});
}
function stopServer() {
	if (!server.child) return;
	try {
		process.kill(-server.child.pid, 'SIGTERM');
	} catch {
		/* already gone */
	}
	server.child = undefined;
}

async function listAdminTables() {
	const rows = await pg(
		adminUrl,
		`select table_name from information_schema.tables
		 where table_schema not in ('pg_catalog', 'information_schema')
		 order by table_name;`
	);
	return rows.map((row) => row.table_name);
}

try {
	console.log(`# spike #547 — fixture ${app} (${pm}, port ${port})`);
	console.log(`# admin URL: ${redactUrl(adminUrl)} (a unique ${'sf_spike_547_*'} database is created and dropped by the spike)`);

	mkdirSync(workdir, { recursive: true });

	// 1. Official-only fixture -------------------------------------------------
	run(sv, ['create', 'app', '--template', 'minimal', '--types', 'ts', '--no-install', '--no-add-ons', '--no-download-check'], { cwd: workdir });
	const pkgPath = join(app, 'package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
	pkg.packageManager = pm;
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);

	run(sv, ['add', 'drizzle=database:postgresql+client:postgres.js+docker:no', '--no-install', '--no-download-check']);
	run(sv, ['add', 'better-auth=demo:', '--no-install', '--no-download-check']);
	run(sv, ['add', 'paraglide=languageTags:en,fr+demo:no', '--no-install', '--no-download-check']);
	console.log('✓ sv add: drizzle + better-auth + paraglide (non-interactive)');

	// 2. Install without peer forcing ----------------------------------------
	run(pm, ['install']);
	const resolved = JSON.parse(
		run(process.execPath, [
			'-e',
			`const out = {};
			 for (const name of ['@sveltejs/kit', 'better-auth', 'drizzle-orm', '@inlang/paraglide-js']) {
			   out[name] = require('./node_modules/' + name + '/package.json').version;
			 }
			 console.log(JSON.stringify(out));`
		]).stdout
	);
	console.log(`✓ ${pm} install (no --force / --legacy-peer-deps): ${JSON.stringify(resolved)}`);

	// 3. Official composition -------------------------------------------------
	const hooks = read('src/hooks.server.ts');
	check('official hooks compose instead of overwriting', hooks.includes('sequence(handleBetterAuth, handleParaglide)'));

	// 4. SVForge policy as additive config (role / disabled / closed signup) --
	patch('src/lib/server/auth.ts', [
		[
			'emailAndPassword: { enabled: true },',
			`emailAndPassword: { enabled: true, disableSignUp: process.env.SPIKE_OPEN_SIGNUP !== '1' },
	user: {
		additionalFields: {
			role: { type: 'string', required: true, defaultValue: 'user', input: false },
			disabled: { type: 'boolean', required: true, defaultValue: false, input: false }
		}
	},`
		]
	]);

	// Everything that touches the database runs against a spike-owned, verified
	// empty database. The supplied URL is never used for DDL/DML (see safety).
	const adminTablesBefore = await listAdminTables();
	await withOwnedDatabase({ adminUrl, ...database }, async ({ databaseUrl }) => {
		console.log(`# working database: ${redactUrl(databaseUrl)}`);

		// Child processes must target the owned database: drizzle-kit and the app
		// prefer an exported DATABASE_URL over `.env`, and the caller's variable
		// still points at the ADMIN database. Pin it for this scope only.
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = databaseUrl;
		try {
		// ORIGIN must match the serving origin: Better Auth only handles
		// /api/auth/* when the request origin equals `baseURL`.
		const env = read('.env')
			.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${databaseUrl}"`)
			.replace(/^ORIGIN=.*$/m, `ORIGIN="http://127.0.0.1:${port}"`);
		writeFileSync(join(app, '.env'), env);

		// The official script generates the schema from auth.ts.
		run(pm, ['run', 'auth:schema']);
		const schema = read('src/lib/server/db/auth.schema.ts');
		check('additionalFields generates NOT NULL role/disabled', /role: text\("role"\)\.default\("user"\)\.notNull\(\)/.test(schema) && /disabled: boolean\("disabled"\)\.default\(false\)\.notNull\(\)/.test(schema));
		check('official schema keeps domain tables in the same Drizzle config', /export \* +from '\.\/auth\.schema'/.test(read('src/lib/server/db/schema.ts')));

		// Apply the schema: auth tables and SVForge domain tables together.
		// `--force` is acceptable here ONLY because the target database was
		// created by this spike and verified empty.
		run(pm, ['run', 'db:push', '--', '--force']);
		const tables = await database.listTables(new URL(databaseUrl).pathname.slice(1));
		check('db:push creates auth + domain tables', ['user', 'session', 'account', 'verification', 'task'].every((name) => tables.includes(name)), tables.join(','));

		// 5. Runtime: role elevation, closed signup, disabled session --------
		patch('src/hooks.server.ts', [
			[
				"import { svelteKitHandler } from 'better-auth/svelte-kit';",
				`import { svelteKitHandler } from 'better-auth/svelte-kit';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';`
			],
			[
				'export const handle: Handle = sequence(handleBetterAuth, handleParaglide);',
				`// SVForge extension: reject a disabled identity even with a live session.
const handleSvforgePolicy: Handle = async ({ event, resolve }) => {
	if (event.locals.user) {
		const [row] = await db
			.select({ disabled: user.disabled })
			.from(user)
			.where(eq(user.id, event.locals.user.id))
			.limit(1);
		if (!row || row.disabled) {
			event.locals.user = null;
			event.locals.session = null;
		}
	}
	return resolve(event);
};

export const handle: Handle = sequence(handleBetterAuth, handleParaglide, handleSvforgePolicy);`
			]
		]);

		mkdirSync(join(app, 'src/routes/poc-whoami'), { recursive: true });
		writeFileSync(
			join(app, 'src/routes/poc-whoami/+server.ts'),
			`import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) =>
	json({ user: locals.user ? { role: locals.user.role, disabled: locals.user.disabled } : null });
`
		);

		const base = `http://127.0.0.1:${port}`;
		const origin = base;

		startServer();
		await waitFor(`${base}/`);

		// Closed signup (default in this patch): the endpoint must refuse.
		const closed = await fetch(`${base}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin },
			body: JSON.stringify({ email: 'closed@spike.test', password: 'password123', name: 'Closed' })
		});
		const closedBody = await closed.text();
		check('closed signup is refused server-side', closed.status === 400 && closedBody.includes('EMAIL_PASSWORD_SIGN_UP_DISABLED'), `${closed.status} ${closedBody.slice(0, 80)}`);

		// Re-open signup to test the role/disabled input gate.
		startServer({ SPIKE_OPEN_SIGNUP: '1' });
		await waitFor(`${base}/`);

		const signup = await fetch(`${base}/api/auth/sign-up/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin },
			body: JSON.stringify({ email: 'elevate@spike.test', password: 'password123', name: 'Elevate', role: 'admin', disabled: true })
		});
		const cookies = signup.headers.getSetCookie?.().map((cookie) => cookie.split(';')[0]).join('; ') ?? '';
		check('signup with an injected role still succeeds', signup.status === 200, String(signup.status));
		const [stored] = pg(databaseUrl, `select role, disabled from "user" where email = 'elevate@spike.test';`);
		check('additionalFields input:false ignores role/disabled from the signup body', stored?.role === 'user' && stored?.disabled === false, JSON.stringify(stored));

		// A disabled identity keeps a valid Better Auth session — the app-level
		// handle must reject it (the reason SVForge keeps a policy extension).
		pg(databaseUrl, `update "user" set disabled = true where email = 'elevate@spike.test';`);
		const sessionKept = await fetch(`${base}/api/auth/get-session`, { headers: { cookie: cookies } });
		const sessionBody = await sessionKept.json();
		check('Better Auth alone keeps a disabled session', Boolean(sessionBody?.session), JSON.stringify(sessionBody).slice(0, 80));
		const probeDisabled = await (await fetch(`${base}/poc-whoami`, { headers: { cookie: cookies } })).json();
		check('the composed SVForge handle rejects the disabled identity', probeDisabled?.user === null, JSON.stringify(probeDisabled));

		pg(databaseUrl, `update "user" set disabled = false where email = 'elevate@spike.test';`);
		const probeEnabled = await (await fetch(`${base}/poc-whoami`, { headers: { cookie: cookies } })).json();
		check('re-enabled identity is restored', probeEnabled?.user?.role === 'user', JSON.stringify(probeEnabled));

		stopServer();
		} finally {
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
		}
	});

	const adminTablesAfter = await listAdminTables();
	check(
		'the caller-supplied database is left unchanged',
		JSON.stringify(adminTablesBefore) === JSON.stringify(adminTablesAfter),
		`before=[${adminTablesBefore.join(',')}] after=[${adminTablesAfter.join(',')}]`
	);

	console.log('\n# summary');
	for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}`);
	if (failures.length) {
		console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
		process.exitCode = 1;
	} else {
		console.log('\nAll checks passed.');
	}
} catch (error) {
	console.error(`\nspike failed: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
} finally {
	stopServer();
	if (!keep) rmSync(workdir, { recursive: true, force: true });
	else console.log(`fixture kept at ${app} (spike database dropped)`);
}
