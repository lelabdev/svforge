import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildScope } from './helpers/build-scope';

const ROOT = join(import.meta.dirname, '..');

describe('monorepo structure', () => {
	const packages = ['svforge', 'ui_toast', 'dnd', 'tiptap', 'graph'];

	it.each(packages)('packages/%s has package.json', (pkg) => {
		expect(existsSync(join(ROOT, 'packages', pkg, 'package.json'))).toBe(true);
	});

	it('every workspace built in this run has a dist entry (#656)', () => {
		// #656: a scoped CI build compiles only the affected closure, so this
		// guard verifies the run's DECLARED build set instead of demanding every
		// workspace (a missing artifact still fails loudly). Unscoped runs
		// (local, full CI, release) keep covering every workspace.
		const { mode, dirs } = buildScope();
		expect(dirs.length, `build scope (${mode}) must not be empty`).toBeGreaterThan(0);
		for (const dir of dirs) {
			expect(existsSync(join(ROOT, 'packages', dir, 'dist/index.js')), `${dir} (build scope: ${mode})`).toBe(true);
		}
	});

	it('base template has the canonical primitives/ui/layout structure (#242)', () => {
		const componentsDir = join(ROOT, 'packages/svforge/templates/base/src/lib/components/svforge');
		const primitives = readdirSync(join(componentsDir, 'primitives'));
		const ui = readdirSync(join(componentsDir, 'ui'));
		const layout = readdirSync(join(componentsDir, 'layout'));

		// primitives: small generic bricks
		const primitiveNames = primitives.filter((f) => f.endsWith('.svelte')).sort();
		expect(primitiveNames).toContain('Button.svelte');
		expect(primitiveNames).toContain('Input.svelte');
		expect(primitiveNames).toContain('Select.svelte');
		expect(primitiveNames).toContain('Badge.svelte');
		expect(primitiveNames).toContain('Toggle.svelte');

		// ui: composed, reusable components
		const uiNames = ui.filter((f) => f.endsWith('.svelte') || f.endsWith('.ts')).sort();
		expect(uiNames).toContain('Card.svelte');
		expect(uiNames).toContain('Alert.svelte');
		expect(uiNames).toContain('Table.svelte');
		expect(uiNames).toContain('Logo.svelte');
		expect(uiNames).toContain('ThemeToggle.svelte');

		// layout: page-structuring components
		const layoutNames = layout.filter((f) => f.endsWith('.svelte')).sort();
		expect(layoutNames).toContain('Navbar.svelte');
		expect(layoutNames).toContain('Footer.svelte');
		expect(layoutNames).toContain('AuthLayout.svelte');

		// No primitives may leak into ui/ (kept in sync with the split)
		for (const name of ['Button.svelte', 'Input.svelte', 'Select.svelte', 'Badge.svelte']) {
			expect(uiNames, `${name} should live in primitives/`).not.toContain(name);
		}
	});

	it('base template keeps a minimal Skeleton-first CSS architecture (#313)', () => {
		const base = join(ROOT, 'packages/svforge/templates/base/src');
		const stylesDir = join(base, 'lib/styles');
		const styleFiles = readdirSync(stylesDir).filter((f) => f.endsWith('.css')).sort();

		expect(styleFiles).toEqual(['svelteforge-theme.css']);
		expect(existsSync(join(stylesDir, 'tokens.css'))).toBe(false);
		expect(existsSync(join(stylesDir, 'index.css'))).toBe(false);

		const layoutCss = readFileSync(join(base, 'routes/layout.css'), 'utf-8');
		expect(layoutCss).toContain("@import '../lib/styles/svelteforge-theme.css';");
		expect(layoutCss).toContain("@import '@skeletonlabs/skeleton';");
		expect(layoutCss).toContain("@import '@skeletonlabs/skeleton-svelte';");
		expect(layoutCss).not.toMatch(/\b(body|:focus-visible|::selection)\s*\{/);
	});

	it('dashboard template owns only the SVForge extensions of the auth/DB foundation (#547)', () => {
		// The official `sv add drizzle better-auth` integrations generate auth.ts,
		// db/index.ts, db/auth.schema.ts, drizzle.config.ts and hooks.server.ts.
		// SVForge ships only its policy, guard, domain schema and DB helper.
		const authDir = join(ROOT, 'packages/svforge/templates/dashboard/src/lib/server');
		for (const owned of ['auth-policy.ts', 'auth-guard.ts', 'db/schema.ts', 'db/client.ts']) {
			expect(existsSync(join(authDir, owned)), owned).toBe(true);
		}
		for (const official of ['auth.ts', 'db/index.ts', 'db/auth.schema.ts', 'auth.schema.config.ts']) {
			expect(existsSync(join(authDir, official)), official).toBe(false);
		}
	});
});
