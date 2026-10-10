import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const { compareVersions, entriesBetween, parseLegacyChangelog, parsePackageChangelog, readPackageChangelogs, validatePackageChangelogs } = await import('../scripts/changelog.mjs');
const { buildReleasePlan } = await import('../scripts/release-plan.mjs');

describe('Changesets package changelogs (#555)', () => {
	const packages = buildReleasePlan(ROOT, 'test-commit').packages;

	it('preserves the historical release notes and covers every current package version', () => {
		const result = validatePackageChangelogs(packages, ROOT);

		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.entries.length).toBeGreaterThanOrEqual(27);
		for (const pkg of packages) {
			expect(result.entries).toContainEqual(expect.objectContaining({ package: pkg.name, version: pkg.version }));
		}
		expect(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')).toContain('svforge@2.0.1');
	});

	it('migrates every legacy entry body and date without loss', () => {
		const archived = parseLegacyChangelog(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'));
		const migrated = readPackageChangelogs(ROOT);

		expect(migrated).toHaveLength(archived.length);
		for (const oldEntry of archived) {
			const newEntry = migrated.find((entry: { package: string; version: string }) =>
				entry.package === oldEntry.package && entry.version === oldEntry.version
			);
			if (!newEntry) throw new Error(`Missing migrated entry: ${oldEntry.package}@${oldEntry.version}`);
			expect(newEntry.date).toBe(oldEntry.date);
			expect(newEntry.body).toBe(oldEntry.body.replace(/^##[^\n]*\n?/, '').trim());
		}
	});

	it('rejects a current version missing from that package changelog', () => {
		const pkg = { name: '@svforge/blog', version: '9.9.9', directory: 'packages/blog' };
		const result = validatePackageChangelogs([pkg], ROOT);

		expect(result.valid).toBe(false);
		expect(result.errors).toContain('@svforge/blog@9.9.9: missing current package changelog entry.');
	});

	it('parses Changesets headings, links, historical dates, and selects only the installed-to-target versions', () => {
		const entries = parsePackageChangelog(`
# @svforge/blog

## 2.0.3
### Patch Changes
- Refresh compatibility metadata ([#123](https://github.com/lelabdev/svforge/pull/123)).

## 2.0.2 — 2026-10-09
### Fixes
- Existing historical note.
`,'@svforge/blog');

		expect(entries).toEqual([
			expect.objectContaining({ package: '@svforge/blog', version: '2.0.3', body: expect.stringContaining('Refresh compatibility metadata') }),
			expect.objectContaining({ package: '@svforge/blog', version: '2.0.2', date: '2026-10-09', body: expect.stringContaining('Existing historical note') })
		]);
		expect(entriesBetween(entries, '@svforge/blog', '2.0.2', '2.0.3').map((entry: { version: string }) => entry.version)).toEqual(['2.0.3']);
		expect(compareVersions('2.0.0-alpha-1.1', '2.0.0-alpha-1.2')).toBeLessThan(0);
		expect(compareVersions('2.0.0+build.2', '2.0.0+build.10')).toBe(0);
	});

	it('uses package-specific changelogs in the release plan', () => {
		const plan = buildReleasePlan(ROOT, 'test-commit');
		expect(plan.changelog.path).toBe('packages/*/CHANGELOG.md');
		expect(plan.changelog.entries).toBeGreaterThanOrEqual(27);
	});

	it('loads the per-package changelog inventory deterministically', () => {
		const entries = readPackageChangelogs(ROOT);
		expect(entries.length).toBeGreaterThanOrEqual(27);
		expect(entries.filter((entry: { package: string }) => entry.package === 'svforge').length).toBeGreaterThan(1);
	});
});
