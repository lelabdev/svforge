// @vitest-environment jsdom
/**
 * #321 — Button primitive: button|anchor union, per-branch attribute
 * forwarding, and honest disabled/loading semantics.
 *
 * The `href` discriminant is authoritative: a non-empty string ALWAYS renders
 * the anchor (disabled/loading degrade to aria-disabled + reduced styling),
 * never a `<button>` fallback; `href=""` renders the button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { createRawSnippet } from 'svelte';
import Button from '../packages/svforge/templates/base/src/lib/components/svforge/primitives/Button.svelte';

const children = createRawSnippet(() => ({
	render: () => '<span>Save</span>'
}));

const button = (props: Record<string, unknown>) => render(Button, { props: { children, ...props } });

afterEach(cleanup);

describe('Button — button|anchor union (#321)', () => {
	it('renders a <button> when no href is given', () => {
		const { getByRole } = button({});
		expect(getByRole('button', { name: 'Save' })).toBeInTheDocument();
	});

	it('renders an <a> when href is present, forwarding anchor attributes', () => {
		const onclick = vi.fn();
		const { getByRole } = button({
			href: '/showcase',
			id: 'cta',
			target: '_blank',
			rel: 'noopener',
			'aria-label': 'Go to demo',
			onclick
		});
		const anchor = getByRole('link', { name: 'Go to demo' });
		expect(anchor.tagName).toBe('A');
		expect(anchor).toHaveAttribute('href', '/showcase');
		expect(anchor).toHaveAttribute('id', 'cta');
		expect(anchor).toHaveAttribute('target', '_blank');
		expect(anchor).toHaveAttribute('rel', 'noopener');
		fireEvent.click(anchor);
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('href="" is no link at all: it renders the button branch', () => {
		const { getByRole, queryByRole } = button({ href: '' });
		expect(queryByRole('link')).toBeNull();
		expect(getByRole('button', { name: 'Save' })).toBeInTheDocument();
	});

	it('renders a <button> when href is absent, forwarding button attributes', () => {
		const onclick = vi.fn();
		const { getByRole } = button({
			type: 'submit',
			name: 'action',
			value: 'save',
			form: 'settings-form',
			onclick
		});
		const el = getByRole('button', { name: 'Save' });
		expect(el).toHaveAttribute('type', 'submit');
		expect(el).toHaveAttribute('name', 'action');
		expect(el).toHaveAttribute('value', 'save');
		expect(el).toHaveAttribute('form', 'settings-form');
		expect(el).not.toBeDisabled();
		fireEvent.click(el);
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('button branch never spreads anchor-only rest props (target/rel)', () => {
		// Untyped (JS) consumers can smuggle anchor props in — the <button>
		// must still never receive them (#321).
		const { getByRole } = button({ target: '_blank', rel: 'noopener', download: 'x' });
		const el = getByRole('button', { name: 'Save' });
		expect(el).not.toHaveAttribute('target');
		expect(el).not.toHaveAttribute('rel');
		expect(el).not.toHaveAttribute('download');
	});

	it('anchor branch never spreads button-only rest props', () => {
		// Untyped (JS) consumers can smuggle button props in — the <a> must
		// still never receive them (#321).
		const { getByRole } = button({
			href: '/showcase',
			type: 'submit',
			name: 'action',
			form: 'settings-form',
			formaction: '/submit-here',
			formmethod: 'post',
			formnovalidate: true,
			formtarget: '_self',
			value: 'save',
			popovertarget: 'menu',
			popovertargetaction: 'toggle',
			popover: 'auto',
			command: 'toggle-popover',
			commandfor: 'menu'
		});
		const anchor = getByRole('link', { name: 'Save' });
		for (const attr of [
			'type',
			'name',
			'form',
			'formaction',
			'formmethod',
			'formnovalidate',
			'formtarget',
			'value',
			'popovertarget',
			'popovertargetaction',
			'popover',
			'command',
			'commandfor'
		]) {
			expect(anchor).not.toHaveAttribute(attr);
		}
		// Legitimate anchor rest props still flow through on the same element.
		expect(anchor).toHaveAttribute('href', '/showcase');
	});

	it('component state is authoritative: consumer aria-* cannot override it', () => {
		// Consumer attributes spread FIRST, the computed aria-disabled/aria-busy
		// land LAST — a lying `aria-disabled="false"` cannot mask the loading
		// state from assistive technology (#321).
		const { getByRole } = button({
			href: '/showcase',
			loading: true,
			'aria-disabled': 'false',
			'aria-busy': 'false'
		});
		const anchor = getByRole('link', { name: /Loading… Save/ });
		expect(anchor).toHaveAttribute('aria-disabled', 'true');
		expect(anchor).toHaveAttribute('aria-busy', 'true');
	});

	it('disabled anchor keeps link semantics: aria-disabled + reduced styling, never a <button>', () => {
		const { getByRole, queryByRole } = button({
			href: '/showcase',
			disabled: true,
			target: '_blank',
			rel: 'noopener'
		});
		// A link styled as a button is still a link — no misleading fallback to
		// a <button> whose href discriminant says otherwise (#321).
		const anchor = getByRole('link', { name: 'Save' });
		expect(queryByRole('button')).toBeNull();
		expect(anchor).toHaveAttribute('aria-disabled', 'true');
		// Anchors have no native disabled attribute and remain keyboard-focusable.
		expect(anchor).not.toHaveAttribute('disabled');
		expect(anchor.tabIndex).toBe(0);
		expect(anchor).toHaveClass('cursor-not-allowed');
		expect(anchor.className).toContain('opacity-50');
		// Anchor-specific attributes stay forwarded on this branch.
		expect(anchor).toHaveAttribute('target', '_blank');
		expect(anchor).toHaveAttribute('rel', 'noopener');
	});

	it('disabled button is a real disabled control without href', () => {
		const { getByRole } = button({ disabled: true });
		expect(getByRole('button', { name: 'Save' })).toBeDisabled();
	});

	it('loading anchor stays an anchor and announces busy state', () => {
		const { getByRole, getByText, queryByRole } = button({ href: '/showcase', loading: true });
		const anchor = getByRole('link', { name: /Loading… Save/ });
		expect(queryByRole('button')).toBeNull();
		expect(anchor).toHaveAttribute('aria-busy', 'true');
		expect(anchor).toHaveAttribute('aria-disabled', 'true');
		// Accessible label for the spinner (visual span is aria-hidden).
		expect(getByText('Loading…')).toHaveClass('sr-only');
		const spinner = anchor.querySelector('span[aria-hidden="true"]');
		expect(spinner).not.toBeNull();
		expect(spinner?.className).toContain('animate-spin');
	});

	it('loading announces state: aria-busy, sr-only label, aria-hidden spinner', () => {
		const { getByRole, getByText } = button({ loading: true });
		const el = getByRole('button', { name: /Loading… Save/ });
		expect(el).toHaveAttribute('aria-busy', 'true');
		// Accessible label for the spinner (visual span is aria-hidden).
		expect(getByText('Loading…')).toHaveClass('sr-only');
		const spinner = el.querySelector('span[aria-hidden="true"]');
		expect(spinner).not.toBeNull();
		expect(spinner?.className).toContain('animate-spin');
	});

	it('loading label is overridable for context-specific copy', () => {
		const { getByText } = button({ loading: true, loadingLabel: 'Working…' });
		expect(getByText('Working…')).toHaveClass('sr-only');
	});

	it('enabled buttons use a pointer cursor; disabled and loading buttons use a non-interactive cursor', () => {
		const enabled = button({}).getByRole('button', { name: 'Save' });
		expect(enabled).toHaveClass('cursor-pointer');
		expect(enabled).toHaveClass('focus-visible:ring-2');
		cleanup();

		const disabled = button({ disabled: true }).getByRole('button', { name: 'Save' });
		expect(disabled).toBeDisabled();
		expect(disabled).toHaveClass('cursor-not-allowed');
		cleanup();

		const loading = button({ loading: true }).getByRole('button', { name: /Loading… Save/ });
		expect(loading).toBeDisabled();
		expect(loading).toHaveClass('cursor-not-allowed');
	});

	it('idle buttons do not render the spinner or aria-busy', () => {
		const { getByRole } = button({});
		const el = getByRole('button', { name: 'Save' });
		expect(el).not.toHaveAttribute('aria-busy');
		expect(el.querySelector('span[aria-hidden="true"]')).toBeNull();
	});

	it('idle anchors do not render disabled signaling', () => {
		const { getByRole } = button({ href: '/showcase' });
		const anchor = getByRole('link', { name: 'Save' });
		expect(anchor).not.toHaveAttribute('aria-disabled');
		expect(anchor).not.toHaveAttribute('aria-busy');
		expect(anchor.className).not.toContain('opacity-50');
	});
});

describe('Button — inactive anchor activation gate + button state authority (#321 blockers)', () => {
	/**
	 * Enter on a focused anchor dispatches a click event — `pointer-events-none`
	 * hides the anchor from the mouse but NOT from the keyboard. Dispatching the
	 * same synthetic activation click asserts the gate for both input paths.
	 */
	const activate = (el: Element) => {
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		const preventDefault = vi.spyOn(event, 'preventDefault');
		el.dispatchEvent(event);
		return { preventDefault };
	};

	it('disabled anchor blocks activation: click (mouse or Enter) is prevented, consumer onClick skipped', () => {
		const onclick = vi.fn();
		const { getByRole } = button({ href: '/showcase', disabled: true, onclick });
		const anchor = getByRole('link', { name: 'Save' });
		// Anchor stays focusable (aria-disabled pattern)…
		expect(anchor).toHaveAttribute('aria-disabled', 'true');
		// …but activation must not navigate and must not reach the consumer.
		const { preventDefault } = activate(anchor);
		expect(preventDefault).toHaveBeenCalled();
		expect(onclick).not.toHaveBeenCalled();
	});

	it('loading anchor blocks activation too: click is prevented, consumer onClick skipped', () => {
		const onclick = vi.fn();
		const { getByRole } = button({ href: '/showcase', loading: true, onclick });
		const anchor = getByRole('link', { name: /Loading… Save/ });
		const { preventDefault } = activate(anchor);
		expect(preventDefault).toHaveBeenCalled();
		expect(onclick).not.toHaveBeenCalled();
	});

	it('active anchor is untouched: click is not prevented and consumer onClick fires', () => {
		const onclick = vi.fn();
		const { getByRole } = button({ href: '/showcase', onclick });
		const anchor = getByRole('link', { name: 'Save' });
		expect(anchor).toHaveClass('cursor-pointer');
		const { preventDefault } = activate(anchor);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('button branch: component state wins — consumer aria-busy="false" cannot mask loading', () => {
		// Consumer rest props spread FIRST, the computed aria-busy lands LAST —
		// component loading state stays authoritative on the <button> too (#321).
		const { getByRole } = button({ loading: true, 'aria-busy': 'false' });
		const el = getByRole('button', { name: /Loading… Save/ });
		expect(el).toHaveAttribute('aria-busy', 'true');
	});
});

describe('Button — one shared default style for both branches (#601)', () => {
	/**
	 * The page-header contract relies on this: an action that does NOT ask for a
	 * variant renders the same filled primary, `md` (`btn-base`) button whether
	 * it is a link (`href`) or a click handler (`onclick`). A per-branch default
	 * would silently reintroduce the visual drift #601 removed.
	 */
	it('renders the same default variant and size for the anchor and button branches', () => {
		const link = button({ href: '/admin/users' }).getByRole('link', { name: 'Save' });
		const action = button({}).getByRole('button', { name: 'Save' });
		for (const el of [link, action]) {
			expect(el).toHaveClass('btn', 'btn-base', 'preset-filled-primary-400-600');
		}
	});

	it('keeps explicit sizes available for genuinely different contexts', () => {
		const small = button({ size: 'sm', href: '/admin/users' }).getByRole('link', { name: 'Save' });
		expect(small).toHaveClass('btn-sm');
		expect(small).not.toHaveClass('btn-base');
	});
});
