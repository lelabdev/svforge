#!/usr/bin/env node
// Local file preparation only. Database provisioning and schema changes are
// separate, deliberate operations; never source .env as executable shell code.
import { randomBytes } from 'node:crypto';
import {
	chmodSync, existsSync, linkSync, lstatSync, readFileSync, renameSync,
	unlinkSync, writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = (name) => resolve(root, name);

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

function prepare() {
	const { values } = parseArgs({ options: { defer: { type: 'boolean' }, help: { type: 'boolean' } } });
	if (values.help) {
		console.log('Usage: bash scripts/setup.sh [--defer]\nPrepares .env only. Never starts services or changes a database.');
		return;
	}
	if (values.defer) {
		console.log('Local configuration deferred. No files changed. Later: bash scripts/setup.sh');
		return;
	}

	const existing = readOptional('.env');
	const source = existing ?? readOptional('.env.example');
	if (source === undefined) throw new Error('Missing .env.example; restore the final generated example and rerun setup.');
	const ignore = readOptional('.gitignore') ?? '';
	const env = parseEnv(source);
	const assignments = source.match(/^[ \t]*(?:export[ \t]+)?BETTER_AUTH_SECRET[ \t]*=/gm) ?? [];
	if (assignments.length > 1) throw new Error('Duplicate BETTER_AUTH_SECRET entries; resolve them in .env before rerunning setup.');

	// Better Auth requires at least 32 characters. Preserve valid user secrets,
	// including quoted values, rather than silently invalidating their sessions.
	const secret = env.BETTER_AUTH_SECRET ?? '';
	const valid = secret.trim().length >= 32 && !/^(?:changeme|your[-_ ].*secret|replace[-_ ].*secret)/i.test(secret.trim());
	let content = source;
	if (!valid) {
		const generated = randomBytes(32).toString('base64');
		if (assignments.length) {
			// Match a whole dotenv assignment, including quoted multiline values.
			// Refuse malformed input rather than rewriting unrelated settings.
			const entry = /^[ \t]*(?:export[ \t]+)?BETTER_AUTH_SECRET[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\r\n'"`]*?)[ \t]*(?:#[^\r\n]*)?(?=\r?$)/m;
			if (!entry.test(content)) throw new Error('Cannot safely update BETTER_AUTH_SECRET; fix its dotenv assignment first.');
			content = content.replace(entry, `BETTER_AUTH_SECRET=${generated}`);
		} else {
			content += `${content && !content.endsWith('\n') ? '\n' : ''}BETTER_AUTH_SECRET=${generated}\n`;
		}
	}

	// A line resembling the secret assignment may be inside another quoted
	// multiline value. Check the parsed result before touching either file.
	const prepared = parseEnv(content);
	if (!prepared.BETTER_AUTH_SECRET || Object.keys({ ...env, ...prepared }).some(
		(key) => key !== 'BETTER_AUTH_SECRET' && env[key] !== prepared[key]
	)) throw new Error('Cannot safely update BETTER_AUTH_SECRET; resolve ambiguous dotenv entries first.');

	// The last ignore rule wins, even when a user previously added !.env.
	if (!['.env', '/.env'].includes(ignore.trimEnd().split(/\r?\n/).at(-1))) {
		writeFileSync(path('.gitignore'), `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}/.env\n`);
	}
	if (existing !== content) writePrivateEnv(content, existing);
	chmodSync(path('.env'), 0o600);
	console.log(existing === undefined ? 'Created private .env from .env.example.' : 'Preserved existing .env settings.');
	console.log(valid ? 'Kept existing Better Auth secret.' : 'Generated a strong Better Auth secret.');

	const pm = existsSync(path('bun.lock')) || existsSync(path('bun.lockb')) ? 'bun'
		: existsSync(path('pnpm-lock.yaml')) ? 'pnpm' : existsSync(path('yarn.lock')) ? 'yarn' : 'npm';
	console.log(`
Local files prepared. Database connectivity not checked; schema not initialized.
Next steps:
  1. Configure DATABASE_URL in .env for a PostgreSQL database you control.
     PostgreSQL/Docker provisioning is manual; no service was started.
  2. Install dependencies if needed: ${pm} install
  3. Review the target database, then explicitly initialize a disposable local schema:
       ${pm} run db:push
     For versioned migrations: ${pm} run db:generate, then ${pm} run db:migrate.
  4. Create the first administrator (refuses if one exists):
       ${pm} run admin:create -- --name 'Admin' --email admin@example.com --password '…'
     Or use /setup in development after starting: ${pm} run dev
Sign-up remains controlled by SIGNUP_MODE in .env (closed by default).`);
}

try {
	prepare();
} catch (error) {
	// Do not print raw filesystem/parser errors: input may contain credentials.
	const safe = error.code ? `Local preparation failed (${error.code}). Check file permissions and arguments, then rerun setup.` : error.message;
	console.error(safe);
	process.exitCode = 1;
}
