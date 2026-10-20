import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { baseRootFiles, dashboardRootFiles } from '../packages/svforge/src/templates';

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
		expect(parseEnv(dashboardRootFiles['/.env.example']).BETTER_AUTH_SECRET).toBe('changeme');
		expect(parseEnv(dashboardRootFiles['/.env.example']).DATABASE_URL).toBe('');
	});

	it('rejects unsupported flags before writing configuration', () => {
		const dir = project();
		expect(run(dir, '--force').status).not.toBe(0);
		expect(existsSync(join(dir, '.env'))).toBe(false);
	});
});
