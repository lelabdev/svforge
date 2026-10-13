// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Alert from '../packages/svforge/templates/base/src/lib/components/svforge/ui/Alert.svelte';
import Badge from '../packages/svforge/templates/base/src/lib/components/svforge/primitives/Badge.svelte';
import Card from '../packages/svforge/templates/base/src/lib/components/svforge/ui/Card.svelte';

afterEach(cleanup);

const children = createRawSnippet(() => ({ render: () => '<span>Content</span>' }));

describe('Base single-use class expressions stay reactive', () => {
	it('updates Badge preset classes when variant and color change', async () => {
		const { container, rerender } = render(Badge, {
			props: { children, class: 'custom-badge' }
		});
		const badge = container.querySelector('span')!;

		expect(badge.classList).toContain('preset-filled-primary-400-600');
		expect(badge.classList).toContain('custom-badge');

		await rerender({ children, class: 'custom-badge', variant: 'outlined', color: 'error' });

		expect(badge.classList).toContain('preset-outlined-error-900-100');
		expect(badge.classList).not.toContain('preset-filled-primary-400-600');
		expect(badge.classList).toContain('custom-badge');
	});

	it('updates Alert preset classes while preserving consumer classes', async () => {
		const { container, rerender } = render(Alert, {
			props: { children, class: 'custom-alert' }
		});
		const alert = container.firstElementChild!;

		expect(alert.classList).toContain('preset-tonal-primary');
		expect(alert.classList).toContain('custom-alert');

		await rerender({ children, class: 'custom-alert', variant: 'success' });

		expect(alert.classList).toContain('preset-tonal-success');
		expect(alert.classList).not.toContain('preset-tonal-primary');
		expect(alert.classList).toContain('custom-alert');
	});

	it('updates Card variant classes while retaining the Skeleton surface', async () => {
		const { container, rerender } = render(Card, {
			props: { children, class: 'custom-card' }
		});
		const card = container.firstElementChild!;

		expect(card.classList).toContain('preset-filled-surface-50-950');
		expect(card.classList).not.toContain('shadow-lg');
		expect(card.classList).toContain('custom-card');

		await rerender({ children, class: 'custom-card', variant: 'elevated' });

		expect(card.classList).toContain('preset-filled-surface-50-950');
		expect(card.classList).toContain('shadow-lg');
		expect(card.classList).toContain('custom-card');
	});
});
