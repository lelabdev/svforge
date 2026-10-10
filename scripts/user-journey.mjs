#!/usr/bin/env node
/**
 * External user journey smoke test helpers (#462, hardened in #465).
 *
 * `scripts/test-user-journey.sh` reproduces the path a REAL external user
 * follows: acquire the `sv` CLI, create a project, add SVForge from a packed
 * tarball (pre-publish) or the exact published version (post-publish), run the
 * documented commands, boot the app, and exercise the dashboard flow.
 *
 * This module owns the parts asserted in unit tests: argument parsing, the
 * documented add-on specifier, local tarball round-trips, external `sv`
 * acquisition, packed CLI installation, and source resolution. It NEVER reads or executes the
 * repository's own `node_modules` tooling — `sv` is installed into a scratch
 * prefix exactly as an external consumer would.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The add-on that carries the base and dashboard templates. */
export const PRIMARY_PACKAGE = 'svforge';
export const JOURNEY_TEMPLATES = ['base', 'dashboard'];

/**
 * Golden path (#470) module selection per template. The one-command creator
 * must configure everything requested in a single non-interactive command.
 * `dashboard` exercises the complete canonical set (which requires the
 * long-lived runtime); `base` exercises an opt-in module.
 */
export const GOLDEN_PATH_MODULES = {
	base: ['ui_toast'],
	dashboard: 'all'
};
export const GOLDEN_PATH_RUNTIME = { dashboard: 'long-lived-node' };

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
			if (!next || next.startsWith('-')) {
				throw new Error('--published requires an exact version (for example --published 2.0.1)');
			}
			version = next;
			index += 1;
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

/** The `sv` version the repository targets, e.g. `1.1.1` — never a checkout path. */
export function resolveSvVersion(root = REPO_ROOT, { override } = {}) {
	if (override) return override;
	const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const raw = manifest.devDependencies?.sv;
	if (typeof raw !== 'string' || raw.length === 0) {
		throw new Error('The repository manifest does not pin the `sv` CLI');
	}
	return raw.replace(/^[\^~>=<\s]*/, '').trim();
}

/**
 * Install `sv` EXTERNALLY into `scratch` (the registry acquisition a real user
 * gets through `npx`/`npm`). Returns the CLI path inside the scratch prefix, so
 * the journey never touches `$REPO_ROOT/node_modules`.
 */
export function installSv(scratch, version, { run = execFileSync } = {}) {
	mkdirSync(scratch, { recursive: true });
	run(
		'npm',
		['install', '--prefix', scratch, '--no-save', '--no-package-lock', '--ignore-scripts', `sv@${version}`],
		// npm writes progress to stdout; keep stdout clean so the resolved source
		// can be printed safely, and surface npm diagnostics on stderr.
		{ stdio: ['ignore', 'ignore', 'inherit'] }
	);
	return join(scratch, 'node_modules', '.bin', 'sv');
}

/** Install the packed CLI exactly as an external npm consumer would. */
export function installPackedCli(tarball, scratch, { run = execFileSync } = {}) {
	if (!tarball) throw new Error('installPackedCli requires a packed tarball path');
	mkdirSync(scratch, { recursive: true });
	run(
		'npm',
		['install', '--prefix', scratch, '--no-save', '--no-package-lock', '--ignore-scripts', tarball],
		{ stdio: ['ignore', 'ignore', 'inherit'] }
	);
	return join(scratch, 'node_modules', '.bin', 'svforge');
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
	execFileSync('tar', ['-xzf', tarball, '-C', destination, '--strip-components=1'], { stdio: ['ignore', 'ignore', 'inherit'] });
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
 * Resolve the `sv add` source and install external `sv` into the scratch
 * prefix. Local: pack the current build and extract it under
 * `scratch/registry/<package>` (never `file:<repo>/packages/...`). Published:
 * the exact npm specifier (`svforge@<version>` or `svforge` for latest).
 */
export function resolveSource(argv, { root = REPO_ROOT, run = execFileSync } = {}) {
	const destFlag = argv.indexOf('--dest');
	const scratch = destFlag === -1 ? null : argv[destFlag + 1];
	if (!scratch) throw new Error('resolveSource requires --dest <directory>');
	const svFlag = argv.indexOf('--sv');
	const svVersion = resolveSvVersion(root, { override: svFlag === -1 ? undefined : argv[svFlag + 1] });
	installSv(scratch, svVersion, { run });

	const publishedFlag = argv.indexOf('--published');
	if (publishedFlag !== -1) {
		const version = argv[publishedFlag + 1];
		if (!version || version.startsWith('-')) {
			throw new Error('--published requires an exact version (for example --published 2.0.1)');
		}
		return `${PRIMARY_PACKAGE}@${version}`;
	}
	const tarball = packLocalAddon(join(root, 'packages', PRIMARY_PACKAGE), join(scratch, 'packs'));
	const extracted = extractAddon(tarball, join(scratch, 'registry', PRIMARY_PACKAGE));
	assertPackagedEntrypoints(extracted);
	return `file:${extracted}`;
}

/**
 * The exact argv for the ONE `svforge create` command the golden path runs
 * (#470). Pure so the non-interactive contract is unit-tested: required
 * choices are flags and `--yes` prevents prompting. Hooks are omitted by
 * default to exercise the CLI's non-TTY default; an explicit hook choice is
 * forwarded. The add-on source is explicit (`--addon-root` for packed
 * artifacts, `--compat-manifest` for exact published versions), never `latest`.
 *
 * @param {{
 *   dir: string,
 *   template?: 'base' | 'dashboard',
 *   pm?: string,
 *   testing?: 'vitest' | 'playwright',
 *   hooks?: 'none' | 'lefthook',
 *   modules?: string[] | 'all',
 *   runtime?: 'long-lived-node',
 *   addonRoot?: string,
 *   addonVersion?: string,
 *   compatManifest?: string
 * }} options
 */
export function goldenPathCreateArgs(options = {}) {
	const {
		dir,
		template = 'base',
		pm = 'bun',
		testing = 'vitest',
		hooks,
		modules = GOLDEN_PATH_MODULES[template] ?? 'all',
		runtime = GOLDEN_PATH_RUNTIME[template],
		addonRoot,
		addonVersion,
		compatManifest
	} = options;
	const args = [
		'create',
		dir,
		'--template',
		template,
		'--pm',
		pm,
		'--testing',
		testing,
		'--modules',
		Array.isArray(modules) ? modules.join(',') : modules,
		'--yes'
	];
	if (hooks !== undefined) args.push('--hooks', hooks);
	if (runtime) args.push('--runtime', runtime);
	if (addonRoot) args.push('--addon-root', addonRoot);
	if (addonVersion) args.push('--addon-version', addonVersion);
	if (compatManifest) args.push('--compat-manifest', compatManifest);
	return args;
}

/**
 * Pack + extract the CURRENT module add-ons into `destination/registry/<id>`,
 * so `svforge create --addon-root` resolves the release's packaged artifacts
 * instead of the checkout or the registry (pre-publish golden path, #470).
 *
 * `svforge` itself is packed separately by `resolveSource`, so it is skipped
 * here to avoid a redundant pack.
 */
export function packModuleSet({ root = REPO_ROOT, destination, skip = [PRIMARY_PACKAGE] }) {
	const registry = join(destination, 'registry');
	const packagesDir = join(root, 'packages');
	const ids = readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
		.map((entry) => entry.name)
		.filter((id) => !skip.includes(id))
		.sort();
	for (const id of ids) {
		const tarball = packLocalAddon(join(packagesDir, id), join(destination, 'packs'));
		const extracted = extractAddon(tarball, join(registry, id));
		assertPackagedEntrypoints(extracted);
	}
	return registry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [command, ...args] = process.argv.slice(2);
	const flag = (name) => {
		const index = args.indexOf(name);
		return index === -1 ? undefined : args[index + 1];
	};
	try {
		if (command === 'source') {
			console.log(resolveSource(args));
		} else if (command === 'addon-set') {
			const destination = flag('--dest');
			if (!destination) throw new Error('addon-set requires --dest <directory>');
			console.log(packModuleSet({ destination }));
		} else if (command === 'install-cli') {
			const tarball = flag('--tarball');
			const destination = flag('--dest');
			if (!tarball) throw new Error('install-cli requires --tarball <path>');
			if (!destination) throw new Error('install-cli requires --dest <directory>');
			console.log(installPackedCli(tarball, destination));
		} else {
			console.error('Usage: node scripts/user-journey.mjs <source|addon-set|install-cli> [options]');
			process.exitCode = 1;
		}
	} catch (error) {
		console.error(`User journey helper failed: ${error.message}`);
		process.exitCode = 1;
	}
}
