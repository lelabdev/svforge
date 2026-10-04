import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

const ROOT = process.cwd();
const RENDERER = join(
	ROOT,
	'packages/tiptap/templates/src/lib/components/svforge/tiptap/render-tiptap.ts'
);

/**
 * Behavioral XSS tests (#282) against the PURE renderer/sanitizer.
 *
 * The renderer is a pure function (render-tiptap.ts) imported by
 * TiptapPreview.svelte — every value coming from the Tiptap document is
 * escaped or strictly allowlisted before reaching the {@html} output.
 * These tests run REAL payloads through the renderer and assert on the
 * produced HTML, not on regex matches of the source.
 */
const { renderTiptap } = await import(RENDERER);

const doc = (content: any[]) => ({ type: 'doc', content });
const text = (t: string, marks?: any[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

describe('TiptapPreview XSS hardening (#282)', () => {
	it('quote-breakout in code block language never escapes the class attribute', () => {
		const html = renderTiptap(
			doc([
				{
					type: 'codeBlock',
					attrs: { language: 'js" onload="alert(1)' },
					content: [text('x')]
				}
			])
		);
		// No attribute breakout: the payload must not appear as an attribute
		expect(html).not.toMatch(/onload/i);
		expect(html).not.toMatch(/alert\(1\)/);
		// Language token was discarded (not a valid [a-zA-Z0-9_-] token)
		expect(html).toContain('class="language-"');
	});

	it('heading level is clamped to 1..6 (no attribute breakout via level)', () => {
		const html = renderTiptap(
			doc([
				{
					type: 'heading',
					attrs: { level: '1" onclick="alert(1)' },
					content: [text('Title')]
				}
			])
		);
		expect(html).not.toMatch(/onclick/i);
		expect(html).toContain('<h1>Title</h1>');
		expect(html).not.toContain('tiptap-heading');
	});

	it('renders semantic heading elements and clamps their level to 1..6', () => {
		expect(renderTiptap(doc([{ type: 'heading', attrs: { level: 3 }, content: [text('H3')] }]))).toBe(
			'<h3>H3</h3>'
		);
		// non-integer / out of range -> h1
		expect(renderTiptap(doc([{ type: 'heading', attrs: { level: 99 }, content: [text('x')] }]))).toBe(
			'<h1>x</h1>'
		);
		expect(renderTiptap(doc([{ type: 'heading', attrs: { level: 2.5 }, content: [text('x')] }]))).toBe(
			'<h1>x</h1>'
		);
	});

	it('script tags in text content are escaped, never raw', () => {
		const html = renderTiptap(
			doc([
				{ type: 'paragraph', content: [text('<script>alert(1)</script>')] },
				{ type: 'paragraph', content: [text('<img src=x onerror=alert(1)>')] }
			])
		);
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
	});

	it('javascript: URLs are stripped to # (quote breakout blocked)', () => {
		const html = renderTiptap(
			doc([
				{
					type: 'paragraph',
					content: [
						text('click', [
							{ type: 'link', attrs: { href: 'javascript:alert(1)', target: '_blank' } }
						])
					]
				}
			])
		);
		expect(html).not.toMatch(/javascript:/i);
		expect(html).toContain('href="#"');
	});

	it('link target is allowlisted to _blank (no on* attribute injection)', () => {
		const html = renderTiptap(
			doc([
				{
					type: 'paragraph',
					content: [
						text('click', [
							{ type: 'link', attrs: { href: 'https://ok.example', target: '" onmouseover="alert(1)' } }
						])
					]
				}
			])
		);
		expect(html).not.toMatch(/onmouseover/i);
		expect(html).toContain('target="_blank"');
	});

	it('valid link protocols still render (http/https/mailto/tel)', () => {
		for (const href of ['https://a.example', 'http://b.example', 'mailto:x@y.z', 'tel:+3312345']) {
			const html = renderTiptap(
				doc([{ type: 'paragraph', content: [text('l', [{ type: 'link', attrs: { href } }])] }])
			);
			expect(html).toContain(`href="`);
			expect(html).not.toMatch(/javascript:/i);
		}
	});

	it('valid formatting still renders: bold, italic, underline, strike, code, lists, code blocks', () => {
		const html = renderTiptap(
			doc([
				{
					type: 'paragraph',
					content: [
						text('b', [{ type: 'bold' }]),
						text('i', [{ type: 'italic' }]),
						text('u', [{ type: 'underline' }]),
						text('s', [{ type: 'strike' }]),
						text('c', [{ type: 'code' }])
					]
				},
				{ type: 'bulletList', content: [{ type: 'listItem', content: [text('item')] }] },
				{ type: 'orderedList', content: [{ type: 'listItem', content: [text('item2')] }] },
				{ type: 'blockquote', content: [{ type: 'paragraph', content: [text('quote')] }] },
				{ type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const x = 1')] }
			])
		);
		expect(html).toContain('<strong>b</strong>');
		expect(html).toContain('<em>i</em>');
		expect(html).toContain('<u>u</u>');
		expect(html).toContain('<s>s</s>');
		expect(html).toContain('<code>c</code>');
		expect(html).toContain('<ul>');
		expect(html).toContain('<ol>');
		expect(html).toContain('<blockquote>');
		expect(html).toContain('class="language-ts"');
	});

	describe('relative URLs are preserved (#294)', () => {
		const link = (href: string) =>
			renderTiptap(doc([{ type: 'paragraph', content: [text('l', [{ type: 'link', attrs: { href } }])] }]));

		it('/docs stays /docs — no placeholder host absolutization (#294)', () => {
			const html = link('/docs');
			expect(html).toContain('href="/docs"');
			expect(html).not.toContain('placeholder');
			expect(html).not.toMatch(/https?:\/\//);
		});

		it('safe relative forms are preserved: ./ ../ ?query #hash plain names (#294)', () => {
			for (const href of ['./foo', '../foo', '#section', 'contact.html']) {
				expect(link(href)).toContain(`href="${href}"`);
			}
			// & is escaped inside the attribute
			expect(link('?x=1&y=2')).toContain('href="?x=1&amp;y=2"');
		});

		it('query/hash-only links keep their relative shape (#294)', () => {
			expect(link('?lang=fr')).toContain('href="?lang=fr"');
			expect(link('#top')).toContain('href="#top"');
		});

		it('protocol-relative //host is refused — ambiguous scheme (#294)', () => {
			const html = link('//evil.example/x');
			expect(html).toContain('href="#"');
			expect(html).not.toContain('evil.example');
		});

		it('mixed-case protocols are normalized and refused when unsafe (#294)', () => {
			const html = link('JaVaScRiPt:alert(1)');
			expect(html).toContain('href="#"');
			expect(html).not.toMatch(/javascript/i);
		});

		it('leading-whitespace payloads are refused (#294)', () => {
			const html = link('  javascript:alert(1)');
			expect(html).toContain('href="#"');
			expect(html).not.toMatch(/javascript/i);
		});

		it('data: URLs are still refused (#294)', () => {
			const html = link('data:text/html;base64,PHNjcmlwdD4=');
			expect(html).toContain('href="#"');
			expect(html).not.toContain('data:text/html');
		});

		it('href attribute escaping still applies to relative URLs (#294)', () => {
			const html = link('/docs?a=1&b=2');
			expect(html).toContain('href="/docs?a=1&amp;b=2"');
		});
	});
});
