// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import LocaleSwitcher from '../packages/svforge/templates/base/src/lib/components/svforge/ui/LocaleSwitcher.svelte';
import { __resetLocaleState, __setLocaleState } from './stubs/lib/paraglide/runtime';
import { __setPageUrl } from './stubs/app/state';
import { ROOT } from './helpers';

/**
 * #588 — the shared Paraglide language switcher.
 *
 * The option list must come from the project's configured locales (no en/fr
 * hard-coding), the current route/query/fragment must survive the switch, and
 * the anchors must stay real server-renderable links (`data-sveltekit-reload`)
 * so prerendering and no-JS navigation keep working.
 */

const BASE = join(ROOT, 'packages/svforge/templates/base');
const DASHBOARD = join(ROOT, 'packages/svforge/templates/dashboard');

function links(container: HTMLElement): HTMLAnchorElement[] {
	return [...container.querySelectorAll('a')];
}

beforeEach(() => {
	__resetLocaleState();
	__setPageUrl('http://localhost/en/');
});

afterEach(cleanup);

describe('LocaleSwitcher (#588)', () => {
	it('offers one anchor per configured locale and marks the active one', () => {
		__setLocaleState({ locale: 'fr' });
		__setPageUrl('http://localhost/fr/showcase');
		const { container } = render(LocaleSwitcher);

		const anchors = links(container);
		expect(anchors.map((anchor) => anchor.textContent?.trim())).toEqual(['EN', 'FR']);
		// Recognizable tag plus a human-readable name in the CURRENT UI locale.
		expect(anchors[0].getAttribute('aria-label')).toMatch(/anglais/i);
		expect(anchors[1].getAttribute('aria-label')).toMatch(/fran[cç]ais/i);
		expect(anchors[0].getAttribute('title')).toBe(anchors[0].getAttribute('aria-label'));
		expect(anchors[1].getAttribute('aria-current')).toBe('true');
		expect(anchors[0].hasAttribute('aria-current')).toBe(false);
		expect(anchors.every((anchor) => anchor.getAttribute('hreflang'))).toBe(true);
		expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Language');
	});

	it('keeps the current route, query string and fragment when switching', () => {
		__setLocaleState({ locale: 'fr' });
		__setPageUrl('http://localhost/fr/admin/users?page=2#invite');
		const { container } = render(LocaleSwitcher);

		const [english, french] = links(container);
		expect(english.getAttribute('href')).toBe('/admin/users?page=2#invite');
		expect(french.getAttribute('href')).toBe('/fr/admin/users?page=2#invite');
		// A full reload is what makes the new locale's copy and <html lang> render.
		expect(anchorsEvery(container, 'data-sveltekit-reload')).toBe(true);
	});

	it('is a real, touch-sized, clickable link set', () => {
		const { container } = render(LocaleSwitcher);
		for (const anchor of links(container)) {
			const classes = anchor.classList;
			expect(classes).toContain('cursor-pointer');
			expect(classes).toContain('min-h-11');
			expect(classes).toContain('min-w-11');
			// Skeleton utilities only: the Skeleton button primitive owns the shape.
			expect(classes).toContain('btn');
		}
	});

	it('renders no control when only one locale is configured', () => {
		__setLocaleState({ locales: ['en'], locale: 'en' });
		const { container } = render(LocaleSwitcher);

		expect(links(container)).toHaveLength(0);
		expect(container.querySelector('[role="group"]')).toBeNull();
	});

	it('exposes a third configured locale without editing the component', () => {
		__setLocaleState({ locales: ['en', 'fr', 'de'], locale: 'de' });
		__setPageUrl('http://localhost/de/blog');
		const { container } = render(LocaleSwitcher);

		const anchors = links(container);
		expect(anchors.map((anchor) => anchor.getAttribute('href'))).toEqual(['/blog', '/fr/blog', '/de/blog']);
		expect(anchors.map((anchor) => anchor.textContent?.trim())).toEqual(['EN', 'FR', 'DE']);
		expect(anchors[2].getAttribute('aria-current')).toBe('true');
	});

	it('never renders the same locale twice', () => {
		__setLocaleState({ locales: ['en', 'en', 'fr'], locale: 'en' });
		const { container } = render(LocaleSwitcher);

		expect(links(container)).toHaveLength(2);
	});
});

describe('locale navigation contract (#588)', () => {
	const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

	it('is the one switcher: shells render it and no layout keeps hidden locale links', () => {
		const navbar = readFileSync(join(BASE, 'src/lib/components/svforge/layout/Navbar.svelte'), 'utf-8');
		const adminLayout = readFileSync(join(DASHBOARD, 'src/lib/components/svforge/layout/AdminLayout.svelte'), 'utf-8');
		const baseLayout = readFileSync(join(BASE, 'src/routes/+layout.svelte'), 'utf-8');
		const dashboardLayout = readFileSync(join(DASHBOARD, 'src/routes/+layout.svelte'), 'utf-8');

		// Desktop + mobile placements stay in sync because they share the component.
		expect(navbar.match(/<LocaleSwitcher/g)?.length).toBe(2);
		expect(adminLayout.match(/<LocaleSwitcher/g)?.length).toBeGreaterThanOrEqual(2);
		for (const layout of [baseLayout, dashboardLayout]) {
			expect(layout).not.toMatch(/#each locales/);
			expect(layout).not.toMatch(/class="hidden"/);
		}
		for (const barrel of ['base', 'dashboard']) {
			expect(read(`packages/svforge/templates/${barrel}/src/lib/components/svforge/ui/index.ts`)).toContain(
				"export { default as LocaleSwitcher } from './LocaleSwitcher.svelte';"
			);
		}
	});

	it('localizes every internal href in the scaffolded templates', () => {
		// A raw internal href drops the active locale and silently returns users to
		// the base locale. Shells localize the paths their consumers pass.
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir)) {
				if (entry === 'node_modules') continue;
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) walk(full);
				else if (entry.endsWith('.svelte')) {
					const source = readFileSync(full, 'utf-8');
					for (const match of source.matchAll(/href=(?:"|\{`)(\/[^"`]*)/g)) {
						offenders.push(`${full.slice(ROOT.length + 1)}: ${match[0]}`);
					}
				}
			}
		};
		walk(join(ROOT, 'packages'));

		expect(offenders, `internal hrefs must go through localizeHref(): ${offenders.join(', ')}`).toEqual([]);
	});
});

function anchorsEvery(container: HTMLElement, attribute: string): boolean {
	return links(container).every((anchor) => anchor.hasAttribute(attribute));
}
