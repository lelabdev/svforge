import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkDesignSystem, SVFORGE_CATALOG } from '../packages/svforge/src/design-system';
import { ROOT } from './helpers';

/**
 * Tests for #240/#480 — preserve strict Skeleton validation while allowing
 * explicitly selected UI libraries. Tested on throwaway projects.
 */
describe('design-system harness (#240)', () => {
	let project: string;

	beforeAll(() => {
		project = mkdtempSync(join(tmpdir(), 'sf-ds-'));
		// Minimal SvelteKit-like project
		writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'probe', dependencies: {} }));
		mkdirSync(join(project, 'src/lib/components/svforge/primitives'), { recursive: true });
		writeFileSync(join(project, 'src/lib/components/svforge/primitives/Button.svelte'), '<button>ok</button>');
		mkdirSync(join(project, 'src/lib/styles'), { recursive: true });
		writeFileSync(
			join(project, 'src/lib/styles/svelteforge-theme.css'),
			"[data-theme='svelteForge'] { --color-primary-500: oklch(60% 0.1 220); }"
		);
		mkdirSync(join(project, 'src/routes'), { recursive: true });
		writeFileSync(
			join(project, 'src/routes/layout.css'),
			"@import '../lib/styles/svelteforge-theme.css';"
		);
	});

	afterAll(() => {
		rmSync(project, { recursive: true, force: true });
	});

	it('passes a canonical project (no violations)', async () => {
		const results = await checkDesignSystem(project);
		const errors = results.filter((r) => r.status === 'error');
		expect(errors).toEqual([]);
	});

	it('reports an imported unregistered UI package as actionable WARN, never ERROR', async () => {
		const pkgPath = join(project, 'package.json');
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
		pkg.dependencies['@example/arbitrary-ui'] = '^1.0.0';
		writeFileSync(pkgPath, JSON.stringify(pkg));
		const page = join(project, 'src/routes/+page.svelte');
		writeFileSync(page, `<script>import { Dialog } from '@example/arbitrary-ui';</script><Dialog />`);
		try {
			const results = await checkDesignSystem(project);
			const notice = results.find((result) => result.message.includes('@example/arbitrary-ui'));
			expect(notice?.status).toBe('warn');
			expect(notice?.message).toContain('svforge ui register @example/arbitrary-ui');
			expect(results.some((result) => result.status === 'error')).toBe(false);
		} finally {
			delete pkg.dependencies['@example/arbitrary-ui'];
			writeFileSync(pkgPath, JSON.stringify(pkg));
			writeFileSync(page, '');
		}
	});

	it('flags a duplicated Skeleton primitive as ERROR', async () => {
		// Dialog.svelte outside the svforge dir is a duplicate of Skeleton's Dialog
		mkdirSync(join(project, 'src/lib/features/employees'), { recursive: true });
		writeFileSync(join(project, 'src/lib/features/employees/Dialog.svelte'), '<div>custom</div>');
		try {
			const results = await checkDesignSystem(project);
			const dup = results.find((r) => r.message.includes('Duplicated Skeleton primitive "Dialog"'));
			expect(dup).toBeDefined();
			expect(dup!.status).toBe('error');
		} finally {
			rmSync(join(project, 'src/lib/features'), { recursive: true, force: true });
		}
	});

	it('passes components inside the svforge dir (ours by construction)', async () => {
		mkdirSync(join(project, 'src/lib/components/svforge/ui'), { recursive: true });
		writeFileSync(join(project, 'src/lib/components/svforge/ui/StatCard.svelte'), '<div>stat</div>');
		const results = await checkDesignSystem(project);
		expect(results.some((r) => r.message.includes('StatCard'))).toBe(false);
	});

	it('catalog entries match the real template files', () => {
		for (const [name, entry] of Object.entries(SVFORGE_CATALOG)) {
			const file = join(ROOT, 'packages/svforge/templates/base/src/lib/components/svforge', entry.path);
			expect(existsSync(file), `catalog entry ${name} → ${entry.path} missing`).toBe(true);
		}
	});

	it('catalog.json is delivered via base root files', async () => {
		const { baseRootFiles } = await import('../packages/svforge/src/templates');
		expect(Object.keys(baseRootFiles)).toContain('/svforge-catalog.json');
		expect(Object.keys(baseRootFiles)).toContain('/svforge-check.mjs');
	});

	it('scaffold guard asserts the catalog + check availability', () => {
		const script = readFileSync(join(ROOT, 'scripts/test-scaffold.sh'), 'utf-8');
		expect(script).toMatch(/svforge-catalog\.json/);
		expect(script).toMatch(/svforge-check\.mjs/);
	});

	it('scaffold gate inspects the compiled CSS for canonical classes (#320)', () => {
		const script = readFileSync(join(ROOT, 'scripts/test-scaffold.sh'), 'utf-8');
		expect(script).toMatch(/compiled CSS canonical-class gate \(#320\)/);
		// ghosts must be asserted absent…
		for (const ghost of ['btn-md', 'badge-sm', 'badge-md', 'badge-lg', 'preset-tonal-info', 'rounded-card']) {
			expect(script).toContain(ghost);
		}
		// …and canonical replacements asserted present.
		for (const canonical of ['btn-base', 'preset-tonal-primary', 'rounded-container']) {
			expect(script).toContain(canonical);
		}
	});
});
