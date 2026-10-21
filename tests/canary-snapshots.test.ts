import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCanaryPlan, canarySnapshotTag, assertStableVersionsPublished, ensureDistributionSnapshotChangeset, prepareCanarySnapshot, validateCanaryPlan, nextCanaryIteration } from '../scripts/canary-snapshots.mjs';

const CHANGESET_BIN = join(process.cwd(), 'node_modules/.bin/changeset');
type CanaryPackage = { name: string; version: string; directory?: string; snapshot?: boolean; tarball?: string };
type CanaryPlan = {
	packages: CanaryPackage[];
	candidates: CanaryPackage[];
	compatibility: { template: { version: string }; packages: Record<string, string> };
};

function writePackage(root: string, directory: string, name: string, version: string) {
	const packageRoot = join(root, 'packages', directory);
	mkdirSync(packageRoot, { recursive: true });
	writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name, version }));
}

describe('isolated Changesets canary snapshots (#563)', () => {
	it('keeps publication manual, maintainer-gated, isolated, and behind artifact checks', () => {
		const workflow = readFileSync(join(process.cwd(), '.github/workflows/publish.yml'), 'utf8');
		expect(workflow).toContain('workflow_dispatch:');
		expect(workflow).not.toMatch(/^  pull_request:/m);
		expect(workflow).toContain("inputs.confirmation == 'publish-stable'");
		expect(workflow).toContain("inputs.channel == 'canary'");
		expect(workflow).toContain("inputs.channel == 'stable'");
		expect(workflow).toContain("inputs.confirmation == 'publish-canary'");
		expect(workflow).not.toContain('environment: npm-canary');
		expect(workflow).toContain('id-token: write');
		expect(workflow).toContain('queue: max');
		expect(readFileSync(join(process.cwd(), '.github/workflows/publish.yml'), 'utf8')).toContain('queue: max');
		expect(workflow).toContain('git archive "${GITHUB_SHA}"');
		expect(workflow).toContain('bun x changeset publish --tag "canary-run-${GITHUB_RUN_ID}" --no-git-tag');
		expect(workflow).toContain('node scripts/canary-dist-tags.mjs promote');
		expect(workflow).toContain('if(!p.compatibility) throw new Error');
		expect(workflow).toContain('scripts/canary-snapshots.mjs validate');
		expect(workflow).toContain('--compat-manifest "$RUNNER_TEMP/canary-compat.json"');
		expect(workflow).toContain('--template dashboard');
		expect(workflow).toContain('POSTGRES_DB: sf_canary_test');
		expect(workflow).toContain('uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
		expect(workflow).toContain('npm install --global npm@11.21.0');
		expect(workflow).not.toContain('NODE_AUTH_TOKEN');
		expect(workflow).not.toContain('npm whoami');
		expect(workflow).not.toContain('--tag latest');
		const setupNode = workflow.indexOf('uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', workflow.indexOf('  canary:'));
		const oidcCheck = workflow.indexOf('Setup npm with OIDC dist-tag support', workflow.indexOf('  canary:'));
		const publication = workflow.indexOf('Publish immutable snapshots');
		expect(setupNode).toBeGreaterThan(-1);
		expect(oidcCheck).toBeGreaterThan(setupNode);
		expect(oidcCheck).toBeLessThan(publication);
		const sourceBuild = workflow.indexOf('Build source packages before snapshot versioning');
		const fullTest = workflow.indexOf('Test full repository suite before snapshot versioning');
		const snapshotPrepare = workflow.indexOf('Prepare immutable Changesets snapshot');
		const compatibilityCheck = workflow.indexOf('Validate generated snapshot compatibility manifest');
		const snapshotBuild = workflow.indexOf('Build all snapshot packages');
		const artifactPack = workflow.indexOf('Pack exact snapshot candidates');
		for (const step of [sourceBuild, fullTest, snapshotPrepare, compatibilityCheck, snapshotBuild, artifactPack]) {
			expect(step).toBeGreaterThan(-1);
		}
		expect(sourceBuild).toBeLessThan(fullTest);
		expect(fullTest).toBeLessThan(snapshotPrepare);
		expect(workflow.slice(snapshotPrepare)).not.toContain('run: bun run test');
		expect(snapshotPrepare).toBeLessThan(compatibilityCheck);
		expect(compatibilityCheck).toBeLessThan(snapshotBuild);
		expect(snapshotBuild).toBeLessThan(artifactPack);
		expect(workflow.indexOf('Pre-publish clean consumer install')).toBeLessThan(workflow.indexOf('Publish immutable snapshots'));
		expect(workflow.indexOf('Post-publish exact-version consumer install')).toBeLessThan(workflow.indexOf('Promote validated snapshots'));
	});

	it('prepares a disposable Changesets snapshot with an automatic exact-version CLI manifest', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-canary-prepare-'));
		const planPath = join(root, 'out', 'plan.json');
		try {
			mkdirSync(join(root, '.changeset'), { recursive: true });
			writeFileSync(join(root, 'package.json'), JSON.stringify({
				name: 'canary-fixture', private: true, packageManager: 'bun@1.3.14', workspaces: ['packages/*']
			}));
			writeFileSync(join(root, '.changeset/config.json'), JSON.stringify({
				baseBranch: 'main', access: 'public', fixed: [], linked: [], changelog: ['missing-changelog-plugin', {}], updateInternalDependencies: 'patch'
			}));
			writePackage(root, 'svforge', 'svforge', '2.1.1');
			writePackage(root, 'addon', '@svforge/addon', '1.4.0');
			writePackage(root, 'core', '@svforge/core', '1.0.0');
			writePackage(root, 'extension', '@svforge/extension', '1.2.0');
			writeFileSync(join(root, 'packages/extension/package.json'), JSON.stringify({
				name: '@svforge/extension', version: '1.2.0', dependencies: { '@svforge/core': '1.0.0' }
			}));
			writePackage(root, 'unchanged', '@svforge/unchanged', '3.2.0');
			writeFileSync(join(root, '.changeset/addon.md'), '---\n"@svforge/addon": patch\n---\nAddon change.\n');
			writeFileSync(join(root, '.changeset/core.md'), '---\n"@svforge/core": patch\n---\nCore change.\n');
			execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
			execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: root });
			execFileSync('git', ['config', 'user.name', 'Canary test'], { cwd: root });
			execFileSync('git', ['add', '.'], { cwd: root });
			execFileSync('git', ['commit', '-m', 'canary fixture'], { cwd: root, stdio: 'pipe' });
			execFileSync('bun', ['install', '--offline', '--ignore-scripts'], { cwd: root, stdio: 'pipe' });

			const runCommand = (command: string, args: string[], cwd: string) => {
				if (args[0] === 'x' && args[1] === 'changeset') {
					execFileSync(process.execPath, [CHANGESET_BIN, ...args.slice(2)], { cwd, stdio: 'pipe' });
				} else if (args[0] === 'install') {
					execFileSync(command, args, { cwd, stdio: 'pipe' });
				}
			};
			const plan = prepareCanarySnapshot({
				root,
				commit: 'abcdef0123456789',
				runId: '321',
				planPath,
				runCommand,
				isPublished: () => true,
				listVersions: () => [],
				currentStaging: () => null
			}) as CanaryPlan;
			expect(plan.candidates.map((pkg) => pkg.name)).toEqual([
				'@svforge/addon', '@svforge/core', '@svforge/extension', 'svforge'
			]);
			expect(plan.compatibility.packages['@svforge/addon']).toBe('1.4.1-canary.1');
			expect(plan.compatibility.packages['@svforge/core']).toBe('1.0.1-canary.1');
			expect(plan.compatibility.packages['@svforge/extension']).toBe('1.2.1-canary.1');
			expect(plan.compatibility.packages['@svforge/unchanged']).toBe('3.2.0');
			expect(JSON.parse(readFileSync(join(root, 'packages/extension/package.json'), 'utf8')).dependencies['@svforge/core'])
				.toBe('1.0.1-canary.1');
			expect(JSON.parse(readFileSync(planPath, 'utf8'))).toMatchObject({ stagingDistTag: 'canary-run-321' });
			expect(JSON.parse(readFileSync(join(root, '.changeset/config.json'), 'utf8')).changelog)
				.toEqual(['missing-changelog-plugin', {}]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});


	it('numbers canaries from prospective versions and preserves staged retry numbers', () => {
		const releases = [
			{ name: 'svforge', newVersion: '2.2.1' },
			{ name: '@svforge/addon', newVersion: '3.0.0' }
		];
		const versions: Record<string, string[]> = {
			svforge: ['2.2.1-canary.1', '2.2.1-canary.2', '2.3.0-canary.22'],
			'@svforge/addon': ['3.0.0-canary.1', '3.0.0-beta.8']
		};
		const list = (name: string) => versions[name] ?? [];
		expect(nextCanaryIteration(releases, list)).toBe(3);
		expect(nextCanaryIteration(releases, list, (name: string) => name === 'svforge' ? '2.2.1-canary.2' : null, '321')).toBe(2);
		expect(() => nextCanaryIteration(releases, list, () => '1.0.0-canary.1', '321')).toThrow(/does not match prospective/);
		expect(nextCanaryIteration([{ name: 'svforge', newVersion: '2.3.0' }], list)).toBe(23);
	});
	it('derives a retry-stable tag from the source commit and workflow run', () => {
		expect(canarySnapshotTag('abcdef0123456789', '987654321')).toBe('canary-abcdef012345-987654321');
		expect(canarySnapshotTag('abcdef0123456789', '987654321')).toBe(canarySnapshotTag('abcdef0123456789', '987654321'));
		expect(() => canarySnapshotTag('not-a-sha', '987654321')).toThrow(/commit/i);
	});

	it('adds an isolated CLI Changeset when addon Changesets omit the compatibility-manifest package', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-canary-changeset-'));
		try {
			mkdirSync(join(root, '.changeset'));
			const path = ensureDistributionSnapshotChangeset(root, [{ name: '@svforge/addon', type: 'patch' }], '123');
			expect(path).toBe(join(root, '.changeset/canary-svforge-123.md'));
			expect(readFileSync(path!, 'utf8')).toContain('svforge: patch');
			expect(ensureDistributionSnapshotChangeset(root, [{ name: 'svforge', type: 'patch' }], '123')).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('keeps unchanged addon versions stable while snapshotting new and changed addons plus the CLI manifest', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-canary-plan-'));
		try {
			writePackage(root, 'svforge', 'svforge', '2.1.2-canary.1');
			writePackage(root, 'addon-kit', '@svforge/addon-kit', '2.4.0');
			writePackage(root, 'changed', '@svforge/changed', '2.0.1-canary.1');
			writePackage(root, 'new-addon', '@svforge/new-addon', '1.0.0-canary.1');
			const tag = 'canary-abcdef012345-987654321';
			const before = [
				{ name: 'svforge', version: '2.1.1', directory: 'packages/svforge' },
				{ name: '@svforge/addon-kit', version: '2.4.0', directory: 'packages/addon-kit' },
				{ name: '@svforge/changed', version: '2.0.0', directory: 'packages/changed' }
			];
			const after = [
				{ name: 'svforge', version: '2.1.2-canary.1', directory: 'packages/svforge' },
				{ name: '@svforge/addon-kit', version: '2.4.0', directory: 'packages/addon-kit' },
				{ name: '@svforge/changed', version: '2.0.1-canary.1', directory: 'packages/changed' },
				{ name: '@svforge/new-addon', version: '1.0.0-canary.1', directory: 'packages/new-addon' }
			];

			const plan = buildCanaryPlan(before, after, { root, tag, commit: 'abcdef0123456789', runId: '987654321', iteration: 1 }) as CanaryPlan;
			expect(validateCanaryPlan(plan, root)).toBe(plan);
			expect(plan.candidates.map((pkg) => pkg.name)).toEqual([
				'@svforge/changed', '@svforge/new-addon', 'svforge'
			]);
			expect(plan.compatibility.packages).toMatchObject({
				'@svforge/addon-kit': '2.4.0',
				'@svforge/changed': '2.0.1-canary.1',
				'@svforge/new-addon': '1.0.0-canary.1',
				svforge: '2.1.2-canary.1'
			});
			expect(plan.packages.find((pkg) => pkg.name === '@svforge/addon-kit')).toMatchObject({
				version: '2.4.0',
				snapshot: false
			});
			expect(plan.compatibility.template.version).toBe(plan.compatibility.packages.svforge);
			writeFileSync(join(root, 'packages/changed/package.json'), JSON.stringify({
				name: '@svforge/changed', version: '4.0.0'
			}));
			expect(() => validateCanaryPlan(plan, root)).toThrow(/does not match 4\.0\.0/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('rejects addon snapshots without a matching CLI snapshot compatibility manifest', () => {
		const root = mkdtempSync(join(tmpdir(), 'svforge-canary-invalid-'));
		try {
			writePackage(root, 'svforge', 'svforge', '2.1.1');
			writePackage(root, 'changed', '@svforge/changed', '2.0.1-canary.1');
			expect(() => buildCanaryPlan(
				[{ name: 'svforge', version: '2.1.1', directory: 'packages/svforge' }],
				[
					{ name: 'svforge', version: '2.1.1', directory: 'packages/svforge' },
					{ name: '@svforge/changed', version: '2.0.1-canary.1', directory: 'packages/changed' }
				],
				{ root, tag: 'canary-abcdef012345-9', commit: 'abcdef0123456789', runId: '9', iteration: 1 }
			)).toThrow(/svforge.*snapshot|compatibility/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails closed if any unchanged package is not available at its exact stable version', () => {
		const plan: { packages: CanaryPackage[] } = {
			packages: [
				{ name: '@svforge/stable', version: '2.4.0', snapshot: false },
				{ name: '@svforge/canary', version: '0.0.0-canary-x', snapshot: true }
			]
		};
		expect(() => assertStableVersionsPublished(plan, (name: string) => name !== '@svforge/stable'))
			.toThrow(/not published.*@svforge\/stable@2\.4\.0/i);
		expect(() => assertStableVersionsPublished(plan, () => true)).not.toThrow();
	});
});
