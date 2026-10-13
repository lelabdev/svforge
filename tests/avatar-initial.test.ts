// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import AvatarInitial from '../packages/svforge/templates/dashboard/src/lib/components/svforge/ui/AvatarInitial.svelte';

afterEach(cleanup);

describe('Dashboard AvatarInitial', () => {
	it('renders the current name initial and reacts to name changes', async () => {
		const { container, rerender } = render(AvatarInitial, {
			props: { name: 'Ada Lovelace' }
		});
		const avatar = container.firstElementChild!;

		expect(avatar.textContent).toBe('A');
		expect(avatar.classList).toContain('w-8');

		await rerender({ name: 'Grace Hopper', size: 'lg', class: 'team-avatar' });

		expect(avatar.textContent).toBe('G');
		expect(avatar.classList).toContain('w-12');
		expect(avatar.classList).not.toContain('w-8');
		expect(avatar.classList).toContain('team-avatar');
	});

	it('uses a question mark when the name is empty', () => {
		const { container } = render(AvatarInitial, { props: { name: '' } });
		expect(container.firstElementChild?.textContent).toBe('?');
	});
});
