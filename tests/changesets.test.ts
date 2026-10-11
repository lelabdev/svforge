import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const CHANGESET_BIN = resolve(ROOT, 'node_modules/.bin/changeset');
const { buildCompatManifest } = await import('../scripts/compat-manifest.mjs');

describe('Changesets release workflow (#555)', () => {
	it('configures independent public releases with GitHub changelogs and a human-reviewed version PR', () => {
		const config = JSON.parse(readFileSync(join(ROOT, '.changeset/config.json'), 'utf8'));
		const workflow = readFileSync(join(ROOT, '.github/workflows/version-packages.yml'), 'utf8');

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
		expect(rootPackage.scripts['changeset:version']).toBe('changeset version && bun install --ignore-scripts && bun run --filter svforge prebuild');
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
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
