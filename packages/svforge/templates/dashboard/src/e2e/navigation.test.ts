import { test, expect } from '@playwright/test';

/**
 * E2E tests for dashboard navigation and protected routes.
 * Playwright is opt-in — install separately: bun add -D @playwright/test
 */

test.describe('protected routes', () => {
	test('admin page requires authentication', async ({ page }) => {
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/login/);
	});

	test('settings page requires authentication', async ({ page }) => {
		await page.goto('/admin/settings');
		await expect(page).toHaveURL(/\/login/);
	});
});

test.describe('dashboard navigation (authenticated)', () => {
	test.beforeEach(async ({ page }) => {
		// Login first
		await page.goto('/login');
		await page.fill('input[type="email"]', 'admin@test.com');
		await page.fill('input[type="password"]', 'password123');
		await page.click('button[type="submit"]');
		await page.waitForURL(/\/dashboard|\/admin/);
	});

	test('can navigate to user management', async ({ page }) => {
		await page.goto('/admin/users');
		await expect(page.locator('table, [data-testid="user-list"]')).toBeVisible();
	});

	test('can navigate to settings', async ({ page }) => {
		await page.goto('/admin/settings');
		await expect(page.getByRole('heading', { level: 2, name: /settings|paramètres/i })).toBeVisible();
	});

	test('mobile navigation traps focus, closes on Escape, and restores the trigger', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/admin');

		const trigger = page.getByTestId('admin-mobile-menu-trigger');
		await expect(trigger).toBeVisible();
		const triggerBox = await trigger.boundingBox();
		expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
		expect(triggerBox?.height).toBeGreaterThanOrEqual(44);
		await trigger.click();

		const drawer = page.getByRole('dialog');
		await expect(drawer).toBeVisible();
		await expect(drawer).toHaveAttribute('aria-modal', 'true');
		expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
		await page.keyboard.press('Shift+Tab');
		expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);

		await page.keyboard.press('Escape');
		await expect(drawer).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test('mobile navigation closes after selecting a route', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/admin');
		const trigger = page.getByTestId('admin-mobile-menu-trigger');
		await trigger.click();
		const drawer = page.getByRole('dialog');
		await expect(drawer).toBeVisible();

		await drawer.locator('a[href="/admin/users"]').click();
		await expect(page).toHaveURL(/\/admin\/users$/);
		await expect(drawer).toBeHidden();
	});
});
