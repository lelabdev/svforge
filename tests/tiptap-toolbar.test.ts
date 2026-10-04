// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import TiptapPreview from '../packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapPreview.svelte';
import TiptapToolbar from '../packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapToolbar.svelte';
import { getToolbarState } from '../packages/tiptap/templates/src/lib/components/svforge/tiptap/toolbar-state';

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}) {
	const actions = {
		onToggleBold: vi.fn(),
		onToggleItalic: vi.fn(),
		onToggleUnderline: vi.fn(),
		onToggleStrike: vi.fn(),
		onToggleBulletList: vi.fn(),
		onToggleOrderedList: vi.fn(),
		onToggleBlockquote: vi.fn(),
		onToggleCode: vi.fn(),
		onSetLink: vi.fn(),
		onSetHeading: vi.fn(),
		onUnsetHeading: vi.fn()
	};
	const props = {
		loading: false,
		activeFormats: [],
		activeHeading: [],
		activeLists: [],
		activeBlocks: [],
		activeLink: false,
		...actions,
		...overrides
	};
	return { ...render(TiptapToolbar, { props: props as never }), actions };
}

describe('Tiptap toolbar controls (#484)', () => {
	it('maps the current editor selection to controlled toolbar values', () => {
		const active = new Set(['bold', 'underline', 'heading', 'orderedList', 'blockquote', 'link']);
		const state = getToolbarState({
			isActive: (type) => active.has(type),
			getAttributes: () => ({ level: 2 })
		});

		expect(state).toEqual({
			activeFormats: ['bold', 'underline'],
			activeHeading: ['2'],
			activeLists: ['orderedList'],
			activeBlocks: ['blockquote'],
			activeLink: true
		});
		expect(getToolbarState(null)).toEqual({
			activeFormats: [],
			activeHeading: [],
			activeLists: [],
			activeBlocks: [],
			activeLink: false
		});
	});

	it('renders semantic rich text with theme-aware prose instead of custom preview hooks', () => {
		const { container, getByRole } = render(TiptapPreview, {
			props: {
				content: {
					type: 'doc',
					content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Preview' }] }]
				}
			} as never
		});
		const heading = getByRole('heading', { level: 2, name: 'Preview' });
		const prose = container.querySelector('.prose');

		expect(heading.className).toBe('');
		expect(prose?.classList.contains('dark:prose-invert')).toBe(true);
		expect(prose?.classList.contains('prose-headings:text-surface-950-50')).toBe(true);
		expect(prose?.classList.contains('tiptap-preview')).toBe(false);
	});

	it('uses the controlled formatting state and dispatches the selected mark action', async () => {
		const { getByRole, actions } = setup({ activeFormats: ['bold'] });

		expect(getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
		expect(getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')).toBe('false');

		await fireEvent.click(getByRole('button', { name: 'Italic' }));

		expect(actions.onToggleItalic).toHaveBeenCalledOnce();
		expect(actions.onToggleBold).not.toHaveBeenCalled();
	});

	it('switches between heading levels and clears a selected heading', async () => {
		const first = setup({ activeHeading: ['1'] });
		expect(first.getByRole('radio', { name: 'Heading 1' }).getAttribute('aria-checked')).toBe('true');
		expect(first.getByRole('radio', { name: 'Heading 2' }).getAttribute('aria-checked')).toBe('false');
		await fireEvent.click(first.getByRole('radio', { name: 'Heading 2' }));
		expect(first.actions.onSetHeading).toHaveBeenCalledWith(2);

		cleanup();
		const second = setup({ activeHeading: ['2'] });
		await fireEvent.click(second.getByRole('radio', { name: 'Heading 2' }));
		expect(second.actions.onUnsetHeading).toHaveBeenCalledOnce();
	});

	it('shows list state and dispatches the selected list command', async () => {
		const { getByRole, actions } = setup({ activeLists: ['bulletList'] });

		expect(getByRole('button', { name: 'Bullet list' }).getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(getByRole('button', { name: 'Ordered list' }));

		expect(actions.onToggleOrderedList).toHaveBeenCalledOnce();
		expect(actions.onToggleBulletList).not.toHaveBeenCalled();
	});

	it('toggles block actions off when the selected item is clicked again', async () => {
		const { getByRole, actions } = setup({ activeBlocks: ['blockquote'] });

		expect(getByRole('button', { name: 'Blockquote' }).getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(getByRole('button', { name: 'Blockquote' }));

		expect(actions.onToggleBlockquote).toHaveBeenCalledOnce();
		expect(actions.onToggleCode).not.toHaveBeenCalled();
	});

	it('keeps the link action as a Skeleton button primitive', async () => {
		const { getByRole, actions } = setup({ activeLink: true });

		expect(getByRole('button', { name: 'Link' }).getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(getByRole('button', { name: 'Link' }));

		expect(actions.onSetLink).toHaveBeenCalledOnce();
	});
});
