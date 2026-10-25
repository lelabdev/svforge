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
const COMPOSE_MARKER = '# svforge-managed-compose:1';
const S3_IMAGE = 'adobe/s3mock:5.2.3@sha256:ab01a6946750f451ca215a47e91030695b260e4003b8a5a6201d25029b8fca92';
const LOCAL_S3_MARKER = 'SVFORGE_LOCAL_S3';
const S3_DEFAULT_PORT = 9090;
const COMPOSE_OVERRIDE_FILES = [
	'compose.yaml', 'compose.yml', 'docker-compose.yaml',
	'compose.override.yml', 'compose.override.yaml',
	'docker-compose.override.yml', 'docker-compose.override.yaml'
];
const COMPOSE_CONTROL_ENV = [
	'COMPOSE_FILE', 'COMPOSE_PROFILES', 'COMPOSE_PROJECT_NAME',
	'COMPOSE_ENV_FILES', 'COMPOSE_PATH_SEPARATOR', 'COMPOSE_DISABLE_ENV_FILE'
];
// Ambient variables that could redirect Drizzle/Better Auth away from the
// verified .env connection (#589 review B-02).
const DATABASE_ENV_KEYS = [
	'DATABASE_URL', 'TEST_DATABASE_URL', 'DRIZZLE_DATABASE_URL',
	'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSERVICE'
];
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

function rootBaseName() {
	const name = root.split(/[\\/]/).pop() ?? 'app';
	const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
	return slug || 'app';
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
	const result = spawnSync(command[0], [...command.slice(1), ...args], { cwd: root, stdio: 'inherit', env: sanitizedEnv(options.env), ...options });
	if (result.error) throw result.error;
	return result.status ?? 1;
}

/** Drop ambient DB/Compose controls from any child environment. */
function sanitizedEnv(extra = {}) {
	const env = { ...process.env };
	for (const key of [...DATABASE_ENV_KEYS, ...COMPOSE_CONTROL_ENV, 'COMPOSE_PROJECT_NAME']) delete env[key];
	return { ...env, ...extra };
}

/** Explicit project file + env, so ambient COMPOSE_* cannot alter the target. */
function composeProjectArgs(args) {
	return ['-f', 'docker-compose.yml', '--env-file', '.env', ...args];
}

function portIsFree(port) {
	return new Promise((resolvePromise) => {
		const server = createServer();
		server.once('error', () => resolvePromise(false));
		server.once('listening', () => server.close(() => resolvePromise(true)));
		server.listen({ host: '127.0.0.1', port, exclusive: true });
	});
}

async function firstFreePort(start, end) {
	for (let port = start; port <= end; port++) {
		if (await portIsFree(port)) return port;
	}
	throw new Error(`No free local port in ${start}-${end}. Stop the conflicting service or set the port explicitly in .env.`);
}

function composeDatabaseReady() {
	const command = composeCommand();
	if (!command) return false;
	const ready = spawnSync(command[0], [...command.slice(1), ...composeProjectArgs(['exec', '-T', 'postgres', 'pg_isready', '-U', POSTGRES_USER, '-d', POSTGRES_DB])], { cwd: root, stdio: 'ignore', env: sanitizedEnv() });
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

function composeFile(includeS3) {
	const s3 = includeS3 ? `  s3:
    image: ${S3_IMAGE}
    restart: unless-stopped
    environment:
      COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS: \${S3_BUCKET:?Set S3_BUCKET in .env}
      COM_ADOBE_TESTING_S3MOCK_STORE_ROOT: /s3mockroot
      COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT: "true"
    ports:
      - "127.0.0.1:\${S3_PORT:-9090}:9090"
    volumes:
      - s3-data:/s3mockroot
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:9090/ || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 12
` : '';
	const volumes = includeS3 ? '  postgres-data:\n  s3-data:' : '  postgres-data:';
	return `${COMPOSE_MARKER}
# Generated by SVForge local setup (#589${includeS3 ? ', #610' : ''}). Local development only.
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
${s3}volumes:
${volumes}
`;
}

/** Whether the selected project modules include S3-compatible storage. */
function projectUsesS3() {
	try {
		const manifest = JSON.parse(readFileSync(path('.svforge.json'), 'utf8'));
		if (Array.isArray(manifest.modules) && manifest.modules.includes('uploads')) return true;
	} catch {
		// Fall through to the delivered-file probe.
	}
	return existsSync(path('src/lib/server/s3.ts'));
}

function isPlaceholderS3(value) {
	const trimmed = (value ?? '').trim().replace(/^["']|["']$/g, '');
	return trimmed === '' || /^https?:\/\/your-s3-compatible-endpoint$/.test(trimmed)
		|| /^(?:your_bucket_name|your_access_key_id|replace_with_s3_secret_access_key|your_s3_region)$/.test(trimmed);
}

/** An explicit external S3/R2 configuration is preserved, never replaced. */
function hasExternalS3(env) {
	return !isPlaceholderS3(env.S3_ENDPOINT) && env[LOCAL_S3_MARKER] !== 'compose';
}

function s3ProvisioningEnabled(env) {
	return projectUsesS3() && !hasExternalS3(env);
}

/**
 * Provenance check (#589 review B-01): a managed file must be byte-identical
 * to the canonical generated document, no override file may exist, and no
 * ambient Compose control may change which project/files are used. Anything
 * else is user-owned and must never be started or trusted as local database.
 */
function managedComposeProblems(content, includeS3) {
	const normalized = content.replace(/\r\n/g, '\n').trimEnd();
	if (!normalized.includes(COMPOSE_MARKER)) return ['missing the SVForge ownership marker'];
	if (normalized !== composeFile(includeS3).replace(/\r\n/g, '\n').trimEnd()) {
		return ['differs from the canonical SVForge-managed Compose document'];
	}
	const overrides = COMPOSE_OVERRIDE_FILES.filter((file) => existsSync(path(file)));
	if (overrides.length > 0) return [`unexpected Compose override files (${overrides.join(', ')})`];
	const controls = COMPOSE_CONTROL_ENV.filter((key) => process.env[key] !== undefined);
	if (controls.length > 0) return [`unexpected Compose environment controls (${controls.join(', ')})`];
	return [];
}

/** Canonical variant of the on-disk file: true = with S3, false = PostgreSQL only, null = not managed. */
function currentComposeVariant() {
	const composePath = path('docker-compose.yml');
	if (!existsSync(composePath)) return undefined;
	const content = readFileSync(composePath, 'utf8');
	if (managedComposeProblems(content, false).length === 0) return false;
	if (managedComposeProblems(content, true).length === 0) return true;
	return null;
}

/** Atomic replacement: a failed write never leaves a truncated Compose file. */
function writeComposeFile(content) {
	const temporary = path(`docker-compose.yml.${randomBytes(8).toString('hex')}.tmp`);
	try {
		writeFileSync(temporary, content, { mode: 0o644, flag: 'wx' });
		renameSync(temporary, path('docker-compose.yml'));
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

/**
 * Validate the EFFECTIVE Compose model (parsed by Compose itself, including
 * interpolation) for the expected service/port/volume/environment
 * (#589 review B-01). The candidate .env values are passed explicitly so this
 * runs before .env is written.
 */
function effectiveComposeProblems(values, includeS3) {
	const command = composeCommand();
	if (!command) return ['Docker Compose is not available'];
	const port = String(values.POSTGRES_PORT ?? '');
	const password = values.POSTGRES_PASSWORD ?? '';
	if (!/^\d+$/.test(port) || !password) return ['incomplete Compose interpolation values'];
	const temporary = path(`.env.compose-${randomBytes(12).toString('hex')}.tmp`);
	try {
		writeFileSync(temporary, [
			`POSTGRES_PORT=${port}`,
			`POSTGRES_PASSWORD=${password}`,
			...(includeS3 ? [`S3_PORT=${values.S3_PORT ?? ''}`, `S3_BUCKET=${values.S3_BUCKET ?? ''}`] : [])
		].join('\n') + '\n', { mode: 0o600, flag: 'wx' });
		const result = spawnSync(command[0], [
			...command.slice(1), '-f', 'docker-compose.yml', '--env-file', temporary,
			'config', '--format', 'json'
		], { cwd: root, encoding: 'utf8', env: sanitizedEnv() });
		if (result.status !== 0) return ['cannot validate the effective Compose configuration'];
		let model;
		try {
			model = JSON.parse(result.stdout);
		} catch {
			return ['cannot parse the effective Compose configuration'];
		}
		const problems = [];
		const services = model.services && typeof model.services === 'object' ? Object.keys(model.services) : [];
		const expectedServices = includeS3 ? ['postgres', 's3'] : ['postgres'];
		if (JSON.stringify(services) !== JSON.stringify(expectedServices)) {
			problems.push(`unexpected effective services (${services.join(', ') || 'none'})`);
		}
		const service = model.services?.postgres;
		if (!service) return problems;
		if (service.image !== POSTGRES_IMAGE) problems.push('unexpected effective image');
		const ports = Array.isArray(service.ports) ? service.ports : [];
		if (ports.length !== 1) problems.push('unexpected effective port mappings');
		else {
			const [mapping] = ports;
			if (mapping.host_ip !== '127.0.0.1') problems.push('effective port is not loopback-bound');
			if (String(mapping.published) !== port) problems.push('effective published port does not match POSTGRES_PORT');
			if (Number(mapping.target) !== 5432 || (mapping.protocol ?? 'tcp') !== 'tcp') problems.push('effective container port is not tcp/5432');
		}
		const volumes = Array.isArray(service.volumes) ? service.volumes : [];
		if (volumes.length !== 1) problems.push('unexpected effective volume mappings');
		else {
			const [mount] = volumes;
			if (mount.type !== 'volume' || mount.source !== 'postgres-data' || mount.target !== '/var/lib/postgresql/data') {
				problems.push('effective volume is not the managed named data volume');
			}
		}
		if (!model.volumes || !('postgres-data' in model.volumes)) problems.push('effective named volume is missing');
		const environment = service.environment ?? {};
		if (environment.POSTGRES_USER !== POSTGRES_USER) problems.push('effective POSTGRES_USER mismatch');
		if (environment.POSTGRES_DB !== POSTGRES_DB) problems.push('effective POSTGRES_DB mismatch');
		if (environment.POSTGRES_PASSWORD !== password) problems.push('effective POSTGRES_PASSWORD mismatch');
		if (service.network_mode) problems.push('unexpected network_mode');
		const healthcheck = Array.isArray(service.healthcheck?.test) ? service.healthcheck.test.join(' ') : '';
		if (!healthcheck.includes(`pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}`)) problems.push('unexpected effective health check');

		if (includeS3) {
			const s3Service = model.services?.s3;
			if (!s3Service) problems.push('missing effective s3 service');
			else {
				if (s3Service.image !== S3_IMAGE) problems.push('unexpected effective S3 image');
				const s3Ports = Array.isArray(s3Service.ports) ? s3Service.ports : [];
				if (s3Ports.length !== 1) problems.push('unexpected effective S3 port mappings');
				else {
					const [mapping] = s3Ports;
					if (mapping.host_ip !== '127.0.0.1') problems.push('effective S3 port is not loopback-bound');
					if (String(mapping.published) !== String(values.S3_PORT ?? '')) problems.push('effective S3 port does not match S3_PORT');
					if (Number(mapping.target) !== 9090) problems.push('effective S3 container port is not 9090');
				}
				const s3Volumes = Array.isArray(s3Service.volumes) ? s3Service.volumes : [];
				if (s3Volumes.length !== 1 || s3Volumes[0].type !== 'volume' || s3Volumes[0].source !== 's3-data' || s3Volumes[0].target !== '/s3mockroot') {
					problems.push('effective S3 volume is not the managed persistent volume');
				}
				const s3Environment = s3Service.environment ?? {};
				if (s3Environment.COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS !== values.S3_BUCKET) problems.push('effective S3 bucket mismatch');
				if (s3Environment.COM_ADOBE_TESTING_S3MOCK_STORE_ROOT !== '/s3mockroot') problems.push('effective S3 store root mismatch');
				if (s3Environment.COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT !== 'true') problems.push('effective S3 persistence flag mismatch');
				const s3Health = Array.isArray(s3Service.healthcheck?.test) ? s3Service.healthcheck.test.join(' ') : '';
				if (!s3Health.includes('wget')) problems.push('unexpected effective S3 health check');
			}
			if (!model.volumes || !('s3-data' in model.volumes)) problems.push('effective S3 named volume is missing');
		}
		return problems;
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

/**
 * Prove that DATABASE_URL targets exactly the project-managed Compose service:
 * ownership marker + managed file, exact credentials/port, running container,
 * matching published port and database identity (#589 review B-02).
 */
function verifyManagedDatabase(env) {
	const problems = [];
	const variant = currentComposeVariant();
	const includeS3 = variant === true;
	if (env[LOCAL_DB_MARKER] !== 'compose') problems.push('missing SVFORGE_LOCAL_DB=compose marker');
	const composePath = path('docker-compose.yml');
	if (!existsSync(composePath)) problems.push('missing docker-compose.yml');
	else if (variant === null) {
		problems.push(...managedComposeProblems(readFileSync(composePath, 'utf8'), s3ProvisioningEnabled(env)));
	}
	if (variant !== null && variant !== undefined) problems.push(...effectiveComposeProblems(env, variant));

	let url;
	try {
		url = parseDatabaseUrl(env.DATABASE_URL ?? '');
	} catch {
		problems.push('invalid DATABASE_URL');
	}
	const port = env.POSTGRES_PORT ?? '';
	const password = env.POSTGRES_PASSWORD ?? '';
	if (!/^\d+$/.test(port)) problems.push('missing POSTGRES_PORT');
	if (!password) problems.push('missing POSTGRES_PASSWORD');
	if (url) {
		if (!isLocalHost(url.hostname)) problems.push('DATABASE_URL host is not loopback');
		if ((url.port || '5432') !== port) problems.push('DATABASE_URL port does not match POSTGRES_PORT');
		if (url.username !== POSTGRES_USER) problems.push('DATABASE_URL user does not match the managed service');
		if (url.password !== password) problems.push('DATABASE_URL password does not match POSTGRES_PASSWORD');
		if (url.pathname !== `/${POSTGRES_DB}`) problems.push('DATABASE_URL database does not match the managed service');
	}

	const command = composeCommand();
	if (!command) problems.push('Docker Compose is not available');
	else {
		const prefix = [...command.slice(1)];
		const running = spawnSync(command[0], [...prefix, ...composeProjectArgs(['ps', '--status', 'running', '--services'])], { cwd: root, encoding: 'utf8', env: sanitizedEnv() });
		if (running.status !== 0 || !running.stdout.split(/\s+/).includes('postgres')) {
			problems.push('the managed postgres service is not running');
		}
		const published = spawnSync(command[0], [...prefix, ...composeProjectArgs(['port', 'postgres', '5432'])], { cwd: root, encoding: 'utf8', env: sanitizedEnv() });
		const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout ?? '');
		if (published.status !== 0 || !match) problems.push('cannot determine the managed published port');
		else if (match[1] !== port) problems.push('published port does not match POSTGRES_PORT');

		// A fresh container can accept `pg_isready` before POSTGRES_DB exists, so
		// retry the identity probe instead of rejecting a healthy cold start.
		let identityOutput = '';
		for (let attempt = 0; attempt < 30; attempt++) {
			const identity = spawnSync(command[0], [...prefix, ...composeProjectArgs(['exec', '-T', 'postgres', 'psql', '-U', POSTGRES_USER, '-d', POSTGRES_DB, '-tAc', "select current_database() || '/' || current_user"])], { cwd: root, encoding: 'utf8', env: sanitizedEnv() });
			if (identity.status === 0) {
				identityOutput = identity.stdout.trim();
				break;
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
		}
		if (identityOutput !== `${POSTGRES_DB}/${POSTGRES_USER}`) {
			problems.push('the managed database identity does not match');
		}
	}

	if (includeS3) {
		const s3Port = env.S3_PORT ?? '';
		if (env[LOCAL_S3_MARKER] !== 'compose') problems.push('missing SVFORGE_LOCAL_S3=compose marker');
		if (!/^\d+$/.test(s3Port)) problems.push('missing S3_PORT');
		if (isPlaceholderS3(env.S3_BUCKET)) problems.push('missing S3_BUCKET');
		if (isPlaceholderS3(env.S3_ACCESS_KEY_ID)) problems.push('missing S3_ACCESS_KEY_ID');
		if (isPlaceholderS3(env.S3_SECRET_ACCESS_KEY)) problems.push('missing S3_SECRET_ACCESS_KEY');
		if (env.S3_FORCE_PATH_STYLE !== 'true') problems.push('S3_FORCE_PATH_STYLE must be true for the local S3Mock backend');
		if ((env.S3_ENDPOINT ?? '').trim().replace(/^["']|["']$/g, '') !== `http://127.0.0.1:${s3Port}`) {
			problems.push('S3_ENDPOINT does not match S3_PORT');
		}
		const command = composeCommand();
		if (command) {
			const prefix = [...command.slice(1)];
			const running = spawnSync(command[0], [...prefix, ...composeProjectArgs(['ps', '--status', 'running', '--services'])], { cwd: root, encoding: 'utf8', env: sanitizedEnv() });
			if (running.status !== 0 || !running.stdout.split(/\s+/).includes('s3')) problems.push('the managed s3 service is not running');
			const published = spawnSync(command[0], [...prefix, ...composeProjectArgs(['port', 's3', '9090'])], { cwd: root, encoding: 'utf8', env: sanitizedEnv() });
			const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout ?? '');
			if (published.status !== 0 || !match) problems.push('cannot determine the managed S3 published port');
			else if (match[1] !== s3Port) problems.push('published S3 port does not match S3_PORT');
			const health = spawnSync(command[0], [...prefix, ...composeProjectArgs(['exec', '-T', 's3', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:9090/'])], { cwd: root, stdio: 'ignore', env: sanitizedEnv() });
			if (health.status !== 0) problems.push('the managed s3 service is not healthy');
		}
	}
	return problems;
}

function isPlaceholderSecret(secret) {
	return !secret || secret.trim().length < 32 || /^(?:changeme|your[-_ ].*secret|replace[-_ ].*secret)/i.test(secret.trim());
}

function isPlaceholderUrl(value) {
	return PLACEHOLDER_URL.test((value ?? '').trim().replace(/^["']|["']$/g, ''));
}

/** Explicit DB environment: ambient connection variables never win. */
function databaseChildEnv(url, extra = {}) {
	const env = { ...process.env };
	for (const key of DATABASE_ENV_KEYS) delete env[key];
	return { ...env, DATABASE_URL: url, ...extra };
}

function runScript(pm, script, options = {}) {
	const result = spawnSync(pm, ['run', script], { cwd: root, encoding: 'utf8', ...options });
	return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function healthAttempts() {
	return Number(process.env.SVFORGE_SETUP_HEALTH_ATTEMPTS ?? 60);
}

function waitForComposeDatabase() {
	for (let attempt = 0; attempt < healthAttempts(); attempt++) {
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
                 (plus a persistent local S3Mock service when the uploads module is
                 selected and no external S3/R2 endpoint is configured)
                 (127.0.0.1 only, project-specific password) and configure DATABASE_URL.
                 Reuses only an existing SVForge-managed file; any other file is refused.
  --init-schema  Initialize the schema of the verified local Compose database
                 (auth:schema when pending, then db:push). Refuses any database
                 that is not exactly the project-managed Compose service.
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
	// Refuse ambient Compose controls up front: they could select another
	// project, file, profile or env file than the verified one.
	const controls = COMPOSE_CONTROL_ENV.filter((key) => process.env[key] !== undefined);
	if (controls.length > 0) {
		throw new Error(`Refusing to run with ambient Compose controls (${controls.join(', ')}). Unset them and rely on docker-compose.yml + .env, or manage that stack yourself.`);
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
	let s3Provisioned = false;
	if (values.compose) {
		if (!composeCommand()) {
			throw new Error('Docker Compose is not available. Install Docker with the Compose plugin, or configure an existing PostgreSQL with --database-url.');
		}
		const password = env.POSTGRES_PASSWORD && !isPlaceholderSecret(env.POSTGRES_PASSWORD)
			? env.POSTGRES_PASSWORD : randomBytes(24).toString('base64url');
		const marker = env[LOCAL_DB_MARKER] === 'compose';
		const port = marker && /^\d+$/.test(env.POSTGRES_PORT ?? '') ? Number(env.POSTGRES_PORT) : await firstFreePort(5432, 5452);
		const includeS3 = s3ProvisioningEnabled(env);
		const generatedUrl = `postgres://${POSTGRES_USER}:${password}@127.0.0.1:${port}/${POSTGRES_DB}`;
		if (env.DATABASE_URL && !isPlaceholderUrl(env.DATABASE_URL) && env.DATABASE_URL.trim().replace(/^["']|["']$/g, '') !== generatedUrl) {
			throw new Error('DATABASE_URL already points at a database SVForge does not manage. Refusing to overwrite it with a local Compose database; use --database-url to keep it, or edit .env first.');
		}
		changes.POSTGRES_PASSWORD = password;
		changes.POSTGRES_PORT = String(port);
		changes[LOCAL_DB_MARKER] = 'compose';
		changes.DATABASE_URL = generatedUrl;
		databaseConfigured = true;

		if (includeS3) {
			const localS3 = env[LOCAL_S3_MARKER] === 'compose';
			const s3Port = localS3 && /^\d+$/.test(env.S3_PORT ?? '') ? Number(env.S3_PORT) : await firstFreePort(S3_DEFAULT_PORT, S3_DEFAULT_PORT + 20);
			const projectSlug = rootBaseName();
			const bucket = isPlaceholderS3(env.S3_BUCKET) ? `svforge-${projectSlug}-${randomBytes(4).toString('hex')}` : env.S3_BUCKET;
			changes.S3_ENDPOINT = `http://127.0.0.1:${s3Port}`;
			changes.S3_REGION = isPlaceholderS3(env.S3_REGION) ? 'us-east-1' : env.S3_REGION;
			changes.S3_BUCKET = bucket;
			changes.S3_ACCESS_KEY_ID = isPlaceholderS3(env.S3_ACCESS_KEY_ID) ? `svforge${randomBytes(8).toString('hex')}` : env.S3_ACCESS_KEY_ID;
			changes.S3_SECRET_ACCESS_KEY = isPlaceholderS3(env.S3_SECRET_ACCESS_KEY) ? randomBytes(24).toString('base64url') : env.S3_SECRET_ACCESS_KEY;
			changes.S3_FORCE_PATH_STYLE = 'true';
			changes.S3_PORT = String(s3Port);
			changes[LOCAL_S3_MARKER] = 'compose';
		}
		s3Provisioned = includeS3;

		const composePath = path('docker-compose.yml');
		let transitionFrom = undefined;
		if (existsSync(composePath)) {
			// Fail closed BEFORE writing credentials or starting anything: only an
			// intact SVForge-managed Compose may be adopted as the local database.
			const currentContent = readFileSync(composePath, 'utf8');
			const postgresOnlyProblems = managedComposeProblems(currentContent, false);
			const withS3Problems = managedComposeProblems(currentContent, true);
			const currentVariant = postgresOnlyProblems.length === 0 ? false : withS3Problems.length === 0 ? true : null;
			if (currentVariant === null) {
				const problems = includeS3 ? withS3Problems : postgresOnlyProblems;
				throw new Error(`Existing docker-compose.yml is not SVForge-managed (${problems.join('; ')}). Refusing to modify or start it. Move it away, or use an existing PostgreSQL with SVFORGE_DATABASE_URL.`);
			}
			if (currentVariant && !includeS3) {
				throw new Error('A managed local S3 service already exists, but this project now uses an external S3/R2 configuration (or no longer selects uploads). Refusing to remove or alter it silently. Keep the local service by unsetting the external S3 variables, or deliberately remove the s3 service from docker-compose.yml — the s3-data volume and its objects are preserved either way. Nothing was changed.');
			}
			if (!currentVariant && includeS3) {
				// Supported evolution: PostgreSQL-only -> PostgreSQL + local S3.
				// Validate the CURRENT effective model before replacing the file,
				// and preserve the existing project identity/volume/credentials.
				if (!env.POSTGRES_PASSWORD || !/^\d+$/.test(env.POSTGRES_PORT ?? '')) {
					throw new Error('Cannot safely add local S3: the existing managed PostgreSQL configuration is incomplete (.env must keep POSTGRES_PASSWORD and POSTGRES_PORT). Nothing was changed.');
				}
				const currentProblems = effectiveComposeProblems({ POSTGRES_PASSWORD: env.POSTGRES_PASSWORD, POSTGRES_PORT: env.POSTGRES_PORT }, false);
				if (currentProblems.length > 0) {
					throw new Error(`Refusing to evolve this Compose configuration: ${currentProblems.join('; ')}. Nothing was changed.`);
				}
				transitionFrom = 'postgres-only';
			}
			if (transitionFrom === 'postgres-only') writeComposeFile(composeFile(true));
		} else {
			writeComposeFile(composeFile(includeS3));
			composeFileCreated = true;
		}
		status.composeTransition = transitionFrom;
		// Validate the EFFECTIVE model Compose will run (interpolation included)
		// before writing credentials or starting anything.
		const composeProblems = effectiveComposeProblems({
			POSTGRES_PASSWORD: password, POSTGRES_PORT: port,
			S3_BUCKET: changes.S3_BUCKET, S3_PORT: changes.S3_PORT
		}, includeS3);
		if (composeProblems.length > 0) {
			throw new Error(`Refusing to use this Compose configuration: ${composeProblems.join('; ')}. Nothing was started and no credentials were written.`);
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
	// A managed Compose project remains configured across a schema-only rerun.
	if (!databaseConfigured && preparedEnv[LOCAL_DB_MARKER] === 'compose' && preparedEnv.DATABASE_URL) {
		databaseConfigured = true;
	}

	// ── Start the local Compose database (explicit --compose only) ──────────
	if (values.compose) {
		console.log('==> Starting the local PostgreSQL container (127.0.0.1 only)');
		const up = compose(['up', '-d', ...(s3Provisioned ? ['postgres', 's3'] : ['postgres'])]);
		if (up !== 0) throw new Error('`docker compose up -d postgres` failed. Inspect the output above, then rerun setup.');
		if (!waitForComposeDatabase()) {
			console.error('PostgreSQL did not become healthy in time. Inspect `docker compose logs postgres`; no schema change was attempted.');
			process.exitCode = 1;
			return;
		}
		if (s3Provisioned) {
			let healthy = false;
			for (let attempt = 0; attempt < healthAttempts(); attempt++) {
				const check = spawnSync(composeCommand()[0], [...composeCommand().slice(1), ...composeProjectArgs(['exec', '-T', 's3', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:9090/'])], { cwd: root, stdio: 'ignore', env: sanitizedEnv() });
				if (check.status === 0) { healthy = true; break; }
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
			}
			if (!healthy) {
				console.error('The local S3 service did not become healthy in time. Inspect `docker compose logs s3`; no schema change was attempted.');
				process.exitCode = 1;
				return;
			}
		}
		composeStarted = true;
	}

	// ── Schema initialization (explicit --init-schema only) ────────────────
	let schemaInitialized = false;
	if (values['init-schema']) {
		const problems = verifyManagedDatabase(preparedEnv);
		if (problems.length > 0) {
			throw new Error(`Refusing to initialize a schema: ${problems.join('; ')}. No migration was run. Start the managed database with \`bash scripts/setup.sh --compose\`, or run your own \`db:push\`/\`db:migrate\` against the intended database.`);
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
		const verifiedUrl = preparedEnv.DATABASE_URL;
		if (process.env.DATABASE_URL && process.env.DATABASE_URL !== verifiedUrl) {
			console.log('==> Ignoring ambient DATABASE_URL/TEST_DATABASE_URL and using the verified local Compose URL from .env');
		}
		if (authSchemaPending && hasAuthSchemaScript) {
			console.log(`==> Generating the Better Auth schema with \`${pm} run auth:schema\``);
			const authSchema = spawnSync(pm, ['run', 'auth:schema'], { cwd: root, stdio: 'inherit', env: databaseChildEnv(verifiedUrl) });
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
		const push = spawnSync(pm, ['run', 'db:push', '--', '--force'], { cwd: root, stdio: 'inherit', env: databaseChildEnv(verifiedUrl) });
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
				env: databaseChildEnv(preparedEnv.DATABASE_URL ?? '', {
					ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: adminPassword
				})
			});
			// Dedicated contract from scripts/create-admin.ts: exit code 3 means the
			// administrator already exists (non-destructive no-op). Any other
			// nonzero exit is a real failure, regardless of its message text.
			if (result.status === 3) {
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
		console.log(`  docker-compose.yml: ${composeFileCreated ? 'generated' : status.composeTransition === 'postgres-only' ? 'updated with local S3 (PostgreSQL service, volume and credentials preserved)' : 'left untouched'}`);
		console.log(`  PostgreSQL: ${composeStarted ? `healthy on 127.0.0.1:${preparedEnv.POSTGRES_PORT}` : 'not started'} (local Compose only)`);
		if (s3Provisioned) {
			console.log(`  Local S3: healthy on http://127.0.0.1:${preparedEnv.S3_PORT} (bucket ${preparedEnv.S3_BUCKET}, persistent volume; S3Mock is a development backend, not production S3/R2)`);
		} else if (hasExternalS3(preparedEnv)) {
			console.log('  Local S3: skipped — an external S3/R2 configuration is preserved (S3Mock is not started)');
		}
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
  - Stop the local services without deleting data: docker compose down${s3Provisioned ? '\n  - Local S3: ' + preparedEnv.S3_ENDPOINT + ' (bucket ' + preparedEnv.S3_BUCKET + '); objects persists in the s3-data volume.\n  - Reset local data explicitly: docker compose down -v (deletes the database AND S3 objects)' : ''}
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
