import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers';

/**
 * #602 — placeholder hints vs entered values.
 *
 * Skeleton's `input`/`textarea` utilities paint `::placeholder` with the single
 * `--field-placeholder` token. The scaffold must therefore own that token in
 * the theme and keep the hint clearly secondary to the typed value in both
 * modes, while staying legible on the field surface. A palette edit that makes
 * hints indistinguishable from input text (or unreadable) fails here.
 *
 * The assertions are computed from the shipped CSS: the theme stops are real
 * `oklch()` values, so contrast is measured rather than asserted by class name.
 */

const THEME = join(ROOT, 'packages/svforge/templates/base/src/lib/styles/svelteforge-theme.css');
const SKELETON_SRC = join(ROOT, 'node_modules', '@skeletonlabs', 'skeleton', 'src');
const TEMPLATES = join(ROOT, 'packages');

const theme = readFileSync(THEME, 'utf-8');

/** oklch(%) -> gamma-encoded sRGB, then WCAG relative luminance. */
function relativeLuminance([l, c, hDeg]: [number, number, number]): number {
	const h = (hDeg * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const linear = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
	].map((value) => Math.min(1, Math.max(0, value)));
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

function surfaceStops(css: string): Map<string, [number, number, number]> {
	const stops = new Map<string, [number, number, number]>();
	for (const match of css.matchAll(/--color-surface-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)deg\)/g)) {
		stops.set(match[1], [Number(match[2]) / 100, Number(match[3]), Number(match[4])]);
	}
	return stops;
}

/** `--field-placeholder: light-dark(var(--color-surface-X), var(--color-surface-Y))` or `var(--color-surface-X-Y)`. */
function placeholderStops(css: string): { light: string; dark: string } | undefined {
	const explicit = css.match(
		/--field-placeholder:\s*light-dark\(\s*var\(--color-surface-(\d+)\)\s*,\s*var\(--color-surface-(\d+)\)\s*\)/
	);
	if (explicit) return { light: explicit[1], dark: explicit[2] };
	const pair = css.match(/--field-placeholder:\s*var\(--color-surface-(\d+)-(\d+)\)/);
	if (pair) return { light: pair[1], dark: pair[2] };
	return undefined;
}

function scaffoldedTemplates(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...scaffoldedTemplates(full));
		else if (entry.endsWith('.svelte')) out.push(full);
	}
	return out;
}

const stops = surfaceStops(theme);
const hint = placeholderStops(theme);
const stop = (name: string) => {
	const value = stops.get(name);
	if (!value) throw new Error(`surface-${name} is missing from the SVForge theme`);
	return value;
};

describe('placeholder hint vs entered value (#602)', () => {
	it('owns the hint token in the theme instead of inheriting Skeleton’s default', () => {
		expect(hint, 'svelteforge-theme.css must define --field-placeholder').toBeDefined();
		// The field surface and the entered value are Skeleton's own field tokens.
		expect(stop('50')).toBeDefined();
		expect(stop('950')).toBeDefined();
	});

	it('paints Skeleton input and textarea placeholders from that one token', () => {
		const files = ['utilities/form-inputs.css', 'utilities/form-textareas.css'].map((file) =>
			join(SKELETON_SRC, file)
		);
		for (const file of files) {
			expect(existsSync(file), `expected the pinned Skeleton source at ${file}`).toBe(true);
			const source = readFileSync(file, 'utf-8');
			expect(source).toMatch(/&::placeholder\s*\{[^}]*color:\s*var\(--field-placeholder\)/);
			// The entered value keeps the normal foreground: the hint token only ever
			// appears inside the ::placeholder block.
			expect(source.match(/var\(--field-placeholder\)/g)?.length).toBe(1);
		}
	});

	it('keeps the hint AA-legible but clearly secondary to the typed value', () => {
		expect(hint).toBeDefined();
		const modes = [
			{ mode: 'light', surface: '50', value: '950' },
			{ mode: 'dark', surface: '950', value: '50' }
		] as const;

		for (const { mode, surface, value } of modes) {
			const background = stop(surface);
			const hintContrast = contrast(stop(mode === 'light' ? hint!.light : hint!.dark), background);
			const valueContrast = contrast(stop(value), background);

			expect(hintContrast, `${mode}: hint contrast ${hintContrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
			expect(valueContrast, `${mode}: value contrast ${valueContrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(7);
			expect(
				hintContrast / valueContrast,
				`${mode}: hint must stay visibly weaker than the entered value`
			).toBeLessThanOrEqual(0.5);
		}
	});

	it('never overrides the shared hint with per-page placeholder colors', () => {
		const offenders = scaffoldedTemplates(TEMPLATES).filter((file) =>
			/\bplaceholder:(?:!?text|!?opacity)-/.test(readFileSync(file, 'utf-8'))
		);
		expect(offenders, 'use --field-placeholder in the theme instead').toEqual([]);
	});
});
