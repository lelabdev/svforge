#!/usr/bin/env node
/**
 * Normalize graphify-out/ artifacts for portability.
 *
 * Raw Graphify output embeds machine-local data that must never be committed
 * and would make graphs differ across machines and worktrees:
 *   - manifest.json records per-file `mtime`/`seen` wall-clock timestamps
 *   - some node ids/labels are derived from the ABSOLUTE checkout path
 *     (e.g. /home/loops/dev/svelteforge-hub/svelteForge ->
 *     home_loops_dev_svelteforge_hub_svelteforge), leaking local paths and
 *     breaking diffs between machines/worktrees/clones
 *
 * Part of the single graph-update entry point `bun run graphify:update`
 * (used by both the optional pre-commit hook and manual updates), it makes
 * the committed graph byte-stable across machines: two runs on the same
 * sources always produce identical files.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(SCRIPT_ROOT, 'graphify-out');

const MANIFEST = join(OUT, 'manifest.json');
const GRAPH = join(OUT, 'graph.json');

// In an issue worktree the checkout directory is `.worktrees/<issue>`, not
// the repository name. Use the parent repo name as an anchor so older IDs
// from sibling worktrees can be recognized even when their absolute prefixes
// differ from the current checkout.
const REPOSITORY_ROOT =
	basename(dirname(SCRIPT_ROOT)) === '.worktrees' ? dirname(dirname(SCRIPT_ROOT)) : SCRIPT_ROOT;
const REPOSITORY_SLUG = slug(basename(REPOSITORY_ROOT));
const ROOT_PATH_SEGMENTS = readdirSync(SCRIPT_ROOT)
	.filter((entry) => !['.git', '.worktrees', 'graphify-out', 'node_modules'].includes(entry))
	.map((entry) => slug(entry).replace(/^_+/, ''))
	.filter(Boolean);
const COMMON_FILESYSTEM_ROOTS = [
	'home', 'tmp', 'users', 'private', 'var', 'mnt', 'media', 'srv', 'opt', 'root', 'workspace',
	'workspaces', 'run', 'nix', 'usr', 'volumes', 'volume', 'dev', 'proc', 'sys', 'boot', 'data',
	'work', 'projects', 'code', 'repo', 'repos', 'build', 'agent', 'agents', 'github', 'runner', 'app'
];
const ABSOLUTE_PATH_ROOTS = new Set([
	...COMMON_FILESYSTEM_ROOTS,
	...readdirSync(parse(SCRIPT_ROOT).root).map((entry) => slug(entry))
]);

/** Strip volatile timestamps from the incremental-extraction manifest. */
function normalizeManifest() {
	const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
	for (const entry of Object.values(manifest)) {
		delete entry.mtime;
		delete entry.seen;
	}
	writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasMetadata(value) {
	if (value === undefined || value === null || value === '') return false;
	if (Array.isArray(value)) return value.length > 0;
	if (isRecord(value)) return Object.keys(value).length > 0;
	return true;
}

function metadataCompleteness(value) {
	if (!hasMetadata(value)) return 0;
	if (Array.isArray(value)) return value.reduce((sum, item) => sum + metadataCompleteness(item), 0);
	if (isRecord(value)) {
		return Object.values(value).reduce((sum, item) => sum + metadataCompleteness(item), 0);
	}
	return 1;
}

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
	);
}

function stableStringify(value) {
	return JSON.stringify(canonicalValue(value));
}

function compareLexically(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

/** Prefer complete records, then use canonical JSON as an order-independent tie-breaker. */
function compareMetadataCompleteness(left, right) {
	const scoreDifference = metadataCompleteness(right) - metadataCompleteness(left);
	return scoreDifference || compareLexically(stableStringify(left), stableStringify(right));
}

/** Fill missing metadata recursively; on conflicts the deterministic preferred value wins. */
function mergeMetadata(preferred, fallback) {
	if (!hasMetadata(preferred)) return fallback;
	if (!hasMetadata(fallback)) return preferred;

	if (isRecord(preferred) && isRecord(fallback)) {
		const merged = { ...preferred };
		for (const key of Object.keys(fallback).sort()) {
			merged[key] = key in merged ? mergeMetadata(merged[key], fallback[key]) : fallback[key];
		}
		return merged;
	}

	if (Array.isArray(preferred) && Array.isArray(fallback)) {
		const values = new Map();
		for (const value of [...preferred, ...fallback]) values.set(stableStringify(value), value);
		return [...values.entries()]
			.sort(([left], [right]) => compareLexically(left, right))
			.map(([, value]) => value);
	}

	return preferred;
}

/**
 * Replace absolute-checkout-path-derived identifiers with a stable root token.
 * Graphify slugifies the checkout directory into some node ids, labels and
 * link endpoints (e.g. /home/loops/dev/svelteforge-hub/svelteForge ->
 * home_loops_dev_svelteforge_hub_svelteforge). The current checkout prefix is
 * rewritten directly; stale sibling-worktree prefixes are recognized by the
 * repository basename followed by a real root-level path segment.
 */
function normalizeGraph() {
	const graph = JSON.parse(readFileSync(GRAPH, 'utf8'));

	// Root: the slug of THIS checkout path. Graphify slugifies the absolute
	// checkout directory into some node ids/labels/link endpoints, so on any
	// machine those ids start with that machine's path slug. Rewriting it to
	// `repo` makes the graph identical across machines, clones and worktrees.
	const checkoutSlug = slug(SCRIPT_ROOT);
	const roots = checkoutSlug ? [checkoutSlug] : [];

	let rewritten = 0;
	const rewrite = (value) => {
		if (typeof value !== 'string') return value;
		let out = value;
		for (const root of roots) {
			if (out === root) return 'repo';
			if (out.startsWith(root + '_')) {
				out = 'repo' + out.slice(root.length);
				rewritten++;
				return out;
			}
		}

		// Root-relative IDs can themselves contain the repository basename (for
		// example packages_svforge_scripts_prebuild). Only treat the later
		// repository marker as an old absolute path when its prefix starts at a
		// filesystem root, never when the ID already starts at a repo path.
		if (
			ROOT_PATH_SEGMENTS.some(
				(segment) => out === segment || out.startsWith(`${segment}_`)
			)
		) return out;

		// Graphify incrementally retains nodes from prior runs. Their absolute
		// prefixes no longer match this checkoutSlug, so find the repository
		// basename followed by a known root-level path and canonicalize that
		// suffix too. Strip `.worktrees/<issue>` when it is present; the same
		// source must normalize identically from every issue worktree.
		const marker = `_${REPOSITORY_SLUG}`;
		let rootIndex = out.indexOf(marker);
		while (rootIndex > 0) {
			const absolutePrefix = out.slice(0, rootIndex);
			const firstPathSegment = absolutePrefix.split('_', 1)[0];
			if (!ABSOLUTE_PATH_ROOTS.has(firstPathSegment) && !/^[a-z]$/i.test(firstPathSegment)) {
				rootIndex = out.indexOf(marker, rootIndex + marker.length);
				continue;
			}

			let suffix = out.slice(rootIndex + marker.length);
			suffix = suffix.replace(/^_+worktrees_+[^_]+_+/, '_');
			const repoRelative = suffix.replace(/^_+/, '');
			if (
				ROOT_PATH_SEGMENTS.some(
					(segment) => repoRelative === segment || repoRelative.startsWith(`${segment}_`)
				)
			) {
				rewritten++;
				return `repo_${repoRelative}`;
			}
			rootIndex = out.indexOf(marker, rootIndex + marker.length);
		}
		return out;
	};

	const nodesById = new Map();
	for (const node of graph.nodes) {
		const id = rewrite(node.id);
		const label = rewrite(node.label);
		const normalized = {
			...node,
			...(id !== node.id ? { id } : {}),
			...(label !== node.label ? { label } : {})
		};
		const group = nodesById.get(id);
		if (group) group.push(normalized);
		else nodesById.set(id, [normalized]);
	}

	let mergedNodes = 0;
	graph.nodes = [...nodesById.values()].map((group) => {
		if (group.length === 1) return group[0];
		mergedNodes += group.length - 1;
		const [preferred, ...fallbacks] = group.sort(compareMetadataCompleteness);
		return fallbacks.reduce((merged, fallback) => mergeMetadata(merged, fallback), preferred);
	});
	if (mergedNodes) {
		console.error(`[normalize-graphify] merged ${mergedNodes} duplicate node(s) after ID normalization`);
	}

	graph.links = graph.links.map((link) => {
		const source = rewrite(link.source);
		const target = rewrite(link.target);
		return { ...link, ...(source !== link.source ? { source } : {}), ...(target !== link.target ? { target } : {}) };
	});

	// Build outputs must not depend on machine build state: when dist/ exists
	// it is gitignored (not indexed), when it does not exist a dynamic import
	// of it still mints a phantom node. Drop dist/-derived nodes in both
	// cases, then drop links left dangling by the removal (or already
	// dangling on checkouts where the target was never indexed).
	const isBuildArtifact = (node) =>
		typeof node.source_file === 'string' && /(^|\/)dist\//.test(node.source_file);
	const removedIds = new Set();
	graph.nodes = graph.nodes.filter((node) => {
		if (isBuildArtifact(node)) {
			removedIds.add(node.id);
			return false;
		}
		return true;
	});
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	graph.links = graph.links.filter(
		(link) => nodeIds.has(link.source) && nodeIds.has(link.target)
	);
	if (removedIds.size) {
		console.error(`[normalize-graphify] dropped ${removedIds.size} build-output node(s)`);
	}

	if (rewritten) {
		console.error(`[normalize-graphify] rewrote ${rewritten} absolute-path identifiers`);
	}
	writeFileSync(GRAPH, JSON.stringify(graph, null, 2) + '\n');
}

/** Slugify a path the same way Graphify does for node ids. */
function slug(path) {
	return path
		.split(/[\\/]/)
		.filter(Boolean)
		.join('_')
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.toLowerCase();
}

normalizeManifest();
normalizeGraph();
console.log('graphify-out normalized (portable, byte-stable).');
