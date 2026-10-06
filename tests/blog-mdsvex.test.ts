import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const POSTS_UTIL = join(ROOT, 'packages/blog/templates/src/lib/utils/posts.ts');
const ARTICLE_SERVER = join(ROOT, 'packages/blog/templates/src/routes/blog/[slug]/+page.server.ts');
const ADDON_INDEX = join(ROOT, 'packages/blog/src/index.ts');

/**
 * Regression tests for #173 + #185 — the blog addon must generate a working
 * MDsveX blog on modern `sv create` projects.
 *
 * #185: modern sv create (Kit 2.63 / vite-plugin-svelte 7) no longer generates
 * svelte.config.js — mdsvex must be wired in vite.config.ts via sveltekit({...}).
 * Also: sv >= 0.15 crashes on addons without an options object, so the blog
 * must define one (verified behaviorally in the CI scaffold, this file is the
 * source-level guard).
 */
describe('blog MDsveX scaffold (#173/#185)', () => {
	describe('posts.ts', () => {
		const source = readFileSync(POSTS_UTIL, 'utf-8');

		it('does not import PUBLIC_POSTS_DIR', () => {
			expect(source).not.toMatch(/PUBLIC_POSTS_DIR/);
		});

		it('types MDsveX content as a Svelte Component wrapper, never a string (#293)', () => {
			expect(source).toMatch(/import type \{ Component \} from 'svelte'/);
			expect(source).toMatch(/content:\s*PostComponent/);
			expect(source).toMatch(/class PostComponent/);
			expect(source).not.toMatch(/content:\s*string/);
		});

		it('resolves the component through the same import.meta.glob on both sides (#293)', () => {
			expect(source).toMatch(/import\.meta\.glob\('\/src\/posts\/\*\.md'\)/);
			expect(source).toMatch(/loadPostComponent/);
		});

		it('getPost returns content (not just metadata)', () => {
			expect(source).toMatch(/\.default|content.*mod|mod\.\w+/i);
		});
	});

	describe('article page server', () => {
		const source = readFileSync(ARTICLE_SERVER, 'utf-8');

		it('fetches the full post with content', () => {
			expect(source).toMatch(/getPost/);
		});

		it('returns 404 for missing slug', () => {
			expect(source).toMatch(/404|not found/i);
		});
	});

	describe('blog routes consume Skeleton and Paraglide foundations (#478)', () => {
		const LIST_PAGE = join(ROOT, 'packages/blog/templates/src/routes/blog/+page.svelte');
		const ARTICLE_PAGE = join(ROOT, 'packages/blog/templates/src/routes/blog/[slug]/+page.svelte');
		const list = readFileSync(LIST_PAGE, 'utf-8');
		const article = readFileSync(ARTICLE_PAGE, 'utf-8');

		it('localizes blog shell labels through Paraglide keys', () => {
			expect(list).toContain('m.blog_title()');
			expect(article).toContain('m.blog_back_to_blog()');
			expect(list).not.toMatch(/>Blog<|"Blog"/);
			expect(article).not.toContain('Back to blog');
		});

		it('uses Skeleton typography and anchor utilities instead of recreating them', () => {
			expect(list).toMatch(/<h1 class="h1[^"]*"/);
			expect(list).toMatch(/<h2 class="h3[^"]*"/);
			expect(article).toMatch(/<h1 class="h1[^"]*"/);
			expect(article).toMatch(/class="anchor[^"]*"/);
			expect(list).toContain('localizeHref(`/blog/${post.slug}`)');
			expect(article).toContain("localizeHref('/blog')");
			expect(list + article).not.toMatch(/text-4xl|font-bold|text-primary-500/);
		});

		it('formats both list and article dates with the active Paraglide locale', () => {
			expect(list).toContain('toLocaleDateString(getLocale()');
			expect(article).toContain('toLocaleDateString(getLocale()');
			expect(list + article).not.toMatch(/toLocaleDateString\(['"]en['"]/);
		});
	});

	describe('article page renders the MDsveX component (#293)', () => {
		const ARTICLE_PAGE = join(ROOT, 'packages/blog/templates/src/routes/blog/[slug]/+page.svelte');
		const page = readFileSync(ARTICLE_PAGE, 'utf-8');

		it('renders the compiled component dynamically (runes), never raw HTML', () => {
			expect(page).toMatch(/const Post = \$derived\(data\.post\.content\.component\)/);
			expect(page).toMatch(/<Post \/>/);
			expect(page).not.toMatch(/<svelte:component/);
			expect(page).not.toMatch(/\{@html/);
		});
	});

	describe('transport hook carries the component across the data boundary (#293)', () => {
		const addon = readFileSync(ADDON_INDEX, 'utf-8');
		const POSTS = readFileSync(POSTS_UTIL, 'utf-8');

		it('the addon patches src/hooks.ts with a transport that encodes the slug', () => {
			expect(addon).toMatch(/sv\.file\('src\/hooks\.ts'/);
			expect(addon).toMatch(/mdx-post/);
			expect(addon).toMatch(/loadPostComponent\(slug\)/);
		});

		it('the PostComponent wrapper brands itself for the transport', () => {
			expect(POSTS).toMatch(/__brand = 'mdx-post'/);
		});
	});

	describe('addon mdsvex integration (#185)', () => {
		const source = readFileSync(ADDON_INDEX, 'utf-8');

		it('patches vite.config.ts with a mdsvex integration', () => {
			expect(source).toMatch(/vite\.config\.ts/);
			expect(source).toMatch(/mdsvex/);
		});

		it('adds .md to the extensions list', () => {
			expect(source).toMatch(/extensions: \['\.svelte', '\.md'\]/);
		});

		it('still patches legacy svelte.config.js projects', () => {
			expect(source).toMatch(/svelte\.config\.js/);
		});

		it('defines empty addon options (sv >= 0.15 crash guard)', () => {
			expect(source).toMatch(/defineAddonOptions\(\)\.build\(\)/);
		});
	});

	describe('legacy svelte.config.js behavior (pinned sv 0.15.4 layout)', () => {
		// The REAL svelte.config.js emitted by `sv create --template minimal`
		// (pinned 0.15.4). The #426 review consumer test exposed that the
		// legacy patch inserted `mdsvex(...)` WITHOUT the import — the config
		// then crashed every tool that loads it (ReferenceError).
		const SV_0_15_SVELTE_CONFIG = [
			"import adapter from '@sveltejs/adapter-auto';",
			'',
			"/** @type {import('@sveltejs/kit').Config} */",
			'const config = {',
			'\tcompilerOptions: {',
			'\t\t// Force runes mode for the project, except for libraries. Can be removed in svelte 6.',
			"\t\trunes: ({ filename }) => (filename.split(/[/\\\\]/).includes('node_modules') ? undefined : true)",
			'\t},',
			'\tkit: {',
			'\t\tadapter: adapter()',
			'\t}',
			'};',
			'',
			'export default config;',
			''
		].join('\n');

		it('the runes-layout legacy config gets its mdsvex import (no use-before-define)', async () => {
			const { patchSvelteConfigMdsvex } = await import('../packages/blog/src/index');
			const patched = patchSvelteConfigMdsvex(SV_0_15_SVELTE_CONFIG);
			expect(patched).toMatch(/import \{ mdsvex \} from 'mdsvex';/);
			// Syntax-level guarantee: the patched config must be parseable.
			const ts = await import('typescript');
			const { diagnostics } = ts.transpileModule(patched, { fileName: 'svelte.config.js', reportDiagnostics: true });
			const errors = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
			expect(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
		});

		it('is idempotent — a second pass does not duplicate the import', async () => {
			const { patchSvelteConfigMdsvex } = await import('../packages/blog/src/index');
			const once = patchSvelteConfigMdsvex(SV_0_15_SVELTE_CONFIG);
			expect(patchSvelteConfigMdsvex(once)).toBe(once);
		});
	});
});
