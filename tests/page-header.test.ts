import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers';
import {
	DESIGN_RULE_IDS,
	SVFORGE_CATALOG,
	checkDesignSystem,
	pageHeaderActionOverrides
} from '../packages/svforge/src/design-system';
import { baseRootFiles } from '../packages/svforge/src/templates';
import { scaffoldedAgents } from '../packages/svforge/src/scaffolded-agents';
import { buildManifest, renderLlmstxt } from '../packages/svforge/src/ai-context';

/**
 * #601 — one canonical page header and default-first header actions.
 *
 * The regression: two Dashboard pages rendered equivalent primary page-header
 * actions with different sizes because one page pinned `size="sm"` while the
 * other relied on the shared Button default. The fix is compositional (one
 * `PageHeader` owning title/description/action row + plain Buttons), and the
 * deterministic guard only reports a PINNED size inside that action slot —
 * compact table rows, toolbars and icon-only controls keep their sizes.
 */

const BASE = join(ROOT, 'packages/svforge/templates/base');
const DASHBOARD = join(ROOT, 'packages/svforge/templates/dashboard');
const ADMIN = join(DASHBOARD, 'src/routes/(app)/admin');
const RULE_MARKER = `[svforge/${DESIGN_RULE_IDS.pageHeaderActionSize}]`;

const temporaryDirs: string[] = [];

afterEach(() => {
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirs.push(dir);
	return dir;
}

function headerActions(file: string): string {
	const source = readFileSync(file, 'utf-8');
	const match = source.match(
		/<PageHeader\b[^>]*>[\s\S]*?\{#snippet\s+actions\s*\([^)]*\)\}([\s\S]*?)\{\/snippet\}/
	);
	expect(match, `no PageHeader actions snippet in ${file}`).not.toBeNull();
	return match![1];
}

/** Button tag attributes that keep the shared default style (no variant/color). */
function primaryActions(snippet: string): string[] {
	return [...snippet.matchAll(/<Button\b([^>]*)>/g)]
		.map((match) => match[1])
		.filter((attributes) => !/\b(?:variant|color)\s*=/.test(attributes));
}

function writeProjectSource(source: string): string {
	const dir = tempDir('sf-page-header-');
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'probe', dependencies: {} }));
	mkdirSync(join(dir, 'src/routes'), { recursive: true });
	writeFileSync(join(dir, 'src/routes/+page.svelte'), source);
	return dir;
}

describe('canonical page header (#601)', () => {
	it('ships one PageHeader with its export and catalog entries', () => {
		expect(SVFORGE_CATALOG.PageHeader).toMatchObject({
			path: 'layout/PageHeader.svelte',
			category: 'layout'
		});
		expect(readFileSync(join(BASE, 'src/lib/components/svforge/layout/index.ts'), 'utf-8')).toMatch(
			/export \{ default as PageHeader \} from '\.\/PageHeader\.svelte';/
		);

		const catalog = JSON.parse(baseRootFiles['/svforge-catalog.json']);
		expect(catalog.designSystem.layout.PageHeader.path).toBe('layout/PageHeader.svelte');
		expect(catalog.rules.defaultFirst).toMatch(/only when the context genuinely differs/i);
		expect(catalog.rules.pageHeader).toMatch(/PageHeader/);
	});

	it('composes every dashboard page header through PageHeader', () => {
		for (const page of [
			join(ADMIN, '+page.svelte'),
			join(ADMIN, 'users', '+page.svelte'),
			join(ADMIN, 'settings', '+page.svelte')
		]) {
			const source = readFileSync(page, 'utf-8');
			expect(source, page).toContain('<PageHeader');
			// The old ad-hoc header wrapper (h2 + justify-between row) is gone.
			expect(source, page).not.toMatch(/<h2 class="h2"/);
		}
	});

	it('gives Manage users and Add user the same default action style', () => {
		const manage = headerActions(join(ADMIN, '+page.svelte'));
		const add = headerActions(join(ADMIN, 'users', '+page.svelte'));

		for (const snippet of [manage, add]) {
			// No equivalent action may pin its own size (#601 regression). Icon
			// sizes inside the button label are unaffected.
			for (const button of snippet.matchAll(/<Button\b[^>]*>/g)) {
				expect(button[0]).not.toMatch(/\bsize\s*=/);
			}
		}

		const [managePrimary] = primaryActions(manage);
		const [addPrimary] = primaryActions(add);
		expect(primaryActions(manage)).toHaveLength(1);
		expect(primaryActions(add)).toHaveLength(1);
		// Both primary CTAs therefore render the SAME Button defaults: filled
		// primary, md (`btn-base`), no sizing class of their own.
		for (const attributes of [managePrimary, addPrimary]) {
			expect(attributes).not.toMatch(/\bclass\s*=|\bsize\s*=/);
		}
	});
});

describe('page-header action rule (#601)', () => {
	it('reports a pinned size inside the canonical action slot', () => {
		const source = [
			'<PageHeader title="Users">',
			'\t{#snippet actions()}',
			'\t\t<Button size="sm" href="/users/add">Add</Button>',
			'\t{/snippet}',
			'</PageHeader>'
		].join('\n');
		expect(pageHeaderActionOverrides(source)).toEqual([{ size: 'sm', line: 3 }]);
		expect(
			pageHeaderActionOverrides('<PageHeader title="x">{#snippet actions()}<Button size={\'lg\'} /></PageHeader>')
		).toEqual([{ size: 'lg', line: 1 }]);
	});

	it('never reports contextual sizes outside the header action slot', () => {
		const source = [
			'<PageHeader title="Users">',
			'\t{#snippet actions()}',
			'\t\t<Button href="/users/add">Add</Button>',
			'\t{/snippet}',
			'</PageHeader>',
			'<PageHeader title="Empty" />',
			'<Table {columns} rows={rows}>',
			'\t{#snippet children({ row })}',
			'\t\t<Button size="sm" class="size-11 p-0" aria-label="edit">{row.name}</Button>',
			'\t{/snippet}',
			'</Table>'
		].join('\n');
		expect(pageHeaderActionOverrides(source)).toEqual([]);
	});

	it('surfaces the drift as a WARN through the repo engine', async () => {
		const project = writeProjectSource(
			[
				'<PageHeader title="Users">',
				'\t{#snippet actions()}',
				'\t\t<Button size="sm" href="/users/add">Add</Button>',
				'\t{/snippet}',
				'</PageHeader>',
				'<Table {columns} rows={rows}>',
				'\t{#snippet children({ row })}',
				'\t\t<Button size="sm">{row.name}</Button>',
				'\t{/snippet}',
				'</Table>'
			].join('\n')
		);

		const drift = (await checkDesignSystem(project)).filter((result) =>
			result.message.includes(RULE_MARKER)
		);
		expect(drift).toHaveLength(1);
		expect(drift[0].status).toBe('warn');
		expect(drift[0].message).toContain('size "sm"');
		expect(drift[0].message).toContain('src/routes/+page.svelte:3');
	});

	it('delivers the same rule through the generated checker', () => {
		const project = writeProjectSource(
			[
				'<PageHeader title="Users">',
				'\t{#snippet actions()}',
				'\t\t<Button size="sm" href="/users/add">Add</Button>',
				'\t{/snippet}',
				'</PageHeader>',
				'<Table {columns} rows={rows}>',
				'\t{#snippet children({ row })}',
				'\t\t<Button size="sm">{row.name}</Button>',
				'\t{/snippet}',
				'</Table>'
			].join('\n')
		);
		writeFileSync(join(project, 'svforge-check.mjs'), baseRootFiles['/svforge-check.mjs']);

		const result = spawnSync(process.execPath, ['svforge-check.mjs'], {
			cwd: project,
			encoding: 'utf-8'
		});
		const driftLines = result.stdout
			.split('\n')
			.filter((line) => line.includes(DESIGN_RULE_IDS.pageHeaderActionSize));
		expect(driftLines, result.stdout + result.stderr).toHaveLength(1);
		expect(driftLines[0]).toContain('src/routes/+page.svelte:3');
		// The rest of the fixture (a compact table action) stays silent, and a
		// WARN does not fail a plain `svforge check`.
		expect(result.stdout).not.toContain('WARN: src/routes/+page.svelte:9');
		expect(result.status).toBe(0);
	});
});

describe('generated guidance (#601)', () => {
	it('documents default-first styling, page width and optional title icons', () => {
		const guidance = scaffoldedAgents('dashboard');
		expect(guidance).toContain('**Default-first styling**');
		expect(guidance).toContain('`layout/PageHeader.svelte`');
		expect(guidance).toContain('Admin pages are full width by default');
		expect(guidance).toContain('**Decorative page-title icons are optional**');
		expect(guidance).toContain('pageHeaderActionSize');
	});

	it('carries the rule into the generated llms.txt context', () => {
		const txt = renderLlmstxt(buildManifest('dashboard', []));
		expect(txt).toContain('compose page titles and header actions with layout/PageHeader.svelte');
		expect(txt).toContain('pin a style prop (size, variant) on an equivalent page-header action');
	});
});
