import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, type AST } from 'svelte/compiler';
import { SVFORGE_CATALOG } from './design-system';
import { isRegisteredUiComponent } from './ui-libraries';

/** Experimental structural-duplication detection (#353).
 *
 * This is deliberately WARN-only. It compares Svelte compiler ASTs rather
 * than source text, so renamed files, copy changes and class ordering do not
 * hide copied SVForge or Skeleton components. The cache is process-local:
 * `check` and editor integrations can reuse fingerprints without writing
 * project files.
 */
export const STRUCTURAL_DUPLICATION_THRESHOLD = 0.86;

export interface StructuralDuplicate {
	file: string;
	component: string;
	severity: 'warn';
	score: number;
	evidence: string[];
}

interface Fingerprint {
	elements: string[];
	utilities: string[];
	props: string[];
	composition: string[];
	sequence: string[];
}

interface CachedFingerprint {
	sourceHash: string;
	fingerprint: Fingerprint;
}

type AstRecord = Record<string, unknown>;

const fingerprintCache = new Map<string, CachedFingerprint>();

function isAstRecord(value: unknown): value is AstRecord {
	return typeof value === 'object' && value !== null;
}

function staticAttributeValue(attribute: AST.Attribute): string {
	if (!Array.isArray(attribute.value)) return '';
	return attribute.value.filter((value): value is AST.Text => value.type === 'Text').map((value) => value.data).join(' ');
}

function unique(values: string[]): string[] {
	return [...new Set(values)].sort();
}

function sourceHash(source: string): string {
	return createHash('sha256').update(source).digest('hex');
}

/** Produce a stable AST fingerprint. Text content and identifiers are omitted. */
export function fingerprintSvelte(source: string, cacheKey?: string): Fingerprint {
	const hash = sourceHash(source);
	const cached = cacheKey ? fingerprintCache.get(cacheKey) : undefined;
	if (cached?.sourceHash === hash) return cached.fingerprint;

	const fingerprint: Fingerprint = { elements: [], utilities: [], props: [], composition: [], sequence: [] };
	try {
		const ast = parse(source, { modern: true });
		const visit = (node: unknown) => {
			if (!isAstRecord(node) || typeof node.type !== 'string') return;
			if (node.type === 'RegularElement' || node.type === 'Component' || node.type === 'SvelteComponent') {
				const name = typeof node.name === 'string' ? node.name : 'dynamic';
				const token = `${node.type === 'RegularElement' ? 'element' : 'component'}:${name}`;
				fingerprint.elements.push(token);
				fingerprint.sequence.push(token);
				if (Array.isArray(node.attributes)) {
					for (const attribute of node.attributes) {
						if (!isAstRecord(attribute) || attribute.type !== 'Attribute' || typeof attribute.name !== 'string') continue;
						const typedAttribute = attribute as unknown as AST.Attribute;
						fingerprint.props.push(`${token}:${typedAttribute.name}`);
						if (typedAttribute.name === 'class') {
							for (const utility of staticAttributeValue(typedAttribute).split(/\s+/).filter(Boolean)) {
								if (/^(?:btn|card|input|select|textarea|badge|preset-|border-|ring-|shadow-)/.test(utility)) {
									fingerprint.utilities.push(utility.replace(/^\w+:/, ''));
								}
							}
						}
					}
				}
			}
			if (/^(?:IfBlock|EachBlock|AwaitBlock|KeyBlock|SnippetBlock)$/.test(node.type)) {
				fingerprint.composition.push(node.type);
				fingerprint.sequence.push(`block:${node.type}`);
			}
			if (node.type === 'RenderTag') {
				fingerprint.composition.push('RenderTag');
				fingerprint.sequence.push('composition:RenderTag');
			}
			for (const [key, value] of Object.entries(node)) {
				if (key === 'metadata' || key === 'parent' || key === 'loc') continue;
				if (Array.isArray(value)) value.forEach(visit);
				else visit(value);
			}
		};
		visit(ast.fragment);
	} catch {
		// Invalid/in-progress editor buffers are intentionally ignored.
	}
	fingerprint.elements = unique(fingerprint.elements);
	fingerprint.utilities = unique(fingerprint.utilities);
	fingerprint.props = unique(fingerprint.props);
	fingerprint.composition = unique(fingerprint.composition);
	if (cacheKey) fingerprintCache.set(cacheKey, { sourceHash: hash, fingerprint });
	return fingerprint;
}

function overlap(left: string[], right: string[]): number {
	if (left.length === 0 && right.length === 0) return 1;
	if (left.length === 0 || right.length === 0) return 0;
	const a = new Set(left);
	const b = new Set(right);
	let shared = 0;
	for (const token of a) if (b.has(token)) shared++;
	return (2 * shared) / (a.size + b.size);
}

function sequenceSimilarity(left: string[], right: string[]): number {
	if (!left.length || !right.length) return 0;
	const row = Array(right.length + 1).fill(0);
	for (const item of left) {
		let previous = 0;
		for (let index = 1; index <= right.length; index++) {
			const saved = row[index];
			row[index] = item === right[index - 1] ? previous + 1 : Math.max(row[index], row[index - 1]);
			previous = saved;
		}
	}
	return (2 * row[right.length]) / (left.length + right.length);
}

function similarity(left: Fingerprint, right: Fingerprint): number {
	return overlap(left.elements, right.elements) * 0.35 + overlap(left.utilities, right.utilities) * 0.2 + overlap(left.props, right.props) * 0.2 + overlap(left.composition, right.composition) * 0.1 + sequenceSimilarity(left.sequence, right.sequence) * 0.15;
}

function svelteFiles(dir: string, out: string[] = []): string[] {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) svelteFiles(file, out);
		else if (entry.name.endsWith('.svelte')) out.push(file);
	}
	return out;
}

function skeletonReferences(projectRoot: string): Array<{ component: string; fingerprint: Fingerprint }> {
	const root = path.join(projectRoot, 'node_modules/@skeletonlabs/skeleton-svelte/dist/components');
	return svelteFiles(root).map((file) => {
		const relativeFile = path.relative(root, file).split(path.sep).join('/').replace(/\.svelte$/, '');
		const [component, ...anatomy] = relativeFile.split('/');
		return {
			component: `Skeleton ${component}${anatomy.length ? `/${anatomy.join('/')}` : ''}`,
			fingerprint: fingerprintSvelte(fs.readFileSync(file, 'utf8'), file)
		};
	});
}

/** Compare local components against SVForge and installed Skeleton fingerprints. */
export function checkStructuralDuplicates(projectRoot: string): StructuralDuplicate[] {
	const componentsRoot = path.join(projectRoot, 'src/lib/components');
	const svforgeRoot = path.join(componentsRoot, 'svforge');
	const catalogPaths = new Set(Object.values(SVFORGE_CATALOG).map((entry) => entry.path));
	const references = [
		...Object.entries(SVFORGE_CATALOG)
			.map(([component, entry]) => {
				const file = path.join(svforgeRoot, entry.path);
				return fs.existsSync(file) ? { component, fingerprint: fingerprintSvelte(fs.readFileSync(file, 'utf8'), file) } : null;
			})
			.filter((reference): reference is { component: string; fingerprint: Fingerprint } => reference !== null),
		...skeletonReferences(projectRoot)
	];

	const findings: StructuralDuplicate[] = [];
	for (const file of svelteFiles(componentsRoot)) {
		if (isRegisteredUiComponent(projectRoot, file)) continue;
		const relFromSvforge = path.relative(svforgeRoot, file).split(path.sep).join('/');
		if (catalogPaths.has(relFromSvforge)) continue;
		const candidate = fingerprintSvelte(fs.readFileSync(file, 'utf8'), file);
		for (const reference of references) {
			const score = similarity(candidate, reference.fingerprint);
			if (score < STRUCTURAL_DUPLICATION_THRESHOLD) continue;
			const evidence = [
				`${Math.round(overlap(candidate.elements, reference.fingerprint.elements) * 100)}% matching elements`,
				`${Math.round(overlap(candidate.utilities, reference.fingerprint.utilities) * 100)}% matching Skeleton utilities`,
				`${Math.round(sequenceSimilarity(candidate.sequence, reference.fingerprint.sequence) * 100)}% matching composition sequence`
			];
			findings.push({ file: path.relative(projectRoot, file), component: reference.component, severity: 'warn', score, evidence });
		}
	}
	return findings.sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));
}

export function clearStructuralFingerprintCache(): void {
	fingerprintCache.clear();
}
