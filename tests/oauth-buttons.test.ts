// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

const { socialSignIn } = vi.hoisted(() => ({ socialSignIn: vi.fn() }));
vi.mock('#lib/client/auth.js', () => ({ authClient: { signIn: { social: socialSignIn } } }));

import OAuthButtons from '../packages/oauth/templates/src/lib/components/svforge/ui/OAuthButtons.svelte';

afterEach(cleanup);

describe('OAuthButtons interaction state', () => {
	it('marks enabled providers clickable and blocks competing sign-ins while loading', async () => {
		socialSignIn.mockReset();
		let resolveSocialSignIn!: (value: unknown) => void;
		socialSignIn.mockImplementation(
			() => new Promise((resolve) => (resolveSocialSignIn = resolve))
		);
		const { getByRole } = render(OAuthButtons);
		const google = getByRole('button', { name: 'Google' }) as HTMLButtonElement;
		const github = getByRole('button', { name: 'GitHub' }) as HTMLButtonElement;

		expect(google.disabled).toBe(false);
		expect(github.disabled).toBe(false);
		expect(google.classList.contains('cursor-pointer')).toBe(true);
		expect(github.classList.contains('cursor-pointer')).toBe(true);

		try {
			await fireEvent.click(google);

			expect(socialSignIn).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/admin' });
			expect(google.disabled).toBe(true);
			expect(github.disabled).toBe(true);
			expect(google.classList.contains('cursor-not-allowed')).toBe(true);
			expect(github.classList.contains('cursor-not-allowed')).toBe(true);
			expect(google.querySelector('.animate-spin')).not.toBeNull();

			await fireEvent.click(github);
			expect(socialSignIn).toHaveBeenCalledTimes(1);
		} finally {
			resolveSocialSignIn(undefined);
		}
		await waitFor(() => {
			expect(google.disabled).toBe(false);
			expect(github.disabled).toBe(false);
			expect(google.classList.contains('cursor-pointer')).toBe(true);
			expect(github.classList.contains('cursor-pointer')).toBe(true);
		});
	});

	it('restores enabled controls when provider sign-in rejects', async () => {
		socialSignIn.mockReset();
		socialSignIn.mockRejectedValueOnce(new Error('provider unavailable'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { getByRole } = render(OAuthButtons);
		const google = getByRole('button', { name: 'Google' }) as HTMLButtonElement;
		const github = getByRole('button', { name: 'GitHub' }) as HTMLButtonElement;

		try {
			await fireEvent.click(github);
			await waitFor(() => {
				expect(google.disabled).toBe(false);
				expect(github.disabled).toBe(false);
				expect(github.classList.contains('cursor-pointer')).toBe(true);
			});
			expect(consoleError).toHaveBeenCalledOnce();
		} finally {
			consoleError.mockRestore();
		}
	});
});
