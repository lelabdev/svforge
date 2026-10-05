import { test, expect } from '@playwright/test';

/**
 * E2E tests for user CRUD flows and form feedback.
 * Playwright is opt-in — install separately: bun add -D @playwright/test
 */

test.describe('user management CRUD', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/login');
		await page.fill('input[type="email"]', 'admin@test.com');
		await page.fill('input[type="password"]', 'password123');
		await page.click('button[type="submit"]');
		await page.waitForURL('**/admin');
		await page.goto('/admin/users');
	});

	test('displays user list table', async ({ page }) => {
		await expect(page.locator('table')).toBeVisible();
	});

	test('shows enhanced validation feedback for invalid create data', async ({ page }) => {
		await page.getByTestId('users-add').click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('input[name="name"]').fill('Test User');
		await dialog.locator('input[name="email"]').fill('invalid-password@test.example');
		await dialog.locator('input[name="password"]').fill('short');
		await dialog.locator('form button[type="submit"]').click();

		// The client accepts syntactically valid fields, then the real SvelteKit
		// action rejects the short password and use:enhance renders the failure.
		await expect(page.locator('.preset-tonal-error')).toBeVisible({ timeout: 5000 });
		await expect(dialog).toBeVisible();
	});

	test('can deactivate a user without removing their identity', async ({ page }) => {
		const deactivateButtons = page.locator('button[data-testid="users-status"]:not([disabled])');
		const count = await deactivateButtons.count();
		if (count > 0) {
			await deactivateButtons.first().click();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toBeVisible();
			await dialog.locator('form button[type="submit"]').click();
			await expect(page.locator('.preset-tonal-success')).toBeVisible({ timeout: 5000 });
		}
	});

	test('prevents self-deactivation', async ({ page }) => {
		await expect(page.locator('button[data-testid="users-status"][disabled]')).toBeVisible();
	});
});
