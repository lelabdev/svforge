#!/usr/bin/env node
/**
 * Published user-journey smoke test helpers (#462).
 *
 * `scripts/test-user-journey.sh` reproduces the EXTERNAL user path:
 * an installable package → project creation → setup → server → minimal
 * functional journey. This module owns the parts that must be asserted in
 * unit tests: argument parsing, the documented add-on specifier, and the
 * local tarball round-trip (`npm pack` → extract → entrypoint check).
 *
 * Local mode packs the package exactly like `npm publish` would and runs the
 * journey from the EXTRACTED tarball (never `file:<repo>/packages/...`), so a
 * file missing from the npm artifact fails the smoke test instead of being
 * masked by the monorepo checkout.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The add-on that carries the base and dashboard templates. */
export const PRIMARY_PACKAGE = 'svforge';
export const JOURNEY_TEMPLATES = ['base', 'dashboard'];

/**
 * Parse the smoke-test CLI. `--published [version]` selects the registry
 * journey (default: the local tarball journey). `--template` may repeat.
 */
export function parseUserJourneyArgs(argv) {
	let mode = 'local';
	let version = null;
	const templates = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--published') {
			mode = 'published';
			const next = argv[index + 1];
			if (next && !next.startsWith('-')) {
				version = next;
				index += 1;
			}
		} else if (arg === '--template') {
			const value = argv[index + 1];
			if (!value || value.startsWith('-')) throw new Error('--template requires a value (base or dashboard)');
			templates.push(value);
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return { mode, version, templates: templates.length > 0 ? templates : [...JOURNEY_TEMPLATES] };
}

/** Build the exact `sv add` specifier documented for a template. */
export function addonSpec({ source, template, testing = 'vitest', hooks = 'none' }) {
	return `${source}=template:${template}+testing:${testing}+hooks:${hooks}`;
}

/** `npm pack` the package as it would be published; return the tarball path. */
export function packLocalAddon(packageDir, destination) {
	mkdirSync(destination, { recursive: true });
	const stdout = execFileSync('npm', ['pack', '--pack-destination', destination, '--json', '--ignore-scripts'], {
		cwd: packageDir,
		encoding: 'utf8'
	});
	const parsed = JSON.parse(stdout);
	const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
	if (!entry?.filename) throw new Error(`npm pack produced no tarball for ${packageDir}`);
	return join(destination, entry.filename);
}

/** Extract a packed tarball into `destination` (tarball root becomes the package root). */
export function extractAddon(tarball, destination) {
	mkdirSync(destination, { recursive: true });
	execFileSync('tar', ['-xzf', tarball, '-C', destination, '--strip-components=1'], { stdio: 'inherit' });
	return destination;
}

/** Every file a consumer needs to load the add-on, from its own manifest. */
export function packagedEntrypoints(manifest) {
	const required = new Set(['package.json']);
	const add = (value) => {
		if (typeof value === 'string') required.add(value.replace(/^\.\//, ''));
	};
	if (manifest.bin && typeof manifest.bin === 'object') for (const target of Object.values(manifest.bin)) add(target);
	add(manifest.main);
	add(manifest.module);
	add(manifest.types);
	const walkExports = (value) => {
		if (value && typeof value === 'object') for (const child of Object.values(value)) walkExports(child);
		else add(value);
	};
	walkExports(manifest.exports);
	return [...required];
}

/**
 * Assert the extracted tarball actually ships every declared entry point.
 * This is what makes the journey fail when a required file is not packaged.
 */
export function assertPackagedEntrypoints(packageDir) {
	const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
	const required = packagedEntrypoints(manifest);
	const missing = required.filter((relative) => !existsSync(join(packageDir, relative)));
	if (missing.length > 0) {
		throw new Error(`Packaged ${manifest.name ?? 'add-on'} is missing required file(s): ${missing.join(', ')}`);
	}
	return required;
}

/**
 * The add-on imports its `sv` peerDependency at load time. A bare tarball
 * extracted into a temporary directory has no node_modules, so make the CLI's
 * own `sv` resolvable from the extraction root (the project/npx provides it
 * for real users). This never touches the SVForge sources under test.
 */
export function linkPeerSv(destination, root) {
	const modules = join(destination, 'node_modules');
	mkdirSync(modules, { recursive: true });
	const link = join(modules, 'sv');
	if (!existsSync(link)) symlinkSync(realpathSync(join(root, 'node_modules', 'sv')), link, 'dir');
	return link;
}

/** Resolve the `sv add` source: an extracted local tarball or a registry version. */
export function resolveSource(argv, { root = resolve(dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
	const destinationFlag = argv.indexOf('--dest');
	const destination = destinationFlag === -1 ? null : argv[destinationFlag + 1];
	if (!destination) throw new Error('resolveSource requires --dest <directory>');
	const publishedFlag = argv.indexOf('--published');
	if (publishedFlag !== -1) {
		const version = argv[publishedFlag + 1];
		return version && !version.startsWith('-') ? `${PRIMARY_PACKAGE}@${version}` : PRIMARY_PACKAGE;
	}
	const tarball = packLocalAddon(join(root, 'packages', PRIMARY_PACKAGE), join(destination, 'packs'));
	const extracted = extractAddon(tarball, join(destination, PRIMARY_PACKAGE));
	assertPackagedEntrypoints(extracted);
	linkPeerSv(destination, root);
	return `file:${extracted}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [command, ...args] = process.argv.slice(2);
	if (command !== 'source') {
		console.error('Usage: node scripts/user-journey.mjs source [--published [version]] --dest <directory>');
		process.exitCode = 1;
	} else {
		try {
			console.log(resolveSource(args));
		} catch (error) {
			console.error(`User journey source resolution failed: ${error.message}`);
			process.exitCode = 1;
		}
	}
}
