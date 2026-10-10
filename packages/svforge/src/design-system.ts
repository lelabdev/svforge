/**
 * SVForge design-system harness (#240).
 *
 * Combines a machine-readable catalog of available components/patterns with
 * automatic checks (`svforge check`) that make design-system violations
 * visible and blocking. The goal: an agent composing a page reuses Skeleton +
 * SvelteForge building blocks instead of inventing a new UI each time.
 *
 * Severity levels:
 *   ERROR — duplicated Skeleton primitive, clear design-system violation
 *   WARN  — unregistered UI guidance, arbitrary visual value, likely-duplicative local component
 *
 * This module is read-only: it never modifies project files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiagnosticResult } from './doctor';
import {
	SKELETON_PRIMITIVES as GENERATED_SKELETON_PRIMITIVES,
	SKELETON_UTILITIES,
	SKELETON_UTILITY_PREFIXES
} from './skeleton-inventory';
import { ADDON_COMPONENTS } from './addon-components';
import { checkStructuralDuplicates } from './structural-duplication';
import { findUnregisteredUiLibraries, isRegisteredUiComponent } from './ui-libraries';

export type Severity = 'ok' | 'warn' | 'error';

/**
 * One conservative avoid matcher, co-located with the catalog entry it
 * belongs to (#342 review). `component` is derived from the catalog key —
 * there is no second hand-maintained list to drift away from the catalog.
 */
export interface AvoidPatternSpec {
	/** Native element the heuristic targets. */
	element: string;
	/** Class prefixes that count as hand-styling. */
	styleTokens: string[];
	/** Class prefixes marking a legitimate Skeleton/SVForge usage. */
	legitTokens: string[];
	/** How styleTokens combine: any (one suffices) or all (all required). */
	match: 'any' | 'all';
	/** Optional source-level signal required alongside class tokens (for example an accessible control label). */
	attributePattern?: string;
	/** Human-readable reason shown in the diagnostic. */
	reason: string;
}

export interface CatalogEntry {
	path: string;
	category: 'primitives' | 'ui' | 'layout';
	useFor: string[];
	avoid?: string[];
	/**
	 * Machine-readable subset of the `avoid` contract (#342 review): only the
	 * reliably detectable cases. Every entry that declares these MUST also
	 * document the human-readable `avoid` list (validated by
	 * `deriveAvoidPatterns`).
	 */
	avoidPatterns?: AvoidPatternSpec[];
}

/**
 * Machine-readable catalog of the SvelteForge design system.
 *
 * The catalog mirrors the canonical filesystem structure (#242):
 * primitives/ (small generic bricks), ui/ (composed reusable), layout/ (page
 * structure). Paths are relative to src/lib/components/svforge/.
 */
export const SVFORGE_CATALOG: Record<string, CatalogEntry> = {
	// ── primitives ────────────────────────────────────────────────
	Button: {
		path: 'primitives/Button.svelte',
		category: 'primitives',
		useFor: ['primary/secondary actions', 'form submits', 'links as buttons'],
		avoid: ['raw <button class="...">', 'reinventing variants'],
		avoidPatterns: [
			{
				element: 'button',
				// No bare 'bg-': structural buttons (modal overlays, icon toggles)
				// legitimately use bg utilities — #342 gate caught AdminLayout.
				styleTokens: ['preset-filled-', 'preset-tonal-', 'preset-outlined-', 'shadow-'],
				legitTokens: ['btn'],
				match: 'any',
				reason: 'hand-styled <button>: use the SVForge Button component (or the Skeleton btn class)'
			}
		]
	},
	Badge: {
		path: 'primitives/Badge.svelte',
		category: 'primitives',
		useFor: ['status labels', 'counts', 'tags'],
		avoid: ['custom span + colored classes']
	},
	Toggle: {
		path: 'primitives/Toggle.svelte',
		category: 'primitives',
		useFor: ['boolean switches'],
		avoid: ['custom checkbox-as-toggle']
	},
	Checkbox: {
		path: 'primitives/Checkbox.svelte',
		category: 'primitives',
		useFor: ['multi-select booleans'],
		avoid: ['raw <input type=checkbox> without styling']
	},
	Input: {
		path: 'primitives/Input.svelte',
		category: 'primitives',
		useFor: ['text inputs'],
		avoid: ['raw <input>'],
		avoidPatterns: [
			{
				element: 'input',
				styleTokens: ['border-', 'shadow-', 'bg-', 'rounded-'],
				legitTokens: ['input'],
				match: 'any',
				reason: 'hand-styled <input>: use the SVForge Input component (or the Skeleton input class)'
			}
		]
	},
	Select: {
		path: 'primitives/Select.svelte',
		category: 'primitives',
		useFor: ['dropdown selection'],
		avoid: ['raw <select>'],
		avoidPatterns: [
			{
				element: 'select',
				styleTokens: ['border-', 'shadow-', 'bg-', 'rounded-'],
				legitTokens: ['select'],
				match: 'any',
				reason: 'hand-styled <select>: use the SVForge Select component (or the Skeleton select class)'
			}
		]
	},
	Textarea: {
		path: 'primitives/Textarea.svelte',
		category: 'primitives',
		useFor: ['multi-line text'],
		avoid: ['raw <textarea>'],
		avoidPatterns: [
			{
				element: 'textarea',
				styleTokens: ['border-', 'shadow-', 'bg-', 'rounded-'],
				legitTokens: ['textarea'],
				match: 'any',
				reason: 'hand-styled <textarea>: use the SVForge Textarea component (or the Skeleton textarea class)'
			}
		]
	},

	// ── ui (composed) ─────────────────────────────────────────────
	Card: {
		path: 'ui/Card.svelte',
		category: 'ui',
		useFor: ['content blocks', 'elevated surfaces', 'stat cards'],
		avoid: ['custom div + border + shadow'],
		avoidPatterns: [
			{
				element: 'div',
				styleTokens: ['border-', 'shadow-', 'rounded-'],
				legitTokens: ['card'],
				match: 'all',
				reason: 'card-like <div> (border + shadow + radius): use the SVForge Card component'
			}
		]
	},
	Alert: {
		path: 'ui/Alert.svelte',
		category: 'ui',
		useFor: ['info/success/warning/error notices'],
		avoid: ['alert alert-* bootstrap classes', 'custom colored div']
	},
	Table: {
		path: 'ui/Table.svelte',
		category: 'ui',
		useFor: ['data tables', 'CRUD lists'],
		avoid: ['raw <table> with ad-hoc classes'],
		avoidPatterns: [
			{
				element: 'table',
				styleTokens: [],
				legitTokens: [],
				match: 'any',
				reason: 'raw <table>: the SVForge Table component is the canonical data table (columns, slots, styling)'
			}
		]
	},
	Logo: {
		path: 'ui/Logo.svelte',
		category: 'ui',
		useFor: ['brand mark in navbar/footer'],
		avoid: ['inline svg brand per page']
	},
	Seo: {
		path: 'ui/Seo.svelte',
		category: 'ui',
		useFor: ['meta tags / SEO head'],
		avoid: ['hand-written <svelte:head> meta spam']
	},
	ThemeToggle: {
		path: 'ui/ThemeToggle.svelte',
		category: 'ui',
		useFor: ['application dark/light switching'],
		avoid: ['local button that changes the application theme'],
		avoidPatterns: [
			{
				element: 'button',
				styleTokens: ['btn'],
				legitTokens: [],
				match: 'all',
				attributePattern: "aria-label\\s*=\\s*['\"][^'\"]*(?:theme|dark mode|light mode)[^'\"]*['\"]",
				reason: 'ad-hoc application theme control: reuse the SVForge ThemeToggle component'
			}
		]
	},

	// ── layout ────────────────────────────────────────────────────
	Navbar: {
		path: 'layout/Navbar.svelte',
		category: 'layout',
		useFor: ['top navigation'],
		avoid: ['custom header + nav per page']
	},
	Footer: {
		path: 'layout/Footer.svelte',
		category: 'layout',
		useFor: ['page footer'],
		avoid: ['custom footer per page']
	},
	AuthLayout: {
		path: 'layout/AuthLayout.svelte',
		category: 'layout',
		useFor: ['shared login and setup composition'],
		avoid: ['duplicated authentication page layout']
	}
};

/**
 * Skeleton is the single source of UI primitives. These names must NOT be
 * recreated as project-local components (ERROR) — Skeleton already provides
 * them via @skeletonlabs/skeleton-svelte.
 *
 * GENERATED (#335) from the installed @skeletonlabs/skeleton-svelte package:
 * a newly exported primitive is protected automatically, without editing a
 * blacklist. See src/skeleton-inventory.ts.
 */
export const SKELETON_PRIMITIVES: string[] = GENERATED_SKELETON_PRIMITIVES;

/**
 * Former scaffold aliases (#335): generic spacing/typography names removed
 * from the scaffold because they recreated a parallel token layer. Using one
 * is an ERROR unless the project explicitly re-defines it with @utility.
 */
export const REMOVED_SCAFFOLD_ALIASES = [
	'p-element',
	'gap-group',
	'space-y-section',
	'py-section',
	'max-w-modal',
	'max-w-container',
	'font-heading',
	'font-code'
];

/** Token namespaces that look like Skeleton utilities. */
const SKELETON_LOOKING = ['btn-icon', 'btn', 'badge', 'chip', 'card', 'label', 'input', 'select', 'textarea', 'preset-'];
/**
 * Tailwind utilities that share a Skeleton namespace stay Tailwind
 * (select-none, select-text, …). Anything else on a Skeleton namespace that
 * is not in the inventory is an invented utility (#335).
 */
const SKELETON_TAILWIND_EXCEPTIONS: Record<string, string[]> = {
	select: ['none', 'text', 'all', 'auto']
};
/** Valid Tailwind rounded-* suffixes; anything else is an invented shape. */
const TAILWIND_RADIUS = /^(none|sm|md|lg|xl|2xl|3xl|full|(t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee)(-(none|sm|md|lg|xl|2xl|3xl|full))?|start|end)$/;
/**
 * Skeleton theme radii (#320): Skeleton v5's @theme defines --radius-base and
 * --radius-container, so Tailwind generates rounded-base / rounded-container
 * (incl. directional variants). Anything else outside the Tailwind scale —
 * e.g. the Skeleton v2 leftover rounded-card — renders NO CSS.
 */
const THEME_RADII = new Set(['base', 'container']);
const DIRECTIONAL = '^(?:t|r|b|l|tl|tr|bl|br|s|e|ss|se|es|ee)-';

function isRealRadiusSuffix(suffix: string): boolean {
	if (TAILWIND_RADIUS.test(suffix)) return true;
	if (THEME_RADII.has(suffix)) return true;
	const directional = new RegExp(DIRECTIONAL + '(base|container)$');
	return directional.test(suffix);
}

/** Tailwind namespaces that can never be Skeleton primitives (last segment). */
const TAILWIND_NAMESPACES = [
	'w-', 'min-w-', 'max-w-', 'h-', 'min-h-', 'max-h-', 'size-', 'p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-',
	'm-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-', 'gap-', 'space-x-', 'space-y-', 'inset-', 'top-', 'right-',
	'bottom-', 'left-', 'basis-', 'flex-', 'grid-', 'col-', 'row-', 'auto-cols-', 'auto-rows-', 'items-',
	'justify-', 'content-', 'self-', 'place-', 'order-', 'text-', 'font-', 'tracking-', 'leading-', 'list-',
	'whitespace-', 'break-', 'bg-', 'from-', 'via-', 'to-', 'border-', 'divide-', 'ring-', 'rounded-', 'shadow-',
	'opacity-', 'blur-', 'brightness-', 'contrast-', 'grayscale-', 'saturate-', 'hue-rotate-', 'backdrop-',
	'transition-', 'duration-', 'ease-', 'delay-', 'scale-', 'rotate-', 'translate-', 'skew-', 'origin-',
	'aspect-', 'object-', 'overflow-', 'overscroll-', 'z-', 'cursor-', 'select-', 'touch-', 'columns-',
	'outline-', 'decoration-', 'underline-', 'accent-', 'caret-', 'scroll-', 'snap-', 'fill-', 'stroke-',
	'indent-', 'align-', 'appearance-', 'resize-', 'will-change-', 'motion-', 'sr-only'
];
const TAILWIND_EXACT = new Set([
	'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'hidden', 'table', 'contents', 'flow-root',
	'static', 'fixed', 'absolute', 'relative', 'sticky', 'isolate', 'container', 'transform', 'animate-spin',
	'animate-ping', 'animate-pulse', 'animate-bounce', 'grayscale', 'invert', 'sepia', 'transition', 'resize',
	'rounded', 'border', 'outline', 'underline', 'sr-only', 'not-sr-only', 'group', 'peer', 'antialiased',
	'italic', 'not-italic', 'uppercase', 'lowercase', 'capitalize', 'normal-case', 'truncate', 'underline-offset-auto',
	'prose', 'avatar-group', 'sr', 'grow', 'grow-0', 'shrink', 'shrink-0'
]);
const TAILWIND_VARIANTS = new Set(['sm', 'md', 'lg', 'xl', '2xl', 'hover', 'focus', 'focus-within', 'focus-visible', 'active', 'visited', 'target', 'first', 'last', 'only', 'odd', 'even', 'first-of-type', 'last-of-type', 'empty', 'disabled', 'enabled', 'checked', 'indeterminate', 'default', 'required', 'valid', 'invalid', 'in-range', 'out-of-range', 'placeholder-shown', 'details-content', 'autofill', 'read-only', 'before', 'after', 'marker', 'file', 'backdrop', 'selection', 'first-line', 'first-letter', 'file-input', 'dark', 'motion-safe', 'motion-reduce', 'motion-secure', 'contrast-more', 'contrast-less', 'forced-colors', 'print', 'rtl', 'ltr', 'open', 'inert', 'group-hover', 'group-focus', 'peer-hover', 'peer-focus', 'peer-checked', 'peer-disabled', 'aria-checked', 'aria-disabled', 'aria-expanded', 'aria-hidden', 'aria-pressed', 'aria-readonly', 'supports-', 'data-', 'has-', 'not-', 'in-', 'min-', 'max-', 'start', 'end']);

function isTailwind(token: string): boolean {
	// Arbitrary values are Tailwind by definition: w-[42px], bg-[#abc], grid-cols-[1fr_2fr].
	if (token.includes('[') && token.includes(']')) return true;
	let segment = token;
	// Strip leading variants: md:hover:bg-... — analyze the last segment.
	while (true) {
		const index = segment.indexOf(':');
		if (index === -1) break;
		const variant = segment.slice(0, index);
		if (!TAILWIND_VARIANTS.has(variant) && !variant.startsWith('group-') && !variant.startsWith('peer-')) return false;
		segment = segment.slice(index + 1);
	}
	if (TAILWIND_EXACT.has(segment)) return true;
	if (TAILWIND_NAMESPACES.some((namespace) => segment.startsWith(namespace))) return true;
	// Bare tailwind scale values attached to a namespace we already matched.
	return false;
}

function isSkeletonUtility(token: string, ctx: { utilities: string[]; prefixes: string[] }): boolean {
	return ctx.utilities.includes(token) || ctx.prefixes.some((prefix) => token.startsWith(prefix));
}

export interface MarkupViolation {
	token: string;
	severity: 'error' | 'warn';
	message: string;
}

export interface MarkupContext {
	utilities: string[];
	prefixes: string[];
	/** @utility names redefined by the project's own CSS files. */
	projectUtilities?: string[];
}

/**
 * Deterministic Skeleton markup rules (#335).
 *
 * ERROR = certain Skeleton violation / low false-positive risk.
 * WARN  = suspicious composition requiring human review.
 */
export function checkClassString(classString: string, ctx: MarkupContext): MarkupViolation[] {
	const violations: MarkupViolation[] = [];
	const tokens = classString.split(/\s+/).map((token) => token.trim()).filter(Boolean);
	const skeletonTokens = tokens.filter((token) => isSkeletonUtility(token, ctx));

	// ── Incompatible primitives on the same element ──────────────
	const hasBtn = skeletonTokens.includes('btn');
	const hasBtnIcon = skeletonTokens.includes('btn-icon');
	const hasCard = skeletonTokens.includes('card');
	const rounded = tokens.filter((token) => token.startsWith('rounded-') || token === 'rounded');
	if (hasBtn && hasBtnIcon) {
		violations.push({
			token: 'btn + btn-icon',
			severity: 'error',
			message: 'btn and btn-icon are mutually exclusive primitives: render one or the other, never both.'
		});
	}
	for (const token of rounded) {
		if (hasBtn || hasBtnIcon) {
			violations.push({
				token,
				severity: 'error',
				message: `btn already owns its radius/shape — do not reapply ${token}. Remove it or use the Skeleton size primitive.`
			});
		}
		if (hasCard) {
			violations.push({
				token,
				severity: 'error',
				message: `card already owns its radius/shape — do not reapply ${token}.`
			});
		}
	}

	for (const token of tokens) {
		// Strip any variant prefix for classification.
		const segment = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
		// ── Former scaffold aliases ───────────────────────────────
		if (REMOVED_SCAFFOLD_ALIASES.includes(segment) && !(ctx.projectUtilities ?? []).includes(segment)) {
			violations.push({
				token,
				severity: 'error',
				message: `${segment} is a removed scaffold alias: it recreates a parallel token layer. Use Tailwind spacing/typography utilities or theme tokens.`
			});
			continue;
		}
		if (isSkeletonUtility(segment, ctx)) continue;
		// ── Skeleton-looking utility that does not exist ──────────
		// Checked BEFORE Tailwind namespaces: Skeleton owns these namespaces,
		// except for the whitelisted Tailwind colliders (select-none, …).
		if (SKELETON_LOOKING.some((namespace) => segment.startsWith(namespace)) && !segment.includes('[')) {
			const root = segment.replace(/-.*$/, '');
			const exception = SKELETON_TAILWIND_EXCEPTIONS[root]?.includes(segment.slice(root.length + 1));
			if (!exception) {
				violations.push({
					token,
					severity: 'error',
					message: `${segment} does not exist in the installed Skeleton version. Check the class name or use a preset-* / size utility that exists.`
				});
				continue;
			}
		}
		// Invented radius (#320): rounded-* must be a Tailwind default or a
		// Skeleton theme radius (base/container). Checked BEFORE the Tailwind
		// namespace short-circuit, which accepts any rounded-* suffix, and
		// skipped when a primitive on the same element already reported the
		// owned-shape conflict above.
		if (!hasBtn && !hasCard && segment.startsWith('rounded-') && !segment.includes('[') && !isRealRadiusSuffix(segment.slice('rounded-'.length))) {
			violations.push({
				token,
				severity: 'error',
				message: `${segment} is not a real radius: use a Tailwind radius (rounded-lg, …) or a Skeleton theme radius (rounded-base / rounded-container).`
			});
			continue;
		}
		if (isTailwind(token)) continue;
		// Unknown non-Skeleton tokens are #314 territory (CSS drift), not flagged here.
	}
	return violations;
}

/** Shared rule identifiers for deterministic design-system diagnostics. */
export const DESIGN_RULE_IDS = {
	duplicatedSkeletonPrimitive: 'duplicatedSkeletonPrimitive'
} as const;

/** Shared text for CLI and ESLint diagnostics (#346). */
export const DESIGN_MESSAGES = {
	duplicatedSkeletonPrimitive: (name: string, file: string) =>
		`Duplicated Skeleton primitive "${name}" at ${file}. Use ${name} from @skeletonlabs/skeleton-svelte or the svforge catalog instead.`
} as const;

/** Deterministic file-name check shared by the CLI and ESLint rule (#346). */
export function duplicatedSkeletonPrimitiveName(filename: string, projectRoot: string): string | null {
	const name = path.basename(filename, '.svelte');
	if (!(SKELETON_PRIMITIVES as readonly string[]).includes(name)) return null;
	const componentsDir = path.join(projectRoot, 'src/lib/components/svforge');
	const rel = path.relative(componentsDir, filename).split(path.sep).join('/');
	const catalogPaths = new Set(Object.values(SVFORGE_CATALOG).map((entry) => entry.path));
	return catalogPaths.has(rel) || isRegisteredUiComponent(projectRoot, filename) ? null : name;
}

/**
 * Check a SvelteForge project against the design-system harness.
 *
 * Rules (all read-only, tested against real scaffolds):
 *  ERROR
 *  - a Skeleton-provided primitive duplicated as an unregistered project-local component
 *  - hex colors used outside theme files when tokens exist
 *  WARN
 *  - hex colors used outside theme files (covered by the dedicated hex scan)
 *  - arbitrary radius/spacing classes (#345): rounded-[…], rounded-{t,r,b,l,
 *    tl,tr,bl,br}-[…], p/m/gap/space namespaces with any direction or logical
 *    side (px, pt, ps, pe, mx, ms, me, gap-x, gap-y, …), including negative
 *    values (-m-[…]). Scanned syntax: static double-quoted class="…"
 *    attributes only — dynamic class={…} and single-quoted attributes are
 *    intentionally NOT scanned. Structural/product-specific values (w-[…],
 *    h-[…], text-[…], position offsets) stay allowed, and arbitrary colors
 *    remain under the hex scan rather than the class scan.
 *  - component files outside the canonical svforge structure
 */
/**
 * Arbitrary radius/spacing detection (#345). Returns the offending class
 * tokens (Tailwind variants preserved) of a class string. Conservative:
 * only radius and spacing namespaces are reported — width/height/font-size/
 * offsets stay allowed as structural or product-specific values, and colors
 * remain under the dedicated hex scan.
 */
const ARBITRARY_SPACING_NAMESPACES = [
	'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe',
	'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me',
	'gap', 'gap-x', 'gap-y', 'space-x', 'space-y'
] as const;

const DIRECTIONAL_RADIUS = /^rounded-(?:t|r|b|l|tl|tr|bl|br)$/;

export function checkArbitraryTokens(classString: string): string[] {
	const offenders: string[] = [];
	for (const token of classString.split(/\s+/).filter(Boolean)) {
		const segment = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
		// Negative margins: -m-[3px] — the leading dash is not part of the ns.
		const body = segment.startsWith('-') ? segment.slice(1) : segment;
		const bracket = body.indexOf('-[');
		if (bracket === -1) continue;
		const ns = body.slice(0, bracket);
		const isRadius = ns === 'rounded' || DIRECTIONAL_RADIUS.test(ns);
		const isSpacing = (ARBITRARY_SPACING_NAMESPACES as readonly string[]).includes(ns);
		if (isRadius || isSpacing) offenders.push(token);
	}
	return offenders;
}

export interface DesignSystemCheckOptions {
	/** Experimental AST structural matching (#353). WARN-only until calibrated. */
	experimentalStructuralDuplication?: boolean;
}

export async function checkDesignSystem(
	projectRoot: string,
	options: DesignSystemCheckOptions = {}
): Promise<DiagnosticResult[]> {
	const results: DiagnosticResult[] = [];

	const srcDir = path.join(projectRoot, 'src');
	const componentsDir = path.join(srcDir, 'lib/components/svforge');
	const pkgPath = path.join(projectRoot, 'package.json');

	// ── 1. Unregistered externally used UI libraries (WARN) ───────────
	try {
		JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
	} catch {
		results.push({
			module: 'ds',
			status: 'error',
			message: 'Cannot read package.json — run svforge check from the project root.'
		});
		return results;
	}
	for (const packageName of findUnregisteredUiLibraries(projectRoot)) {
		results.push({
			module: 'ds',
			status: 'warn',
			message: `UI component package "${packageName}" is used but not registered in .svforge.json. Register it with \`svforge ui register ${packageName}\`; use --component-root <path> for copy-in component sources.`
		});
	}

	// ── 2. Duplicated Skeleton primitives (ERROR) ─────────────────
	if (fs.existsSync(srcDir)) {
		const walk = (dir: string, out: string[] = []): string[] => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full, out);
				else if (entry.name.endsWith('.svelte')) out.push(full);
			}
			return out;
		};
		const svelteFiles = walk(srcDir);
		// Only exact approved catalog paths are exempt (#361): a new local
		// component under components/svforge/ matching a Skeleton primitive is
		// still an error. Components delivered by an installed addon (uploads,
		// dnd, …) are approved while that addon is installed.
		const installedModules = readManifestModules(fs, path, projectRoot);
		for (const file of svelteFiles) {
			const base = duplicatedSkeletonPrimitiveName(file, projectRoot);
			if (!base) continue;
			// POSIX-normalized: addon mappings use forward slashes.
			const relFromComponents = path.relative(componentsDir, file).split(path.sep).join('/');
			// Installed addons are approved by exact component path only.
			if (isApprovedAddonComponent(relFromComponents, installedModules)) continue;
			results.push({
				module: 'ds',
				status: 'error',
				message: `[svforge/${DESIGN_RULE_IDS.duplicatedSkeletonPrimitive}] ${DESIGN_MESSAGES.duplicatedSkeletonPrimitive(base, path.relative(projectRoot, file))}`
			});
		}
	}

	// ── 3. Arbitrary hex colors outside theme (WARN) ──────────────

	const nonThemeSvelte = fs.existsSync(srcDir)
		? (() => {
				const out: string[] = [];
				const walk = (dir: string) => {
					for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
						const full = path.join(dir, entry.name);
						if (entry.isDirectory()) walk(full);
						else if (entry.name.endsWith('.svelte') && !isRegisteredUiComponent(projectRoot, full)) out.push(full);
					}
				};
				walk(srcDir);
				return out;
			})()
		: [];
	for (const file of nonThemeSvelte) {
		const rel = path.relative(projectRoot, file);
		const content = fs.readFileSync(file, 'utf-8');
		// Ignore inline SVG path fills and explicit brand colors.
		const hexes = content.match(/#[0-9a-fA-F]{6}\b/g) || [];
		const meaningful = hexes.filter(
			(h) => !content.match(new RegExp(`(path|fill|stroke)[^\\n]*${h.replace('#', '\\#')}`))
		);
		if (meaningful.length > 0) {
			results.push({
				module: 'ds',
				status: 'warn',
				message: `Arbitrary hex colors in ${rel}: ${[...new Set(meaningful)].join(', ')}. Use theme tokens instead.`
			});
		}
		// Arbitrary radius/spacing (#345, WARN). Exact-path exemption only
		// (#345 review, mirroring #361): the canonical implementation at its
		// exact catalog path (plus precise installed-addon component paths) is
		// exempt — an unapproved new component in the same directory warns.
		const relPosix = path.relative(componentsDir, file).split(path.sep).join('/');
		const approvedPaths = new Set(Object.values(SVFORGE_CATALOG).map((entry) => entry.path));
		const installedModules = readManifestModules(fs, path, projectRoot);
		const isCanonicalImplementation =
			approvedPaths.has(relPosix) || isApprovedAddonComponent(relPosix, installedModules);
		if (!isCanonicalImplementation) {
			const offenders = new Set<string>();
			for (const match of content.matchAll(/class="([^"]*)"/g)) {
				for (const token of checkArbitraryTokens(match[1])) offenders.add(token);
			}
			if (offenders.size > 0) {
				results.push({
					module: 'ds',
					status: 'warn',
					message: `Arbitrary radius/spacing in ${rel}: ${[...offenders].join(', ')}. Use the Tailwind scale or theme tokens instead.`
				});
			}
		}
	}

	// ── 4. Components outside the canonical svforge structure (WARN) ──
	if (fs.existsSync(componentsDir)) {
		const walk = (dir: string, out: string[] = []): string[] => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full, out);
				else if (entry.name.endsWith('.svelte')) out.push(full);
			}
			return out;
		};
		const svforgeFiles = walk(componentsDir);
		const allowedDirs = new Set(['primitives', 'ui', 'layout', 'dnd', 'graph', 'tiptap', 'uploads']);
		for (const file of svforgeFiles) {
			if (isRegisteredUiComponent(projectRoot, file)) continue;
			const rel = path.relative(componentsDir, file);
			const top = rel.split(path.sep)[0];
			if (!allowedDirs.has(top)) {
				results.push({
					module: 'ds',
					status: 'warn',
					message: `Component ${rel} lives outside the canonical structure (${[...allowedDirs].join(', ')}). Move it.`
				});
			}
		}
	}

	// ── 5. Skeleton markup composition (#335, ERROR) ───────────────
	if (fs.existsSync(srcDir)) {
		const approvedPaths = new Set(Object.values(SVFORGE_CATALOG).map((entry) => entry.path));
		const installedModules = readManifestModules(fs, path, projectRoot);
		const markupCtx: MarkupContext = {
			utilities: SKELETON_UTILITIES,
			prefixes: SKELETON_UTILITY_PREFIXES,
			projectUtilities: collectProjectUtilities(fs, path, srcDir)
		};
		const collectMarkup = (dir: string, out: string[] = []): string[] => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) collectMarkup(full, out);
				else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.html')) out.push(full);
			}
			return out;
		};
		for (const file of collectMarkup(srcDir)) {
			if (isRegisteredUiComponent(projectRoot, file)) continue;
			const source = fs.readFileSync(file, 'utf-8');
			const rel = path.relative(projectRoot, file);
			// Catalog avoid patterns (#342, WARN). Exact-path exemption only
			// (#342 review, mirroring #361): the canonical implementation at its
			// exact catalog path (plus precise installed-addon component paths)
			// never warns about its own markup — an unapproved new component in
			// the same directory still does.
			// Catalog paths and addon mappings are relative to componentsDir.
			const relPosix = path.relative(componentsDir, file).split(path.sep).join('/');
			const isCanonicalImplementation =
				approvedPaths.has(relPosix) || isApprovedAddonComponent(relPosix, installedModules);
			if (!isCanonicalImplementation) {
				for (const { component, reason } of checkAvoidPatterns(source)) {
					results.push({
						module: 'ds',
						status: 'warn',
						message: `${rel}: ${reason} — consider ${component}`
					});
				}
			}
			for (const { className, violations } of checkSvelteMarkup(source, markupCtx)) {
				for (const violation of violations) {
					results.push({
						module: 'ds',
						status: violation.severity,
						message: `${rel}: "${className}" — ${violation.message}`
					});
				}
			}
		}
	}

	// ── 6. Experimental structural duplication (#353, WARN) ───────
	// Explicit opt-in keeps calibrated similarity matching non-blocking.
	if (options.experimentalStructuralDuplication || process.env.SVFORGE_EXPERIMENTAL_STRUCTURAL_DUPLICATION === '1') {
		for (const finding of checkStructuralDuplicates(projectRoot)) {
			results.push({
				module: 'ds',
				status: 'warn',
				message: `${finding.file}: structurally duplicates ${finding.component} (${Math.round(finding.score * 100)}%). ${finding.evidence.join('; ')} — reuse ${finding.component}`
			});
		}
	}

	// ── 7. CSS drift outside Skeleton (#314) ─────────────────────
	if (fs.existsSync(srcDir)) {
		const cssFiles: string[] = [];
		const walkCss = (dir: string) => {
			if (!fs.existsSync(dir)) return;
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walkCss(full);
				else if (entry.name.endsWith('.css')) cssFiles.push(full);
			}
		};
		walkCss(srcDir);
		const themeFiles = new Set(
			cssFiles.filter((file) => isSkeletonThemeCss(fs.readFileSync(file, 'utf-8')))
		);
		for (const file of cssFiles) {
			const rel = path.relative(projectRoot, file).split(path.sep).join('/');
			const content = fs.readFileSync(file, 'utf-8');
			const findings =
				rel === 'src/routes/layout.css'
					? checkLayoutCss(content)
					: checkCssVariables(rel, content, themeFiles.has(file));
			for (const finding of findings) {
				results.push({ module: 'ds', status: finding.severity, message: `[svforge/${finding.rule}] ${finding.message}` });
			}
		}
		// Wrappers stay thin: <style> blocks with literal colors/radii drift.
		// Same exact-path exemption as the other wrappers checks (#361/#345):
		// the canonical implementation at its catalog path (and installed addon
		// component paths) never warns — a new component in the same directory
		// still does.
		if (fs.existsSync(componentsDir)) {
			const approvedPaths = new Set(Object.values(SVFORGE_CATALOG).map((entry) => entry.path));
			const installedModules = readManifestModules(fs, path, projectRoot);
			const walkSvelte = (dir: string, out: string[] = []): string[] => {
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					const full = path.join(dir, entry.name);
					if (entry.isDirectory()) walkSvelte(full, out);
					else if (entry.name.endsWith('.svelte')) out.push(full);
				}
				return out;
			};
			for (const file of walkSvelte(componentsDir)) {
				// Exemption paths are componentsDir-relative (catalog + addon mapping).
				const relPosix = path.relative(componentsDir, file).split(path.sep).join('/');
				if (approvedPaths.has(relPosix) || isApprovedAddonComponent(relPosix, installedModules)) continue;
				const rel = path.relative(projectRoot, file).split(path.sep).join('/');
				for (const finding of checkStyleBlockDrift(fs.readFileSync(file, 'utf-8'))) {
					results.push({ module: 'ds', status: finding.severity, message: `${rel}: [svforge/${finding.rule}] ${finding.message}` });
				}
			}
		}
	}

	return results;
}

/**
 * Extract markup violations from a Svelte/HTML source (#335, #320).
 *
 * Three families:
 * - class="..." attributes on plain elements → primitive conflicts, invented
 *   Skeleton-looking utilities, invented radii, removed scaffold aliases;
 * - class="..." on an SVForge wrapper component (Button, Card, …) containing
 *   a Skeleton primitive → the wrapper already owns its primitive; the class
 *   contract is "props = Skeleton choice, class = local Tailwind";
 * - QUOTED LITERALS inside class={…} expressions and <script> blocks (#320):
 *   ghost classes are typically assembled through cn(...) ternaries
 *   (`size === 'md' ? 'btn-md' : 'btn-lg'`), invisible to the static-attribute
 *   scan. The SAME deterministic rules apply to those literals — no second
 *   denylist.
 */
export function checkSvelteMarkup(source: string, ctx: MarkupContext): { className: string; violations: MarkupViolation[] }[] {
	const out: { className: string; violations: MarkupViolation[] }[] = [];
	const wrapperNames = Object.keys(SVFORGE_CATALOG).join('|');
	// class="..." (plain or on components). Single quotes and curly expressions
	// are intentionally not parsed: deterministic rules only.
	const classAttrPattern = new RegExp(
		`<(?:${wrapperNames})\\b[^>]*?class="([^"]*)"|class="([^"]*)"`,
		'g'
	);
	for (const match of source.matchAll(classAttrPattern)) {
		const className = match[1] ?? match[2];
		if (!className) continue;
		// Svelte expressions inside class="…" are not literal class names —
		// prettier-wrapped markup can split them into bare tokens (e.g. btn.check
		// from {isActive(btn.check)}), so validate the static part only (#346).
		const staticClassName = className.replace(/\{[^}]*\}/g, ' ');
		const violations = checkClassString(staticClassName, ctx);
		if (match[1] !== undefined) {
			// SVForge wrapper: any Skeleton primitive inside class is an error.
			const tokens = staticClassName.split(/\s+/).filter(Boolean);
			for (const token of tokens) {
				const segment = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
				if (isSkeletonUtility(segment, ctx)) {
					violations.push({
						token,
						severity: 'error',
						message: `The SVForge wrapper already renders its Skeleton primitive: select the visual through its props (variant, size, …) — not through class ("${token}").`
					});
				} else if (segment.startsWith('rounded-') && !segment.includes('[')) {
					// ANY radius on a wrapper is an error (the wrapper owns its shape);
					// the message distinguishes an invented radius (#320) from an
					// unnecessary override of a real one.
					const suffix = segment.slice('rounded-'.length);
					violations.push({
						token,
						severity: 'error',
						message: isRealRadiusSuffix(suffix)
							? `The SVForge wrapper already owns its shape — do not reapply ${segment}: select the shape through props (or corner-shape-*).`
							: `${segment} is not a real radius (Tailwind scale or theme rounded-base / rounded-container) and the wrapper already owns its shape.`
					});
				}
			}
		}
		if (violations.length) out.push({ className, violations });
	}

	// ── class={…} expressions and <script> literals (#320) ─────────
	// Ghost classes are usually assembled in cn(...) ternaries — the same
	// deterministic rules run over every quoted literal in those regions.
	// When the class={…} sits on an SVForge wrapper, the wrapper contract
	// applies instead: primitives and radii come through props.
	const reported = new Set(out.map((entry) => entry.className));
	const wrapperOpenPattern = new RegExp(`<(?:${wrapperNames})\\b[^>]*$`);
	for (const match of source.matchAll(/class\s*=\s*\{/g)) {
		const region = balancedRegion(source, match.index + match[0].length - 1);
		if (!region) continue;
		// The current (unclosed) tag = text after the last '>' before the attr.
		const before = source.slice(0, match.index);
		const tagStart = before.lastIndexOf('>') + 1;
		const isOnWrapper = wrapperOpenPattern.test(before.slice(tagStart));
		for (const literal of extractStringLiterals(region)) {
			const violations: MarkupViolation[] = [];
			if (isOnWrapper) {
				for (const token of literal.split(/\s+/).filter(Boolean)) {
					const segment = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
					if (isSkeletonUtility(segment, ctx)) {
						violations.push({
							token,
							severity: 'error',
							message: `The SVForge wrapper already renders its Skeleton primitive: select the visual through its props (variant, size, …) — not through class ("${token}").`
						});
					} else if (segment.startsWith('rounded-') && !segment.includes('[')) {
						const suffix = segment.slice('rounded-'.length);
						violations.push({
							token,
							severity: 'error',
							message: isRealRadiusSuffix(suffix)
								? `The SVForge wrapper already owns its shape — do not reapply ${token}: select the shape through props (or corner-shape-*).`
								: `${token} is not a real radius (Tailwind scale or theme rounded-base / rounded-container) and the wrapper already owns its shape.`
						});
					}
				}
			} else {
				violations.push(...checkClassString(literal, ctx));
			}
			const key = `${isOnWrapper ? 'wrapper' : 'expr'}:${literal}`;
			if (violations.length && !reported.has(key)) {
				reported.add(key);
				out.push({ className: `class={…} → ${literal}`, violations });
			}
		}
	}
	for (const region of scriptRegions(source)) {
		for (const literal of extractStringLiterals(region)) {
			const violations = checkClassString(literal, ctx);
			if (violations.length && !reported.has(`script:${literal}`)) {
				reported.add(`script:${literal}`);
				out.push({ className: `<script> → ${literal}`, violations });
			}
		}
	}

	return out;
}

const STRING_LITERAL_PATTERN = /(?<!\\)(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;

/** Quoted string literals of a region (single/double quotes, no template parts). */
function extractStringLiterals(region: string): string[] {
	return [...region.matchAll(STRING_LITERAL_PATTERN)]
		.map((match) => match[2])
		.filter((literal) => literal.trim().length > 0);
}

/** Content of <script> blocks (the only place wrapper components assemble classes). */
function scriptRegions(source: string): string[] {
	return [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

function balancedRegion(source: string, openBraceIndex: number): string | null {
	let depth = 0;
	for (let i = openBraceIndex; i < source.length; i++) {
		const ch = source[i];
		if (ch === '"' || ch === "'" || ch === '`') {
			const quote = ch;
			i++;
			while (i < source.length && source[i] !== quote) {
				if (source[i] === '\\') i++;
				i++;
			}
			continue;
		}
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return source.slice(openBraceIndex + 1, i);
		}
	}
	return null;
}

/**
 * Machine-readable avoid patterns derived from the catalog's `avoid` lists
 * (#342). Conservative markup heuristics only — each entry targets a native
 * element and names the catalog component that should be used instead.
 * Findings are WARN: the heuristic can legitimately miss hand-styled markup
 * through dynamic classes, and that is fine for a warning.
 *
 * This array is JSON-serializable: the prebuild injects it into the
 * scaffolded checker (svforge-check.mjs) so project-side checks apply the
 * same rules.
 */
export interface AvoidPattern extends AvoidPatternSpec {
	/** Catalog component recommended instead (the catalog key). */
	component: string;
}

/**
 * Derive the flat matcher list from the catalog (#342 review): the catalog
 * entry IS the single source. An entry declaring `avoidPatterns` must also
 * document its human-readable `avoid` contract — a mismatch throws so the
 * two can never drift silently.
 */
export function deriveAvoidPatterns(
	catalog: Record<string, CatalogEntry> = SVFORGE_CATALOG
): AvoidPattern[] {
	const patterns: AvoidPattern[] = [];
	for (const [component, entry] of Object.entries(catalog)) {
		if (!entry.avoidPatterns) continue;
		if (!entry.avoid || entry.avoid.length === 0) {
			throw new Error(
				`Catalog entry ${component} declares avoidPatterns but has an empty avoid contract (#342).`
			);
		}
		for (const spec of entry.avoidPatterns) patterns.push({ ...spec, component });
	}
	return patterns;
}

/** Flat matchers used by the checks; injected into the scaffolded checker. */
export const AVOID_PATTERNS: AvoidPattern[] = deriveAvoidPatterns();

/** Extract the class attribute value of an element match (static classes only). */
function extractClassAttr(attrs: string): string {
	const match = attrs.match(/class=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/);
	return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

/**
 * Detect avoid-pattern violations in a .svelte source (#342). Conservative:
 * dynamic class expressions are ignored (no tokens → no finding), and
 * legitimate Skeleton class usage never warns.
 */
export function checkAvoidPatterns(source: string): { component: string; reason: string }[] {
	const findings: { component: string; reason: string }[] = [];
	for (const pattern of AVOID_PATTERNS) {
		const elementRegex = // Case-sensitive: native HTML elements are lowercase — a PascalCase Svelte
			// component (<Table …>) must not match the raw-element heuristic.
			new RegExp(`<${pattern.element}(\\s[^>]*)?>`, 'g');
		for (const match of source.matchAll(elementRegex)) {
			const attrs = match[1] ?? '';
			const tokens = extractClassAttr(attrs).split(/\s+/).filter(Boolean);
			if (pattern.attributePattern && !new RegExp(pattern.attributePattern, 'i').test(attrs)) continue;
			if (pattern.legitTokens.some((prefix) => tokens.some((token) => token.startsWith(prefix)))) continue;
			if (pattern.styleTokens.length === 0) {
				findings.push({ component: pattern.component, reason: pattern.reason });
				continue;
			}
			const has = (prefix: string) => tokens.some((token) => token.startsWith(prefix));
			const styled =
				pattern.match === 'all' ? pattern.styleTokens.every(has) : pattern.styleTokens.some(has);
			if (styled) findings.push({ component: pattern.component, reason: pattern.reason });
		}
	}
	return findings;
}

/**
 * Whether a POSIX component path is an approved component of an INSTALLED
 * addon (#361). The addon id is the mapping KEY — it may differ from the
 * path's first segment (notifications → ui/NotificationsBell.svelte,
 * ui_toast → ui/Toaster.svelte).
 */
export function isApprovedAddonComponent(
	relPosixPath: string,
	installedModules: readonly string[]
): boolean {
	return installedModules.some((moduleId) => (ADDON_COMPONENTS[moduleId] ?? []).includes(relPosixPath));
}

/** Read the installed addon module ids from the project manifest (.svforge.json). */
function readManifestModules(fs: typeof import('node:fs'), path: typeof import('node:path'), projectRoot: string): string[] {
	const manifestPath = path.join(projectRoot, '.svforge.json');
	if (!fs.existsSync(manifestPath)) return [];
	try {
		const modules = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).modules;
		return Array.isArray(modules) ? modules.filter((module): module is string => typeof module === 'string') : [];
	} catch {
		return [];
	}
}

/** Collect @utility names redefined by the project's own CSS files. */
function collectProjectUtilities(fs: typeof import('node:fs'), path: typeof import('node:path'), srcDir: string): string[] {
	const names: string[] = [];
	const walk = (dir: string) => {
		if (!fs.existsSync(dir)) return;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.css')) {
				const source = fs.readFileSync(full, 'utf-8');
				for (const match of source.matchAll(/@utility\s+([a-zA-Z0-9-]+)/g)) names.push(match[1]);
			}
		}
	};
	walk(srcDir);
	return names;
}

// ── CSS drift outside Skeleton (#314) ─────────────────────────

export interface CssDriftFinding {
	rule: string;
	severity: 'warn' | 'error';
	message: string;
}

/** Every custom property declaration in CSS text (comments stripped). */
export function parseCssVariables(css: string): Map<string, string> {
	const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const vars = new Map<string, string>();
	for (const match of code.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)[;}]?/g)) {
		vars.set(match[1], match[2].trim());
	}
	return vars;
}

/** Skeleton v5 namespaces that must have exactly ONE source of truth: the theme. */
export const SKELETON_CSS_NAMESPACES: ReadonlyArray<[RegExp, string]> = [
	[/^--typo-/, 'typography (--typo-*)'],
	[/^--text-scaling$/, 'the typographic scale (--text-scaling)'],
	[/^--radius-(?:base|container)$/, 'theme radii (--radius-base / --radius-container)'],
	[/^--corner-shape-/, 'corner shapes (--corner-shape-*)'],
	[/^--default-(?:border|outline|ring)-width$/, 'default edge widths'],
	[/^--color-root-bg-/, 'root backgrounds (--color-root-bg-*)'],
	[/^--color-brand-/, 'brand colors (--color-brand-*)']
];

const SKELETON_THEME_HINT =
	/--(?:color-(?:primary|secondary|tertiary|success|warning|error|surface)-\d{3}|typo-[a-z]+--|radius-(?:base|container)|corner-shape-[a-z])/g;

/**
 * Recognize the project's Skeleton theme file by CONTENT, not filename
 * (#314): a `[data-theme='…']` block carrying several Skeleton variables.
 * A consumer may rename `svelteforge-theme.css` to `acme-theme.css`.
 */
export function isSkeletonThemeCss(css: string): boolean {
	if (!/\[data-theme=/.test(css)) return false;
	const hints = css.match(SKELETON_THEME_HINT);
	return (hints?.length ?? 0) >= 5;
}

/**
 * `src/routes/layout.css` is WIRING (#313): Tailwind/Skeleton imports, font
 * imports, plugins, the dark variant and font tokens. Global visual overrides
 * or theme variables defined here create a second source of truth.
 */
export function checkLayoutCss(css: string): CssDriftFinding[] {
	const findings: CssDriftFinding[] = [];
	const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
	// Allowed single-line at-rules: imports, plugins, the dark variant, sources.
	let rest = code.replace(/^[ \t]*@(?:import|plugin|custom-variant|source)[^\n{]*;?[ \t]*$/gm, '');
	// @theme blocks may carry font tokens only — the ONLY font mechanism since
	// #317 removed the global code/pre rule (--font-mono feeds Skeleton's own
	// code/pre/kbd styles and Tailwind's font-mono utility).
	rest = rest.replace(/@theme\s*\{([^}]*)\}/g, (_m, body: string) => {
		for (const decl of body.split(';').map((s) => s.trim()).filter(Boolean)) {
			if (!/^--(?:font-|typo-)/.test(decl)) {
				findings.push({
					rule: 'layout-theme-token',
					severity: 'error',
					message: `layout.css @theme may only define font tokens (found: ${decl.split(':')[0].trim()}) — colors, radii and palettes belong to the theme file.`
				});
			}
		}
		return '';
	});
	// Any remaining variable declaration creates a parallel token layer.
	for (const match of rest.matchAll(/--[a-zA-Z0-9-]+\s*:/g)) {
		findings.push({
			rule: 'layout-variable',
			severity: 'error',
			message: `layout.css must stay wiring: define ${match[0].replace(/[:\s]+$/, '')} in the Skeleton theme file, not here.`
		});
	}
	// Any remaining rule block is a global visual override — INCLUDING
	// code/pre: since #317 the only sanctioned mechanism is @theme --font-mono
	// (Skeleton styles code/pre/kbd itself); a global code/pre rule would
	// resurrect the parallel styling layer #317 removed.
	for (const match of rest.matchAll(/(^|\n)(?!\s*@)([^\n{}@]+)\{/g)) {
		const selector = match[2].trim();
		findings.push({
			rule: 'layout-override',
			severity: 'error',
			message: `layout.css must stay wiring. Global override "${selector} { … }" belongs in the theme file or a component.`
		});
	}
	return findings;
}

/**
 * CSS files added around the theme: recreating a Skeleton namespace is an
 * ERROR (one source of truth); parallel palette tokens are a strong WARN —
 * a product-specific abstraction may be legitimate, Skeleton-first stays the
 * default (#240 severity model).
 */
export function checkCssVariables(cssPath: string, css: string, isThemeFile: boolean): CssDriftFinding[] {
	if (isThemeFile) return [];
	const findings: CssDriftFinding[] = [];
	for (const name of parseCssVariables(css).keys()) {
		for (const [pattern, label] of SKELETON_CSS_NAMESPACES) {
			if (pattern.test(name)) {
				findings.push({
					rule: 'skeleton-namespace',
					severity: 'error',
					message: `${cssPath}: ${name} recreates a Skeleton namespace (${label}) outside the theme file — keep ONE source of truth.`
				});
			}
		}
	}
	for (const name of parseCssVariables(css).keys()) {
		if (/^--color-(?!root-bg-|brand-)/.test(name)) {
			findings.push({
				rule: 'parallel-palette',
				severity: 'warn',
				message: `${cssPath}: ${name} looks like a parallel palette variable. If it duplicates a Skeleton token, use the theme; keep product colors to a real, documented need.`
			});
		} else if (/^--radius-/.test(name) && !/^--radius-(?:base|container)$/.test(name)) {
			findings.push({
				rule: 'parallel-palette',
				severity: 'warn',
				message: `${cssPath}: ${name} looks like a parallel radius token. Use the Tailwind scale or the theme radii (--radius-base / --radius-container).`
			});
		}
	}
	return findings;
}

/** Properties whose literal values drift from the token system in <style>. */
const STYLE_DRIFT_PROPERTIES =
	/\b(background-color|background|color|border-color|border-radius|box-shadow|fill|stroke)\s*:\s*([^;{}]+)/g;

/**
 * SVForge wrappers stay thin (#314): a <style> block recreating visual
 * styling with literal colors or radii drifts from Skeleton/Tailwind tokens.
 * Token-based values (var(…), relative colors from var(…)) pass, as do
 * structural declarations (opacity, transforms, spacing, fonts).
 */
export function checkStyleBlockDrift(source: string): CssDriftFinding[] {
	const findings: CssDriftFinding[] = [];
	for (const block of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
		const css = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
		for (const match of css.matchAll(STYLE_DRIFT_PROPERTIES)) {
			const [, property, rawValue] = match;
			const value = rawValue.trim();
			const tokenBased =
				/^var\(/.test(value) ||
				value.includes('from var(') ||
				/^(?:transparent|inherit|currentcolor|none)$/i.test(value);
			if (tokenBased) continue;
			if (/^#[0-9a-f]{3,8}\b|^(?:rgb|hsl|oklch)\(/i.test(value)) {
				findings.push({
					rule: 'style-block-color',
					severity: 'warn',
					message: `<style> sets ${property} to a literal color ("${value}") — compose theme tokens or Tailwind utilities instead.`
				});
			} else if (property === 'border-radius') {
				findings.push({
					rule: 'style-block-radius',
					severity: 'warn',
					message: `<style> sets border-radius to a literal value ("${value}") — use rounded-* utilities or the theme radii.`
				});
			}
		}
	}
	return findings;
}
