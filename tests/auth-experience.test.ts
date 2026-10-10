import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DASHBOARD = join(ROOT, 'packages/svforge/templates/dashboard/src');
const BASE = join(ROOT, 'packages/svforge/templates/base/src');
const read = (path: string) => readFileSync(path, 'utf8');

const login = read(join(DASHBOARD, 'routes/login/+page.svelte'));
const setup = read(join(DASHBOARD, 'routes/setup/+page.svelte'));
const authLayout = join(BASE, 'lib/components/svforge/layout/AuthLayout.svelte');
const logo = read(join(BASE, 'lib/components/svforge/ui/Logo.svelte'));

describe('auth experience (#541)', () => {
	it('shares a full-height asymmetric layout without a floating card', () => {
		expect(login).toMatch(/<AuthLayout/);
		expect(setup).toMatch(/<AuthLayout/);
		expect(login).not.toMatch(/\bCard\b/);
		expect(setup).not.toMatch(/\bCard\b/);
		const layout = read(authLayout);
		expect(layout).toMatch(/lg:grid-cols-5/);
		expect(layout).toMatch(/lg:col-span-2/);
		expect(layout).toMatch(/lg:col-span-3/);
		expect(layout).toMatch(/min-h-dvh/);
		expect(layout).toMatch(/ThemeToggle/);
	});

	it('keeps the generated app identity neutral and the existing Logo customizable', () => {
		expect(logo).toMatch(/brandName\??: string/);
		expect(logo).not.toMatch(/SVForge|metalFlow|animation:/);
		expect(login).toMatch(/from '\$lib\/components\/svforge\/layout\/AuthLayout\.svelte'/);
		expect(setup).toMatch(/from '\$lib\/components\/svforge\/layout\/AuthLayout\.svelte'/);
		expect(read(join(BASE, 'lib/components/svforge/layout/index.ts'))).toMatch(/AuthLayout/);
	});

	it('uses native autocomplete semantics and one localized feedback component', () => {
		expect(login).toMatch(/autocomplete="username"/);
		expect(login).toMatch(/autocomplete="current-password"/);
		expect(setup).toMatch(/autocomplete="name"/);
		expect(setup).toMatch(/autocomplete="email"/);
		expect(setup).toMatch(/autocomplete="new-password"/);
		expect(login).toMatch(/<Feedback/);
		expect(setup).toMatch(/<Feedback/);
		expect(setup).not.toMatch(/<p[^>]+text-error/);
		expect(login).toMatch(/loading=\{loading\}/);
		expect(setup).toMatch(/loading=\{loading\}/);
		expect(login).toMatch(/aria-pressed=\{passwordVisible\}/);
		expect(setup).toMatch(/aria-pressed=\{passwordVisible\}/);
		expect(read(join(DASHBOARD, 'lib/components/svforge/ui/Feedback.svelte'))).toMatch(/role=\{type === 'error' \? 'alert'/);
	});

	it('uses only stable login error codes and does not return a password', () => {
		const server = read(join(DASHBOARD, 'routes/login/+page.server.ts'));
		expect(server).toMatch(/code: 'invalid_credentials'/);
		expect(server).toMatch(/code: 'invalid_input'/);
		expect(server).not.toMatch(/message: 'Invalid credentials'/);
		expect(server).not.toMatch(/return fail\([^;]*password/s);
		const setupServer = read(join(DASHBOARD, 'routes/setup/+page.server.ts'));
		expect(setupServer).toMatch(/code: 'invalid_input'/);
		expect(setupServer).toMatch(/code: 'admin_exists'/);
		expect(setupServer).toMatch(/code: 'create_failed'/);
		expect(setupServer).not.toMatch(/return fail\([^;]*password/s);
	});
});
