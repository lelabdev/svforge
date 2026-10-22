#!/usr/bin/env node
/**
 * Release-time validation for the two offline Svelte/Skeleton agent references.
 * The snapshots are reviewed with the dependency pins, not replaced with latest
 * documentation during a publication or an idempotent release retry.
 *
 * Usage:
 *   node scripts/check-release-docs.mjs
 *   node scripts/check-release-docs.mjs --check-upstream   # drift is advisory
 *   node scripts/check-release-docs.mjs --update-lock      # only in a reviewed PR
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = join(ROOT, 'packages/svforge/docs/llms-snapshots.json');
const DOC_ROOT = join(ROOT, 'packages/svforge/docs');
export const MAX_RELEASE_DOC_AGE_DAYS = 90;

export const SOURCES = [
	{
		file: 'llms-skeleton.txt',
		url: 'https://skeleton.dev/llms-full.txt',
		dependency: '@skeletonlabs/skeleton',
		markers: ['preset-tonal', '--typo-base--font-family']
	},
	{
		file: 'llms-svelte.txt',
		url: 'https://svelte.dev/llms-full.txt',
		dependency: 'svelte',
		markers: ['$state', 'SvelteKit', 'runes']
	}
];

const digest = (value) => createHash('sha256').update(value).digest('hex');
function fail(message) {
	throw new Error(`Release documentation gate: ${message}`);
}
export function parseSnapshot(source) {
	const match = /^---\r?\nsource: ([^\r\n]+)\r?\nfetched: (\d{4}-\d{2}-\d{2})\r?\n---\r?\n\r?\n([\s\S]*)$/.exec(source);
	if (!match) fail('snapshot is missing its source and fetch-date header');
	return { url: match[1], fetched: match[2], body: match[3] };
}

export function verifySnapshot({ content, metadata, spec, dependencyVersion, now = Date.now() }) {
	const source = parseSnapshot(content);
	if (source.url !== spec.url || metadata.url !== spec.url) fail(`${spec.file}: unexpected documentation source`);
	if (metadata.file !== spec.file || metadata.dependency !== spec.dependency) fail(`${spec.file}: incorrect lock identity`);
	if (metadata.versionRange !== dependencyVersion) fail(`${spec.file}: dependency version changed; review and repin the documentation`);
	const major = Number(/^[~^]?(\d+)\./.exec(dependencyVersion)?.[1]);
	if (!Number.isInteger(major) || major < 1) fail(`${spec.file}: unsupported dependency version ${dependencyVersion}`);
	if (metadata.major !== major) fail(`${spec.file}: documented major differs from pinned dependency`);
	if (metadata.sha256 !== digest(content)) fail(`${spec.file}: snapshot contents changed without updating the reviewed lock`);
	const fetchedTime = Date.parse(`${source.fetched}T00:00:00Z`);
	const ageDays = (now - fetchedTime) / 86_400_000;
	if (!Number.isFinite(ageDays) || ageDays < -1 || ageDays >= MAX_RELEASE_DOC_AGE_DAYS)
		fail(`${spec.file}: reviewed snapshot from ${source.fetched} is outside the ${MAX_RELEASE_DOC_AGE_DAYS}-day release window; update it in a PR`);
	if (source.body.length < 10_000) fail(`${spec.file}: full offline reference is unexpectedly short`);
	for (const marker of spec.markers) {
		if (!source.body.includes(marker)) fail(`${spec.file}: expected supported-major marker ${marker} is missing`);
	}
	return { ageDays: Math.floor(ageDays), body: source.body };
}

function manifests() {
	const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	const versions = packageJson.devDependencies;
	if (!versions?.sv) fail('the root sv CLI pin is missing');
	return versions;
}

function buildLock(versions, oldLock) {
	return {
		schema: 1,
		svCliVersion: versions.sv,
		sources: SOURCES.map((spec) => {
			const content = readFileSync(join(DOC_ROOT, spec.file), 'utf8');
			const { url, body } = parseSnapshot(content);
			if (url !== spec.url || body.length < 10_000 || !spec.markers.every((marker) => body.includes(marker)))
				fail(`${spec.file}: incompatible or incomplete upstream documentation`);
			const versionRange = versions[spec.dependency];
			const major = Number(/^[~^]?(\d+)\./.exec(versionRange ?? '')?.[1]);
			if (!Number.isInteger(major) || major < 1) fail(`${spec.file}: unresolved dependency major`);
			if (oldLock && oldLock.svCliVersion !== versions.sv)
				console.log(`Re-pinning snapshot for sv CLI ${oldLock.svCliVersion} → ${versions.sv}`);
			return { file: spec.file, url: spec.url, dependency: spec.dependency, versionRange, major, sha256: digest(content) };
		})
	};
}

export function verifyReleaseDocs({ root = ROOT, now = Date.now() } = {}) {
	const versions = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies;
	const lock = JSON.parse(readFileSync(join(root, 'packages/svforge/docs/llms-snapshots.json'), 'utf8'));
	if (lock.schema !== 1 || lock.svCliVersion !== versions.sv || !Array.isArray(lock.sources) || lock.sources.length !== SOURCES.length)
		fail('reviewed source count or sv CLI pin does not match the lock');
	const checked = [];
	for (const [index, spec] of SOURCES.entries()) {
		const content = readFileSync(join(root, 'packages/svforge/docs', spec.file), 'utf8');
		const outcome = verifySnapshot({ content, metadata: lock.sources[index], spec, dependencyVersion: versions[spec.dependency], now });
		checked.push({ spec, ...outcome });
	}
	return checked;
}

async function checkUpstream(checked) {
	for (const { spec, body } of checked) {
		try {
			const response = await fetch(spec.url, { signal: AbortSignal.timeout(20_000) });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const currentBody = await response.text();
			if (digest(body) !== digest(currentBody)) {
				console.warn(`::warning file=packages/svforge/docs/${spec.file}::Upstream ${spec.url} changed after the pinned snapshot. Review compatibility and refresh in a separate PR; this release uses the reviewed snapshot.`);
			} else {
				console.log(`No upstream changes for ${spec.file}`);
			}
		} catch (error) {
			console.warn(`::warning::Unable to compare ${spec.file} against upstream (${error.message}). Using the previously reviewed, pinned snapshot.`);
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const versions = manifests();
		if (process.argv.includes('--update-lock')) {
			let oldLock = null;
			try { oldLock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')); } catch { /* first-time setup */ }
			const lock = buildLock(versions, oldLock);
			writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
		}
		const checked = verifyReleaseDocs();
		for (const { spec, ageDays } of checked) console.log(`Release docs OK: ${spec.file} (${ageDays} days old; ${versions[spec.dependency]})`);
		if (process.argv.includes('--check-upstream')) await checkUpstream(checked);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
