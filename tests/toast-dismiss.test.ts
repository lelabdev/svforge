// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { toaster } from '../packages/ui_toast/templates/src/lib/components/svforge/ui/toaster';
import Toaster from '../packages/ui_toast/templates/src/lib/components/svforge/ui/Toaster.svelte';

afterEach(() => {
	cleanup();
	toaster.dismiss();
});

describe('ui_toast Toaster (#594)', () => {
	it('keeps the Skeleton dismiss trigger while presenting it as clickable', async () => {
		const { getByRole } = render(Toaster);
		toaster.create({ title: 'Saved', description: 'Changes stored.' });

		const dismiss = await waitFor(() => getByRole('button', { name: 'Dismiss notification' }));

		expect(dismiss.getAttribute('data-part')).toBe('close-trigger');
		expect(dismiss.classList.contains('cursor-pointer')).toBe(true);
	});
});
