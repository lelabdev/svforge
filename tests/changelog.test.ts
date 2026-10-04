import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const { entriesBetween, parseChangelog, validateChangelog } = await import('../scripts/changelog.mjs');
const { buildReleasePlan } = await import('../scripts/release-plan.mjs');

describe('package changelog (#348)', () => {
	const content = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
	const packages = buildReleasePlan(ROOT, 'test-commit').packages;

	it('covers every current package version with explicit migration sections', () => {
		const result = validateChangelog(content, packages);

		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		for (const pkg of packages) {
			expect(result.entries).toContainEqual(
				expect.objectContaining({ package: pkg.name, version: pkg.version })
			);
		}
	});

	it('rejects a release whose package entry is missing', () => {
		const withoutSvforge = content.replace(/<!-- svforge-release package="svforge"[\s\S]*?(?=<!-- svforge-release)/, '');
		const result = validateChangelog(withoutSvforge, packages);

		expect(result.valid).toBe(false);
		const svforge = packages.find((pkg: { name: string }) => pkg.name === 'svforge')!;
		expect(result.errors).toContain(`${svforge.name}@${svforge.version}: missing current release entry.`);
	});

	it('selects only the installed-to-target package releases', () => {
		const entries = parseChangelog(`
<!-- svforge-release package="svforge" version="1.0.0" date="2026-01-01" -->
## svforge@1.0.0
### Breaking changes
- None.
### Migrations
- None.
### Fixes
- Initial release.
### Deprecations
- None.

<!-- svforge-release package="svforge" version="1.1.0" date="2026-02-01" -->
## svforge@1.1.0
### Breaking changes
- None.
### Migrations
- Migrate the config.
### Fixes
- Fixed setup.
### Deprecations
- None.

<!-- svforge-release package="@svforge/blog" version="2.0.0" date="2026-02-01" -->
## @svforge/blog@2.0.0
### Breaking changes
- None.
### Migrations
- None.
### Fixes
- Fixed blog.
### Deprecations
- None.
`);

		expect(entriesBetween(entries, 'svforge', '1.0.0', '1.1.0').map((entry: { version: string }) => entry.version)).toEqual(['1.1.0']);
		expect(entriesBetween(entries, 'svforge', null, '1.1.0')).toHaveLength(2);
		expect(entriesBetween(entries, 'svforge', '1.1.0', '2.0.0')).toHaveLength(0);
	});
});
