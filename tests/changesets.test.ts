import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const CHANGESET_BIN = resolve(ROOT, 'node_modules/.bin/changeset');
const { buildCompatManifest } = await import('../scripts/compat-manifest.mjs');

describe('Changesets release workflow (#555)', () => {
	it('configures independent public releases with GitHub changelogs and a human-reviewed version PR', () => {
		const config = JSON.parse(readFileSync(join(ROOT, '.changeset/config.json'), 'utf8'));
		const workflow = readFileSync(join(ROOT, '.github/workflows/version-packages.yml'), 'utf8');
		const publish = readFileSync(join(ROOT, '.github/workflows/publish.yml'), 'utf8');

		expect(config.baseBranch).toBe('main');
		expect(config.access).toBe('public');
		expect(config.fixed).toEqual([]);
		expect(config.linked).toEqual([]);
		expect(config.updateInternalDependencies).toBe('patch');
		expect(config.changelog).toEqual(['@changesets/changelog-github', { repo: 'lelabdev/svforge' }]);
		expect(workflow).toContain('uses: changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d');
		expect(workflow).not.toContain('changesets/action/version@');
		expect(workflow).toContain('contents: write');
		expect(workflow).toContain('pull-requests: write');
		expect(workflow).toContain('version: bun run changeset:version');
		expect(workflow).toContain('title: Version Packages');
		expect(workflow).toContain('branch: main');
		expect(workflow).not.toContain('npm publish');
		expect(workflow).not.toMatch(/^\s+publish:/m);
		const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
		expect(rootPackage.scripts['changeset:version']).toBe('node scripts/version-packages.mjs');
		expect(rootPackage.scripts['changeset:publish']).toBe('changeset publish');
		expect(publish).toContain('publish: bun run changeset:publish');
		expect(publish).toContain('createGithubReleases: false');
		expect(publish).toContain('node scripts/finalize-releases.mjs');
		expect(publish).not.toContain('node scripts/release-plan.mjs --plan /tmp/release-plan.json --publish');
	});

	it('skips exact versions already on npm when a stable publish is retried', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-changesets-retry-'));
		try {
			const packageName = '@svforge/already-published';
			const version = '1.2.3';
			const bin = join(root, 'bin');
			const npmLog = join(root, 'npm.log');
			mkdirSync(join(root, '.changeset'), { recursive: true });
			mkdirSync(join(root, 'packages', 'already-published'), { recursive: true });
			mkdirSync(bin);
			writeFileSync(join(root, 'package.json'), JSON.stringify({
				name: 'svforge-changesets-retry-fixture',
				private: true,
				packageManager: 'bun@1.3.14',
				workspaces: ['packages/*']
			}));
			writeFileSync(join(root, '.changeset/config.json'), JSON.stringify({
				baseBranch: 'main',
				access: 'public',
				fixed: [],
				linked: [],
				changelog: false,
				updateInternalDependencies: 'patch'
			}));
			writeFileSync(join(root, 'packages/already-published/package.json'), JSON.stringify({
				name: packageName,
				version
			}));
			execFileSync('bun', ['install', '--offline', '--ignore-scripts'], { cwd: root, stdio: 'pipe' });
			const fakeNpm = join(bin, 'npm');
			writeFileSync(fakeNpm, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_LOG, args.join(' ') + '\\n');
if (args[0] !== 'info') process.exit(97);
process.stdout.write(JSON.stringify({ versions: ['${version}'], 'dist-tags': { latest: '${version}' } }));
`);
			chmodSync(fakeNpm, 0o755);

			const env = {
				...process.env,
				PATH: `${bin}${process.env.PATH ? `${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` : ''}`,
				FAKE_NPM_LOG: npmLog
			};
			for (let attempt = 0; attempt < 2; attempt++) {
				execFileSync(process.execPath, [CHANGESET_BIN, 'publish'], { cwd: root, env, stdio: 'pipe' });
			}

			const calls = readFileSync(npmLog, 'utf8').trim().split(/\r?\n/);
			expect(calls).toHaveLength(2);
			expect(calls.every((call) => call.startsWith(`info ${packageName}`))).toBe(true);
			expect(calls.some((call) => call.startsWith('publish'))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('versions only selected packages in a SHA-identifiable snapshot without publishing', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-changesets-snapshot-'));
		try {
			mkdirSync(join(root, '.changeset'), { recursive: true });
			for (const [directory, name, version] of [
				['changed', '@svforge/changed', '1.2.3'],
				['unchanged', '@svforge/unchanged', '4.5.6']
			]) {
				mkdirSync(join(root, 'packages', directory), { recursive: true });
				writeFileSync(join(root, 'packages', directory, 'package.json'), JSON.stringify({ name, version }));
			}
			writeFileSync(join(root, 'package.json'), JSON.stringify({
				name: 'svforge-snapshot-fixture',
				private: true,
				packageManager: 'bun@1.3.14',
				workspaces: ['packages/*']
			}));
			writeFileSync(join(root, '.changeset/config.json'), JSON.stringify({
				baseBranch: 'main',
				access: 'public',
				fixed: [],
				linked: [],
				changelog: false,
				updateInternalDependencies: 'patch'
			}));
			writeFileSync(join(root, '.changeset/changed.md'), '---\n"@svforge/changed": patch\n---\nChanged package only.\n');
			execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
			execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: root });
			execFileSync('git', ['config', 'user.name', 'Changesets test'], { cwd: root });
			execFileSync('bun', ['install', '--offline', '--ignore-scripts'], { cwd: root, stdio: 'pipe' });
			execFileSync('git', ['add', '.'], { cwd: root });
			execFileSync('git', ['commit', '-m', 'snapshot fixture baseline'], { cwd: root, stdio: 'pipe' });
			const snapshotArgs = [CHANGESET_BIN, 'version', '--snapshot', 'canary-abc123-456', '--snapshot-prerelease-template', '{tag}'];
			execFileSync(process.execPath, snapshotArgs, { cwd: root, stdio: 'pipe' });

			const changed = JSON.parse(readFileSync(join(root, 'packages/changed/package.json'), 'utf8'));
			const unchanged = JSON.parse(readFileSync(join(root, 'packages/unchanged/package.json'), 'utf8'));
			expect(changed.version).toBe('0.0.0-canary-abc123-456');
			expect(unchanged.version).toBe('4.5.6');
			expect(existsSync(join(root, '.changeset/changed.md'))).toBe(false);

			// A retry from the same commit/run must recreate the identical immutable
			// version, not a new timestamp-based snapshot that npm cannot overwrite.
			writeFileSync(join(root, 'packages/changed/package.json'), JSON.stringify({ name: '@svforge/changed', version: '1.2.3' }));
			writeFileSync(join(root, '.changeset/changed.md'), '---\n"@svforge/changed": patch\n---\nChanged package only.\n');
			execFileSync(process.execPath, snapshotArgs, { cwd: root, stdio: 'pipe' });
			expect(JSON.parse(readFileSync(join(root, 'packages/changed/package.json'), 'utf8')).version).toBe(changed.version);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('uses Changesets to version explicitly selected independent packages without publishing', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-changesets-'));
		try {
			mkdirSync(join(root, '.changeset'), { recursive: true });
			for (const name of ['svforge', '@svforge/blog', '@svforge/addon-kit']) {
				const dir = join(root, 'packages', name === 'svforge' ? name : name.slice('@svforge/'.length));
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, 'package.json'), JSON.stringify({
					name,
					version: name === 'svforge' ? '2.1.1' : '2.0.2'
				}, null, 2));
			}
			writeFileSync(join(root, 'package.json'), JSON.stringify({
				name: 'svforge-changesets-fixture',
				private: true,
				packageManager: 'bun@1.3.14',
				workspaces: ['packages/*']
			}));
			writeFileSync(join(root, '.changeset/config.json'), JSON.stringify({
				baseBranch: 'main',
				access: 'public',
				fixed: [],
				linked: [],
				changelog: false,
				updateInternalDependencies: 'patch'
			}));
			writeFileSync(join(root, '.changeset/addon-and-cli.md'), '---\n"@svforge/blog": patch\nsvforge: patch\n---\nRefresh the compatibility manifest for the updated blog addon.\n');
			writeFileSync(join(root, '.changeset/release-candidates.json'), JSON.stringify({ schemaVersion: 1, packages: [] }));
			execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
			execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: root });
			execFileSync('git', ['config', 'user.name', 'Changesets test'], { cwd: root });
			execFileSync('bun', ['install', '--offline', '--ignore-scripts'], { cwd: root, stdio: 'pipe' });
			execFileSync('git', ['add', '.'], { cwd: root });
			execFileSync('git', ['commit', '-m', 'fixture baseline'], { cwd: root, stdio: 'pipe' });
			execFileSync(process.execPath, [CHANGESET_BIN, 'version'], { cwd: root, stdio: 'pipe' });
			execFileSync('bun', ['install', '--frozen-lockfile', '--offline', '--ignore-scripts'], { cwd: root, stdio: 'pipe' });

			expect(JSON.parse(readFileSync(join(root, 'packages/blog/package.json'), 'utf8')).version).toBe('2.0.3');
			expect(JSON.parse(readFileSync(join(root, 'packages/svforge/package.json'), 'utf8')).version).toBe('2.1.2');
			expect(JSON.parse(readFileSync(join(root, 'packages/addon-kit/package.json'), 'utf8')).version).toBe('2.0.2');
			const compatibility = buildCompatManifest(root);
			expect(compatibility.packages['@svforge/blog']).toBe('2.0.3');
			expect(compatibility.template.version).toBe('2.1.2');
			expect(existsSync(join(root, '.changeset/addon-and-cli.md'))).toBe(false);
			expect(existsSync(join(root, '.changeset/release-candidates.json'))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
