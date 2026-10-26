// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import UploadsDemo from '../packages/uploads/templates/src/routes/showcase/uploads/+page.svelte';

/**
 * #586 — the uploads showcase is SAFE BY DEFAULT.
 *
 * Rendered behaviour, not class strings: a valid selection reaches the
 * simulated success state with the Skeleton progress affordance, a rejected
 * type/size shows the module's own localized error, and nothing ever calls
 * `fetch` (asserted here, not just in the source guards).
 */
const originalFetch = globalThis.fetch;

function selectFile(container: HTMLElement, file: File) {
	const input = container.querySelector('input[type="file"]') as HTMLInputElement;
	fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
	vi.useFakeTimers();
	globalThis.fetch = vi.fn(() => {
		throw new Error('the uploads demo must never call fetch');
	}) as unknown as typeof fetch;
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	globalThis.fetch = originalFetch;
});

describe('uploads showcase demo (#586)', () => {
	it('simulates progress and success for an allowed file without a request', async () => {
		const { container } = render(UploadsDemo);
		selectFile(container, new File(['hello'], 'notes.txt', { type: 'text/plain' }));

		// Progress is the Skeleton primitive (role + value), never a bare div.
		const progress = await screen.findByRole('progressbar');
		expect(progress).toHaveAttribute('aria-valuenow');
		await vi.runAllTimersAsync();
		expect(screen.queryByRole('progressbar')).toBeNull();

		expect(await screen.findByText(/Selection accepted/)).toBeTruthy();
		// Svelte splits interpolations into separate text nodes: assert the
		// rendered outcome, not one node's string.
		expect(container.textContent).toContain('notes.txt');
		expect(container.textContent).toContain('uploads/demo-notes.txt');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('shows the localized type error for a disallowed file', async () => {
		const { container } = render(UploadsDemo);
		selectFile(container, new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
		await vi.runAllTimersAsync();

		expect(await screen.findByRole('alert')).toHaveTextContent('File type not allowed');
		expect(screen.queryByRole('progressbar')).toBeNull();
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('shows the localized size error for an oversized file', async () => {
		const { container } = render(UploadsDemo);
		const oversized = new File(['x'], 'big.pdf', { type: 'application/pdf' });
		Object.defineProperty(oversized, 'size', { value: 11 * 1024 * 1024 });
		selectFile(container, oversized);
		await vi.runAllTimersAsync();

		expect(await screen.findByRole('alert')).toHaveTextContent('File too large');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
});
