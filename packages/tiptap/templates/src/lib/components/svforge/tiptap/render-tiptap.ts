/**
 * Pure renderer/sanitizer for Tiptap JSON documents (#282).
 *
 * Every value coming from the Tiptap document is either escaped or strictly
 * allowlisted BEFORE it reaches the `{@html}` output of TiptapPreview:
 *
 * - text is HTML-escaped (`& < > " '`)
 * - link hrefs are protocol-allowlisted (http/https/mailto/tel) and escaped
 * - link targets are allowlisted (`_blank` only)
 * - heading levels are clamped to the valid 1..6 range
 * - code block language tokens are allowlisted to `[a-zA-Z0-9_-]` before
 *   interpolation inside a class attribute
 *
 * The renderer is a pure function so it can be tested behaviorally with
 * malicious payloads (no regex assertions on the .svelte source).
 */

import type { JSONContent } from '@tiptap/core';

/** Escape HTML special characters to prevent injection. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Allowed link protocols. Anything else is stripped to prevent javascript: URLs. */
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Whether an href uses a protocol or relative form accepted by the renderer (#294).
 */
export function isSafeHref(href: unknown): href is string {
	if (typeof href !== 'string') return false;
	const value = href.trim();
	if (!value) return false;

	const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value)?.[1]?.toLowerCase();
	if (scheme) return SAFE_PROTOCOLS.includes(`${scheme}:`);
	return !value.startsWith('//');
}

/**
 * Sanitize an href and preserve safe RELATIVE URLs (#294).
 *
 * Forms accepted as-is (after escaping):
 *   - safe absolute/protocol URLs: http:, https:, mailto:, tel:
 *   - relative URLs: /path, ./path, ../path, ?query, #hash, plain names
 *
 * Forms REFUSED (→ '#'):
 *   - any other scheme (javascript:, data:, vbscript:, …) whatever the case
 *   - protocol-relative //host URLs (their scheme depends on the page and a
 *     //evil.com link would navigate the browser to an attacker's origin)
 *   - leading/trailing whitespace tricks (" javascript:…")
 *
 * Never uses `new URL(href, base)` for the OUTPUT — that would absolutize a
 * relative URL against a placeholder host (the #294 regression).
 */
export function sanitizeHref(href: unknown): string {
	if (!isSafeHref(href)) return '#';
	return escapeHtml(href.trim());
}

/** Link target allowlist — only '_blank' is ever produced by the toolbar. */
export function sanitizeTarget(target: unknown): string {
	return target === '_blank' ? '_blank' : '_blank';
}

/** Clamp a heading level to the valid 1..6 range (anything else → 1). */
export function clampHeadingLevel(level: unknown): number {
	if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6) {
		return 1;
	}
	return level;
}

/** Allowlist a code block language token for interpolation in a class attribute. */
export function sanitizeLanguage(language: unknown): string {
	if (typeof language !== 'string') return '';
	const match = language.match(/^[a-zA-Z0-9_-]+$/);
	return match ? match[0] : '';
}

function applyMarks(text: string, marks: JSONContent['marks']): string {
	if (!marks) return text;
	return marks.reduce((acc, mark) => {
		switch (mark.type) {
			case 'bold':
				return `<strong>${acc}</strong>`;
			case 'italic':
				return `<em>${acc}</em>`;
			case 'underline':
				return `<u>${acc}</u>`;
			case 'strike':
				return `<s>${acc}</s>`;
			case 'code':
				return `<code>${acc}</code>`;
			case 'link': {
				const href = sanitizeHref(mark.attrs?.href);
				const target = sanitizeTarget(mark.attrs?.target);
				return `<a href="${href}" target="${target}" rel="noopener noreferrer">${acc}</a>`;
			}
			default:
				return acc;
		}
	}, text);
}

function renderNode(node: JSONContent): string {
	if (!node) return '';

	const type = node.type;
	const nodeContent = node.content || [];
	const text = escapeHtml(node.text || '');
	const marks = node.marks || [];
	const children = (nodeContent || []).map((child) => renderNode(child)).join('');

	switch (type) {
		case 'doc':
			return children;
		case 'paragraph':
			return `<p>${children || '<br>'}</p>`;
		case 'heading': {
			const level = clampHeadingLevel(node.attrs?.level);
			return `<h${level}>${children}</h${level}>`;
		}
		case 'bulletList':
			return `<ul>${children}</ul>`;
		case 'orderedList':
			return `<ol>${children}</ol>`;
		case 'listItem':
			return `<li>${children}</li>`;
		case 'blockquote':
			return `<blockquote>${children}</blockquote>`;
		case 'codeBlock': {
			const language = sanitizeLanguage(node.attrs?.language);
			return `<pre><code class="language-${language}">${children}</code></pre>`;
		}
		case 'hardBreak':
			return '<br>';
		case 'horizontalRule':
			return '<hr>';
		case 'text':
			return applyMarks(text, marks);
		default:
			return children || text;
	}
}

/** Render a Tiptap JSON document to sanitized HTML. */
export function renderTiptap(content: JSONContent | null | undefined): string {
	if (!content) return '';
	return renderNode(content);
}
