// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PasswordInput from '../packages/svforge/templates/dashboard/src/lib/components/svforge/ui/PasswordInput.svelte';

const ROOT = process.cwd();
const DASHBOARD = join(ROOT, 'packages/svforge/templates/dashboard');

afterEach(cleanup);

function mount(overrides: Record<string, unknown> = {}) {
	return render(PasswordInput, {
		props: { label: 'Password', name: 'password', value: 'secret', ...overrides }
	});
}

/**
 * #603 — the password reveal affordance used to be hand-rolled identically in
 * the login and setup routes. It now lives in one shared field component that
 * keeps the Skeleton/primitive markup and owns only the reveal state.
 */
describe('shared PasswordInput (#603)', () => {
	it('renders a masked field with an accessible reveal control', () => {
		const { getByLabelText, getByRole } = mount();
		const input = getByLabelText('Password') as HTMLInputElement;
		const toggle = getByRole('button', { name: 'Show password' });

		expect(input.type).toBe('password');
		expect(input.name).toBe('password');
		expect(input.value).toBe('secret');
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
		expect(toggle.classList.contains('cursor-pointer')).toBe(true);
	});

	it('reveals and re-masks the value while keeping the same field', async () => {
		const { getByLabelText, getByRole } = mount();
		const input = getByLabelText('Password') as HTMLInputElement;

		await fireEvent.click(getByRole('button', { name: 'Show password' }));
		expect(input.type).toBe('text');
		expect(input.value).toBe('secret');
		const hide = getByRole('button', { name: 'Hide password' });
		expect(hide.getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(hide);
		await waitFor(() => expect(input.type).toBe('password'));
		expect(getByRole('button', { name: 'Show password' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('posts the typed value and forwards the autofill hint', async () => {
		const { getByLabelText } = mount({ autocomplete: 'new-password', value: '' });
		const input = getByLabelText('Password') as HTMLInputElement;

		expect(input.getAttribute('autocomplete')).toBe('new-password');
		await fireEvent.input(input, { target: { value: 'hunter2hunter2' } });
		expect(input.value).toBe('hunter2hunter2');
	});

	it('disables both the field and its reveal control', () => {
		const { getByLabelText, getByRole } = mount({ disabled: true });

		expect((getByLabelText('Password') as HTMLInputElement).disabled).toBe(true);
		expect((getByRole('button', { name: 'Show password' }) as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('password field reuse contract (#603)', () => {
	it.each([
		['login', join(DASHBOARD, 'src/routes/login/+page.svelte')],
		['setup', join(DASHBOARD, 'src/routes/setup/+page.svelte')]
	])('%s composes the shared field instead of re-implementing the toggle', (_name, file) => {
		const source = readFileSync(file, 'utf-8');

		expect(source).toContain('<PasswordInput');
		expect(source).toMatch(/from '#lib\/components\/svforge\/ui\/index\.js'/);
		// The local reveal state, the eye icons and the inline toggle are gone.
		expect(source).not.toContain('passwordVisible');
		expect(source).not.toContain('EyeSlash');
		expect(source).not.toContain('common_show_password');
	});

	it('is exported from the canonical ui barrel', () => {
		expect(readFileSync(join(DASHBOARD, 'src/lib/components/svforge/ui/index.ts'), 'utf-8')).toContain(
			"export { default as PasswordInput } from './PasswordInput.svelte';"
		);
	});
});
