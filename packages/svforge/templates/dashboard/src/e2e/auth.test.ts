import { test, expect } from '@playwright/test';

/**
 * E2E tests for authentication flows.
 * Playwright is opt-in — install separately: bun add -D @playwright/test
 */

test.describe('authentication', () => {
	test('redirects unauthenticated users to login', async ({ page }) => {
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/login/);
	});

	test('shows login form', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await expect(page.locator('input[type="password"]')).toBeVisible();
	});

	test('uses the asymmetric desktop panel and a single-column mobile layout', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/login');

		const panel = page.locator('main > aside');
		const formPanel = page.locator('main > section');
		await expect(panel).toBeVisible();
		const [panelBox, formBox] = await Promise.all([panel.boundingBox(), formPanel.boundingBox()]);
		expect(panelBox).not.toBeNull();
		expect(formBox).not.toBeNull();
		expect(Math.abs(panelBox!.width / formBox!.width - 2 / 3)).toBeLessThan(0.05);

		await page.setViewportSize({ width: 320, height: 640 });
		await expect(panel).toBeHidden();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
		const headingBox = await page.locator('main h1').boundingBox();
		expect(headingBox?.y).toBeLessThan(180);
		const submitButton = page.locator('button[type="submit"]');
		await expect(submitButton).toBeVisible();
		expect((await submitButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
	});

	test('keeps setup server-side and unavailable in production builds', async ({ page }) => {
		await page.goto('/setup');
		await expect(page).toHaveURL(/\/login/);
	});

	test('reveals and hides the password with a keyboard-operable pressed state', async ({ page }) => {
		await page.goto('/login');
		const password = page.locator('input[name="password"]');
		const reveal = page.locator('button[aria-pressed]');
		await expect(password).toHaveAttribute('type', 'password');
		await expect(reveal).toHaveAttribute('aria-pressed', 'false');
		await reveal.focus();
		await page.keyboard.press('Enter');
		await expect(password).toHaveAttribute('type', 'text');
		await expect(reveal).toHaveAttribute('aria-pressed', 'true');
		await page.keyboard.press('Enter');
		await expect(password).toHaveAttribute('type', 'password');
	});

	test('shows validation feedback on empty submit', async ({ page }) => {
		await page.goto('/login');
		await page.click('button[type="submit"]');
		// Browser-native validation or server-side error message
		await expect(page.locator('input:invalid, [role="alert"], .error').first()).toBeVisible({ timeout: 5000 });
	});

	test('shows a generic localized error and keeps the email on rejected credentials', async ({ page }) => {
		await page.goto('/login');
		await page.locator('input[name="email"]').fill('unknown@example.com');
		await page.locator('input[name="password"]').fill('incorrect-password');
		await page.locator('button[type="submit"]').click();
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.locator('input[name="email"]')).toHaveValue('unknown@example.com');
	});

	test('logs in with valid credentials', async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[type="email"]', 'admin@test.com');
		await page.fill('input[type="password"]', 'password123');
		await page.click('button[type="submit"]');
		// Should navigate away from /login after success
		await expect(page).not.toHaveURL(/\/login/);
	});
});
