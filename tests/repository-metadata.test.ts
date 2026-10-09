import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, 'packages');
const packageDirectories = readdirSync(PACKAGES_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(PACKAGES_DIR, entry.name, 'package.json')))
	.map((entry) => entry.name)
	.sort();
const rootLicense = readFileSync(join(ROOT, 'LICENSE'), 'utf8');

describe('repository maintenance documentation (#525)', () => {
	it('uses the root release guide as the only versioning source of truth', () => {
		const versioningPath = join(PACKAGES_DIR, 'svforge', 'docs', 'VERSIONING.md');
		const versioning = readFileSync(versioningPath, 'utf8');

		expect(versioning).toContain('https://github.com/lelabdev/svforge/blob/main/docs/RELEASE.md');
		expect(existsSync(join(ROOT, 'docs', 'RELEASE.md'))).toBe(true);
		expect(versioning).not.toContain('1.x');
		expect(versioning).not.toContain('0.x');
		expect(versioning).not.toContain('main` | `dev`');
		expect(existsSync(join(PACKAGES_DIR, 'svforge', 'docs', 'PRD.md'))).toBe(false);
	});

	it('points contributors at the real scaffold harness instead of a template-copy simulation', () => {
		const instructions = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
		expect(instructions).toContain('bash scripts/test-scaffold.sh base');
		expect(instructions).not.toContain('test-local.ts');
		expect(existsSync(join(PACKAGES_DIR, 'svforge', 'scripts', 'test-local.ts'))).toBe(false);
	});
});

describe('published package metadata (#334)', () => {
	it('declares the supported package manager and current product positioning', () => {
		const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			packageManager?: string;
		};
		const addonManifest = JSON.parse(
			readFileSync(join(PACKAGES_DIR, 'svforge', 'package.json'), 'utf8')
		) as { description?: string };
		const addonSource = readFileSync(join(PACKAGES_DIR, 'svforge', 'src', 'index.ts'), 'utf8');

		expect(rootManifest.packageManager).toBe('bun@1.3.14');
		expect(addonManifest.description).toContain('Production-ready foundations for SvelteKit');
		expect(addonSource).toContain('production-ready foundations for SvelteKit');

		const ciWorkflow = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
		const publishWorkflow = readFileSync(join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8');
		const canaryWorkflow = readFileSync(join(ROOT, '.github', 'workflows', 'canary.yml'), 'utf8');
		expect(ciWorkflow).toContain('bun-version: 1.3.14');
		expect(publishWorkflow).toContain('bun-version: 1.3.14');
		expect(canaryWorkflow).toContain('bun-version: latest');
		expect(canaryWorkflow).toContain('scripts/canary-issue.mjs');
		expect(canaryWorkflow).toContain('Open or update drift issue on failure');
	});

	it('uses an existing package directory in every repository field', () => {
		for (const packageName of packageDirectories) {
			const packageDirectory = join(PACKAGES_DIR, packageName);
			const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as {
				repository?: { directory?: string };
			};

			expect(manifest.repository?.directory, packageName).toBe(`packages/${packageName}`);
			expect(existsSync(join(ROOT, manifest.repository?.directory ?? ''))).toBe(true);
		}
	});

	it('includes the canonical MIT license in every npm package tarball', () => {
		for (const packageName of packageDirectories) {
			const packageDirectory = join(PACKAGES_DIR, packageName);
			const packageLicense = join(packageDirectory, 'LICENSE');
			expect(readFileSync(packageLicense, 'utf8'), packageName).toBe(rootLicense);

			const result = execFileSync('npm', ['pack', '--dry-run', '--json'], {
				cwd: packageDirectory,
				encoding: 'utf8'
			});
			// npm <= 10 returns an array of entries; npm >= 11 maps them by package name.
			const parsed = JSON.parse(result) as
				| Array<{ files?: Array<{ path: string }> }>
				| Record<string, { files: Array<{ path: string }> }>;
			const manifestName = (JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as { name: string }).name;
			const entry = Array.isArray(parsed) ? parsed[0] : parsed[manifestName];
			const files = (entry?.files ?? []).map((file) => file.path);

			expect(files, packageName).toContain('LICENSE');
			expect(files, packageName).toContain('README.md');
			expect(files, packageName).toContain('package.json');
		}
	}, 30_000);
});
