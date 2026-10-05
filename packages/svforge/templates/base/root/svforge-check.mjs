#!/usr/bin/env node
// @ts-nocheck
/**
 * SVForge design-system check (#240, #335).
 *
 * Self-contained (no runtime deps): scans the project for design-system
 * violations and exits non-zero on ERROR (or WARN with --strict). Delivered by the SvelteForge base
 * template — run `node svforge-check.mjs` (or `bun svforge-check.mjs`) after
 * composing a page.
 *
 * ERROR — unregistered duplicated Skeleton primitive, incompatible Skeleton
 *         primitives on one element, Skeleton primitive injected through
 *         `class` into an SVForge wrapper, invented Skeleton-looking utility,
 *         removed scaffold alias, hex outside theme
 * WARN  — hex outside theme, arbitrary radius/spacing classes (#345),
 *         catalog avoid patterns (#342), component outside canonical structure
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, basename, sep, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let ROOT = process.cwd();
let results = [];

// Skeleton inventory injected at scaffold time from the actually shipped
// @skeletonlabs packages (#335). Fallback: derive from the project's own
// node_modules below when available.
const SKELETON_INVENTORY = /*__SKELETON_INVENTORY__*/ {"versions":{},"primitives":[],"utilities":[],"utilityPrefixes":[]};
// Exact addon-delivered component paths, approved per precise path (#361).
const ADDON_COMPONENTS = /*__ADDON_COMPONENTS__*/ {};
// Catalog avoid patterns (#342): conservative markup heuristics, WARN only.
const AVOID_PATTERNS = /*__AVOID_PATTERNS__*/ [];
// ── Shared rule contract (#346): one analysis engine, many surfaces ──
// The scaffolded ESLint plugin (eslint-plugin-svforge.mjs) imports these —
// this checker is the single source of truth shared with `bun run check`
// and the Vite build gate. Never duplicate engine logic in the adapter.
export const DESIGN_RULE_IDS = {
	duplicatedSkeletonPrimitive: 'duplicatedSkeletonPrimitive'
};
export const DESIGN_MESSAGES = {
	duplicatedSkeletonPrimitive: (name, file) =>
		`Duplicated Skeleton primitive "${name}" at ${file}. Use ${name} from @skeletonlabs/skeleton-svelte or the svforge catalog instead.`
};
const THEME_FILES = new Set([
	'src/lib/styles/svelteforge-theme.css',
	'src/lib/styles/tokens.css',
	'src/lib/styles/index.css'
]);
const REMOVED_ALIASES = new Set([
	'p-element', 'gap-group', 'space-y-section', 'py-section',
	'max-w-modal', 'max-w-container', 'font-heading', 'font-code'
]);
const SKELETON_LOOKING = ['btn-icon', 'btn', 'badge', 'chip', 'card', 'label', 'input', 'select', 'textarea', 'preset-'];
const TAILWIND_NS = [
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
	'italic', 'not-italic', 'uppercase', 'lowercase', 'capitalize', 'normal-case', 'truncate', 'prose',
	'grow', 'grow-0', 'shrink', 'shrink-0'
]);
const VARIANTS = new Set([
	'sm', 'md', 'lg', 'xl', '2xl', 'hover', 'focus', 'focus-within', 'focus-visible', 'active', 'visited',
	'target', 'first', 'last', 'only', 'odd', 'even', 'empty', 'disabled', 'enabled', 'checked', 'indeterminate',
	'default', 'required', 'valid', 'invalid', 'placeholder-shown', 'autofill', 'read-only', 'before', 'after',
	'marker', 'file', 'backdrop', 'selection', 'dark', 'motion-safe', 'motion-reduce', 'contrast-more',
	'contrast-less', 'forced-colors', 'print', 'rtl', 'ltr', 'open', 'inert', 'group-hover', 'group-focus',
	'peer-hover', 'peer-focus', 'peer-checked', 'peer-disabled', 'start', 'end'
]);

function walk(dir, exts, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, exts, out);
		else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
	}
	return out;
}

function lastSegment(token) {
	return token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
}

function isSkeletonUtility(token, inventory) {
	return inventory.utilities.includes(token) || inventory.utilityPrefixes.some((p) => token.startsWith(p));
}

function isTailwind(token) {
	if (token.includes('[') && token.includes(']')) return true;
	let segment = token;
	while (segment.includes(':')) {
		const variant = segment.slice(0, segment.indexOf(':'));
		if (!VARIANTS.has(variant) && !variant.startsWith('group-') && !variant.startsWith('peer-')) return false;
		segment = segment.slice(segment.indexOf(':') + 1);
	}
	if (TAILWIND_EXACT.has(segment)) return true;
	return TAILWIND_NS.some((ns) => segment.startsWith(ns));
}

// ── Radius validation (#320) ─────────────────────────────────────────
// Tailwind default scale + Skeleton theme radii (--radius-base/--radius-
// container generate rounded-base/rounded-container). Anything else — e.g.
// the Skeleton v2 leftover rounded-card — renders NO CSS in v5.
const TAILWIND_RADIUS = /^(none|sm|md|lg|xl|2xl|3xl|full|(t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee)(-(none|sm|md|lg|xl|2xl|3xl|full))?|start|end)$/;
const THEME_RADII = new Set(['base', 'container']);

function isRealRadiusSuffix(suffix) {
	if (TAILWIND_RADIUS.test(suffix)) return true;
	if (THEME_RADII.has(suffix)) return true;
	return /^(?:t|r|b|l|tl|tr|bl|br|s|e|ss|se|es|ee)-(base|container)$/.test(suffix);
}

const STRING_LITERAL = /(?<!\\)(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;

function extractStringLiterals(region) {
	return [...region.matchAll(STRING_LITERAL)]
		.map((match) => match[2])
		.filter((literal) => literal.trim().length > 0);
}

function balancedRegion(source, openBraceIndex) {
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

function scriptRegions(source) {
	return [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

// Prefer the project's own installed Skeleton when it can be derived.
// Primitives and utilities are derived independently: a consumer can install a
// newer skeleton-svelte (new primitives) or skeleton (new utilities), and each
// side falls back to the shipped inventory when its package is missing (#361).
function deriveInventoryFromNodeModules(projectRoot = ROOT) {
	const inventory = {
		versions: { ...SKELETON_INVENTORY.versions },
		primitives: [...SKELETON_INVENTORY.primitives],
		utilities: [...SKELETON_INVENTORY.utilities],
		utilityPrefixes: [...SKELETON_INVENTORY.utilityPrefixes]
	};
	const svelteComponentsDir = join(projectRoot, 'node_modules', '@skeletonlabs', 'skeleton-svelte', 'dist', 'components');
	if (existsSync(svelteComponentsDir)) {
		const derived = new Set();
		for (const entry of readdirSync(svelteComponentsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const indexPath = join(svelteComponentsDir, entry.name, 'index.js');
			if (!existsSync(indexPath)) continue;
			const source = readFileSync(indexPath, 'utf-8');
			for (const match of source.matchAll(/export \{ ([A-Za-z0-9]+) \} from '\.\/modules\/anatomy\.js'/g)) {
				derived.add(match[1]);
			}
		}
		if (derived.size) inventory.primitives = [...derived].sort();
	}
	const utilitiesDir = join(projectRoot, 'node_modules', '@skeletonlabs', 'skeleton', 'src', 'utilities');
	if (existsSync(utilitiesDir)) {
		const utilities = new Set();
		const utilityPrefixes = new Set();
		for (const file of walk(utilitiesDir, ['.css'])) {
			const source = readFileSync(file, 'utf-8');
			for (const match of source.matchAll(/@utility\s+([a-zA-Z0-9-]+)/g)) {
				if (match[1].endsWith('-')) utilityPrefixes.add(match[1]);
				else utilities.add(match[1]);
			}
		}
		if (utilities.size) inventory.utilities = [...utilities].sort();
		if (utilityPrefixes.size) inventory.utilityPrefixes = [...utilityPrefixes].sort();
	}
	return inventory;
}

// Catalog + manifest exemptions shared by the checker walk and the exported
// per-file helper below: exact approved catalog paths (#361) and exact
// component paths of INSTALLED addons. One collection, one meaning.
function collectCatalogExempts(projectRoot) {
	const paths = new Set();
	const wrappers = [];
	const entries = [];
	const installedModules = [];
	// The project catalog is NESTED (designSystem.primitives/ui/layout) — collect
	// component entries recursively, not just the first level.
	const catalogPath = join(projectRoot, 'svforge-catalog.json');
	if (existsSync(catalogPath)) {
		try {
			const collect = (node) => {
				if (!node || typeof node !== 'object' || Array.isArray(node)) return;
				for (const [key, value] of Object.entries(node)) {
					if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
					if (typeof value.path === 'string') {
						paths.add(value.path);
						wrappers.push(key); // the entry name IS the component name
						entries.push({ component: key, path: value.path });
					}
					collect(value);
				}
			};
			collect(JSON.parse(readFileSync(catalogPath, 'utf-8')));
		} catch {
			// unreadable catalog: nothing is exempt except installed addon paths
		}
	}
	// .svforge.json modules gate the addon-path exemptions (#361): the exact
	// path must belong to an INSTALLED addon.
	const manifestPath = join(projectRoot, '.svforge.json');
	if (existsSync(manifestPath)) {
		try {
			const modules = JSON.parse(readFileSync(manifestPath, 'utf-8')).modules;
			if (Array.isArray(modules)) installedModules.push(...modules);
		} catch {
			// unreadable manifest: addon paths are not exempt
		}
	}
	return { paths, wrappers, entries, installedModules };
}

const registeredUiCache = new Map();
function registeredUiLibraries(projectRoot) {
	const manifestPath = join(projectRoot, '.svforge.json');
	try {
		const { mtimeMs, size } = statSync(manifestPath);
		const cached = registeredUiCache.get(projectRoot);
		if (cached?.mtimeMs === mtimeMs && cached.size === size) return cached.libraries;
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		const libraries = Array.isArray(manifest.ui?.libraries) ? manifest.ui.libraries : [];
		registeredUiCache.set(projectRoot, { mtimeMs, size, libraries });
		return libraries;
	} catch {
		return [];
	}
}

function isRegisteredUiComponent(filename, projectRoot) {
	const absoluteFile = resolve(filename);
	return registeredUiLibraries(projectRoot).some((library) => {
		if (!Array.isArray(library.componentRoots)) return false;
		return library.componentRoots.some((root) => {
			if (typeof root !== 'string' || !root || root.startsWith('/') || /^[a-z]:[\\/]/i.test(root) || /^[/\\]{2}/.test(root) || root.split(/[\\/]/).includes('..')) return false;
			const absoluteRoot = resolve(projectRoot, root);
			const relativeFile = relative(absoluteRoot, absoluteFile);
			return relativeFile === '' || (relativeFile !== '..' && !relativeFile.startsWith(`..${sep}`) && !relativeFile.startsWith(sep));
		});
	});
}

const UI_PACKAGE_SIGNAL = /(?:^|[-/_.])(?:ui|headless|component|components|design[-_]?system|widget|widgets|primitive|primitives|dialog|popover|tooltip|modal|accordion|tabs|dropdown)(?:$|[-/_.])/i;
function packageNameFromSpecifier(specifier) {
	if (!specifier || specifier.startsWith('.') || specifier.startsWith('$') || specifier.startsWith('#')) return null;
	const parts = specifier.split('/');
	return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? null;
}
function importedComponentPackages(projectRoot) {
	const packages = new Set();
	for (const file of walk(join(projectRoot, 'src'), ['.svelte'])) {
		const source = readFileSync(file, 'utf-8');
		for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['\"]([^'\"]+)['\"]/g)) {
			const packageName = packageNameFromSpecifier(match[2]);
			if (!packageName || ['@skeletonlabs/skeleton-svelte', 'phosphor-svelte'].includes(packageName) || /icons?(?:$|[-/])/i.test(packageName)) continue;
			const bindings = match[1];
			const names = [...bindings.matchAll(/\b([A-Z][\w$]*)\b(?:\s+as\s+([A-Z][\w$]*))?/g)].map((binding) => binding[2] ?? binding[1]);
			if (names.some((name) => new RegExp(`<${name}(?:\\s|/|>)`).test(source))) packages.add(packageName);
		}
	}
	return packages;
}
function findUnregisteredUiLibraries(projectRoot, dependencies) {
	const registered = new Set(registeredUiLibraries(projectRoot).map((library) => library.package));
	const imported = importedComponentPackages(projectRoot);
	return Object.keys(dependencies)
		.filter((name) => name !== '@skeletonlabs/skeleton-svelte' && !registered.has(name))
		.filter((name) => imported.has(name) || UI_PACKAGE_SIGNAL.test(name))
		.sort();
}

/**
 * Deterministic per-file primitive-duplication check (#361) — the exact rule
 * the section-2 walk applies, exposed for the ESLint adapter. Returns the
 * duplicated primitive name, or null when the file is exempt or not a
 * Skeleton primitive at all.
 */
const perFileExemptsCache = new Map();
export function duplicatedSkeletonPrimitiveName(filename, projectRoot = process.cwd()) {
	const inventory = deriveInventoryFromNodeModules(projectRoot) ?? SKELETON_INVENTORY;
	const name = basename(filename, '.svelte');
	if (!inventory.primitives.includes(name) || isRegisteredUiComponent(filename, projectRoot)) return null;
	let exempts = perFileExemptsCache.get(projectRoot);
	if (!exempts) {
		exempts = collectCatalogExempts(projectRoot);
		perFileExemptsCache.set(projectRoot, exempts);
	}
	const componentsDir = join(projectRoot, 'src', 'lib', 'components', 'svforge');
	// POSIX-normalized: catalog/generated paths always use forward slashes.
	const rel = relative(componentsDir, filename).split(sep).join('/');
	if (exempts.paths.has(rel)) return null; // approved catalog component
	// The addon id is the mapping KEY — it may differ from the path's first
	// segment (notifications → ui/NotificationsBell.svelte, ui_toast → ui/Toaster.svelte).
	const owningAddon = exempts.installedModules.find(
		(moduleId) => (ADDON_COMPONENTS[moduleId] ?? []).includes(rel)
	);
	return owningAddon !== undefined ? null : name; // exact component of an installed addon
}

export async function checkDesignSystem(projectRoot = process.cwd(), options = {}) {
	ROOT = resolve(projectRoot);
	results = [];
	const INVENTORY = deriveInventoryFromNodeModules() ?? SKELETON_INVENTORY;

// ── 1. Unregistered externally used UI libraries (WARN) ──────────────
const pkgPath = join(ROOT, 'package.json');
if (!existsSync(pkgPath)) {
	return [{ status: 'error', msg: 'no package.json — run from the project root.' }];
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
for (const packageName of findUnregisteredUiLibraries(ROOT, allDeps)) {
	results.push({ status: 'warn', msg: `UI component package "${packageName}" is used but not registered in .svforge.json. Register it with \`svforge ui register ${packageName}\`; use --component-root <path> for copy-in component sources.` });
}

// ── 2. Duplicated Skeleton primitives (ERROR) ────────────────────
const componentsDir = join(ROOT, 'src', 'lib', 'components', 'svforge');
// Only exact approved catalog paths are exempt. A new local component under
// components/svforge/ (e.g. ui/Marquee.svelte) is still rejected when its name
// matches a primitive of the installed Skeleton inventory (#361).
// Exemptions come from the SAME collection the ESLint adapter uses (#346).
const { paths: catalogPaths, wrappers: catalogWrappers, entries: catalogEntries, installedModules } = collectCatalogExempts(ROOT);
for (const file of walk(join(ROOT, 'src'), ['.svelte'])) {
	const base = duplicatedSkeletonPrimitiveName(file, ROOT);
	if (!base) continue;
	results.push({ status: 'error', msg: `[svforge/${DESIGN_RULE_IDS.duplicatedSkeletonPrimitive}] ${DESIGN_MESSAGES.duplicatedSkeletonPrimitive(base, relative(ROOT, file))}` });
}

// ── 3. Skeleton markup composition (#335, ERROR) ─────────────────
const projectUtilities = [];
for (const file of walk(join(ROOT, 'src'), ['.css'])) {
	const source = readFileSync(file, 'utf-8');
	for (const match of source.matchAll(/@utility\s+([a-zA-Z0-9-]+)/g)) projectUtilities.push(match[1]);
}

function classViolations(classString) {
	const violations = [];
	const tokens = classString.split(/\s+/).filter(Boolean);
	const skeletonTokens = tokens.filter((token) => isSkeletonUtility(token, INVENTORY));
	const hasBtn = skeletonTokens.includes('btn');
	const hasBtnIcon = skeletonTokens.includes('btn-icon');
	const hasCard = skeletonTokens.includes('card');

	if (hasBtn && hasBtnIcon) {
		violations.push('btn and btn-icon are mutually exclusive primitives: render one or the other, never both.');
	}
	for (const token of tokens) {
		if ((token.startsWith('rounded-') || token === 'rounded') && (hasBtn || hasBtnIcon)) {
			violations.push(`btn already owns its radius/shape — do not reapply ${token}.`);
		}
		if ((token.startsWith('rounded-') || token === 'rounded') && hasCard) {
			violations.push(`card already owns its radius/shape — do not reapply ${token}.`);
		}
	}

	for (const token of tokens) {
		const segment = lastSegment(token);
		if (REMOVED_ALIASES.has(segment) && !projectUtilities.includes(segment)) {
			violations.push(`${segment} is a removed scaffold alias: it recreates a parallel token layer. Use Tailwind utilities or theme tokens.`);
			continue;
		}
		if (isSkeletonUtility(segment, INVENTORY)) continue;
		// Invented radius (#320): checked BEFORE the Tailwind namespace
		// short-circuit, which accepts any rounded-* suffix; skipped when a
		// primitive on the same element already reported the conflict above.
		if (!hasBtn && !hasCard && segment.startsWith('rounded-') && !segment.includes('[') && !isRealRadiusSuffix(segment.slice('rounded-'.length))) {
			violations.push(`${segment} is not a real radius: use a Tailwind radius (rounded-lg, …) or a Skeleton theme radius (rounded-base / rounded-container).`);
			continue;
		}
		if (isTailwind(token)) continue;
		if (SKELETON_LOOKING.some((ns) => segment.startsWith(ns)) && !segment.includes('[')) {
			violations.push(`${segment} does not exist in the installed Skeleton version. Check the class name.`);
		}
	}
	return violations;
}

for (const file of walk(join(ROOT, 'src'), ['.svelte', '.html'])) {
	if (isRegisteredUiComponent(file, ROOT)) continue;
	const source = readFileSync(file, 'utf-8');
	const rel = relative(ROOT, file);
	const wrapperPattern = catalogWrappers.length
		? new RegExp(`<(?:${catalogWrappers.join('|')})\\b[^>]*?class="([^"]*)"|class="([^"]*)"`, 'g')
		: /class="([^"]*)"/g;
	for (const match of source.matchAll(wrapperPattern)) {
		const className = match[1] ?? match[2];
		if (!className) continue;
		// Svelte expressions inside class="…" are not literal class names —
		// prettier-wrapped markup can split them into bare tokens (e.g. btn.check
		// from {isActive(btn.check)}), so validate the static part only (#346).
		const staticClassName = className.replace(/\{[^}]*\}/g, ' ');
		const violations = classViolations(staticClassName);
		if (match[1] !== undefined) {
			for (const token of staticClassName.split(/\s+/).filter(Boolean)) {
				const segment = lastSegment(token);
				if (isSkeletonUtility(segment, INVENTORY)) {
					violations.push(`The SVForge wrapper already renders its Skeleton primitive: select the visual through props — not class ("${token}").`);
				} else if (segment.startsWith('rounded-') && !segment.includes('[')) {
					// ANY radius on a wrapper is an error (the wrapper owns its shape) (#320).
					const suffix = segment.slice('rounded-'.length);
					violations.push(isRealRadiusSuffix(suffix)
						? `The SVForge wrapper already owns its shape — do not reapply ${token}: select the shape through props (or corner-shape-*).`
						: `${token} is not a real radius (Tailwind scale or theme rounded-base / rounded-container) and the wrapper already owns its shape.`);
				}
			}
		}
		for (const violation of violations) {
			results.push({ status: 'error', msg: `${rel}: "${className}" — ${violation}` });
		}
	}

	// class={…} expressions and <script> literals (#320): ghost classes are
	// usually assembled in cn(...) ternaries — the SAME rules run over every
	// quoted literal in those regions (no second denylist). On an SVForge
	// wrapper the wrapper contract applies instead (primitives and radii come
	// through props).
	const wrapperOpenPattern = catalogWrappers.length
		? new RegExp(`<(?:${catalogWrappers.join('|')})\\b[^>]*$`)
		: null;
	const reportLiteral = (literal, isOnWrapper) => {
		const violations = [];
		if (isOnWrapper) {
			for (const token of literal.split(/\s+/).filter(Boolean)) {
				const segment = lastSegment(token);
				if (isSkeletonUtility(segment, INVENTORY)) {
					violations.push(`The SVForge wrapper already renders its Skeleton primitive: select the visual through props — not class ("${token}").`);
				} else if (segment.startsWith('rounded-') && !segment.includes('[')) {
					const suffix = segment.slice('rounded-'.length);
					violations.push(isRealRadiusSuffix(suffix)
						? `The SVForge wrapper already owns its shape — do not reapply ${token}: select the shape through props (or corner-shape-*).`
						: `${token} is not a real radius (Tailwind scale or theme rounded-base / rounded-container) and the wrapper already owns its shape.`);
				}
			}
		} else {
			violations.push(...classViolations(literal));
		}
		return violations;
	};
	for (const match of source.matchAll(/class\s*=\s*\{/g)) {
		const region = balancedRegion(source, match.index + match[0].length - 1);
		if (!region) continue;
		const before = source.slice(0, match.index);
		const tagStart = before.lastIndexOf('>') + 1;
		const isOnWrapper = wrapperOpenPattern ? wrapperOpenPattern.test(before.slice(tagStart)) : false;
		for (const literal of extractStringLiterals(region)) {
			for (const violation of reportLiteral(literal, isOnWrapper)) {
				results.push({ status: 'error', msg: `${rel}: "class={…} → ${literal}" — ${violation}` });
			}
		}
	}
	for (const region of scriptRegions(source)) {
		for (const literal of extractStringLiterals(region)) {
			for (const violation of classViolations(literal)) {
				results.push({ status: 'error', msg: `${rel}: "<script> → ${literal}" — ${violation}` });
			}
		}
	}
}

// ── 4. Hex colors outside theme (WARN) ───────────────────────────
for (const file of walk(join(ROOT, 'src'), ['.svelte'])) {
	if (THEME_FILES.has(relative(ROOT, file)) || isRegisteredUiComponent(file, ROOT)) continue;
	const content = readFileSync(file, 'utf-8');
	const hexes = content.match(/#[0-9a-fA-F]{6}\b/g) || [];
	const meaningful = hexes.filter((h) => !content.match(new RegExp(`(path|fill|stroke)[^\\n]*${h.replace('#', '\\#')}`)));
	if (meaningful.length > 0) {
		results.push({ status: 'warn', msg: `Arbitrary hex colors in ${relative(ROOT, file)}: ${[...new Set(meaningful)].join(', ')}. Use theme tokens instead.` });
	}
}

// ── 4b. Catalog avoid patterns (WARN) (#342) ─────────────────────
// Conservative markup heuristics derived from the catalog avoid lists.
// Canonical implementations under components/svforge/ are excluded.
{
	const detectAvoid = (source) => {
		const findings = [];
		for (const pattern of AVOID_PATTERNS) {
			const elementRegex = // Case-sensitive: native HTML elements are lowercase — a PascalCase Svelte
			// component (<Table …>) must not match the raw-element heuristic.
			new RegExp(`<${pattern.element}(\\s[^>]*)?>`, 'g');
			for (const match of source.matchAll(elementRegex)) {
				const classMatch = (match[1] ?? '').match(/class=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/);
				const tokens = (classMatch?.[1] ?? classMatch?.[2] ?? classMatch?.[3] ?? '').trim().split(/\s+/).filter(Boolean);
				if (pattern.attributePattern && !new RegExp(pattern.attributePattern, 'i').test(match[1] ?? '')) continue;
				if (pattern.legitTokens.some((prefix) => tokens.some((token) => token.startsWith(prefix)))) continue;
				const has = (prefix) => tokens.some((token) => token.startsWith(prefix));
				const styled = pattern.styleTokens.length === 0 || (pattern.match === 'all' ? pattern.styleTokens.every(has) : pattern.styleTokens.some(has));
				if (styled) findings.push({ component: pattern.component, reason: pattern.reason });
			}
		}
		return findings;
	};
	for (const file of walk(join(ROOT, 'src'), ['.svelte'])) {
		if (isRegisteredUiComponent(file, ROOT)) continue;
		// Exact-path exemption only (#342 review, mirroring #361): the canonical
		// implementation at its exact catalog path (plus precise installed-addon
		// component paths) is exempt — an unapproved new component in the same
		// directory still warns.
		const relFromComponents = relative(componentsDir, file).split(sep).join('/');
		const isCanonicalImplementation =
			catalogPaths.has(relFromComponents) ||
			installedModules.some((moduleId) => (ADDON_COMPONENTS[moduleId] ?? []).includes(relFromComponents));
		if (isCanonicalImplementation) continue;
		const findings = detectAvoid(readFileSync(file, 'utf-8'));
		for (const { component, reason } of findings) {
			results.push({ status: 'warn', msg: `${relative(ROOT, file)}: ${reason} — consider ${component}` });
		}
	}
}

// ── 4c. Experimental AST structural duplication (WARN, #353) ────
// Opt-in while the threshold is calibrated. References include both the
// project's SVForge catalog and the installed Skeleton source, so a renamed
// Skeleton anatomy file is caught even when its filename is unrelated.
if (options.experimentalStructuralDuplication || process.env.SVFORGE_EXPERIMENTAL_STRUCTURAL_DUPLICATION === '1') {
	try {
		const { parse } = await import('svelte/compiler');
		const fingerprint = (source) => {
			const out = { elements: [], utilities: [], props: [], composition: [], sequence: [] };
			const add = (key, value) => out[key].push(value);
			const visit = (node) => {
				if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
				if (['RegularElement', 'Component', 'SvelteComponent'].includes(node.type)) {
					const token = `${node.type === 'RegularElement' ? 'element' : 'component'}:${typeof node.name === 'string' ? node.name : 'dynamic'}`;
					add('elements', token); add('sequence', token);
					for (const attribute of node.attributes ?? []) {
						if (attribute.type !== 'Attribute') continue;
						add('props', `${token}:${attribute.name}`);
						if (attribute.name === 'class' && Array.isArray(attribute.value)) {
							for (const value of attribute.value.filter((value) => value.type === 'Text')) {
								for (const utility of value.data.split(/\s+/).filter(Boolean)) if (/^(?:btn|card|input|select|textarea|badge|preset-|border-|ring-|shadow-)/.test(utility)) add('utilities', utility.replace(/^\w+:/, ''));
							}
						}
					}
				}
				if (/^(?:IfBlock|EachBlock|AwaitBlock|KeyBlock|SnippetBlock)$/.test(node.type)) { add('composition', node.type); add('sequence', `block:${node.type}`); }
				if (node.type === 'RenderTag') { add('composition', 'RenderTag'); add('sequence', 'composition:RenderTag'); }
				for (const [key, value] of Object.entries(node)) if (!['metadata', 'parent', 'loc'].includes(key)) {
					if (Array.isArray(value)) value.forEach(visit); else visit(value);
				}
			};
			visit(parse(source, { modern: true }).fragment);
			for (const key of ['elements', 'utilities', 'props', 'composition']) out[key] = [...new Set(out[key])].sort();
			return out;
		};
		const overlap = (a, b) => { if (!a.length && !b.length) return 1; if (!a.length || !b.length) return 0; const left = new Set(a), right = new Set(b); let common = 0; for (const token of left) if (right.has(token)) common++; return (2 * common) / (left.size + right.size); };
		const sequence = (a, b) => { if (!a.length || !b.length) return 0; const row = Array(b.length + 1).fill(0); for (const token of a) { let previous = 0; for (let i = 1; i <= b.length; i++) { const saved = row[i]; row[i] = token === b[i - 1] ? previous + 1 : Math.max(row[i], row[i - 1]); previous = saved; } } return (2 * row[b.length]) / (a.length + b.length); };
		const references = [
			...catalogEntries.map(({ component, path: catalogFile }) => ({ component, fingerprint: fingerprint(readFileSync(join(componentsDir, catalogFile), 'utf-8')) })),
			...walk(join(ROOT, 'node_modules', '@skeletonlabs', 'skeleton-svelte', 'dist', 'components'), ['.svelte']).map((file) => {
				const parts = relative(join(ROOT, 'node_modules', '@skeletonlabs', 'skeleton-svelte', 'dist', 'components'), file).split(sep);
				return { component: `Skeleton ${parts[0]}/${parts.slice(1).join('/').replace(/\.svelte$/, '')}`, fingerprint: fingerprint(readFileSync(file, 'utf-8')) };
			})
		];
		for (const file of walk(join(ROOT, 'src', 'lib', 'components'), ['.svelte'])) {
			if (isRegisteredUiComponent(file, ROOT)) continue;
			const rel = relative(componentsDir, file).split(sep).join('/');
			if (catalogPaths.has(rel)) continue;
			const candidate = fingerprint(readFileSync(file, 'utf-8'));
			for (const reference of references) {
				const score = overlap(candidate.elements, reference.fingerprint.elements) * .35 + overlap(candidate.utilities, reference.fingerprint.utilities) * .2 + overlap(candidate.props, reference.fingerprint.props) * .2 + overlap(candidate.composition, reference.fingerprint.composition) * .1 + sequence(candidate.sequence, reference.fingerprint.sequence) * .15;
				if (score >= .86) results.push({ status: 'warn', msg: `${relative(ROOT, file)}: structurally duplicates ${reference.component} (${Math.round(score * 100)}%). ${Math.round(overlap(candidate.elements, reference.fingerprint.elements) * 100)}% matching elements; ${Math.round(overlap(candidate.utilities, reference.fingerprint.utilities) * 100)}% matching Skeleton utilities; ${Math.round(sequence(candidate.sequence, reference.fingerprint.sequence) * 100)}% matching composition sequence — reuse ${reference.component}` });
			}
		}
	} catch (error) {
		// A partial editor/project install must not make the opt-in checker fail.
		results.push({ status: 'warn', msg: `Structural duplication detector unavailable: ${error instanceof Error ? error.message : 'could not parse Svelte files'}` });
	}
}

// ── 4d. Arbitrary radius/spacing (WARN) (#345) ───────────────────
// Conservative: only radius and spacing namespaces. Structural or
// product-specific arbitrary values (w-[…], h-[…], text-[…], offsets) and
// colors (hex scan above) stay allowed. Scanned syntax: static double-quoted
// class="…" attributes only — dynamic class={…} and single-quoted attributes
// are intentionally NOT scanned. Canonical implementations are exempt per
// exact path only (#361 model), same as the avoid patterns above.
{
	const ARBITRARY_SPACING_NAMESPACES = [
		'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe',
		'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me',
		'gap', 'gap-x', 'gap-y', 'space-x', 'space-y'
	];
	const DIRECTIONAL_RADIUS = /^rounded-(?:t|r|b|l|tl|tr|bl|br)$/;
	const checkArbitraryTokens = (classString) => {
		const offenders = [];
		for (const token of classString.split(/\s+/).filter(Boolean)) {
			const segment = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
			// Negative margins: -m-[3px] — the leading dash is not part of the ns.
			const body = segment.startsWith('-') ? segment.slice(1) : segment;
			const bracket = body.indexOf('-[');
			if (bracket === -1) continue;
			const ns = body.slice(0, bracket);
			const isRadius = ns === 'rounded' || DIRECTIONAL_RADIUS.test(ns);
			const isSpacing = ARBITRARY_SPACING_NAMESPACES.includes(ns);
			if (isRadius || isSpacing) offenders.push(token);
		}
		return offenders;
	};
	for (const file of walk(join(ROOT, 'src'), ['.svelte'])) {
		if (isRegisteredUiComponent(file, ROOT)) continue;
		const relFromComponents = relative(componentsDir, file).split(sep).join('/');
		const isCanonicalImplementation =
			catalogPaths.has(relFromComponents) ||
			installedModules.some((moduleId) => (ADDON_COMPONENTS[moduleId] ?? []).includes(relFromComponents));
		if (isCanonicalImplementation) continue;
		const source = readFileSync(file, 'utf-8');
		const offenders = new Set();
		for (const match of source.matchAll(/class="([^"]*)"/g)) {
			for (const token of checkArbitraryTokens(match[1])) offenders.add(token);
		}
		if (offenders.size > 0) {
			results.push({ status: 'warn', msg: `Arbitrary radius/spacing in ${relative(ROOT, file)}: ${[...offenders].join(', ')}. Use the Tailwind scale or theme tokens instead.` });
		}
	}
}

// ── 5. Components outside the canonical structure (WARN) ─────────
const allowedDirs = new Set(['primitives', 'ui', 'layout', 'dnd', 'graph', 'tiptap', 'uploads']);
for (const file of walk(componentsDir, ['.svelte'])) {
	if (isRegisteredUiComponent(file, ROOT)) continue;
	const rel = relative(componentsDir, file);
	const top = rel.split(sep)[0];
	if (!allowedDirs.has(top)) {
		results.push({ status: 'warn', msg: `Component ${rel} lives outside the canonical structure. Move it.` });
	}
}

// ── 6. CSS drift outside Skeleton (#314) ──────────────────────────
// Same rules as the repository engine (checkLayoutCss / checkCssVariables /
// checkStyleBlockDrift): layout.css stays wiring, Skeleton namespaces keep ONE
// source of truth (theme file recognized by CONTENT, any filename), parallel
// palettes and literal styling in wrappers are strong WARNs.
const parseCssVariables = (css) => {
	const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const vars = new Map();
	for (const match of code.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)[;}]?/g)) vars.set(match[1], match[2].trim());
	return vars;
};
const SKELETON_CSS_NAMESPACES = [
	[/^--typo-/, 'typography (--typo-*)'],
	[/^--text-scaling$/, 'the typographic scale (--text-scaling)'],
	[/^--radius-(?:base|container)$/, 'theme radii (--radius-base / --radius-container)'],
	[/^--corner-shape-/, 'corner shapes (--corner-shape-*)'],
	[/^--default-(?:border|outline|ring)-width$/, 'default edge widths'],
	[/^--color-root-bg-/, 'root backgrounds (--color-root-bg-*)'],
	[/^--color-brand-/, 'brand colors (--color-brand-*)']
];
const isSkeletonThemeCss = (css) => {
	if (!/\[data-theme=/.test(css)) return false;
	const hints = css.match(/--(?:color-(?:primary|secondary|tertiary|success|warning|error|surface)-\d{3}|typo-[a-z]+--|radius-(?:base|container)|corner-shape-[a-z])/g);
	return (hints?.length ?? 0) >= 5;
};
const checkLayoutCss = (css) => {
	const findings = [];
	const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
	let rest = code.replace(/^[ \t]*@(?:import|plugin|custom-variant|source)[^\n{]*;?[ \t]*$/gm, '');
	rest = rest.replace(/@theme\s*\{([^}]*)\}/g, (_m, body) => {
		for (const decl of body.split(';').map((s) => s.trim()).filter(Boolean)) {
			if (!/^--(?:font-|typo-)/.test(decl)) {
				findings.push({ rule: 'layout-theme-token', severity: 'error', message: `layout.css @theme may only define font tokens (found: ${decl.split(':')[0].trim()}) — colors, radii and palettes belong to the theme file.` });
			}
		}
		return '';
	});
	for (const match of rest.matchAll(/--[a-zA-Z0-9-]+\s*:/g)) {
		findings.push({ rule: 'layout-variable', severity: 'error', message: `layout.css must stay wiring: define ${match[0].replace(/[:\s]+$/, '')} in the Skeleton theme file, not here.` });
	}
	for (const match of rest.matchAll(/(^|\n)(?!\s*@)([^\n{}@]+)\{/g)) {
		const selector = match[2].trim();
		// code/pre included: since #317, @theme --font-mono is the ONLY sanctioned
		// mechanism — a global code/pre rule resurrects the parallel styling layer.
		findings.push({ rule: 'layout-override', severity: 'error', message: `layout.css must stay wiring. Global override "${selector} { … }" belongs in the theme file or a component.` });
	}
	return findings;
};
const checkCssVariables = (cssPath, css, isThemeFile) => {
	if (isThemeFile) return [];
	const findings = [];
	for (const name of parseCssVariables(css).keys()) {
		for (const [pattern, label] of SKELETON_CSS_NAMESPACES) {
			if (pattern.test(name)) {
				findings.push({ rule: 'skeleton-namespace', severity: 'error', message: `${cssPath}: ${name} recreates a Skeleton namespace (${label}) outside the theme file — keep ONE source of truth.` });
			}
		}
	}
	for (const name of parseCssVariables(css).keys()) {
		if (/^--color-(?!root-bg-|brand-)/.test(name)) {
			findings.push({ rule: 'parallel-palette', severity: 'warn', message: `${cssPath}: ${name} looks like a parallel palette variable. If it duplicates a Skeleton token, use the theme; keep product colors to a real, documented need.` });
		} else if (/^--radius-/.test(name) && !/^--radius-(?:base|container)$/.test(name)) {
			findings.push({ rule: 'parallel-palette', severity: 'warn', message: `${cssPath}: ${name} looks like a parallel radius token. Use the Tailwind scale or the theme radii (--radius-base / --radius-container).` });
		}
	}
	return findings;
};
const checkStyleBlockDrift = (source) => {
	const findings = [];
	for (const block of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
		const css = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
		for (const match of css.matchAll(/\b(background-color|background|color|border-color|border-radius|box-shadow|fill|stroke)\s*:\s*([^;{}]+)/g)) {
			const property = match[1];
			const value = match[2].trim();
			const tokenBased = /^var\(/.test(value) || value.includes('from var(') || /^(?:transparent|inherit|currentcolor|none)$/i.test(value);
			if (tokenBased) continue;
			if (/^#[0-9a-f]{3,8}\b|^(?:rgb|hsl|oklch)\(/i.test(value)) {
				findings.push({ rule: 'style-block-color', severity: 'warn', message: `<style> sets ${property} to a literal color ("${value}") — compose theme tokens or Tailwind utilities instead.` });
			} else if (property === 'border-radius') {
				findings.push({ rule: 'style-block-radius', severity: 'warn', message: `<style> sets border-radius to a literal value ("${value}") — use rounded-* utilities or the theme radii.` });
			}
		}
	}
	return findings;
};
const cssFiles = walk(join(ROOT, 'src'), ['.css']);
const themeFileSet = new Set(cssFiles.filter((file) => isSkeletonThemeCss(readFileSync(file, 'utf-8'))));
for (const file of cssFiles) {
	const rel = relative(ROOT, file);
	const content = readFileSync(file, 'utf-8');
	const findings = rel === 'src/routes/layout.css' ? checkLayoutCss(content) : checkCssVariables(rel, content, themeFileSet.has(file));
	for (const finding of findings) {
		results.push({ status: finding.severity, msg: `[svforge/${finding.rule}] ${finding.message}` });
	}
}
for (const file of walk(componentsDir, ['.svelte'])) {
	if (isRegisteredUiComponent(file, ROOT)) continue;
	// Exemption paths are componentsDir-relative (catalog + addon mapping).
	const relPosix = relative(componentsDir, file).split(sep).join('/');
	const isCanonicalImplementation =
		catalogPaths.has(relPosix) ||
		installedModules.some((moduleId) => (ADDON_COMPONENTS[moduleId] ?? []).includes(relPosix));
	if (isCanonicalImplementation) continue;
	const rel = relative(ROOT, file);
	for (const finding of checkStyleBlockDrift(readFileSync(file, 'utf-8'))) {
		results.push({ status: finding.severity, msg: `${rel}: [svforge/${finding.rule}] ${finding.message}` });
	}
}

	return results;
}

export function printDesignSystemResults(diagnostics) {
	if (diagnostics.length === 0) {
		console.log('✓ [ds] no design-system violations found.');
		return;
	}
	for (const result of diagnostics) {
		console.log(`${result.status === 'error' ? '✗' : '⚠'} [ds] ${result.status.toUpperCase()}: ${result.msg}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const diagnostics = await checkDesignSystem();
	printDesignSystemResults(diagnostics);
	process.exitCode = diagnostics.some((result) => result.status === 'error' || (process.argv.includes('--strict') && result.status === 'warn')) ? 1 : 0;
}

