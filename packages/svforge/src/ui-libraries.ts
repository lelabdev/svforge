import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateManifestShape } from '@svforge/addon-kit';
import { regenerateLlmstxt } from './ai-context';

export interface UiLibrary {
	package: string;
	componentRoots?: string[];
}

export interface UiProjectConfig {
	preferred: string;
	libraries: UiLibrary[];
}

interface UiManifest extends Record<string, unknown> {
	ui?: Partial<UiProjectConfig>;
}

const DEFAULT_UI: UiProjectConfig = { preferred: 'skeleton', libraries: [] };
const componentRootsCache = new Map<string, { mtimeMs: number; size: number; roots: string[] }>();

function parseManifest(root: string): UiManifest {
	const manifestPath = path.join(root, '.svforge.json');
	if (!fs.existsSync(manifestPath)) throw new Error('.svforge.json not found — run this in a SvelteForge project root.');
	let manifest: unknown;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		throw new Error(`Cannot parse .svforge.json: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	const problems = validateManifestShape(manifest, '.svforge.json');
	if (problems.length) throw new Error(problems.join('\n'));
	return manifest as UiManifest;
}

function normalizedUi(manifest: UiManifest): UiProjectConfig {
	const ui = manifest.ui ?? {};
	return {
		preferred: typeof ui.preferred === 'string' && ui.preferred.length ? ui.preferred : DEFAULT_UI.preferred,
		libraries: Array.isArray(ui.libraries) ? (ui.libraries as UiLibrary[]) : []
	};
}

function packageNameIsValid(name: string): boolean {
	return /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name);
}

function validateComponentRoot(root: string, componentRoot: string): string {
	if (!componentRoot || path.isAbsolute(componentRoot) || /^[a-z]:[\\/]/i.test(componentRoot) || /^[/\\]{2}/.test(componentRoot) || /(^|[\\/])\.\.([\\/]|$)/.test(componentRoot) || /[*?{}]/.test(componentRoot)) throw new Error('Component roots must be safe project-relative paths without traversal or glob patterns.');
	const absoluteRoot = path.resolve(root);
	const absoluteComponentRoot = path.resolve(absoluteRoot, componentRoot);
	const relativeRoot = path.relative(absoluteRoot, absoluteComponentRoot);
	if (relativeRoot === '..' || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) {
		throw new Error(`Component root "${componentRoot}" must stay inside the project.`);
	}
	return relativeRoot.split(path.sep).join('/');
}

export function renderUiAgentGuidance(ui: UiProjectConfig): string {
	const lines = [
		'<!-- SVFORGE:UI-STRATEGY:START -->',
		'## Project-selected UI strategy',
		`- Preferred UI strategy: \`${ui.preferred}\`.`,
		...(ui.libraries.length
			? [
				' - Reuse these human-selected UI/headless libraries where they fit:',
				...ui.libraries.map((library) => `  - \`${library.package}\`${library.componentRoots?.length ? ` (local components: ${library.componentRoots.join(', ')})` : ''}`),
				'- Do not remove or replace a selected library merely because Skeleton has an overlapping primitive.'
			]
			: [
				'- Skeleton is the recommended/default design system; no external UI libraries are registered.',
				'- Do not add/register a UI library unless the user explicitly requests one; ask before changing the project UI stack.'
			]),
		'<!-- SVFORGE:UI-STRATEGY:END -->'
	];
	return lines.join('\n');
}

function writeUiContext(root: string, manifest: UiManifest): void {
	const manifestPath = path.join(root, '.svforge.json');
	const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
	const llmsContent = regenerateLlmstxt(manifestContent);
	fs.writeFileSync(manifestPath, manifestContent);
	componentRootsCache.delete(root);
	fs.writeFileSync(path.join(root, 'llms.txt'), llmsContent);
	const agentsPath = path.join(root, 'AGENTS.md');
	if (!fs.existsSync(agentsPath)) return;
	const current = fs.readFileSync(agentsPath, 'utf8');
	const nextBlock = renderUiAgentGuidance(normalizedUi(manifest));
	const managedBlock = /<!-- SVFORGE:UI-STRATEGY:START -->[\s\S]*?<!-- SVFORGE:UI-STRATEGY:END -->/;
	const updated = managedBlock.test(current) ? current.replace(managedBlock, nextBlock) : `${current.trimEnd()}\n\n${nextBlock}\n`;
	fs.writeFileSync(agentsPath, updated);
}

/** Register a manually installed UI/headless library. Repeated calls merge roots and remain byte-idempotent. */
export function registerUiLibrary(projectRoot: string, packageName: string, componentRoot?: string): UiProjectConfig {
	if (!packageNameIsValid(packageName)) throw new Error(`Invalid package name "${packageName}".`);
	const root = path.resolve(projectRoot);
	const packageJsonPath = path.join(root, 'package.json');
	if (!fs.existsSync(packageJsonPath)) throw new Error('package.json not found — run this in the project root.');
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	if (!packageJson.dependencies?.[packageName] && !packageJson.devDependencies?.[packageName]) {
		throw new Error(`Package "${packageName}" is not declared in package.json. Install it first, then register it with svforge ui register.`);
	}
	const manifest = parseManifest(root);
	const ui = normalizedUi(manifest);
	const roots = new Set(ui.libraries.find((library) => library.package === packageName)?.componentRoots ?? []);
	if (componentRoot) roots.add(validateComponentRoot(root, componentRoot));
	const libraries = new Map(ui.libraries.map((library) => [library.package, library]));
	libraries.set(packageName, {
		package: packageName,
		...(roots.size ? { componentRoots: [...roots].sort() } : {})
	});
	const next: UiProjectConfig = {
		preferred: ui.preferred,
		libraries: [...libraries.values()].sort((left, right) => left.package.localeCompare(right.package))
	};
	manifest.ui = next;
	writeUiContext(root, manifest);
	return next;
}

/** Change the project's preferred UI strategy without an allowlist of package names. */
export function setPreferredUi(projectRoot: string, preferred: string): UiProjectConfig {
	if (!packageNameIsValid(preferred)) throw new Error(`Invalid UI strategy "${preferred}".`);
	const root = path.resolve(projectRoot);
	const manifest = parseManifest(root);
	const ui = normalizedUi(manifest);
	if (preferred !== 'skeleton' && !ui.libraries.some((library) => library.package === preferred)) {
		throw new Error(`Register "${preferred}" first with svforge ui register, or use "skeleton".`);
	}
	const next = { ...ui, preferred };
	manifest.ui = next;
	writeUiContext(root, manifest);
	return next;
}

/** Read the registered component roots, validated as project-relative paths. */
export function getRegisteredUiComponentRoots(projectRoot: string): string[] {
	const root = path.resolve(projectRoot);
	const manifestPath = path.join(root, '.svforge.json');
	try {
		const { mtimeMs, size } = fs.statSync(manifestPath);
		const cached = componentRootsCache.get(root);
		if (cached?.mtimeMs === mtimeMs && cached.size === size) return cached.roots;
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as UiManifest;
		const ui = normalizedUi(manifest);
		const roots = ui.libraries.flatMap((library) =>
			Array.isArray(library.componentRoots)
				? library.componentRoots.map((componentRoot) => validateComponentRoot(root, componentRoot))
				: []
		);
		componentRootsCache.set(root, { mtimeMs, size, roots });
		return roots;
	} catch {
		return [];
	}
}

/** Whether a file belongs to one of the explicitly registered source roots. */
export function isRegisteredUiComponent(projectRoot: string, filename: string): boolean {
	const absoluteFile = path.resolve(filename);
	return getRegisteredUiComponentRoots(projectRoot).some((componentRoot) => {
		const absoluteRoot = path.resolve(projectRoot, componentRoot);
		const relative = path.relative(absoluteRoot, absoluteFile);
		return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
	});
}

/** Generic package-name signal for likely UI/headless libraries; no framework allowlist. */
function hasUiPackageSignal(packageName: string): boolean {
	return /(?:^|[-/_.])(?:ui|headless|component|components|design[-_]?system|widget|widgets|primitive|primitives|dialog|popover|tooltip|modal|accordion|tabs|dropdown)(?:$|[-/_.])/i.test(packageName) && !/(?:^|[-/_.])icons?(?:$|[-/_.])/i.test(packageName);
}

function packageNameFromSpecifier(specifier: string): string | null {
	if (!specifier || specifier.startsWith('.') || specifier.startsWith('$') || specifier.startsWith('#')) return null;
	const parts = specifier.split('/');
	return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? null;
}

/** Find externally imported Svelte components backed by declared dependencies. */
function importedComponentPackages(projectRoot: string): Set<string> {
	const sourceRoot = path.join(projectRoot, 'src');
	const packages = new Set<string>();
	const visit = (directory: string) => {
		if (!fs.existsSync(directory)) return;
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) visit(file);
			else if (entry.name.endsWith('.svelte')) {
				const source = fs.readFileSync(file, 'utf8');
				for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
					const packageName = packageNameFromSpecifier(match[2]);
					if (!packageName || packageName === '@skeletonlabs/skeleton-svelte' || packageName === 'phosphor-svelte' || /icons?(?:$|[-/])/i.test(packageName)) continue;
					const bindings = match[1];
					const names = [...bindings.matchAll(/\b([A-Z][\w$]*)\b(?:\s+as\s+([A-Z][\w$]*))?/g)].map((binding) => binding[2] ?? binding[1]);
					if (names.some((name) => new RegExp(`<${name}(?:\\s|/|>)`).test(source))) packages.add(packageName);
				}
			}
		}
	};
	visit(sourceRoot);
	return packages;
}

/** UI dependencies not yet represented in project metadata, reported as guidance rather than errors. */
export function findUnregisteredUiLibraries(projectRoot: string): string[] {
	const packagePath = path.join(projectRoot, 'package.json');
	if (!fs.existsSync(packagePath)) return [];
	let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
	try {
		packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
	} catch {
		return [];
	}
	const manifestPath = path.join(projectRoot, '.svforge.json');
	let registered = new Set<string>();
	if (fs.existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as UiManifest;
			registered = new Set(normalizedUi(manifest).libraries.map((library) => library.package));
		} catch {
			// Invalid metadata is diagnosed elsewhere; do not invent package errors.
		}
	}
	const imported = importedComponentPackages(projectRoot);
	const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
	return Object.keys(dependencies)
		.filter((name) => name !== '@skeletonlabs/skeleton-svelte' && !registered.has(name))
		.filter((name) => imported.has(name) || hasUiPackageSignal(name))
		.sort();
}
