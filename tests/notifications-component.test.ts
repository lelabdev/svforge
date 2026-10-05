// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import NotificationsBell from '../packages/notifications/templates/src/lib/components/svforge/ui/NotificationsBell.svelte';

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('NotificationsBell (#475)', () => {
	it('shows and hides the unread Badge at the zero boundary', () => {
		const { getByText, rerender, queryByText } = render(NotificationsBell, {
			props: { items: [], unreadCount: 3 }
		});

		expect(getByText('3').closest('.badge')).toBeInTheDocument();
		rerender({ items: [], unreadCount: 0 });
		expect(queryByText('0')).not.toBeInTheDocument();
	});

	it('opens from the trigger, closes on Escape and restores trigger focus', async () => {
		const { getByRole, queryByRole } = render(NotificationsBell, {
			props: { items: [], unreadCount: 1 }
		});
		const trigger = getByRole('button', { name: 'Notifications' });

		await fireEvent.click(trigger);
		expect(getByRole('dialog')).toBeVisible();
		await fireEvent.click(trigger);
		await waitFor(() => expect(queryByRole('dialog')).not.toBeInTheDocument());

		await fireEvent.click(trigger);
		const dialog = getByRole('dialog');
		expect(dialog).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(queryByRole('dialog')).not.toBeInTheDocument());
		await waitFor(() => expect(trigger).toHaveFocus());
	});

	it('mark-all posts to the endpoint and closes the popover', async () => {
		const fetchMock = vi.fn(() => new Promise(() => {}));
		vi.stubGlobal('fetch', fetchMock);
		const { getByRole, queryByRole } = render(NotificationsBell, {
			props: { items: [], unreadCount: 2 }
		});

		await fireEvent.click(getByRole('button', { name: 'Notifications' }));
		await fireEvent.click(getByRole('button', { name: 'Mark all as read' }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/notifications/read-all', { method: 'POST' }));
		await waitFor(() => expect(queryByRole('dialog')).not.toBeInTheDocument());
	});
});
