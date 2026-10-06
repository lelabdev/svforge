// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import TiptapPreview from '../packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapPreview.svelte';
import TiptapToolbar from '../packages/tiptap/templates/src/lib/components/svforge/tiptap/TiptapToolbar.svelte';
import { getToolbarState } from '../packages/tiptap/templates/src/lib/components/svforge/tiptap/toolbar-state';

beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		vi.stubGlobal(
			'ResizeObserver',
			class ResizeObserverStub {
				observe() {}
				unobserve() {}
				disconnect() {}
			}
		);
	}
});

afterAll(() => vi.unstubAllGlobals());
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
		onApplyLink: vi.fn(),
		onRemoveLink: vi.fn(),
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
		linkHref: '',
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
		const boldButton = getByRole('button', { name: 'Bold' });

		expect(boldButton.getAttribute('aria-pressed')).toBe('true');
		expect(boldButton.classList.contains('preset-filled-primary-500')).toBe(true);
		expect(boldButton.className).not.toMatch(/bg-primary-500\s+text-white/);
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

	it('shows Skeleton list presets and dispatches the selected list command', async () => {
		const { getByRole, actions } = setup({ activeLists: ['bulletList'] });
		const bullet = getByRole('button', { name: 'Bullet list' });

		expect(bullet.getAttribute('aria-pressed')).toBe('true');
		expect(bullet.classList.contains('preset-tonal-primary')).toBe(true);
		expect(bullet.className).not.toMatch(/bg-primary-500\s+text-white/);
		await fireEvent.click(getByRole('button', { name: 'Ordered list' }));

		expect(actions.onToggleOrderedList).toHaveBeenCalledOnce();
		expect(actions.onToggleBulletList).not.toHaveBeenCalled();
	});

	it('shows Skeleton block presets and toggles a selected block off', async () => {
		const { getByRole, actions } = setup({ activeBlocks: ['blockquote'] });
		const quote = getByRole('button', { name: 'Blockquote' });

		expect(quote.getAttribute('aria-pressed')).toBe('true');
		expect(quote.classList.contains('preset-tonal-primary')).toBe(true);
		expect(quote.className).not.toMatch(/bg-primary-500\s+text-white/);
		await fireEvent.click(getByRole('button', { name: 'Blockquote' }));

		expect(actions.onToggleBlockquote).toHaveBeenCalledOnce();
		expect(actions.onToggleCode).not.toHaveBeenCalled();
	});

	it('opens the link popover with focus in the localized URL field and applies a new link', async () => {
		const { getByRole, queryByRole, actions } = setup();
		await fireEvent.click(getByRole('button', { name: 'Link' }));

		const input = getByRole('textbox', { name: 'Link URL' });
		await waitFor(() => expect(document.activeElement).toBe(input));
		await fireEvent.input(input, { target: { value: 'https://example.com/new' } });
		await fireEvent.click(getByRole('button', { name: 'Apply link' }));

		expect(actions.onApplyLink).toHaveBeenCalledWith('https://example.com/new');
		expect(queryByRole('textbox', { name: 'Link URL' })).toBeNull();
	});

	it.each(['/docs', './page', '../page', '?view=full', '#section', 'article.html'])(
		'accepts safe relative link href %s',
		async (href) => {
			const { getByRole, actions } = setup();
			await fireEvent.click(getByRole('button', { name: 'Link' }));

			const input = getByRole('textbox', { name: 'Link URL' });
			await fireEvent.input(input, { target: { value: href } });
			await fireEvent.click(getByRole('button', { name: 'Apply link' }));

			expect(actions.onApplyLink).toHaveBeenCalledWith(href);
		}
	);

	it.each(['//example.com/path', 'javascript:alert(1)'])(
		'rejects unsafe link href %s',
		async (href) => {
			const { getByRole, getByText, actions } = setup();
			await fireEvent.click(getByRole('button', { name: 'Link' }));

			const input = getByRole('textbox', { name: 'Link URL' });
			await fireEvent.input(input, { target: { value: href } });
			await fireEvent.click(getByRole('button', { name: 'Apply link' }));

			expect(actions.onApplyLink).not.toHaveBeenCalled();
			expect(getByRole('textbox', { name: 'Link URL' }).getAttribute('aria-invalid')).toBe('true');
			expect(getByText('Enter a valid URL or relative link.')).toBeTruthy();
		}
	);

	it('prefills an existing URL so it can be edited', async () => {
		const { getByRole, actions } = setup({ activeLink: true, linkHref: 'https://example.com/old' });
		await fireEvent.click(getByRole('button', { name: 'Link' }));

		const input = getByRole('textbox', { name: 'Link URL' }) as HTMLInputElement;
		expect(input.value).toBe('https://example.com/old');
		await fireEvent.input(input, { target: { value: 'https://example.com/updated' } });
		await fireEvent.click(getByRole('button', { name: 'Update link' }));

		expect(actions.onApplyLink).toHaveBeenCalledWith('https://example.com/updated');
	});

	it('removes an existing link from the popover', async () => {
		const { getByRole, actions } = setup({ activeLink: true, linkHref: 'https://example.com/old' });
		const trigger = getByRole('button', { name: 'Link' });
		expect(trigger.classList.contains('preset-tonal-primary')).toBe(true);
		expect(trigger.className).not.toMatch(/bg-primary-500\s+text-white/);
		await fireEvent.click(trigger);
		await fireEvent.click(getByRole('button', { name: 'Remove link' }));

		expect(actions.onRemoveLink).toHaveBeenCalledOnce();
		expect(actions.onApplyLink).not.toHaveBeenCalled();
	});

	it('Escape closes the popover and restores focus to its trigger', async () => {
		const { getByRole, queryByRole } = setup();
		const trigger = getByRole('button', { name: 'Link' });
		await fireEvent.click(trigger);
		const input = getByRole('textbox', { name: 'Link URL' });
		await waitFor(() => expect(document.activeElement).toBe(input));

		await fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

		await waitFor(() => expect(queryByRole('dialog')).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it('cancels link editing without applying changes', async () => {
		const { getByRole, queryByRole, actions } = setup({ activeLink: true, linkHref: 'https://example.com/old' });
		await fireEvent.click(getByRole('button', { name: 'Link' }));
		const input = getByRole('textbox', { name: 'Link URL' });
		await fireEvent.input(input, { target: { value: 'https://example.com/unsaved' } });
		await fireEvent.click(getByRole('button', { name: 'Cancel' }));

		expect(actions.onApplyLink).not.toHaveBeenCalled();
		expect(actions.onRemoveLink).not.toHaveBeenCalled();
		expect(queryByRole('textbox', { name: 'Link URL' })).toBeNull();
	});
});
