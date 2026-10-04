// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Card from '../packages/svforge/templates/base/src/lib/components/svforge/ui/Card.svelte';
import { SKELETON_UTILITIES } from '../packages/svforge/src/skeleton-inventory';

const children = createRawSnippet(() => ({ render: () => '<span>Card content</span>' }));
const surfaceClass = 'preset-filled-surface-50-950';
const outlineClass = 'preset-outlined-surface-200-800';

afterEach(cleanup);

function renderCard(variant?: 'flat' | 'elevated' | 'outlined'): Set<string> {
	const props = variant ? { variant, children } : { children };
	const { container } = render(Card, { props });
	return new Set((container.firstElementChild as HTMLElement).classList);
}

describe('Card Skeleton surface contract (#473)', () => {
	it('defaults to a filled, theme-aware Skeleton surface', () => {
		const classes = renderCard();
		expect(classes).toContain('card');
		expect(classes).toContain(surfaceClass);
		expect(SKELETON_UTILITIES).toContain(surfaceClass);
	});

	it('keeps every variant on the same explicit surface with intentional differences', () => {
		const flat = renderCard('flat');
		const elevated = renderCard('elevated');
		const outlined = renderCard('outlined');

		for (const classes of [flat, elevated, outlined]) {
			expect(classes).toContain('card');
			expect(classes).toContain(surfaceClass);
		}

		expect(flat).not.toContain('shadow-lg');
		expect(flat).not.toContain(outlineClass);
		expect(elevated).toContain('shadow-lg');
		expect(elevated).not.toContain(outlineClass);
		expect(outlined).toContain(outlineClass);
		expect(outlined).not.toContain('shadow-lg');
		expect(SKELETON_UTILITIES).toContain(outlineClass);
	});
});
