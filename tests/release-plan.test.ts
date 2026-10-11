import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const {
	buildReleasePlan,
	checkPublishAccess,
	checkRegistry,
	compareVersions,
	orderPackages,
	preflightPackage,
	parseVersion
} = await import('../scripts/release-plan.mjs');

// npm fakes only implement the status/stdout/stderr surface the planner uses;
// cast them to the real spawnSync-based signature at this single boundary.
type NpmFake = Parameters<typeof checkRegistry>[2];
const asNpm = (fn: unknown): NpmFake => fn as NpmFake;

describe('independent release plan (#330)', () => {
	it('describes every workspace with an explicit package version', () => {
		const plan = buildReleasePlan(ROOT, 'test-commit');

		expect(plan.schemaVersion).toBe(1);
		expect(plan.versionPolicy).toBe('independent');
		expect(plan.commit).toBe('test-commit');
		expect(plan.packages).toHaveLength(15);
		expect(plan.packages.every((pkg: { name: string; version: string; manifestPath: string }) => pkg.name && pkg.version && pkg.manifestPath)).toBe(true);
		expect(new Set(plan.packages.map((pkg: { name: string }) => pkg.name)).size).toBe(15);
	});

	it('compares full SemVer prerelease identifiers and accepts build metadata', () => {
		expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
		expect(compareVersions('1.0.0-beta.2', '1.0.0-beta')).toBeGreaterThan(0);
		expect(compareVersions('1.0.0+build.10', '1.0.0+build.2')).toBe(0);
		expect(compareVersions('1.0.0-9007199254740992', '1.0.0-9007199254740993')).toBeLessThan(0);
		expect(compareVersions('9007199254740992.0.0', '9007199254740993.0.0')).toBeLessThan(0);
		expect(parseVersion('1.2.3+build.7').build).toEqual(['build', '7']);
		expect(() => parseVersion('1.0.0-01')).toThrow(/Unsupported package version/);
	});

	it('publishes local dependencies before their dependents', () => {
		const ordered = orderPackages([
			{ name: '@svforge/feature', localDependencies: ['@svforge/core'] },
			{ name: '@svforge/core', localDependencies: [] }
		]);

		expect(ordered.map((pkg: { name: string }) => pkg.name)).toEqual(['@svforge/core', '@svforge/feature']);
	});

	it('does not allow OAuth build failures to be swallowed', () => {
		const oauth = JSON.parse(readFileSync(join(ROOT, 'packages/oauth/package.json'), 'utf8')) as {
			scripts: { build: string };
		};

		expect(oauth.scripts.build).not.toContain('|| true');
	});

	it('uses pinned actions and serializes all publish runs globally', () => {
		const workflow = readFileSync(join(ROOT, '.github/workflows/publish.yml'), 'utf8');

		expect(workflow).toContain('group: publish');
		expect(workflow).not.toContain('group: publish-${{ github.ref }}');
		expect(workflow).toContain('cancel-in-progress: false');
		expect(workflow).toContain('actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09');
		expect(workflow).toContain('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6');
		expect(workflow).toContain('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
		expect(workflow).not.toContain('id-token: write');
		expect(workflow).toContain('--check-access');
		expect(workflow).toContain('npm-consumer-smoke.mjs');
	});

	it('checks registry state and skips already-published versions', () => {
		const calls: string[][] = [];
		const plan = {
			packages: [
				{ name: '@svforge/old', version: '1.0.0', directory: 'packages/old', localDependencies: [] },
				{ name: '@svforge/new', version: '1.0.0', directory: 'packages/new', localDependencies: [] }
			]
		};
		const npm = (args: string[]) => {
			calls.push(args);
			return { status: 0, stdout: args[1] === '@svforge/old' ? '["1.0.0"]' : '["0.9.0"]', stderr: '' };
		};

		const checked = checkRegistry(plan, ROOT, asNpm(npm));
		expect(checked.packages[0].registry.published).toBe(true);
		expect(checked.packages[1].registry.published).toBe(false);
		expect(calls).toHaveLength(2);
	});

	it('fails access preflight when any existing package is not writable', () => {
		const plan = { packages: [{ name: 'svforge' }, { name: '@svforge/audit' }] };
		const npm = () => ({ status: 0, stdout: JSON.stringify({ svforge: 'read-write' }), stderr: '' });

		expect(() => checkPublishAccess(plan, ROOT, asNpm(npm))).toThrow(/@svforge\/audit/);
	});

	it('does not reject packages that have not been published yet', () => {
		const calls: string[][] = [];
		const plan = {
			packages: [
				{ name: '@svforge/existing', registry: { published: true } },
				{ name: '@svforge/first-release', registry: { published: false } }
			]
		};
		const npm = (args: string[]) => {
			calls.push(args);
			return { status: 0, stdout: JSON.stringify({ '@svforge/existing': 'read-write' }), stderr: '' };
		};

		expect(() => checkPublishAccess(plan, ROOT, asNpm(npm))).not.toThrow();
		expect(calls).toEqual([['access', 'list', 'packages', '--json']]);
	});

	it('checks access for a package with an older published version', () => {
		const plan = {
			packages: [{
				name: '@svforge/existing',
				registry: { published: false, availableVersions: ['0.9.0'] }
			}]
		};
		const npm = () => ({ status: 0, stdout: '{}', stderr: '' });

		expect(() => checkPublishAccess(plan, ROOT, asNpm(npm))).toThrow(/@svforge\/existing/);
	});

	it('runs tarball preflight and reports missing required files', () => {
		const pkg = { name: 'svforge', version: '1.2.0', directory: 'packages/svforge' };
		const files = ['README.md', 'package.json', 'LICENSE', 'dist/index.js', 'dist/index.d.ts', 'bin/svforge.mjs'];
		const npm = () => ({ status: 0, stdout: JSON.stringify([{ files: files.map((path) => ({ path })) }]), stderr: '' });
		expect(preflightPackage(pkg, ROOT, asNpm(npm)).fileCount).toBe(files.length);

		const broken = () => ({ status: 0, stdout: JSON.stringify([{ files: files.filter((path) => path !== 'dist/index.d.ts').map((path) => ({ path })) }]), stderr: '' });
		expect(() => preflightPackage(pkg, ROOT, asNpm(broken))).toThrow(/dist\/index\.d\.ts/);
	});

	it('reads npm pack output in the object-keyed shape returned by npm 12+ (#398)', () => {
		const pkg = { name: 'svforge', version: '1.2.0', directory: 'packages/svforge' };
		const files = ['README.md', 'package.json', 'LICENSE', 'dist/index.js', 'dist/index.d.ts', 'bin/svforge.mjs'];
		const record = { files: files.map((path) => ({ path })) };
		const keyed = () => ({ status: 0, stdout: JSON.stringify({ svforge: record }), stderr: '' });
		expect(preflightPackage(pkg, ROOT, asNpm(keyed)).fileCount).toBe(files.length);

		// Fallback: no entry matches the package name — take the first entry with a files array.
		const otherKey = () => ({ status: 0, stdout: JSON.stringify({ '@svforge/ui_toast': record }), stderr: '' });
		expect(preflightPackage(pkg, ROOT, asNpm(otherKey)).fileCount).toBe(files.length);

		// The object-keyed shape must also surface missing required files.
		const brokenKeyed = () => ({ status: 0, stdout: JSON.stringify({ svforge: { files: files.filter((path) => path !== 'dist/index.js').map((path) => ({ path })) } }), stderr: '' });
		expect(() => preflightPackage(pkg, ROOT, asNpm(brokenKeyed))).toThrow(/dist\/index\.js/);
	});

	it('throws an actionable error on unknown or empty npm pack output (#398)', () => {
		const pkg = { name: 'svforge', version: '1.2.0', directory: 'packages/svforge' };
		const empty = () => ({ status: 0, stdout: '', stderr: '' });
		expect(() => preflightPackage(pkg, ROOT, asNpm(empty))).toThrow(/svforge/);
		expect(() => preflightPackage(pkg, ROOT, asNpm(empty))).toThrow(/npm pack/i);

		const invalidJson = () => ({ status: 0, stdout: 'npm notice name: svforge', stderr: '' });
		expect(() => preflightPackage(pkg, ROOT, asNpm(invalidJson))).toThrow(/svforge/);

		const missingFiles = () => ({ status: 0, stdout: JSON.stringify({ svforge: { name: 'svforge' } }), stderr: '' });
		expect(() => preflightPackage(pkg, ROOT, asNpm(missingFiles))).toThrow(/svforge/);
	});

	it('rejects the removed custom publish command in favor of Changesets', () => {
		expect(() => execFileSync(process.execPath, [join(ROOT, 'scripts/release-plan.mjs'), '--publish'], {
			cwd: ROOT,
			encoding: 'utf8'
		})).toThrow(/Changesets owns npm publication/);
	});
});
