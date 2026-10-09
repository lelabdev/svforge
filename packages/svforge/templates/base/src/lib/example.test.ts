import { describe, it, expect } from 'vitest';
import { cn } from '$lib/utils/cn';
import { generateSitemap } from '$lib/components/svforge/ui/Sitemap';

describe('cn utility', () => {
	it('merges class names', () => {
		expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
	});

	it('handles conditional classes', () => {
		const hidden: string | false = 'hidden';
		expect(cn('flex', false, hidden && 'italic', 'p-2')).toBe('flex italic p-2');
	});

	it('merges conflicting tailwind classes', () => {
		expect(cn('px-4', 'px-8')).toBe('px-8');
	});
});

describe('generateSitemap', () => {
	it('generates valid sitemap XML', () => {
		const xml = generateSitemap('https://example.com', [
			{ path: '/', priority: 1.0 },
			{ path: '/about', priority: 0.8 }
		]);

		expect(xml).toContain('<?xml version="1.0"');
		expect(xml).toContain('<loc>https://example.com/</loc>');
		expect(xml).toContain('<loc>https://example.com/about</loc>');
		expect(xml).toContain('<priority>1</priority>');
	});

	it('omits optional fields when not provided', () => {
		const xml = generateSitemap('https://example.com', [{ path: '/' }]);
		expect(xml).toContain('<loc>');
		expect(xml).not.toContain('<lastmod>');
	});
});
