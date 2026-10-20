import { test, expect } from '@playwright/test';

/** Browser coverage for the Skeleton Dialog used by the admin users page. */
test.describe('admin users Skeleton Dialog', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[type="email"]', 'admin@test.com');
		await page.fill('input[type="password"]', 'password123');
		await page.click('button[type="submit"]');
		await page.waitForURL('**/admin');
		await page.goto('/admin/users');
	});

	test('opens with modal semantics and focus, then Escape restores focus', async ({ page }) => {
		const addUser = page.getByTestId('users-add');
		await addUser.click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('aria-modal', 'true');
		await expect(dialog).toHaveClass(/preset-filled-surface-50-950/);
		await expect(dialog.locator('form')).toHaveAttribute('method', 'POST');
		const close = page.getByTestId('app-dialog-close');
		const closeBox = await close.boundingBox();
		expect(closeBox?.width).toBeGreaterThanOrEqual(44);
		expect(closeBox?.height).toBeGreaterThanOrEqual(44);
		const titleId = await dialog.getAttribute('aria-labelledby');
		expect(titleId).toBeTruthy();
		await expect(page.locator(`[id="${titleId}"]`)).toBeVisible();
		expect(
			await dialog.evaluate((element) => {
				const color = getComputedStyle(element).backgroundColor;
				return color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)';
			})
		).toBe(true);
		expect(
			await dialog.evaluate((element) => element.contains(document.activeElement))
		).toBe(true);

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(addUser).toBeFocused();
	});

	test('search and icon actions have accessible names and touch-sized targets', async ({ page }) => {
		const search = page.getByTestId('users-search');
		expect(await search.evaluate((input: HTMLInputElement) => input.labels?.length)).toBe(1);
		const searchBox = await search.boundingBox();
		expect(searchBox?.height).toBeGreaterThanOrEqual(44);

		for (const action of [page.getByTestId('users-edit').first(), page.getByTestId('users-status').first()]) {
			await expect(action).toHaveAttribute('aria-label', /.+/);
			const box = await action.boundingBox();
			expect(box?.width).toBeGreaterThanOrEqual(44);
			expect(box?.height).toBeGreaterThanOrEqual(44);
		}
	});

	test('renders an opaque, hit-testable panel above the backdrop', async ({ page }) => {
		await page.getByTestId('users-add').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		// #603: a framework Dialog.Content is a div[data-state], never a native
		// <dialog open> — an `animate-dialog` opacity rule would leave the panel
		// invisible behind a dimmed backdrop. Assert the rendered result.
		const panel = await dialog.evaluate((element) => {
			const styles = getComputedStyle(element);
			const box = element.getBoundingClientRect();
			const center = document.elementFromPoint(
				box.left + box.width / 2,
				box.top + box.height / 2
			);
			return {
				opacity: Number(styles.opacity),
				visibility: styles.visibility,
				width: box.width,
				height: box.height,
				hitInsidePanel: Boolean(center && element.contains(center))
			};
		});

		expect(panel.opacity).toBeGreaterThanOrEqual(0.99);
		expect(panel.visibility).toBe('visible');
		expect(panel.width).toBeGreaterThan(0);
		expect(panel.height).toBeGreaterThan(0);
		expect(panel.hitInsidePanel).toBe(true);
	});

	test('accepts input and keeps it while the form stays open', async ({ page }) => {
		await page.getByTestId('users-add').click();
		const dialog = page.getByRole('dialog');
		const name = dialog.locator('input[name="name"]');

		await name.fill('Ada Lovelace');
		await expect(name).toHaveValue('Ada Lovelace');
		await expect(dialog).toBeVisible();
	});

	test('outside interaction does not discard an open form', async ({ page }) => {
		await page.getByTestId('users-add').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		// Skeleton owns this policy: modal forms stay open on outside interaction;
		// users can dismiss them explicitly with Escape, Cancel, or the close button.
		await page.mouse.click(5, 5);
		await expect(dialog).toBeVisible();
	});

	test('create, edit, and invite retain their enhanced POST forms', async ({ page }) => {
		await page.getByTestId('users-add').click();
		let dialog = page.getByRole('dialog');
		await expect(dialog.locator('form')).toHaveAttribute('method', 'POST');
		await dialog.locator('form button[type="button"]').click();
		await expect(dialog).toBeHidden();

		await page.getByTestId('users-edit').first().click();
		dialog = page.getByRole('dialog');
		await expect(dialog.locator('form')).toHaveAttribute('method', 'POST');
		await expect(dialog.locator('input[name="id"]')).toHaveCount(1);
		await dialog.locator('form button[type="button"]').click();
		await expect(dialog).toBeHidden();

		await page.getByTestId('users-invite').click();
		dialog = page.getByRole('dialog');
		await expect(dialog.locator('form')).toHaveAttribute('method', 'POST');
		await expect(dialog.locator('input[name="email"]')).toBeVisible();
	});

	test('status confirmation uses the Dialog for deactivation and reactivation', async ({ page }) => {
		const email = `dialog-${Date.now()}@test.example`;
		await page.getByTestId('users-add').click();
		let dialog = page.getByRole('dialog');
		await dialog.locator('input[name="name"]').fill('Dialog Status User');
		await dialog.locator('input[name="email"]').fill(email);
		await dialog.locator('input[name="password"]').fill('password123');
		await dialog.locator('form button[type="submit"]').click();
		await expect(dialog).toBeHidden();

		const row = page.locator('tr').filter({ hasText: email });
		await expect(row).toBeVisible();
		await row.getByTestId('users-status').click();
		dialog = page.getByRole('dialog');
		await expect(dialog.locator('input[name="disabled"]')).toHaveValue('true');
		await dialog.locator('form button[type="submit"]').click();
		await expect(dialog).toBeHidden();

		await row.getByTestId('users-status').click();
		dialog = page.getByRole('dialog');
		await expect(dialog.locator('input[name="disabled"]')).toHaveValue('false');
		await expect(dialog.locator('form')).toHaveAttribute('method', 'POST');
	});
});

/** #603: the same shared shell must stay usable on a phone viewport. */
test.describe('admin users dialog on mobile', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test.beforeEach(async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[type="email"]', 'admin@test.com');
		await page.fill('input[type="password"]', 'password123');
		await page.click('button[type="submit"]');
		await page.waitForURL('**/admin');
		await page.goto('/admin/users');
	});

	test('keeps the panel inside the viewport with a working form and close control', async ({ page }) => {
		await page.getByTestId('users-add').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		const box = await dialog.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
		expect(box!.y + box!.height).toBeLessThanOrEqual(844 + 1);

		await dialog.locator('input[name="name"]').fill('Mobile Admin');
		await expect(dialog.locator('input[name="name"]')).toHaveValue('Mobile Admin');

		const close = page.getByTestId('app-dialog-close');
		const closeBox = await close.boundingBox();
		expect(closeBox?.width).toBeGreaterThanOrEqual(44);
		expect(closeBox?.height).toBeGreaterThanOrEqual(44);
		await close.click();
		await expect(dialog).toBeHidden();
		await expect(page.getByTestId('users-add')).toBeFocused();
	});

	test('drawer navigation keeps its intentional outside-click dismissal', async ({ page }) => {
		await page.goto('/admin');
		const trigger = page.getByTestId('admin-mobile-menu-trigger');
		await trigger.click();
		const drawer = page.getByRole('dialog');
		await expect(drawer).toBeVisible();

		// AdminLayout owns the drawer policy (#603): unlike a form modal it closes
		// on outside interaction.
		await page.mouse.click(380, 800);
		await expect(drawer).toBeHidden();
	});
});
