// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import { mount, tick, unmount } from 'svelte';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { JSDOM } from 'jsdom';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseFiles, baseRootFiles } from '../packages/svforge/src/templates';

const generatedDir = join(process.cwd(), 'tests/__gen__');
const compiledSeo = join(generatedDir, 'Seo.web-hardening.compiled.js');
const compiledThemeToggle = join(generatedDir, 'ThemeToggle.web-hardening.compiled.js');
const compiledButton = join(generatedDir, 'Button.web-hardening.compiled.js');
const scaffoldFile = (path: string) => baseFiles[path as keyof typeof baseFiles];
const scaffoldRootFile = (path: string) => baseRootFiles[path as keyof typeof baseRootFiles];

let Seo: Component<{ title: string; description: string; image?: string; url?: string; type?: string }>;
let ThemeToggle: Component;
let harnessDir: string | undefined;

/** Run the copied scaffold helpers outside the raw template directory. */
function runScaffoldHarness() {
	if (!harnessDir) throw new Error('Scaffold harness was not initialized');
	const output = execFileSync(process.env.BUN_INSTALL ? `${process.env.BUN_INSTALL}/bin/bun` : 'bun', ['run', 'web-hardening-harness.ts'], {
		cwd: harnessDir,
		encoding: 'utf8'
	});
	return JSON.parse(output) as {
		callbacks: Record<string, string | null>;
		xml: string;
		theme: { changes: boolean[]; listeners: number; storedCleanup: boolean };
	};
}

beforeAll(async () => {
	// The addon manifest is what sv add actually copies. Compiling its Seo source
	// here avoids importing a raw SvelteKit template (whose tsconfig is generated
	// only after a real scaffold), while exercising the delivered component.
	mkdirSync(generatedDir, { recursive: true });
	writeFileSync(join(generatedDir, 'web-hardening-utils.ts'), scaffoldFile('/lib/utils/web.ts'));
	const seoSource = scaffoldFile('/lib/components/svforge/ui/Seo.svelte')
		.replace("import { page } from '$app/state';", "const page = { url: new URL('https://example.test/docs/page') };")
		.replace("from '$lib/utils/web'", "from './web-hardening-utils.ts'");
	writeFileSync(compiledSeo, compile(seoSource, { generate: 'server', filename: 'Seo.svelte' }).js.code);
	Seo = (await import(/* @vite-ignore */ compiledSeo)).default;

	const buttonSource = `<script lang="ts">let { children, ...rest } = $props();</script><button {...rest}>{@render children?.()}</button>`;
	writeFileSync(compiledButton, compile(buttonSource, { generate: 'client', filename: 'Button.svelte' }).js.code);

	const themeToggleSource = scaffoldFile('/lib/components/svforge/ui/ThemeToggle.svelte')
		.replace("import * as m from '$lib/paraglide/messages.js';", "const m = { common_toggle_theme: () => 'Toggle theme' };")
		.replace("import { Button } from '$lib/components/svforge/primitives';", "import Button from './Button.web-hardening.compiled.js';")
		.replace("import { Sun, Moon } from '$lib/icons';", 'const Sun = () => null; const Moon = () => null;')
		.replace("from '$lib/utils/theme'", "from './theme.web-hardening.ts'")
		.replace(/\{#if isDark\}[\s\S]*?\{\/if\}/, '<span>{isDark ? \'dark\' : \'light\'}</span>');
	writeFileSync(join(generatedDir, 'theme.web-hardening.ts'), scaffoldFile('/lib/utils/theme.ts'));
	writeFileSync(compiledThemeToggle, compile(themeToggleSource, { generate: 'client', filename: 'ThemeToggle.svelte' }).js.code);
	ThemeToggle = (await import(/* @vite-ignore */ compiledThemeToggle)).default;

	harnessDir = mkdtempSync(join(tmpdir(), 'svforge-web-hardening-'));
	writeFileSync(join(harnessDir, 'Sitemap.ts'), scaffoldFile('/lib/components/svforge/ui/Sitemap.ts'));
	writeFileSync(join(harnessDir, 'web.ts'), scaffoldFile('/lib/utils/web.ts'));
	writeFileSync(join(harnessDir, 'theme.ts'), scaffoldFile('/lib/utils/theme.ts'));
	writeFileSync(
		join(harnessDir, 'web-hardening-harness.ts'),
		`import { generateSitemap } from './Sitemap';
import { normalizeInternalCallback } from './web';
import { followSystemTheme } from './theme';

const listeners = new Set<(event: { matches: boolean }) => void>();
const media = {
	matches: false,
	addEventListener: (_: 'change', listener: (event: { matches: boolean }) => void) => listeners.add(listener),
	removeEventListener: (_: 'change', listener: (event: { matches: boolean }) => void) => listeners.delete(listener)
};
const changes: boolean[] = [];
const cleanup = followSystemTheme(null, media, (dark) => changes.push(dark));
for (const listener of listeners) listener({ matches: true });
cleanup?.();
const storedCleanup = followSystemTheme('light', media, (dark) => changes.push(dark));
console.log(JSON.stringify({
	callbacks: Object.fromEntries(['https://attacker.example', '//attacker.example', 'javascript:alert(1)', '/%2f%2fattacker.example', '/\\\\attacker.example', '/admin/users?tab=active'].map((value) => [value, normalizeInternalCallback(value)])),
	xml: generateSitemap('https://example.test?brand=a&b', [{ path: ${JSON.stringify("/products?name=<forge>\"'")}, lastmod: ${JSON.stringify("2025-01-01&<>\"'")}, changefreq: 'always<script>', priority: 4 }]),
	theme: { changes, listeners: listeners.size, storedCleanup: storedCleanup !== undefined }
}));`
	);
});

afterAll(() => {
	if (harnessDir) rmSync(harnessDir, { recursive: true, force: true });
	rmSync(generatedDir, { recursive: true, force: true });
});

describe('web helper hardening (#333)', () => {
	it('only preserves normalized internal login callbacks', () => {
		const { callbacks } = runScaffoldHarness();
		expect(callbacks['/admin/users?tab=active']).toBe('/admin/users?tab=active');
		for (const callback of [
			'https://attacker.example',
			'//attacker.example',
			'javascript:alert(1)',
			'/%2f%2fattacker.example',
			'/\\attacker.example'
		]) {
			expect(callbacks[callback], callback).toBeNull();
		}
	});

	it('escapes all XML characters in the scaffolded sitemap and produces parseable XML', () => {
		const { xml } = runScaffoldHarness();
		const document = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
		expect(document.querySelector('parsererror')).toBeNull();
		expect(document.querySelector('loc')?.textContent).toBe("https://example.test?brand=a&b/products?name=<forge>\"'");
		expect(document.querySelector('lastmod')?.textContent).toBe("2025-01-01&<>\"'");
		expect(xml).toContain('&amp;');
		expect(xml).toContain('&lt;');
		expect(xml).toContain('&gt;');
		expect(xml).toContain('&quot;');
		expect(xml).toContain('&apos;');
		expect(document.querySelector('changefreq')).toBeNull();
		expect(document.querySelector('priority')).toBeNull();
	});

	it('renders canonical, Open Graph, and Twitter tags with absolute URLs', () => {
		const { head } = render(Seo, {
			props: { title: 'SvelteForge', description: 'Fast starts', image: '/preview.png', url: '/pricing' }
		});
		const document = new JSDOM(`<head>${head}</head>`).window.document;
		expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://example.test/pricing');
		expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://example.test/pricing');
		expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://example.test/preview.png');
		expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
		expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe('https://example.test/preview.png');
	});

	it('follows reduced system theme changes only without a stored preference', () => {
		const { theme } = runScaffoldHarness();
		expect(theme.changes).toEqual([true]);
		expect(theme.listeners).toBe(0);
		expect(theme.storedCleanup).toBe(false);
	});

	it('keeps a manual ThemeToggle choice after initially following the system theme', async () => {
		const listeners = new Set<(event: { matches: boolean }) => void>();
		const emitSystemChange = (matches: boolean) => {
			for (const listener of listeners) listener({ matches });
		};
		const media = {
			matches: true,
			addEventListener: vi.fn((_: 'change', listener: (event: { matches: boolean }) => void) => listeners.add(listener)),
			removeEventListener: vi.fn((_: 'change', listener: (event: { matches: boolean }) => void) => listeners.delete(listener))
		};
		vi.stubGlobal('matchMedia', vi.fn(() => media));
		localStorage.removeItem('theme-mode');

		const target = document.createElement('div');
		document.body.append(target);
		const component = mount(ThemeToggle, { target });
		await tick();
		expect(listeners.size).toBe(1);

		(target.querySelector('button') as HTMLButtonElement).click();
		await tick();
		expect(document.documentElement.dataset.mode).toBe('light');
		expect(localStorage.getItem('theme-mode')).toBe('light');
		expect(listeners.size).toBe(0);

		emitSystemChange(true);
		await tick();
		expect(document.documentElement.dataset.mode).toBe('light');
		expect(media.removeEventListener).toHaveBeenCalledTimes(1);

		unmount(component);
		target.remove();
		vi.unstubAllGlobals();
	});

	it('delivers and runs the external theme script before hydration', () => {
		const html = scaffoldFile('/app.html').replace('%sveltekit.assets%', '/_app').replace('%sveltekit.head%', '<script data-hydration="true"></script>');
		const script = scaffoldRootFile('/static/theme-init.js');
		const document = new JSDOM(html).window.document;
		const scripts = [...document.querySelectorAll('head script')];
		expect(scripts.findIndex((node) => node.getAttribute('src') === '/_app/theme-init.js')).toBeLessThan(
			scripts.findIndex((node) => node.hasAttribute('data-hydration'))
		);

		const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
			url: 'https://example.test',
			runScripts: 'dangerously'
		});
		Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: false }) });
		dom.window.localStorage.setItem('theme-mode', 'dark');
		dom.window.eval(script);
		expect(dom.window.document.documentElement.dataset.mode).toBe('dark');
		expect(dom.window.document.documentElement.style.colorScheme).toBe('dark');
	});
});
