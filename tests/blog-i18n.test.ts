import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, tempProject } from './helpers';
import { createBaseProject, diskSv } from './helpers/fixtures';

const { dir, cleanup } = tempProject('sf-blog-i18n-');
createBaseProject(dir);
afterAll(() => cleanup());

describe('blog module Paraglide integration (#478)', () => {
	it('merges localized shell messages into every configured base catalog without replacing existing keys', async () => {
		const { default: addon } = await import('../packages/blog/src/index');
		writeFileSync(join(dir, 'messages/fr.json'), JSON.stringify({ $schema: 'https://inlang.com/schema/inlang-message-format', existing_key: 'conservé' }));
		writeFileSync(join(dir, 'messages/en.json'), JSON.stringify({ $schema: 'https://inlang.com/schema/inlang-message-format', existing_key: 'preserved' }));
		const sv = diskSv(dir);
		let cancelReason: string | undefined;

		await addon.run({
			sv: sv as never,
			cancel: (reason: string) => {
				cancelReason = reason;
			},
			cwd: dir,
			options: {}
		} as never);

		expect(cancelReason).toBeUndefined();
		const fr = JSON.parse(readFileSync(join(dir, 'messages/fr.json'), 'utf8'));
		const en = JSON.parse(readFileSync(join(dir, 'messages/en.json'), 'utf8'));
		expect(fr).toMatchObject({ $schema: 'https://inlang.com/schema/inlang-message-format', blog_title: 'Blog', blog_back_to_blog: 'Retour au blog' });
		expect(en).toMatchObject({ $schema: 'https://inlang.com/schema/inlang-message-format', blog_title: 'Blog', blog_back_to_blog: 'Back to blog' });
		expect(fr.existing_key).toBe('conservé');
		expect(en.existing_key).toBe('preserved');
		expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
	});
});

/**
 * #668 — the canary asserted French dates on the DEFAULT pages while the
 * scaffold's base locale is English (#588), so the whole `base-blog` profile
 * failed on a stale expectation. The scaffold harness must derive its expected
 * copy from the configured catalogs and Intl, and check BOTH locales.
 */
describe('base-blog scaffold locale assertions (#668)', () => {
	const harness = readFileSync(join(ROOT, 'scripts', 'test-scaffold.sh'), 'utf8');
	const baseBlog = harness.slice(
		harness.indexOf('if [ "$TEMPLATE" = "base-blog" ]; then'),
		harness.indexOf('# 4b. dashboard-foundations composition')
	);

	it('derives the date strings from Intl with the shipped formatting contract', () => {
		// Same options as formatPostDate: long date, UTC calendar day.
		expect(baseBlog).toContain("new Intl.DateTimeFormat('en',{dateStyle:'long',timeZone:'UTC'})");
		expect(baseBlog).toContain("new Intl.DateTimeFormat('fr',{dateStyle:'long',timeZone:'UTC'})");
		expect(baseBlog).not.toContain('1 janvier 2025');
	});

	it('checks the default pages in the base locale and the French pages under /fr', () => {
		expect(baseBlog).toContain('http://localhost:4188/blog');
		expect(baseBlog).toContain('http://localhost:4188/fr/blog');
		expect(baseBlog).toContain('http://localhost:4188/fr/blog/welcome');
		expect(baseBlog).toContain('$EN_DATE');
		expect(baseBlog).toContain('$FR_DATE');
		expect(baseBlog).toContain('$EN_BACK');
		expect(baseBlog).toContain('$FR_BACK');
	});

	it('reads the back-link copy from the catalogs instead of hardcoding it', () => {
		expect(baseBlog).toContain("require('./messages/en.json')");
		expect(baseBlog).toContain("require('./messages/fr.json')");
		expect(baseBlog).not.toContain('grep -q "Retour au blog"');
	});
});
