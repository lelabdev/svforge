import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	validateSkeletonTheme,
	parseThemeVariables,
	contrastRatio,
	resolveVariable,
	type ThemeViolation
} from './helpers/skeleton-theme-validator';

const ROOT = process.cwd();
const THEME = join(ROOT, 'packages/svforge/templates/base/src/lib/styles/svelteforge-theme.css');

/**
 * Complete Skeleton v5 theme contract (#315, extends #194).
 *
 * The validator (`helpers/skeleton-theme-validator.ts`) is filename-agnostic:
 * it takes CSS text, so the canonical theme, renamed project themes and small
 * fixtures all run through the SAME rules:
 * - 7 palettes × shades 50…950, every contrast mapping declared;
 * - cross-theme v5 variables (spacing, scaling, typo, radii, shapes, edges,
 *   root backgrounds, brand);
 * - no dead pre-v5 variables;
 * - every declared (shade, contrast-shade) pair reaches WCAG AA 4.5:1.
 */

/** Replace / remove a single custom property line in the canonical theme. */
function withVar(css: string, name: string, value: string | null): string {
	const pattern = new RegExp(`^[ \\t]*${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}\\s*:[^;]*;[ \\t]*\\n`, 'm');
	if (value === null) return css.replace(pattern, '');
	if (!pattern.test(css)) return css.replace(/\[data-theme='svelteForge'\] \{/, `[data-theme='svelteForge'] {\n\t${name}: ${value};\n`);
	return css.replace(pattern, `\t${name}: ${value};\n`);
}

function violationsOf(css: string): ThemeViolation[] {
	return validateSkeletonTheme(css);
}

function find(violations: ThemeViolation[], rule: string, fragment: string): ThemeViolation | undefined {
	return violations.find((v) => v.rule === rule && v.message.includes(fragment));
}

describe('Skeleton v5 theme contract (#315)', () => {
	const canonical = readFileSync(THEME, 'utf-8');

	it('accepts the complete canonical theme', () => {
		expect(violationsOf(canonical)).toEqual([]);
	});

	it('accepts a renamed theme file (validator is filename-agnostic)', () => {
		const renamed = join(ROOT, 'tests/fixtures/renamed-theme.css');
		expect(readFileSync(renamed, 'utf-8')).toBe(canonical);
		expect(violationsOf(readFileSync(renamed, 'utf-8'))).toEqual([]);
	});

	it('fails when a shade is missing', () => {
		const violations = violationsOf(withVar(canonical, '--color-primary-500', null));
		const violation = find(violations, 'palette-shade', '--color-primary-500');
		expect(violation?.message).toContain('missing shade');
	});

	it('fails when a contrast mapping is missing', () => {
		const violations = violationsOf(withVar(canonical, '--color-success-contrast-400', null));
		const violation = find(violations, 'contrast-mapping', '--color-success-contrast-400');
		expect(violation?.message).toContain('missing contrast mapping');
	});

	it('fails when a required Skeleton v5 cross-theme variable is missing', () => {
		const violations = violationsOf(withVar(canonical, '--spacing', null));
		const violation = find(violations, 'required-var', '--spacing');
		expect(violation?.message).toContain('missing required Skeleton v5 variable');
	});

	it('fails when an obsolete pre-v5 variable reappears', () => {
		const violations = violationsOf(withVar(canonical, '--base-font-family', "'Inter', sans-serif"));
		const violation = find(violations, 'obsolete-var', '--base-font-family');
		expect(violation?.message).toContain('dead pre-v5 variable');
	});

	it('fails with a shade-by-shade message for a pair below 4.5:1', () => {
		// success-500 is light; pair it with a light contrast → below AA
		const broken = withVar(canonical, '--color-success-contrast-500', 'var(--color-success-50)');
		const violation = find(violationsOf(broken), 'contrast-ratio', 'success-500 contrast =');
		expect(violation).toBeDefined();
		expect(violation!.message).toMatch(/success-500 contrast = \d\.\d\d:1 \(< 4\.5\)/);
	});

	it('accepts a compliant contrast pair', () => {
		const vars = parseThemeVariables(canonical);
		const ratio = contrastRatio(
			resolveVariable(vars, '--color-primary-contrast-500')!,
			resolveVariable(vars, '--color-primary-500')!
		);
		expect(ratio).toBeGreaterThanOrEqual(4.5);
		expect(violationsOf(canonical).filter((v) => v.rule === 'contrast-ratio')).toEqual([]);
	});

	it('provides measured secondary-text and accent pairs for both surface modes', () => {
		const vars = parseThemeVariables(canonical);
		const check = (foreground: string, background: string, minimum: number) => {
			const ratio = contrastRatio(resolveVariable(vars, foreground)!, resolveVariable(vars, background)!);
			expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
		};

		check('--color-surface-700', '--color-surface-50', 4.5);
		check('--color-surface-300', '--color-surface-950', 4.5);
		check('--color-primary-900', '--color-surface-50', 4.5);
		check('--color-primary-300', '--color-surface-950', 4.5);
		check('--color-error-700', '--color-surface-50', 4.5);
		check('--color-error-300', '--color-surface-950', 4.5);
		check('--color-primary-700', '--color-surface-50', 3);
		check('--color-primary-300', '--color-surface-950', 3);
		check('--color-primary-950', '--color-primary-100', 4.5);
		check('--color-primary-50', '--color-primary-900', 4.5);
		check('--color-surface-700', '--color-surface-50', 3);
		check('--color-surface-400', '--color-surface-950', 3);
	});

	it('protects the brand concept: variables defined and resolvable', () => {
		const vars = parseThemeVariables(canonical);
		for (const name of [
			'--color-brand-light',
			'--color-brand-dark',
			'--color-brand-contrast-light',
			'--color-brand-contrast-dark'
		]) {
			expect(resolveVariable(vars, name), name).toBeDefined();
		}
		// The focus indicator on Skeleton's checkbox/switch controls uses the
		// brand color. It needs 3:1 against the page surface in both color modes.
		const lightFocus = contrastRatio(
			resolveVariable(vars, '--color-brand-light')!,
			resolveVariable(vars, '--color-surface-50')!
		);
		const darkFocus = contrastRatio(
			resolveVariable(vars, '--color-brand-dark')!,
			resolveVariable(vars, '--color-surface-950')!
		);
		expect(lightFocus).toBeGreaterThanOrEqual(3);
		expect(darkFocus).toBeGreaterThanOrEqual(3);

		// Filled brand presets must keep a readable foreground/background pair.
		expect(
			contrastRatio(
				resolveVariable(vars, '--color-brand-contrast-light')!,
				resolveVariable(vars, '--color-brand-light')!
			)
		).toBeGreaterThanOrEqual(4.5);
		expect(
			contrastRatio(
				resolveVariable(vars, '--color-brand-contrast-dark')!,
				resolveVariable(vars, '--color-brand-dark')!
			)
		).toBeGreaterThanOrEqual(4.5);
	});
});
