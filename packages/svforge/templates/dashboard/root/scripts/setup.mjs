#!/usr/bin/env node
// Local development preparation for generated Dashboard projects (#589).
//
// Default: prepare the private .env only (no service, no schema change).
// Explicit flags add deliberate side effects:
//   --compose       generate docker-compose.yml + local PostgreSQL and start it
//   --init-schema   initialize the schema of the VERIFIED local Compose database
//   --admin         create the first administrator (skipped without ADMIN_NAME/EMAIL)
//
// Credentials are never printed. Existing values, volumes and database rows are
// preserved on rerun. Never source .env as executable shell code.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	chmodSync, existsSync, linkSync, lstatSync, readFileSync, renameSync,
	unlinkSync, writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = (name) => resolve(root, name);
const POSTGRES_IMAGE = 'postgres:17.2';
const POSTGRES_USER = 'svforge';
const POSTGRES_DB = 'svforge';
const LOCAL_DB_MARKER = 'SVFORGE_LOCAL_DB';
const PLACEHOLDER_URL = /^(?:|postgres(?:ql)?:\/\/user:password@host:port\/db-name)$/;

function readOptional(name) {
	try {
		if (!lstatSync(path(name)).isFile()) throw new Error(`${name} must be a regular file (no symlinks).`);
		return readFileSync(path(name), 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return undefined;
		throw error;
	}
}

// Write through a private temporary file. Creating .env uses an exclusive
// link so an existing configuration is never overwritten by a racing setup.
function writePrivateEnv(content, existing) {
	const temporary = path(`.env.${randomBytes(12).toString('hex')}.tmp`);
	try {
		writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
		if (existing === undefined) linkSync(temporary, path('.env'));
		else {
			if (readOptional('.env') !== existing) throw new Error('.env changed during setup; rerun setup.');
			renameSync(temporary, path('.env'));
		}
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

/**
 * Whether Git already tracks OR stages `.env`.
 *
 * An ignore rule only keeps an UNTRACKED file out of commits: Git keeps
 * committing an `.env` that is already in the index. Writing or repairing a
 * credential there would make the secret eligible for the next commit, so
 * preparation refuses instead of relying on `.gitignore`.
 */
function envIsIndexed() {
	try {
		const indexed = execFileSync(
			'git',
			['-C', root, 'ls-files', '--cached', '--', '.env'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		);
		return indexed.trim().length > 0;
	} catch {
		// Not a Git repository, or Git is unavailable: nothing can be indexed.
		return false;
	}
}

function packageManager() {
	return existsSync(path('bun.lock')) || existsSync(path('bun.lockb')) ? 'bun'
		: existsSync(path('pnpm-lock.yaml')) ? 'pnpm' : existsSync(path('yarn.lock')) ? 'yarn' : 'npm';
}

/** Compose command, or null when Docker Compose is unavailable. */
function composeCommand() {
	for (const candidate of [['docker', 'compose'], ['docker-compose']]) {
		try {
			execFileSync(candidate[0], [...candidate.slice(1), 'version'], { stdio: 'ignore' });
			return candidate;
		} catch {
			// Try the next supported command.
		}
	}
	return null;
}

function compose(args, options = {}) {
	const command = composeCommand();
	if (!command) throw new Error('Docker Compose is not available. Install Docker with the Compose plugin, or configure an existing PostgreSQL with --database-url.');
	const result = spawnSync(command[0], [...command.slice(1), ...args], { cwd: root, stdio: 'inherit', ...options });
	if (result.error) throw result.error;
	return result.status ?? 1;
}

function portIsFree(port) {
	return new Promise((resolvePromise) => {
		const server = createServer();
		server.once('error', () => resolvePromise(false));
		server.once('listening', () => server.close(() => resolvePromise(true)));
		server.listen({ host: '127.0.0.1', port, exclusive: true });
	});
}

async function firstFreePort() {
	for (let port = 5432; port <= 5452; port++) {
		if (await portIsFree(port)) return port;
	}
	throw new Error('No free local PostgreSQL port in 5432-5452. Stop the conflicting service or set POSTGRES_PORT in .env.');
}

function composeDatabaseReady() {
	const command = composeCommand();
	if (!command) return false;
	const ready = spawnSync(command[0], [...command.slice(1), 'exec', '-T', 'postgres', 'pg_isready', '-U', POSTGRES_USER, '-d', POSTGRES_DB], { cwd: root, stdio: 'ignore' });
	return ready.status === 0;
}

function assignment(key) {
	return new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*(?:"[^"]*"|'[^']*'|\`[^\`]*\`|[^\\r\\n'"\`]*?)[ \\t]*(?:#[^\\r\\n]*)?(?=\\r?$)`, 'm');
}

/** Set a dotenv key without disturbing unrelated or multiline values. */
function setEnvValue(content, key, value) {
	const entries = content.match(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=`, 'gm')) ?? [];
	if (entries.length > 1) throw new Error(`Duplicate ${key} entries; resolve them in .env before rerunning setup.`);
	const line = `${key}=${value}`;
	if (entries.length === 0) return `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`;
	const entry = assignment(key);
	if (!entry.test(content)) throw new Error(`Cannot safely update ${key}; fix its dotenv assignment first.`);
	return content.replace(entry, line);
}

function isLocalHost(hostname) {
	return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

function parseDatabaseUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('DATABASE_URL is not a valid URL. Expected postgres://user:password@host:port/database.');
	}
	if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
		throw new Error('DATABASE_URL must use postgres:// or postgresql://.');
	}
	if (!url.hostname || !url.pathname || url.pathname === '/') {
		throw new Error('DATABASE_URL must include a host and a database name.');
	}
	return url;
}

function composeFile() {
	return `# Generated by SVForge local setup (#589). Local development only.
# Credentials come from the ignored .env file; never commit them.
services:
  postgres:
    image: ${POSTGRES_IMAGE}
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "127.0.0.1:\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 12
volumes:
  postgres-data:
`;
}

function isPlaceholderSecret(secret) {
	return !secret || secret.trim().length < 32 || /^(?:changeme|your[-_ ].*secret|replace[-_ ].*secret)/i.test(secret.trim());
}

function isPlaceholderUrl(value) {
	return PLACEHOLDER_URL.test((value ?? '').trim().replace(/^["']|["']$/g, ''));
}

function runScript(pm, script, options = {}) {
	const result = spawnSync(pm, ['run', script], { cwd: root, encoding: 'utf8', ...options });
	return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function waitForComposeDatabase() {
	for (let attempt = 0; attempt < 60; attempt++) {
		const ready = spawnSync(composeCommand()[0], [...composeCommand().slice(1), 'exec', '-T', 'postgres', 'pg_isready', '-U', POSTGRES_USER, '-d', POSTGRES_DB], { cwd: root, stdio: 'ignore' });
		if (ready.status === 0) return true;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
	}
	return false;
}

async function prepare() {
	const { values } = parseArgs({
		options: {
			defer: { type: 'boolean' },
			compose: { type: 'boolean' },
			'init-schema': { type: 'boolean' },
			admin: { type: 'boolean' },
			help: { type: 'boolean' }
		}
	});
	if (values.help) {
		console.log(`Usage: bash scripts/setup.sh [options]

Default: prepare the private .env only. Never starts services or changes a database.
  --compose      Generate docker-compose.yml, start the local PostgreSQL container
                 (127.0.0.1 only, project-specific password) and configure DATABASE_URL.
  --init-schema  Initialize the schema of the verified local Compose database
                 with the project's db:push script (never --force, never a remote DB).
  --admin        Create the first administrator from ADMIN_NAME/ADMIN_EMAIL;
                 a missing ADMIN_PASSWORD is generated, stored in .env, never printed.
  --defer        Do nothing and print the later command.
  --help         Show this help.`);
		return;
	}
	if (values.defer) {
		console.log('Local configuration deferred. No files changed. Later: bash scripts/setup.sh');
		return;
	}

	// Checked before anything is written, so a refused run leaves no partial
	// state (no .gitignore edit, no credential).
	if (envIsIndexed()) {
		throw new Error(
			'Refusing to prepare credentials: .env is tracked by Git (staged or committed), so a generated secret could be committed. Run `git rm --cached .env`, commit that removal, rotate any secret that was already committed, then rerun setup.'
		);
	}

	const externalUrl = process.env.SVFORGE_DATABASE_URL;
	if (externalUrl) {
		const parsed = parseDatabaseUrl(externalUrl);
		if (values.compose) throw new Error('Choose one database source: --compose or SVFORGE_DATABASE_URL, not both.');
		void parsed;
	}

	const existing = readOptional('.env');
	const source = existing ?? readOptional('.env.example');
	if (source === undefined) throw new Error('Missing .env.example; restore the final generated example and rerun setup.');
	const ignore = readOptional('.gitignore') ?? '';
	const env = parseEnv(source);

	// Better Auth requires at least 32 characters. Preserve valid user secrets,
	// including quoted values, rather than silently invalidating their sessions.
	const secret = env.BETTER_AUTH_SECRET ?? '';
	const secretValid = !isPlaceholderSecret(secret);
	const generatedSecret = secretValid ? undefined : randomBytes(32).toString('base64');

	let content = source;
	const status = { envCreated: existing === undefined, secretGenerated: generatedSecret !== undefined };
	const changes = {};
	if (generatedSecret) changes.BETTER_AUTH_SECRET = generatedSecret;

	// ── Database configuration ─────────────────────────────────────────────
	let composeStarted = false;
	let composeFileCreated = false;
	let databaseConfigured = false;
	if (values.compose) {
		if (!composeCommand()) {
			throw new Error('Docker Compose is not available. Install Docker with the Compose plugin, or configure an existing PostgreSQL with --database-url.');
		}
		const password = env.POSTGRES_PASSWORD && !isPlaceholderSecret(env.POSTGRES_PASSWORD)
			? env.POSTGRES_PASSWORD : randomBytes(24).toString('base64url');
		const marker = env[LOCAL_DB_MARKER] === 'compose';
		const port = marker && /^\d+$/.test(env.POSTGRES_PORT ?? '') ? Number(env.POSTGRES_PORT) : await firstFreePort();
		const generatedUrl = `postgres://${POSTGRES_USER}:${password}@127.0.0.1:${port}/${POSTGRES_DB}`;
		if (env.DATABASE_URL && !isPlaceholderUrl(env.DATABASE_URL) && env.DATABASE_URL.trim().replace(/^["']|["']$/g, '') !== generatedUrl) {
			throw new Error('DATABASE_URL already points at a database SVForge does not manage. Refusing to overwrite it with a local Compose database; use --database-url to keep it, or edit .env first.');
		}
		changes.POSTGRES_PASSWORD = password;
		changes.POSTGRES_PORT = String(port);
		changes[LOCAL_DB_MARKER] = 'compose';
		changes.DATABASE_URL = generatedUrl;
		databaseConfigured = true;

		const composePath = path('docker-compose.yml');
		if (!existsSync(composePath)) {
			writeFileSync(composePath, composeFile(), { mode: 0o644 });
			composeFileCreated = true;
		}
	} else if (externalUrl) {
		parseDatabaseUrl(externalUrl);
		changes.DATABASE_URL = externalUrl;
		databaseConfigured = true;
	}

	for (const [key, value] of Object.entries(changes)) content = setEnvValue(content, key, value);

	// A line resembling a credential assignment may be inside another quoted
	// multiline value. Check the parsed result before touching either file.
	const prepared = parseEnv(content);
	const allowed = new Set(Object.keys(changes));
	if (!prepared.BETTER_AUTH_SECRET || Object.keys({ ...env, ...prepared }).some(
		(key) => !allowed.has(key) && env[key] !== prepared[key]
	)) throw new Error('Cannot safely update .env; resolve ambiguous dotenv entries first.');

	// The last ignore rule wins, even when a user previously added !.env.
	if (!['.env', '/.env'].includes(ignore.trimEnd().split(/\r?\n/).at(-1))) {
		writeFileSync(path('.gitignore'), `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}/.env\n`);
	}
	if (existing !== content) writePrivateEnv(content, existing);
	chmodSync(path('.env'), 0o600);

	const pm = packageManager();
	const preparedEnv = parseEnv(readFileSync(path('.env'), 'utf8'));
	const dbUrl = preparedEnv.DATABASE_URL ?? '';

	// ── Start the local Compose database (explicit --compose only) ──────────
	if (values.compose) {
		console.log('==> Starting the local PostgreSQL container (127.0.0.1 only)');
		const up = compose(['up', '-d', 'postgres']);
		if (up !== 0) throw new Error('`docker compose up -d postgres` failed. Inspect the output above, then rerun setup.');
		if (!waitForComposeDatabase()) {
			console.error('PostgreSQL did not become healthy in time. Inspect `docker compose logs postgres`; no schema change was attempted.');
			process.exitCode = 1;
			return;
		}
		composeStarted = true;
	}

	// ── Schema initialization (explicit --init-schema only) ────────────────
	let schemaInitialized = false;
	if (values['init-schema']) {
		if (!databaseConfigured) throw new Error('Refusing to initialize a schema outside the verified local Compose database. Start it with `bash scripts/setup.sh --compose`, or run your own `db:push`/`db:migrate` against the intended database.');
		const parsed = parseDatabaseUrl(dbUrl);
		const verified = preparedEnv[LOCAL_DB_MARKER] === 'compose'
			&& existsSync(path('docker-compose.yml'))
			&& isLocalHost(parsed.hostname)
			&& parsed.username === POSTGRES_USER
			&& parsed.pathname === `/${POSTGRES_DB}`;
		if (!verified) {
			throw new Error('Refusing to initialize a schema outside the verified local Compose database. Start it with `bash scripts/setup.sh --compose`, or run your own `db:push`/`db:migrate` against the intended database.');
		}
		if (!composeDatabaseReady()) {
			throw new Error('The local PostgreSQL is unreachable; no schema change was attempted. Run `bash scripts/setup.sh --compose` and inspect `docker compose logs postgres`.');
		}
		// The official Better Auth integration ships the generator script, not the
		// generated Drizzle file: generate it once so db:push also creates the
		// auth tables the first-admin bootstrap needs.
		const hasAuthSchemaScript = (() => {
			try {
				const pkg = JSON.parse(readFileSync(path('package.json'), 'utf8'));
				return Boolean(pkg.scripts?.['auth:schema']);
			} catch {
				return false;
			}
		})();
		const authSchemaPath = path('src/lib/server/db/auth.schema.ts');
		const authSchemaPending = !existsSync(authSchemaPath)
			|| /have not run the auth:schema script/i.test(readFileSync(authSchemaPath, 'utf8'));
		if (authSchemaPending && hasAuthSchemaScript) {
			console.log(`==> Generating the Better Auth schema with \`${pm} run auth:schema\``);
			const authSchema = spawnSync(pm, ['run', 'auth:schema'], { cwd: root, stdio: 'inherit' });
			if ((authSchema.status ?? 1) !== 0) {
				console.error('Better Auth schema generation failed; no database schema change was attempted. Fix the error above and rerun.');
				process.exitCode = 1;
				return;
			}
		}
		// `--force` is limited to this explicitly requested, verified LOCAL Compose
		// database: Drizzle requires it to skip the confirmation prompt in
		// non-interactive shells. It is never used for a remote/external URL.
		console.log(`==> Initializing the local schema with \`${pm} run db:push -- --force\` (verified local Compose database only)`);
		const push = spawnSync(pm, ['run', 'db:push', '--', '--force'], { cwd: root, stdio: 'inherit' });
		if ((push.status ?? 1) !== 0) {
			console.error('Schema initialization failed. The database is reachable but the schema was not confirmed; fix the error above and rerun. No migrations were run automatically.');
			process.exitCode = 1;
			return;
		}
		schemaInitialized = true;
	}

	// ── First administrator (optional, never destructive) ──────────────────
	let adminStatus = 'not requested';
	if (values.admin) {
		const adminEnv = { ...preparedEnv, ...process.env };
		const name = adminEnv.ADMIN_NAME?.trim();
		const email = adminEnv.ADMIN_EMAIL?.trim();
		if (!name || !email) {
			adminStatus = 'skipped (set ADMIN_NAME and ADMIN_EMAIL in .env, then rerun with --admin)';
		} else {
			let adminPassword = adminEnv.ADMIN_PASSWORD?.trim();
			if (!adminPassword) {
				adminPassword = randomBytes(24).toString('base64url');
				const updated = setEnvValue(readFileSync(path('.env'), 'utf8'), 'ADMIN_PASSWORD', adminPassword);
				writePrivateEnv(updated, readFileSync(path('.env'), 'utf8'));
				chmodSync(path('.env'), 0o600);
				console.log('==> Generated a first-admin password and saved it in .env (not printed).');
			}
			const result = runScript(pm, 'admin:create', {
				env: { ...process.env, ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: adminPassword }
			});
			if (/already exists/i.test(result.output)) {
				adminStatus = 'already exists (unchanged)';
			} else if (result.status !== 0) {
				console.error(result.output.trim());
				console.error('First-admin creation failed; no administrator was changed. Fix the error above and rerun with --admin.');
				process.exitCode = 1;
				return;
			} else {
				adminStatus = `created (${email})`;
			}
		}
	}

	// ── Accurate summary, no credential values ─────────────────────────────
	console.log('');
	console.log('Local environment status:');
	console.log(`  .env: ${status.envCreated ? 'created from .env.example' : 'preserved existing settings'} (mode 600, Git-ignored)`);
	console.log(`  Better Auth secret: ${status.secretGenerated ? 'generated' : 'kept existing'}`);
	if (values.compose) {
		console.log(`  docker-compose.yml: ${composeFileCreated ? 'generated' : 'left untouched'}`);
		console.log(`  PostgreSQL: ${composeStarted ? `healthy on 127.0.0.1:${preparedEnv.POSTGRES_PORT}` : 'not started'} (local Compose only)`);
	}
	console.log(`  DATABASE_URL: ${databaseConfigured ? 'configured (value not printed)' : 'not configured'}`);
	console.log(`  Schema: ${schemaInitialized ? 'initialized with db:push' : 'not initialized'}`);
	console.log(`  First admin: ${adminStatus}`);

	if (!databaseConfigured) {
		console.log(`
Local files prepared. Database connectivity not checked; schema not initialized.
Next steps:
  1. Configure a local database (recommended):
       bash scripts/setup.sh --compose --init-schema
     Or point DATABASE_URL at a PostgreSQL database you control, then run:
       ${pm} run db:push        (initial local development)
       ${pm} run db:generate && ${pm} run db:migrate   (versioned migrations)
  2. Create the first administrator (refuses if one exists):
       ${pm} run admin:create -- --name 'Admin' --email admin@example.com --password '…'
     Or use /setup in development after starting: ${pm} run dev
  3. Start developing: ${pm} run dev
Sign-up remains controlled by SIGNUP_MODE in .env (closed by default).`);
	} else {
		console.log(`
Next steps:
  - Start the app: ${pm} run dev
  - Stop the database without deleting data: docker compose down
  - Create the first administrator (refuses if one exists):
      ${pm} run admin:create -- --name 'Admin' --email admin@example.com --password '…'
    Or use /setup in development.
  - Schema changes: ${pm} run db:push (local) or ${pm} run db:generate && ${pm} run db:migrate (versioned).
  - Rerun this command safely: secrets, volumes and existing rows are preserved.`);
	}
}

try {
	await prepare();
} catch (error) {
	// Do not print raw filesystem/parser errors: input may contain credentials.
	const safe = error.code ? `Local preparation failed (${error.code}). Check file permissions and arguments, then rerun setup.` : error.message;
	console.error(safe);
	process.exitCode = 1;
}
