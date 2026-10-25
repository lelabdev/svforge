import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { baseRootFiles, dashboardRootFiles } from '../packages/svforge/src/templates';
import { OFFICIAL_FOUNDATION_FILES } from './helpers/official-foundation';
import { patchDotEnv } from '../packages/svforge/src/modes/dashboard';

const template = resolve('packages/svforge/templates/dashboard/root');
const directories: string[] = [];
function project() {
	const dir = mkdtempSync(join(tmpdir(), 'svforge-bootstrap-'));
	directories.push(dir);
	mkdirSync(join(dir, 'scripts'));
	for (const file of ['setup.sh', 'setup.mjs']) {
		if (existsSync(join(template, 'scripts', file))) {
			writeFileSync(join(dir, 'scripts', file), readFileSync(join(template, 'scripts', file)));
		}
	}
	writeFileSync(join(dir, '.env.example'), 'DATABASE_URL=\nBETTER_AUTH_SECRET=changeme\nADDON_TOKEN=fill-me\n');
	// Any automatic Docker/schema invocation fails the test (no real services required).
	mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
	for (const tool of ['docker', 'drizzle-kit']) {
		writeFileSync(join(dir, 'node_modules/.bin', tool), '#!/bin/sh\necho invoked >> invoked\nexit 91\n', { mode: 0o755 });
	}
	return dir;
}
function run(dir: string, ...args: string[]) {
	return spawnSync('bash', ['scripts/setup.sh', ...args], {
		cwd: dir, encoding: 'utf8',
		env: { ...process.env, PATH: `${join(dir, 'node_modules/.bin')}:${process.env.PATH}` }
	});
}
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('Dashboard local preparation (#589)', () => {
	it('prepares the final example without Docker, schema writes or secret disclosure; reruns are stable', () => {
		const dir = project();
		const result = run(dir);
		expect(result.status).toBe(0);
		const content = readFileSync(join(dir, '.env'), 'utf8');
		const env = parseEnv(content);
		expect(Buffer.from(env.BETTER_AUTH_SECRET ?? '', 'base64')).toHaveLength(32);
		expect(env.ADDON_TOKEN).toBe('fill-me');
		expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
		expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('/.env');
		expect(result.stdout + result.stderr).not.toContain(env.BETTER_AUTH_SECRET);
		expect(result.stdout).toContain('not checked');
		expect(result.stdout).toContain('npm run db:push');
		expect(run(dir).status).toBe(0);
		expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(content);
		expect(existsSync(join(dir, 'invoked'))).toBe(false);
		const second = project();
		run(second);
		expect(parseEnv(readFileSync(join(second, '.env'), 'utf8')).BETTER_AUTH_SECRET).not.toBe(env.BETTER_AUTH_SECRET);
	});

	it('preserves existing credentials and valid quoted secrets byte for byte', () => {
		const dir = project();
		const content = `# user configuration\r\nDATABASE_URL="postgres://private:password@remote/db"\r\nexport BETTER_AUTH_SECRET = '${'s'.repeat(40)}' # keep\r\nCUSTOM=yes\r\n`;
		writeFileSync(join(dir, '.env'), content);
		rmSync(join(dir, '.env.example'));
		writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
		const result = run(dir);
		expect(result.status).toBe(0);
		expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(content);
		expect(result.stdout).toContain('pnpm run db:push');
		expect(result.stdout + result.stderr).not.toContain('private:password');
		expect(existsSync(join(dir, 'invoked'))).toBe(false);
	});

	it.each(['', 'BETTER_AUTH_SECRET=\n', 'BETTER_AUTH_SECRET="" # empty\n', "BETTER_AUTH_SECRET='changeme'\n", 'BETTER_AUTH_SECRET=too-short\n', `BETTER_AUTH_SECRET="${' '.repeat(32)}"\n`, 'BETTER_AUTH_SECRET=your-super-secret-key-at-least-32-chars\n'])(
		'repairs a missing, empty or invalid secret without changing other settings (%j)', (secret) => {
			const dir = project();
			writeFileSync(join(dir, '.env'), `CUSTOM=keep\n${secret}`);
			expect(run(dir).status).toBe(0);
			const content = readFileSync(join(dir, '.env'), 'utf8');
			expect(content).toContain('CUSTOM=keep\n');
			expect(Buffer.from(parseEnv(content).BETTER_AUTH_SECRET ?? '', 'base64')).toHaveLength(32);
			expect(run(dir).status).toBe(0);
			expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(content);
		}
	);

	it('defers without writing files or starting services', () => {
		const dir = project();
		const result = run(dir, '--defer');
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('deferred');
		expect(result.stdout).toContain('bash scripts/setup.sh');
		for (const path of ['.env', '.gitignore', 'invoked']) expect(existsSync(join(dir, path))).toBe(false);
	});

	it('fails clearly when the example is missing, instead of inventing credentials', () => {
		const dir = project();
		rmSync(join(dir, '.env.example'));
		const result = run(dir);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('.env.example');
		expect(existsSync(join(dir, '.env'))).toBe(false);
	});

	it('refuses symlinks without touching their targets', () => {
		const dir = project();
		const target = join(dir, 'private');
		writeFileSync(target, 'BETTER_AUTH_SECRET=changeme\n');
		symlinkSync(target, join(dir, '.env'));
		expect(run(dir).status).not.toBe(0);
		expect(readFileSync(target, 'utf8')).toBe('BETTER_AUTH_SECRET=changeme\n');
	});

	it('refuses to generate a secret into a Git-indexed .env (#589 review)', () => {
		const dir = project();
		const content = 'DATABASE_URL=\nBETTER_AUTH_SECRET=changeme\n';
		writeFileSync(join(dir, '.env'), content);
		const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
		expect(git('init', '-q').status).toBe(0);
		expect(git('add', '.env').status).toBe(0);
		expect(git('ls-files', '--cached', '--', '.env').stdout.trim()).toBe('.env');

		const result = run(dir);
		expect(result.status).not.toBe(0);
		// Actionable remediation, and no credential reached the indexed file.
		expect(result.stderr).toContain('git rm --cached .env');
		expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(content);
		// Refusal is atomic: no ignore rule and no temporary files are left behind.
		expect(existsSync(join(dir, '.gitignore'))).toBe(false);
		expect(existsSync(join(dir, 'invoked'))).toBe(false);
	});

	it('still prepares a Git repository whose .env is untracked', () => {
		const dir = project();
		expect(spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' }).status).toBe(0);

		const result = run(dir);
		expect(result.status, result.stderr).toBe(0);
		const env = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
		expect(Buffer.from(env.BETTER_AUTH_SECRET ?? '', 'base64')).toHaveLength(32);
		expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('/.env');
		expect(spawnSync('git', ['ls-files', '--cached', '--', '.env'], { cwd: dir, encoding: 'utf8' }).stdout.trim()).toBe('');
	});

	it('works when Docker and OpenSSL are absent and resolves the project from its script', () => {
		const dir = project();
		const result = spawnSync(process.execPath, [join(dir, 'scripts/setup.mjs')], {
			cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, PATH: '' }
		});
		expect(result.status, result.stderr).toBe(0);
		expect(existsSync(join(dir, '.env'))).toBe(true);
	});

	it.each([
		'BETTER_AUTH_SECRET=short\nBETTER_AUTH_SECRET=other\n',
		'BETTER_AUTH_SECRET="unterminated\n',
		'CUSTOM="multiline\nBETTER_AUTH_SECRET=inside-another-value\nend"\n'
	])('refuses ambiguous configuration without damaging existing values (%j)', (content) => {
		const dir = project();
		writeFileSync(join(dir, '.env'), content);
		const result = run(dir);
		expect(result.status).not.toBe(0);
		expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(content);
	});

	it('preserves multiline user values while repairing a real secret', () => {
		const dir = project();
		const other = 'CUSTOM="first\nsecond"\n';
		writeFileSync(join(dir, '.env'), `${other}BETTER_AUTH_SECRET="short\nsecret"\n`);
		expect(run(dir).status).toBe(0);
		expect(readFileSync(join(dir, '.env'), 'utf8')).toContain(other);
	});

	it('deferring also preserves existing configuration and does not rotate a placeholder', () => {
		const dir = project();
		writeFileSync(join(dir, '.env'), 'BETTER_AUTH_SECRET=changeme\n');
		expect(run(dir, '--defer').status).toBe(0);
		expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('BETTER_AUTH_SECRET=changeme\n');
		expect(existsSync(join(dir, '.gitignore'))).toBe(false);
	});

	it('ships both setup files only in Dashboard and never embeds runtime secrets', () => {
		for (const file of ['setup.sh', 'setup.mjs']) {
			expect(dashboardRootFiles[`/scripts/${file}` as keyof typeof dashboardRootFiles]).toBe(
				readFileSync(join(template, 'scripts', file), 'utf8')
			);
			expect(baseRootFiles).not.toHaveProperty(`/scripts/${file}`);
		}
		// #547: the official integrations own .env.example; SVForge appends its
		// policy (no runtime secret is ever embedded).
		const envExample = parseEnv(patchDotEnv(OFFICIAL_FOUNDATION_FILES['.env.example']));
		expect(envExample.BETTER_AUTH_SECRET).toBe('');
		expect(envExample.DATABASE_URL).toContain('postgres://');
		expect(envExample.SIGNUP_MODE).toBe('closed');
	});

	it('rejects unsupported flags before writing configuration', () => {
		const dir = project();
		expect(run(dir, '--force').status).not.toBe(0);
		expect(existsSync(join(dir, '.env'))).toBe(false);
	});
});

/**
 * #589 — explicit local provisioning. Docker, Compose and the package manager
 * are stubbed: these tests never start a real container, and a real-Compose
 * smoke lives in `scripts/test-local-setup.sh`.
 */
function provisionedProject() {
	const dir = project();
	writeFileSync(join(dir, 'bun.lock'), '');
	writeFileSync(join(dir, 'package.json'), JSON.stringify({
		name: 'fixture', private: true,
		scripts: { 'db:push': 'drizzle-kit push', 'admin:create': 'tsx scripts/create-admin.ts' }
	}));
	writeFileSync(join(dir, 'node_modules/.bin/docker'), `#!/bin/sh
echo "docker $*" >> invoked
case "$*" in
  "compose version") exit 0 ;;
  "compose up -d postgres") exit 0 ;;
  "compose ps --status running --services") echo postgres; exit 0 ;;
  "compose port postgres 5432")
    p=$(sed -n 's/^POSTGRES_PORT=//p' .env)
    echo "127.0.0.1:\${STUB_PORT:-$p}"; exit 0 ;;
  "compose exec"*"current_database"*) echo "svforge/svforge"; exit 0 ;;
  "compose exec"*) exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
	writeFileSync(join(dir, 'node_modules/.bin/bun'), `#!/bin/sh
echo "bun $*" >> invoked
case "$*" in
  "run db:push"*) exit "\${STUB_PUSH_EXIT:-0}" ;;
  "run admin:create"*)
    echo "\${STUB_ADMIN_OUTPUT:-Administrator created}"
    exit "\${STUB_ADMIN_EXIT:-0}" ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
	return dir;
}
function runEnv(dir: string, env: Record<string, string>, ...args: string[]) {
	return spawnSync('bash', ['scripts/setup.sh', ...args], {
		cwd: dir, encoding: 'utf8',
		env: { ...process.env, PATH: `${join(dir, 'node_modules/.bin')}:${process.env.PATH}`, ...env }
	});
}

describe('Dashboard local database provisioning (#589)', () => {
	it('generates a loopback-only Compose database, starts it once, and preserves it on rerun', () => {
		const dir = provisionedProject();
		const result = runEnv(dir, {}, '--compose');
		expect(result.status, result.stderr).toBe(0);
		const compose = readFileSync(join(dir, 'docker-compose.yml'), 'utf8');
		expect(compose).toContain('# svforge-managed-compose:1');
		expect(compose).toContain('image: postgres:17.2');
		expect(compose).toContain('127.0.0.1:${POSTGRES_PORT:-5432}:5432');
		expect(compose).toContain('postgres-data:/var/lib/postgresql/data');
		expect(compose).toContain('pg_isready');
		expect(compose).not.toContain('postgres/postgres');

		const env = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
		expect(env.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(env.SVFORGE_LOCAL_DB).toBe('compose');
		expect(env.DATABASE_URL).toBe(`postgres://svforge:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.POSTGRES_PORT}/svforge`);
		expect(result.stdout + result.stderr).not.toContain(env.POSTGRES_PASSWORD);
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).toContain('docker compose up -d postgres');
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).not.toContain('run db:push');

		const content = readFileSync(join(dir, '.env'), 'utf8');
		const rerun = runEnv(dir, {}, '--compose');
		expect(rerun.status, rerun.stderr).toBe(0);
		expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(content);
		expect(readFileSync(join(dir, 'docker-compose.yml'), 'utf8')).toBe(compose);
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).not.toContain('run db:push');
	});

	it('refuses to replace an existing external DATABASE_URL with a Compose database', () => {
		const dir = provisionedProject();
		const content = 'DATABASE_URL="postgres://private:password@remote.example.com:5432/app"\nBETTER_AUTH_SECRET=""\n';
		writeFileSync(join(dir, '.env'), content);
		const result = runEnv(dir, {}, '--compose');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('DATABASE_URL');
		expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(content);
		expect(existsSync(join(dir, 'docker-compose.yml'))).toBe(false);
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).not.toContain('up -d');
	});

	it('stores an existing PostgreSQL URL without starting Docker or printing the value', () => {
		const dir = provisionedProject();
		const url = 'postgres://app:super-secret@db.internal:5432/appdb';
		const result = runEnv(dir, { SVFORGE_DATABASE_URL: url }, '--defer');
		// --defer wins: no side effect, as documented.
		expect(result.status).toBe(0);
		expect(existsSync(join(dir, '.env'))).toBe(false);

		const second = provisionedProject();
		const stored = runEnv(second, { SVFORGE_DATABASE_URL: url });
		expect(stored.status, stored.stderr).toBe(0);
		expect(parseEnv(readFileSync(join(second, '.env'), 'utf8')).DATABASE_URL).toBe(url);
		expect(stored.stdout + stored.stderr).not.toContain('super-secret');
		expect(existsSync(join(second, 'docker-compose.yml'))).toBe(false);
		expect(existsSync(join(second, 'invoked'))).toBe(false);
	});

	it('rejects an invalid PostgreSQL URL before writing anything', () => {
		const dir = provisionedProject();
		const result = runEnv(dir, { SVFORGE_DATABASE_URL: 'mysql://user:pass@host/db' });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('postgres');
		expect(existsSync(join(dir, '.env'))).toBe(false);
	});

	it('never initializes a schema outside the verified local Compose database', () => {
		const dir = provisionedProject();
		writeFileSync(join(dir, '.env'), 'DATABASE_URL="postgres://svforge:pw@127.0.0.1:5432/svforge"\nBETTER_AUTH_SECRET=""\n');
		const result = runEnv(dir, {}, '--init-schema');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Refusing to initialize a schema');
		const invoked = existsSync(join(dir, 'invoked')) ? readFileSync(join(dir, 'invoked'), 'utf8') : '';
		expect(invoked).not.toContain('run db:push');
	});

	it('initializes the schema of the local Compose database with db:push (never --force)', () => {
		const dir = provisionedProject();
		const result = runEnv(dir, {}, '--compose', '--init-schema');
		expect(result.status, result.stderr).toBe(0);
		const invoked = readFileSync(join(dir, 'invoked'), 'utf8');
		// Non-interactive Drizzle requires --force; this path is restricted to the
		// verified local Compose database (see the refusal test above).
		expect(invoked).toContain('bun run db:push -- --force');
		expect(result.stdout).toContain('Schema: initialized with db:push');
	});

	it('reports a failed schema initialization instead of claiming success', () => {
		const dir = provisionedProject();
		const result = runEnv(dir, { STUB_PUSH_EXIT: '1' }, '--compose', '--init-schema');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Schema initialization failed');
		expect(result.stdout).not.toContain('Schema: initialized');
	});

	it('treats an existing administrator as a non-destructive no-op', () => {
		const dir = provisionedProject();
		const result = runEnv(dir, {
			ADMIN_NAME: 'Admin', ADMIN_EMAIL: 'admin@example.com',
			STUB_ADMIN_OUTPUT: '✗ An administrator already exists — bootstrap refused', STUB_ADMIN_EXIT: '3'
		}, '--compose', '--admin');
		expect(result.status, result.stderr).toBe(0);
		const env = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
		expect(env.ADMIN_PASSWORD).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(result.stdout + result.stderr).not.toContain(env.ADMIN_PASSWORD);
		expect(result.stdout).toContain('already exists (unchanged)');
	});

	it('skips admin creation without ADMIN_NAME/ADMIN_EMAIL and explains how to enable it', () => {
		const dir = provisionedProject();
		const result = runEnv(dir, {}, '--compose', '--admin');
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('set ADMIN_NAME and ADMIN_EMAIL');
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).not.toContain('run admin:create');
	});

	it('fails clearly when Docker Compose is unavailable, before writing configuration', () => {
		const dir = provisionedProject();
		writeFileSync(join(dir, 'node_modules/.bin/docker'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
		const result = runEnv(dir, {}, '--compose');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Docker Compose is not available');
		expect(existsSync(join(dir, '.env'))).toBe(false);
		expect(existsSync(join(dir, 'docker-compose.yml'))).toBe(false);
	});

	it('refuses an existing user-owned docker-compose.yml without starting or rewriting it', () => {
		const dir = provisionedProject();
		const userCompose = 'services:\n  postgres:\n    image: postgres:17.2\n    ports:\n      - "127.0.0.1:5432:5432"\n';
		writeFileSync(join(dir, 'docker-compose.yml'), userCompose);
		const result = runEnv(dir, {}, '--compose');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('not SVForge-managed');
		expect(readFileSync(join(dir, 'docker-compose.yml'), 'utf8')).toBe(userCompose);
		expect(existsSync(join(dir, '.env'))).toBe(false);
		const invoked = existsSync(join(dir, 'invoked')) ? readFileSync(join(dir, 'invoked'), 'utf8') : '';
		expect(invoked).not.toContain('up -d');
	});

	function managedProject() {
		const dir = provisionedProject();
		const result = runEnv(dir, {}, '--compose');
		expect(result.status, result.stderr).toBe(0);
		return dir;
	}

	it('initializes the schema of an already-provisioned project without --compose', () => {
		const dir = managedProject();
		const result = runEnv(dir, {}, '--init-schema');
		expect(result.status, result.stderr).toBe(0);
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).toContain('bun run db:push -- --force');
	});

	it('rejects a DATABASE_URL password that does not match POSTGRES_PASSWORD', () => {
		const dir = managedProject();
		const env = readFileSync(join(dir, '.env'), 'utf8').replace(/^POSTGRES_PASSWORD=.*$/m, 'POSTGRES_PASSWORD=rotated-during-test-0000000000000000');
		writeFileSync(join(dir, '.env'), env);
		const result = runEnv(dir, {}, '--init-schema');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('password does not match');
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).not.toContain('run db:push');
	});

	it('rejects a DATABASE_URL port that does not match POSTGRES_PORT', () => {
		const dir = managedProject();
		const env = readFileSync(join(dir, '.env'), 'utf8').replace(/^POSTGRES_PORT=.*$/m, 'POSTGRES_PORT=5555');
		writeFileSync(join(dir, '.env'), env);
		const result = runEnv(dir, {}, '--init-schema');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('port does not match');
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).not.toContain('run db:push');
	});

	it('rejects an altered managed Compose file', () => {
		const dir = managedProject();
		const compose = readFileSync(join(dir, 'docker-compose.yml'), 'utf8')
			.replace('image: postgres:17.2', 'image: postgres:16');
		writeFileSync(join(dir, 'docker-compose.yml'), compose);
		const result = runEnv(dir, {}, '--init-schema');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('incompatible pinned PostgreSQL image');
		expect(readFileSync(join(dir, 'invoked'), 'utf8')).not.toContain('run db:push');
	});

	it('rejects a stale Compose marker or an unexpected published port', () => {
		const stale = managedProject();
		const env = readFileSync(join(stale, '.env'), 'utf8').replace(/^SVFORGE_LOCAL_DB=.*$/m, '');
		writeFileSync(join(stale, '.env'), env);
		const staleResult = runEnv(stale, {}, '--init-schema');
		expect(staleResult.status).not.toBe(0);
		expect(staleResult.stderr).toContain('missing SVFORGE_LOCAL_DB=compose marker');

		const wrongPort = managedProject();
		const wrongPortResult = runEnv(wrongPort, { STUB_PORT: '5999' }, '--init-schema');
		expect(wrongPortResult.status).not.toBe(0);
		expect(wrongPortResult.stderr).toContain('published port does not match');
		expect(readFileSync(join(wrongPort, 'invoked'), 'utf8')).not.toContain('run db:push');
	});

	it('does not treat an unrelated "already exists" failure as an existing admin', () => {
		const dir = provisionedProject();
		const result = runEnv(dir, {
			ADMIN_NAME: 'Admin', ADMIN_EMAIL: 'admin@example.com',
			STUB_ADMIN_OUTPUT: '✗ Bootstrap failed: relation "user" already exists', STUB_ADMIN_EXIT: '1'
		}, '--compose', '--admin');
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('First-admin creation failed');
		expect(result.stdout).not.toContain('already exists (unchanged)');
	});

});
