import { test, expect } from '@playwright/test';

/* global document, getComputedStyle, NodeFilter */

const modes = ['light', 'dark'];

async function setMode(page, mode) {
	await page.evaluate((nextMode) => {
		localStorage.setItem('theme-mode', nextMode);
		document.documentElement.dataset.mode = nextMode;
		document.documentElement.style.colorScheme = nextMode;
	}, mode);
}

async function expectTextContrast(page, route, mode) {
	const failures = await page.evaluate(() => {
		function colorChannels(value) {
			const oklch = value.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+(-?[\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+)%?)?\s*\)/);
			if (oklch) {
				const lightness = Number(oklch[1]) * (oklch[1].includes('.') && !value.includes('%') ? 100 : 1) / 100;
				const chroma = Number(oklch[2]);
				const angle = (Number(oklch[3]) * Math.PI) / 180;
				const a = chroma * Math.cos(angle);
				const b = chroma * Math.sin(angle);
				const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
				const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
				const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
				return [
					4.0767416621 * l - 3.3077116621 * m + 0.2309699292 * s,
					-1.2684380046 * l + 2.6097574011 * m - 0.3414193965 * s,
					-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
					oklch[4] === undefined ? 1 : Number(oklch[4]) / (oklch[4].includes('.') ? 1 : 100)
				];
			}
			const rgb = value.match(/rgba?\(([^)]+)\)/);
			if (!rgb) return null;
			const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
			const channels = parts.slice(0, 3).map((part) => {
				const amount = Number.parseFloat(part);
				const srgb = part.endsWith('%') ? amount / 100 : amount / 255;
				return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
			});
			return [...channels, parts[3] === undefined ? 1 : Number.parseFloat(parts[3])];
		}

		const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
		const composite = (background, foreground) => {
			const alpha = foreground[3];
			return [
				foreground[0] * alpha + background[0] * (1 - alpha),
				foreground[1] * alpha + background[1] * (1 - alpha),
				foreground[2] * alpha + background[2] * (1 - alpha),
				1
			];
		};
		const ratio = (foreground, background) => {
			const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
			return (values[0] + 0.05) / (values[1] + 0.05);
		};
		const effectiveBackground = (element) => {
			const ancestors = [];
			for (let current = element; current; current = current.parentElement) ancestors.push(current);
			let background = [1, 1, 1, 1];
			for (const ancestor of ancestors.reverse()) {
				const color = colorChannels(getComputedStyle(ancestor).backgroundColor);
				if (color && color[3] > 0) background = composite(background, color);
			}
			return background;
		};
		const failures = [];
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const textNode = walker.currentNode;
			const text = textNode.textContent?.replace(/\s+/g, ' ').trim();
			const element = textNode.parentElement;
			if (!text || !element || element.closest('script,style,svg,[aria-hidden="true"],[hidden],:disabled,[aria-disabled="true"]')) continue;
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || !rect.width || !rect.height) continue;
			const foreground = colorChannels(style.color);
			const background = effectiveBackground(element);
			if (!foreground) continue;
			const fontSize = Number.parseFloat(style.fontSize);
			const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
			const largeText = fontSize >= 24 || (fontSize >= 18.67 && fontWeight >= 700);
			const minimum = largeText ? 3 : 4.5;
			const measured = ratio(foreground, background);
			if (measured < minimum) {
				failures.push({
					text: text.slice(0, 70),
					element: `${element.tagName.toLowerCase()}.${element.className?.toString?.().trim().replace(/\s+/g, '.') ?? ''}`,
					foreground: style.color,
					background: `rgb(${background.slice(0, 3).map((channel) => Math.round(channel * 255)).join(', ')})`,
					ratio: Number(measured.toFixed(2)),
					minimum,
					fontSize,
					fontWeight
				});
			}
		}
		return failures;
	});

	expect(failures, `${mode} ${route} contrast violations`).toEqual([]);
}

async function expectVisibleBoundaryContrast(page, route, mode) {
	const failures = await page.locator('.input, .select, .textarea, .checkbox, [class*="preset-outlined-"]').evaluateAll((elements) => {
		function luminance(color) {
			const oklch = color.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+(-?[\d.]+)(?:deg)?/);
			if (oklch) {
				const lightness = Number(oklch[1]) * (oklch[1].includes('.') && !color.includes('%') ? 100 : 1) / 100;
				const chroma = Number(oklch[2]);
				const angle = (Number(oklch[3]) * Math.PI) / 180;
				const a = chroma * Math.cos(angle);
				const b = chroma * Math.sin(angle);
				const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
				const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
				const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
				return 0.2126 * (4.0767416621 * l - 3.3077116621 * m + 0.2309699292 * s) +
					0.7152 * (-1.2684380046 * l + 2.6097574011 * m - 0.3414193965 * s) +
					0.0722 * (-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
			}
			const rgb = color.match(/rgba?\(([^)]+)\)/);
			if (!rgb) return undefined;
			const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
			const linear = parts.slice(0, 3).map((part) => {
					const amount = Number.parseFloat(part);
					const srgb = part.endsWith('%') ? amount / 100 : amount / 255;
					return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
		}
		return elements.flatMap((element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			if (style.display === 'none' || style.visibility === 'hidden' || element.disabled || !rect.width || !rect.height) return [];
			const borderWidth = Number.parseFloat(style.borderTopWidth);
			let background = 'rgb(255, 255, 255)';
			for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
				const candidate = getComputedStyle(ancestor).backgroundColor;
				if (candidate === 'transparent' || /,\s*0(?:\.0+)?\s*\)$/.test(candidate)) continue;
				if (luminance(candidate) !== undefined) {
					background = candidate;
					break;
				}
			}
			const border = style.borderTopColor;
			const borderLuminance = luminance(border);
			const backgroundLuminance = luminance(background);
			if (!borderWidth || borderLuminance === undefined || backgroundLuminance === undefined) {
				return [{ tag: element.tagName, className: element.className, border, background, contrast: 'unmeasurable' }];
			}
			const contrast = (Math.max(borderLuminance, backgroundLuminance) + 0.05) /
				(Math.min(borderLuminance, backgroundLuminance) + 0.05);
			return contrast < 3 ? [{ tag: element.tagName, className: element.className, border, background, contrast: Number(contrast.toFixed(2)) }] : [];
		});
	});

	expect(failures, `${mode} ${route} component boundary contrast`).toEqual([]);
}

async function expectFormFocusContrast(page, route, mode) {
	const failures = await page.locator('input:not([type="hidden"]), select, textarea').evaluateAll((controls) => {
		function luminance(color) {
			const oklch = color.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+(-?[\d.]+)(?:deg)?/);
			if (oklch) {
				const lightness = Number(oklch[1]) * (oklch[1].includes('.') && !color.includes('%') ? 100 : 1) / 100;
				const chroma = Number(oklch[2]);
				const angle = (Number(oklch[3]) * Math.PI) / 180;
				const a = chroma * Math.cos(angle);
				const b = chroma * Math.sin(angle);
				const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
				const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
				const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
				return 0.2126 * (4.0767416621 * l - 3.3077116621 * m + 0.2309699292 * s) +
					0.7152 * (-1.2684380046 * l + 2.6097574011 * m - 0.3414193965 * s) +
					0.0722 * (-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
			}
			const rgb = color.match(/rgba?\(([^)]+)\)/);
			if (!rgb) return undefined;
			const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
			const linear = parts.slice(0, 3).map((part) => {
				const amount = Number.parseFloat(part);
				const srgb = part.endsWith('%') ? amount / 100 : amount / 255;
				return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
		}
		return controls.flatMap((control) => {
			if (getComputedStyle(control).display === 'none' || control.disabled) return [];
			control.focus();
			const style = getComputedStyle(control);
			const ring = style.getPropertyValue('--tw-ring-color').trim();
			let background = 'rgb(255, 255, 255)';
			for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
				const candidate = getComputedStyle(ancestor).backgroundColor;
				if (candidate === 'transparent' || /,\s*0(?:\.0+)?\s*\)$/.test(candidate)) continue;
				if (luminance(candidate) !== undefined) {
					background = candidate;
					break;
				}
			}
			const foregroundLuminance = luminance(ring);
			const backgroundLuminance = luminance(background);
			if (foregroundLuminance === undefined || backgroundLuminance === undefined) {
				return [{ tag: control.tagName, className: control.className, ring, background, contrast: 'unmeasurable' }];
			}
			const contrast = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
				(Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
			return contrast < 3 ? [{ tag: control.tagName, className: control.className, ring, background, contrast }] : [];
		});
	});

	expect(failures, `${mode} ${route} focus indicator contrast`).toEqual([]);
}

test('scaffold text and form focus meet WCAG AA in both theme modes', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	for (const mode of modes) {
		for (const route of ['/login', '/demo-ui']) {
			await page.goto(route);
			await setMode(page, mode);
			await expect(page.locator('main')).toBeVisible();
			await expectTextContrast(page, route, mode);
			await expectFormFocusContrast(page, route, mode);
			await expectVisibleBoundaryContrast(page, route, mode);
		}
	}

	const authenticatedPage = await page.context().newPage();
	await authenticatedPage.goto('/login');
	await setMode(authenticatedPage, 'light');
	await expect(authenticatedPage.locator('input[type="email"]')).toBeVisible();
	await authenticatedPage.fill('input[type="email"]', 'admin@test.com');
	await authenticatedPage.fill('input[type="password"]', 'password123');
	await authenticatedPage.click('button[type="submit"]');
	await expect(authenticatedPage).not.toHaveURL(/\/login/);
	for (const mode of modes) {
		for (const route of ['/admin', '/blog']) {
			await authenticatedPage.goto(route);
			await setMode(authenticatedPage, mode);
			await expect(authenticatedPage.locator('main')).toBeVisible();
			await expectTextContrast(authenticatedPage, route, mode);
		}
	}
	await authenticatedPage.close();
});
