import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempProject } from './helpers';
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
