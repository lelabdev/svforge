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
 * Requires PostgreSQL (schema push + runtime probes):
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/sf_547 \
 *     node scripts/spike-547.mjs [--pm npm|bun] [--dir <path>] [--keep]
 *
 * The fixture is deleted unless `--keep` is passed. Nothing in the repository is
 * modified: all patches are applied to the disposable fixture.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

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
const databaseUrl = String(flag('database-url', process.env.DATABASE_URL ?? ''));
const workdir = String(flag('dir', mkdtempSync(join(tmpdir(), 'sf-547-'))));
mkdirSync(workdir, { recursive: true });
const app = join(workdir, 'app');
const port = Number(flag('port', 5470));

if (!databaseUrl) {
	console.error('Missing DATABASE_URL (or --database-url). PostgreSQL is required for db:push and the runtime probes.');
	process.exit(2);
}

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

function query(sql) {
	const result = run(process.execPath, [
		'--input-type=module',
		'-e',
		`import postgres from 'postgres';
		 const sql = postgres(process.env.DATABASE_URL, { max: 1 });
		 const rows = await sql.unsafe(${JSON.stringify(sql)});
		 console.log(JSON.stringify(rows));
		 await sql.end();`
	], { env: { DATABASE_URL: databaseUrl } });
	return JSON.parse(result.stdout.trim().split('\n').pop());
}

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
function stopServer() {
	if (!server.child) return;
	try {
		process.kill(-server.child.pid, 'SIGTERM');
	} catch {
		/* already gone */
	}
	server.child = undefined;
}

try {
	console.log(`# spike #547 — fixture ${app} (${pm}, port ${port})`);

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
	// ORIGIN must match the serving origin: Better Auth only handles /api/auth/*
	// when the request origin equals `baseURL` (verified in the POC).
	const env = read('.env')
		.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${databaseUrl}"`)
		.replace(/^ORIGIN=.*$/m, `ORIGIN="http://127.0.0.1:${port}"`);
	writeFileSync(join(app, '.env'), env);

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

	// The official script generates the schema from auth.ts (needs DATABASE_URL).
	run(pm, ['run', 'auth:schema']);
	const schema = read('src/lib/server/db/auth.schema.ts');
	check('additionalFields generates NOT NULL role/disabled', /role: text\("role"\)\.default\("user"\)\.notNull\(\)/.test(schema) && /disabled: boolean\("disabled"\)\.default\(false\)\.notNull\(\)/.test(schema));
	check('official schema keeps domain tables in the same Drizzle config', read('src/lib/server/db/schema.ts').includes("export *  from './auth.schema'") || read('src/lib/server/db/schema.ts').includes("export * from './auth.schema'"));

	// 5. Apply the schema: auth tables and SVForge domain tables together ----
	run(pm, ['run', 'db:push', '--', '--force']);
	const tables = query(`select table_name from information_schema.tables where table_schema = 'public' order by table_name;`).map((row) => row.table_name);
	check('db:push creates auth + domain tables', ['user', 'session', 'account', 'verification', 'task'].every((name) => tables.includes(name)), tables.join(','));

	// 6. Runtime: role elevation, closed signup, disabled session ------------
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

	stopServer();
	server.child = spawn(pm, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
		cwd: app,
		detached: true,
		stdio: 'ignore',
		env: { ...process.env }
	});
	await waitFor(`http://127.0.0.1:${port}/`);

	const base = `http://127.0.0.1:${port}`;
	const origin = `http://127.0.0.1:${port}`;

	// Closed signup (default in this patch): the endpoint must refuse.
	const closed = await fetch(`${base}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body: JSON.stringify({ email: 'closed@spike.test', password: 'password123', name: 'Closed' })
	});
	const closedBody = await closed.text();
	check('closed signup is refused server-side', closed.status === 400 && closedBody.includes('EMAIL_PASSWORD_SIGN_UP_DISABLED'), `${closed.status} ${closedBody.slice(0, 80)}`);

	// Re-open signup to test the role/disabled input gate.
	stopServer();
	server.child = spawn(pm, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
		cwd: app,
		detached: true,
		stdio: 'ignore',
		env: { ...process.env, SPIKE_OPEN_SIGNUP: '1' }
	});
	await waitFor(`${base}/`);

	const signup = await fetch(`${base}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body: JSON.stringify({ email: 'elevate@spike.test', password: 'password123', name: 'Elevate', role: 'admin', disabled: true })
	});
	const cookies = signup.headers.getSetCookie?.().map((cookie) => cookie.split(';')[0]).join('; ') ?? '';
	check('signup with an injected role still succeeds', signup.status === 200, String(signup.status));
	const [stored] = query(`select role, disabled from "user" where email = 'elevate@spike.test';`);
	check('additionalFields input:false ignores role/disabled from the signup body', stored?.role === 'user' && stored?.disabled === false, JSON.stringify(stored));

	// A disabled identity keeps a valid Better Auth session — the app-level
	// handle must reject it (the reason SVForge keeps a policy extension).
	query(`update "user" set disabled = true where email = 'elevate@spike.test';`);
	const sessionKept = await fetch(`${base}/api/auth/get-session`, { headers: { cookie: cookies } });
	const sessionBody = await sessionKept.json();
	check('Better Auth alone keeps a disabled session', Boolean(sessionBody?.session), JSON.stringify(sessionBody).slice(0, 80));
	const probeDisabled = await (await fetch(`${base}/poc-whoami`, { headers: { cookie: cookies } })).json();
	check('the composed SVForge handle rejects the disabled identity', probeDisabled?.user === null, JSON.stringify(probeDisabled));

	query(`update "user" set disabled = false where email = 'elevate@spike.test';`);
	const probeEnabled = await (await fetch(`${base}/poc-whoami`, { headers: { cookie: cookies } })).json();
	check('re-enabled identity is restored', probeEnabled?.user?.role === 'user', JSON.stringify(probeEnabled));

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
	else console.log(`fixture kept at ${app}`);
}
