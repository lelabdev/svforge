// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import AppDialog from '../packages/svforge/templates/dashboard/src/lib/components/svforge/ui/AppDialog.svelte';
import { SKELETON_UTILITIES } from '../packages/svforge/src/skeleton-inventory';

const ROOT = process.cwd();
const DASHBOARD = join(ROOT, 'packages/svforge/templates/dashboard');
const UI_INDEX = join(DASHBOARD, 'src/lib/components/svforge/ui/index.ts');
const USERS_PAGE = join(DASHBOARD, 'src/routes/(app)/admin/users/+page.svelte');

const body = createRawSnippet(() => ({
	render: () => '<p data-testid="dialog-body">Form body</p>'
}));

afterEach(cleanup);

function mountDialog(overrides: Record<string, unknown> = {}) {
	return render(AppDialog, {
		props: { open: true, onOpenChange: () => {}, title: 'Create user', children: body, ...overrides }
	});
}

describe('shared application modal shell (#603)', () => {
	it('renders one accessible modal with its title, description and body', () => {
		const { getByTestId, getByText } = mountDialog({ description: 'Fill every field' });
		const dialog = getByTestId('dialog-body').closest('[role="dialog"]') as HTMLElement;

		expect(dialog).not.toBeNull();
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(getByText('Create user')).toBeTruthy();
		expect(getByText('Fill every field')).toBeTruthy();
		expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
	});

	it('keeps the panel on the Skeleton card surface and never applies the native-dialog animation', () => {
		const { getByTestId } = mountDialog();
		const classes = (getByTestId('dialog-body').closest('[role="dialog"]') as HTMLElement).classList;

		expect(classes).toContain('card');
		expect(classes).toContain('preset-filled-surface-50-950');
		expect(SKELETON_UTILITIES).toContain('preset-filled-surface-50-950');
		// `animate-dialog` animates a native <dialog open>; Dialog.Content is a
		// div[data-state] and would stay at opacity 0 behind the backdrop.
		expect(classes).not.toContain('animate-dialog');
	});

	it('maps the size prop onto the shared panel width presets', () => {
		const panelFor = (size: 'sm' | 'md' | 'lg') => {
			const { container, unmount } = mountDialog({ size });
			const panel = container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;
			const classes = new Set(panel.classList);
			unmount();
			return classes;
		};

		expect(panelFor('sm')).toContain('max-w-sm');
		expect(panelFor('md')).toContain('max-w-md');
		expect(panelFor('lg')).toContain('max-w-2xl');
	});

	it('requests a close from Escape and from the close control', async () => {
		const onOpenChange = vi.fn();
		const { getByTestId } = mountDialog({ onOpenChange });
		const close = getByTestId('app-dialog-close');

		// Escape is owned by Skeleton's focus-trapped layer: focus the panel's
		// close control first, exactly like the trapped focus of an open modal.
		close.focus();
		// Let Skeleton register the focus-trap layer before dismissing.
		await new Promise((resolve) => setTimeout(resolve, 20));
		await fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

		onOpenChange.mockClear();
		await fireEvent.click(close);
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});

	it('labels the close control for assistive technology and exposes a touch-sized affordance', () => {
		const { getByTestId } = mountDialog();
		const close = getByTestId('app-dialog-close');
		const classes = close.classList;

		expect(close.getAttribute('aria-label')).toBe('Close');
		expect(classes).toContain('btn-icon');
		expect(classes).toContain('size-11');
		expect(classes).toContain('cursor-pointer');
	});

	it('lets the consumer override the close control label without changing the shell', () => {
		const { getByTestId } = mountDialog({ closeLabel: 'Fermer la fenêtre' });

		expect(getByTestId('app-dialog-close').getAttribute('aria-label')).toBe('Fermer la fenêtre');
	});

	it('is exported from the canonical ui barrel', () => {
		expect(readFileSync(UI_INDEX, 'utf-8')).toContain(
			"export { default as AppDialog } from './AppDialog.svelte';"
		);
	});
});

describe('modal composition contract (#603)', () => {
	it('the admin users route reuses the shared shell instead of composing Skeleton Dialog', () => {
		const source = readFileSync(USERS_PAGE, 'utf-8');

		expect(source).toContain('<AppDialog');
		expect(source).toMatch(/from '#lib\/components\/svforge\/ui\/index\.js'/);
		expect(source).not.toContain("from '@skeletonlabs/skeleton-svelte'");
		expect(source).not.toMatch(/<Dialog[.\s]/);
		expect(source).not.toContain('<Portal>');
	});

	it('no scaffolded template applies the native-dialog animation to a framework dialog', () => {
		// Only real markup counts: the shell documents the hazard in a JSDoc
		// comment, so strip comments before looking for the utility itself.
		const markupOnly = (source: string) =>
			source
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/<!--[\s\S]*?-->/g, '')
				.replace(/^\s*\/\/.*$/gm, '');
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir)) {
				if (entry === 'node_modules') continue;
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) walk(full);
				else if (entry.endsWith('.svelte') && markupOnly(readFileSync(full, 'utf-8')).includes('animate-dialog')) {
					offenders.push(full);
				}
			}
		};
		walk(join(ROOT, 'packages'));

		expect(offenders).toEqual([]);
	});

	it('keeps the mobile navigation drawer a distinct, outside-click-dismissable pattern', () => {
		const layout = readFileSync(
			join(DASHBOARD, 'src/lib/components/svforge/layout/AdminLayout.svelte'),
			'utf-8'
		);

		// The drawer owns its own geometry and dismissal policy (#603): it is not
		// forced through the form-modal shell.
		expect(layout).toContain('closeOnInteractOutside={true}');
		expect(layout).toContain('data-testid="admin-mobile-drawer"');
		expect(layout).not.toContain('<AppDialog');
	});
});
