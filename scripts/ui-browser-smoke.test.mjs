import { test, expect } from '@playwright/test';

/** Stable browser assertions against the built, generated base scaffold. */
test.describe('scaffold UI browser smoke', () => {
	test('demo page has one shell and opaque, legible cards in light and dark modes', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.addInitScript(() => localStorage.setItem('theme-mode', 'light'));
		await page.goto('/demo-ui');

		await expect(page.locator('nav')).toHaveCount(1);
		await expect(page.locator('footer')).toHaveCount(1);
		await expect(page.locator('main')).toBeVisible();
		await expect(page.locator('main > h1')).toBeVisible();

		const cardsSection = page.locator('main section').nth(1);
		const card = cardsSection.locator('.card').first();
		await expect(card).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
		const background = () => card.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor);
		await expect.poll(background).not.toMatch(/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/);

		const contrast = await card.evaluate((element) => {
			const luminance = (color) => {
				const channels = color.match(/[\d.-]+/g)?.map(Number) ?? [];
				let linearRgb;
				if (color.startsWith('oklch(')) {
					const [lightness, chroma, hue] = channels;
					const angle = (hue * Math.PI) / 180;
					const a = chroma * Math.cos(angle);
					const b = chroma * Math.sin(angle);
					const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
					const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
					const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
					linearRgb = [
						4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
						-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
						-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
					];
				} else {
					linearRgb = channels.slice(0, 3).map((channel) => {
						const value = channel / 255;
						return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
					});
				}
				const [r, g, b] = linearRgb;
				return 0.2126 * r + 0.7152 * g + 0.0722 * b;
			};
			const foreground = globalThis.getComputedStyle(element.querySelector('p')).color;
			const cardBackground = globalThis.getComputedStyle(element).backgroundColor;
			const colors = [luminance(foreground), luminance(cardBackground)].sort((a, b) => b - a);
			return {
				ratio: (colors[0] + 0.05) / (colors[1] + 0.05),
				foreground,
				background: cardBackground
			};
		});
		expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);

		await page.locator('nav button:not([class~="md:hidden"])').click();
		await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
		await expect.poll(background).not.toMatch(/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/);
	});

	test('mobile shell fits the viewport and its menu opens and closes', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/');

		await expect(page.locator('main')).toBeVisible();
		await expect(page.locator('nav')).toHaveCount(1);
		await expect(page.locator('footer')).toHaveCount(1);
		const fitsViewport = () =>
			page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth);
		expect(await fitsViewport()).toBe(true);

		const menuToggle = page.locator('nav button[class~="md:hidden"]');
		await expect(menuToggle).toHaveCount(1);
		await menuToggle.click();
		await expect(page.locator('nav a[href="/demo-ui"]')).toHaveCount(2);
		await expect(page.locator('nav a[href="/demo-ui"]').last()).toBeVisible();
		await menuToggle.click();
		await expect(page.locator('nav a[href="/demo-ui"]')).toHaveCount(1);
		await expect(page.locator('main > section h1')).toBeVisible();
		expect(await fitsViewport()).toBe(true);
	});
});
