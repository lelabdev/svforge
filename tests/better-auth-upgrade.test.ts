import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');

const {
	bumpRangeInSource,
	currentPin,
	readPinnedVersions,
	applyUpgrades
} = await import('../scripts/better-auth-upgrade.mjs');

const DASHBOARD_TS = join(ROOT, 'packages/svforge/src/modes/dashboard.ts');

describe('better-auth manual bump helper (#319, #460)', () => {
	describe('readPinnedVersions', () => {
		it('reads the better-auth pin from the real dashboard mode source', () => {
			const source = readFileSync(DASHBOARD_TS, 'utf8');
			const pins = readPinnedVersions(source);

			const betterAuth = pins.find((p: { name: string }) => p.name === 'better-auth');
			expect(betterAuth, 'better-auth must be pinned in dashboard.ts').toBeDefined();
			// #197: the scaffold never floats. A concrete tilde range only.
			expect(betterAuth!.range).toMatch(/^~\d+\.\d+\.\d+$/);
		});

		it('no longer declares @better-auth/cli as a scaffold dependency (#319)', () => {
			// Its nested @better-auth/core (1.4.x) hoists over the runtime's
			// @better-auth/core (1.7.x) and breaks the SSR build with
			// "does not provide an export named 'APIError'". The generator runs
			// via an ON-DEMAND dlx runner (`bunx` for bun, `npx --yes` for npm —
			// #325) — isolated tree — and its output is gated by
			// scripts/check-auth-schema.mjs.
			const source = readFileSync(DASHBOARD_TS, 'utf8');
			expect(source).not.toMatch(/sv\.(dev)?[Dd]ependency\(\s*'@better-auth\/cli'/);
			// The on-demand runner reference must survive in the shipped
			// auth:schema path — still version-pinned.
			expect(source).toContain('@better-auth/cli@1.4.21');
			expect(source).toContain('auth.schema.config.ts');
			const schemaConfig = readFileSync(
				join(ROOT, 'packages/svforge/templates/dashboard/src/lib/server/auth.schema.config.ts'),
				'utf8'
			);
			expect(schemaConfig).toContain('drizzleAdapter');
			expect(schemaConfig).not.toContain('$app/env/private');
			expect(schemaConfig).not.toContain('$app/server');
			const templatePkg = JSON.parse(
				readFileSync(join(ROOT, 'packages/svforge/templates/dashboard/package.json'), 'utf8')
			);
			expect(Object.keys({ ...templatePkg.dependencies, ...templatePkg.devDependencies })).not.toContain(
				'@better-auth/cli'
			);
			expect(templatePkg.scripts['auth:schema']).toContain('auth.schema.config.ts');
		});
	});

	describe('bumpRangeInSource', () => {
		it('rewrites the sv.dependency range for one package only', () => {
			const source = [
				"sv.dependency('drizzle-orm', '^0.45.2');",
				"sv.dependency('better-auth', '~1.7.3');",
				"sv.devDependency('@better-auth/cli', '~1.4.21');"
			].join('\n');
			const bumped = bumpRangeInSource(source, 'better-auth', '1.7.4');
			expect(bumped).toContain("sv.dependency('better-auth', '~1.7.4')");
			expect(bumped).toContain("sv.devDependency('@better-auth/cli', '~1.4.21')");
			expect(bumped).toContain("sv.dependency('drizzle-orm', '^0.45.2')");
		});

		it('rewrites a package.json dependency entry', () => {
			const source = JSON.stringify(
				{
					dependencies: { 'better-auth': '~1.7.3' },
					devDependencies: { '@better-auth/cli': '~1.4.21' }
				},
				null,
				2
			);
			const bumped = bumpRangeInSource(source, 'better-auth', '1.8.0');
			expect(bumped).toContain('"better-auth": "~1.8.0"');
			expect(bumped).toContain('"@better-auth/cli": "~1.4.21"');
		});

		it('rewrites a TS fixture object entry (tests/helpers style)', () => {
			const source = "{ dependencies: { 'better-auth': '~1.7.3' } }";
			expect(bumpRangeInSource(source, 'better-auth', '1.7.4')).toContain("'better-auth': '~1.7.4'");
		});

		it('is idempotent when the version already matches', () => {
			const source = "sv.dependency('better-auth', '~1.7.4');";
			expect(bumpRangeInSource(source, 'better-auth', '1.7.4')).toBe(source);
		});

		it('throws when the package is not declared in the source', () => {
			expect(() => bumpRangeInSource("sv.dependency('zod', '^4.3.5');", 'better-auth', '1.7.4')).toThrow(
				/better-auth/
			);
		});
	});

	describe('applyUpgrades', () => {
		it('rewrites every pin carrier in the repository', async () => {
			const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } = await import('node:fs');
			const { tmpdir } = await import('node:os');
			const dir = mkdtempSync(join(tmpdir(), 'sf-upgrade-'));
			try {
				for (const rel of [
					'packages/svforge/src/modes',
					'packages/svforge/templates/dashboard',
					'tests/helpers',
					'tests'
				]) {
					mkdirSync(join(dir, rel), { recursive: true });
				}
				writeFileSync(
					join(dir, 'packages/svforge/src/modes/dashboard.ts'),
					"sv.dependency('better-auth', '~1.7.3');\nsv.devDependency('@better-auth/cli', '~1.4.21');\n"
				);
				writeFileSync(
					join(dir, 'packages/svforge/templates/dashboard/package.json'),
					'{"dependencies":{"better-auth":"~1.7.3"},"devDependencies":{"@better-auth/cli":"~1.4.21"}}'
				);
				writeFileSync(join(dir, 'tests/helpers/fixtures.ts'), "{ 'better-auth': '~1.7.3' }");
				writeFileSync(join(dir, 'tests/doctor.test.ts'), "{ 'better-auth': '~1.7.3' }");

				const changed = applyUpgrades(dir, [{ name: 'better-auth', version: '1.7.4' }]);

				expect(changed).toHaveLength(4);
				expect(readFileSync(join(dir, 'packages/svforge/src/modes/dashboard.ts'), 'utf8')).toContain('~1.7.4');
				expect(readFileSync(join(dir, 'packages/svforge/templates/dashboard/package.json'), 'utf8')).toContain(
					'"better-auth":"~1.7.4"'
				);
				expect(readFileSync(join(dir, 'tests/helpers/fixtures.ts'), 'utf8')).toContain('~1.7.4');
				expect(readFileSync(join(dir, 'tests/doctor.test.ts'), 'utf8')).toContain('~1.7.4');
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	});

	describe('repository pin coherence (the manual bump relies on it)', () => {
		it('the template package.json carries exactly the dashboard.ts better-auth range', () => {
			const dashboardTs = readFileSync(DASHBOARD_TS, 'utf8');
			const templatePkg = JSON.parse(
				readFileSync(join(ROOT, 'packages/svforge/templates/dashboard/package.json'), 'utf8')
			);
			const pinned = readPinnedVersions(dashboardTs).find((p: { name: string }) => p.name === 'better-auth')!;
			// The template declares better-auth in devDependencies; accept either
			// scope but the RANGE must match dashboard.ts exactly.
			const templateRanges = {
				...(templatePkg.dependencies ?? {}),
				...(templatePkg.devDependencies ?? {})
			};

			expect(templateRanges['better-auth']).toBe(pinned.range);
		});

		it('the version fixtures used by doctor/upgrade tests match the live pin', () => {
			const dashboardTs = readFileSync(DASHBOARD_TS, 'utf8');
			const pinned = readPinnedVersions(dashboardTs).find((p: { name: string }) => p.name === 'better-auth')!;
			const fixtures = readFileSync(join(ROOT, 'tests/helpers/fixtures.ts'), 'utf8');
			const doctor = readFileSync(join(ROOT, 'tests/doctor.test.ts'), 'utf8');

			expect(fixtures).toContain(`'better-auth': '${pinned.range}'`);
			expect(doctor).toContain(`'better-auth': '${pinned.range}'`);
		});
	});

	describe('currentPin (#319 review: the pin claim must never go stale)', () => {
		it('derives the live pin from dashboard.ts at call time', () => {
			const pin = currentPin();
			expect(pin.name).toBe('better-auth');
			expect(pin.range).toMatch(/^~\d+\.\d+\.\d+$/);
			expect(pin.version).toBe(pin.range.slice(1));
			// ...and it matches what readPinnedVersions sees in the real source.
			const source = readFileSync(DASHBOARD_TS, 'utf8');
			expect(pin.range).toBe(readPinnedVersions(source).find((p: { name: string }) => p.name === 'better-auth')!.range);
		});

		it('tracks a bumped source instead of reporting a frozen version', async () => {
			// After a bump merges, currentPin must move with the pin.
			const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
			const { tmpdir } = await import('node:os');
			const dir = mkdtempSync(join(tmpdir(), 'sf-pin-'));
			try {
				mkdirSync(join(dir, 'packages/svforge/src/modes'), { recursive: true });
				writeFileSync(join(dir, 'packages/svforge/src/modes/dashboard.ts'), "sv.dependency('better-auth', '~9.9.9');\n");
				expect(currentPin(dir)).toMatchObject({ name: 'better-auth', range: '~9.9.9', version: '9.9.9' });
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it('fails loudly when the pin disappeared from dashboard.ts', async () => {
			const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
			const { tmpdir } = await import('node:os');
			const dir = mkdtempSync(join(tmpdir(), 'sf-pin-missing-'));
			try {
				mkdirSync(join(dir, 'packages/svforge/src/modes'), { recursive: true });
				writeFileSync(join(dir, 'packages/svforge/src/modes/dashboard.ts'), "sv.dependency('zod', '^4.3.5');\n");
				expect(() => currentPin(dir)).toThrow(/better-auth/);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	});

	describe('CLI apply mode', () => {
		it('prints the live pin via the pin command (#319 review: no static pin claim)', () => {
			const out = execFileSync(process.execPath, [join(ROOT, 'scripts/better-auth-upgrade.mjs'), 'pin'], {
				encoding: 'utf8'
			});
			expect(out).toContain('better-auth');
			expect(out).toContain('dashboard.ts');
		});

		it('exposes an apply command that rewrites the repository pins', async () => {
			const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
			const { tmpdir } = await import('node:os');
			const dir = mkdtempSync(join(tmpdir(), 'sf-upgrade-cli-'));
			try {
				for (const rel of [
					'packages/svforge/src/modes',
					'packages/svforge/templates/dashboard',
					'tests/helpers',
					'tests'
				]) {
					mkdirSync(join(dir, rel), { recursive: true });
				}
				writeFileSync(join(dir, 'packages/svforge/src/modes/dashboard.ts'), "sv.dependency('better-auth', '~1.7.3');\nsv.devDependency('@better-auth/cli', '~1.4.21');\n");
				writeFileSync(join(dir, 'packages/svforge/templates/dashboard/package.json'), '{"dependencies":{"better-auth":"~1.7.3"}}');
				writeFileSync(join(dir, 'tests/helpers/fixtures.ts'), "{ 'better-auth': '~1.7.3' }");
				writeFileSync(join(dir, 'tests/doctor.test.ts'), "{ 'better-auth': '~1.7.3' }");
				const out = execFileSync(
					process.execPath,
					[join(ROOT, 'scripts/better-auth-upgrade.mjs'), 'apply', '--root', dir, '--better-auth', '1.7.4'],
					{ encoding: 'utf8' }
				);
				expect(out).toContain('dashboard.ts');
				expect(readFileSync(join(dir, 'packages/svforge/src/modes/dashboard.ts'), 'utf8')).toContain('~1.7.4');
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	});
});
