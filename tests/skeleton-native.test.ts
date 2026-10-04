import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { applyBaseMode } from '../packages/svforge/src/modes/base';
import { scaffoldedAgents } from '../packages/svforge/src/scaffolded-agents';
import { baseTemplateFile, dashboardTemplateFile, ROOT } from './helpers';

/**
 * #317 — Generate Skeleton-native projects.
 *
 * Product rule (decision order): Skeleton provides it -> use Skeleton;
 * no -> standard Tailwind for local layout; no -> a concrete repeated
 * product need justifies custom. When a Skeleton primitive is present:
 * theme -> Skeleton primitive -> component, and the component never
 * repeats what the primitive already applies.
 */

const TEMPLATES = join(ROOT, 'packages/svforge/templates');

function allTemplateFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...allTemplateFiles(full));
		else if (/(\.svelte|\.ts|\.css|\.html)$/.test(entry)) out.push(full);
	}
	return out;
}

/** Static class="…" attributes of a Svelte source plus the joined source (for computed classes). */
function scanTemplates(pattern: RegExp): string[] {
	return allTemplateFiles(TEMPLATES).filter((f) => pattern.test(readFileSync(f, 'utf-8')));
}

describe('wrappers do not duplicate Skeleton primitives (#317)', () => {
	it('canonical Card never combines card with rounded-container', () => {
		const card = readFileSync(baseTemplateFile('lib', 'components', 'svforge', 'ui', 'Card.svelte'), 'utf-8');
		expect(card).toContain('card preset-filled-surface-50-950');
		expect(card).not.toContain('rounded-container');
	});

	it('no template stacks a radius utility on the btn/card primitives', () => {
		// `card` consumes --radius-container and `btn` its own radius: any
		// rounded-* inside a class string that also carries btn/btn-icon/card
		// repeats the primitive (checkClassString rule, applied to sources).
		const offenders: string[] = [];
		for (const file of allTemplateFiles(TEMPLATES)) {
			const source = readFileSync(file, 'utf-8');
			for (const match of source.matchAll(/class="([^"]*)"/g)) {
				const tokens = match[1].split(/\s+/).filter(Boolean);
				const hasPrimitive = tokens.some((t) => /^(btn|btn-icon|card)$/.test(t.replace(/^[a-z-]+:/, '')));
				if (hasPrimitive && tokens.some((t) => t.startsWith('rounded-'))) offenders.push(`${file}: "${match[1]}"`);
			}
		}
		expect(offenders, `redundant radius on Skeleton primitives: ${offenders.join('; ')}`).toEqual([]);
	});

	it('canonical Button uses btn-base, never the invented btn-md', () => {
		const button = readFileSync(baseTemplateFile('lib', 'components', 'svforge', 'primitives', 'Button.svelte'), 'utf-8');
		expect(button).not.toContain('btn-md');
		expect(button).toContain('btn-base');
	});

	it('canonical Badge emits no invented badge sizes (Skeleton v5 has none)', () => {
		const badge = readFileSync(baseTemplateFile('lib', 'components', 'svforge', 'primitives', 'Badge.svelte'), 'utf-8');
		expect(badge).not.toMatch(/badge-(sm|md|lg)\b/);
	});

	it('no template ships a Skeleton utility that does not exist in v5', () => {
		const invented: Array<[RegExp, string]> = [
			[/btn-md\b/, 'btn-md (sizes are btn-xs…btn-9xl with btn-base as default)'],
			[/badge-(sm|md|lg)\b/, 'badge-sm/md/lg (the badge utility owns its size)'],
			[/preset-tonal-info\b/, 'preset-tonal-info (tonal presets have no info color)'],
			[/preset-filled-info\b/, 'preset-filled-info (filled presets have no info color)']
		];
		for (const [pattern, message] of invented) {
			const offenders = scanTemplates(pattern);
			expect(offenders, `${message} — found in: ${offenders.join(', ')}`).toEqual([]);
		}
	});

	it('Feedback uses the Skeleton tonal presets instead of hand-paired bg/text colors', () => {
		const feedback = readFileSync(dashboardTemplateFile('lib', 'components', 'svforge', 'ui', 'Feedback.svelte'), 'utf-8');
		expect(feedback).toContain('preset-tonal-success');
		expect(feedback).toContain('preset-tonal-error');
		expect(feedback).not.toContain('bg-success-100-900');
		expect(feedback).not.toContain('bg-error-100-900');
	});
});

describe('Fira Code rides the native mono token (#317)', () => {
	const layoutCss = readFileSync(baseTemplateFile('routes', 'layout.css'), 'utf-8');

	it('exposes Fira Code through --font-mono', () => {
		expect(layoutCss).toMatch(/@theme\s*\{[^}]*--font-mono:\s*'Fira Code Variable'/);
	});

	it('no global code/pre font override is scaffolded', () => {
		expect(layoutCss).not.toMatch(/code\s*,\s*pre\s*\{/);
		expect(layoutCss).not.toContain("font-family: 'Fira Code Variable'");
	});
});

describe('local Skeleton/Svelte references ship with every scaffold (#317)', () => {
	// A tolerant sv.add API recorder (same contract as agents-md.test.ts):
	// sv.file() results land in `files`, transforms receive existing content,
	// every other addon method is a no-op — keeps the fake immune to
	// unrelated applyBaseMode API surface.
	function fakeSv(): { files: Map<string, string>; api: Parameters<typeof applyBaseMode>[0] } {
		const files = new Map<string, string>();
		const target = {
			dependency: () => {},
			devDependency: () => {},
			file: (path: string, transform: (existing: string) => string) =>
				files.set(path, transform(path === 'package.json' ? '{"scripts":{}}' : ''))
		};
		const api = new Proxy(target, {
			get: (t, prop) => (prop in t ? t[prop as keyof typeof t] : () => {})
		}) as unknown as Parameters<typeof applyBaseMode>[0];
		return { files, api };
	}

	it('applyBaseMode delivers docs/llms-skeleton.txt and docs/llms-svelte.txt', () => {
		const { files, api } = fakeSv();
		applyBaseMode(api, { '/lib/base.ts': 'base' });
		for (const doc of ['docs/llms-skeleton.txt', 'docs/llms-svelte.txt']) {
			const content = files.get(doc);
			expect(content, `${doc} must be scaffolded`).toBeTruthy();
			expect(content!.length, `${doc} must carry the full cached dump`).toBeGreaterThan(10_000);
			expect(content).toContain('source: https://');
		}
	});

	it('the shipped docs are the same cached files the freshness tests guard', () => {
		const { files, api } = fakeSv();
		applyBaseMode(api, { '/lib/base.ts': 'base' });
		for (const doc of ['docs/llms-skeleton.txt', 'docs/llms-svelte.txt']) {
			const cached = readFileSync(join(ROOT, 'packages/svforge/docs', doc.split('/')[1]), 'utf-8');
			expect(files.get(doc)).toBe(cached);
		}
	});
});

describe('generated AGENTS.md teaches the real Skeleton model (#317)', () => {
	const canonical = scaffoldedAgents('base');

	it('stops presenting the hand-written utility list as exhaustive', () => {
		expect(canonical).not.toMatch(/exclusively/i);
		expect(canonical).toMatch(/not exhaustive/i);
	});

	it('points agents to the LOCAL cached references first', () => {
		expect(canonical).toContain('docs/llms-skeleton.txt');
		expect(canonical).toContain('docs/llms-svelte.txt');
		expect(canonical).toMatch(/search docs\/llms-skeleton\.txt/i);
	});

	it('no longer sends agents to remote LLM docs', () => {
		expect(canonical).not.toContain('llms-full.txt');
	});

	it('tells agents to trust vendored docs over training memory', () => {
		expect(canonical).toMatch(/training memory/i);
	});

	it('keeps the blacklist for known obsolete patterns', () => {
		expect(canonical).toContain('variant-*');
		expect(canonical).toContain('preset-ghost');
	});

	it('references the real Skeleton inventory shipped in the scaffold', () => {
		expect(canonical).toContain('svforge-check.mjs');
	});
});

describe('demo and reference screens consume Skeleton typography utilities (#317)', () => {
	it('/demo-ui has a typography section driven by the native utilities', () => {
		const demo = readFileSync(baseTemplateFile('routes', 'demo-ui', '+page.svelte'), 'utf-8');
		expect(demo).toMatch(/class="h1"/);
		expect(demo).toMatch(/class="h2/);
		expect(demo).toMatch(/class="h3"/);
		expect(demo).toMatch(/class="anchor"/);
		expect(demo).toMatch(/class="kbd"/);
		expect(demo).toMatch(/<pre/);
	});

	it('/demo-ui no longer hand-rolls heading sizes', () => {
		const demo = readFileSync(baseTemplateFile('routes', 'demo-ui', '+page.svelte'), 'utf-8');
		expect(demo).not.toMatch(/<h[1-6][^>]*class="[^"]*text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/);
		expect(demo).not.toMatch(/<h[1-6][^>]*class="[^"]*font-bold/);
	});

	it('the landing screen consumes the heading utilities', () => {
		const landing = readFileSync(baseTemplateFile('routes', '+page.svelte'), 'utf-8');
		expect(landing).toMatch(/class="h1"/);
		expect(landing).not.toMatch(/<h[1-6][^>]*class="[^"]*font-bold/);
	});

	it('dashboard reference screens consume the heading utilities', () => {
		const headingFiles = [
			dashboardTemplateFile('routes', '(app)', 'admin', '+page.svelte'),
			dashboardTemplateFile('routes', '(app)', 'admin', 'settings', '+page.svelte'),
			dashboardTemplateFile('routes', 'login', '+page.svelte'),
			dashboardTemplateFile('routes', 'setup', '+page.svelte')
		];
		for (const file of headingFiles) {
			const source = readFileSync(file, 'utf-8');
			expect(
				source.match(/<h[1-6][^>]*>/g)?.filter((tag) => /text-|font-bold/.test(tag)) ?? [],
				`${file} must use the Skeleton h1…h6 utilities on headings`
			).toEqual([]);
		}
	});
});
