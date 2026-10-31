#!/usr/bin/env node
/**
 * Install the exact release-plan versions in a clean consumer and compile
 * imports for every package through its declared TypeScript entry point.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

export function packageTypePath(manifest) {
	const rootExport = manifest.exports?.['.'] ?? manifest.exports;
	if (rootExport && typeof rootExport === 'object' && typeof rootExport.types === 'string') return rootExport.types;
	if (typeof manifest.types === 'string') return manifest.types;
	return null;
}

export function validateInstalledTypes(plan, consumerRoot) {
	const missing = [];
	for (const pkg of plan.packages) {
		const packageRoot = join(consumerRoot, 'node_modules', ...pkg.name.split('/'));
		const manifestPath = join(packageRoot, 'package.json');
		if (!existsSync(manifestPath)) {
			missing.push(`${pkg.name}: package.json is missing`);
			continue;
		}
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		const typePath = packageTypePath(manifest);
		if (!typePath || !existsSync(join(packageRoot, typePath.replace(/^\.\//, '')))) {
			missing.push(`${pkg.name}: declared TypeScript entry point is missing`);
		}
	}
	return missing;
}

/** Generate imports so TypeScript must resolve every package's public entry point. */
export function consumerSource(plan) {
	return `${plan.packages.map((pkg, index) => [
		`import * as package${index} from ${JSON.stringify(pkg.name)};`,
		`void package${index};`
	].join('\n')).join('\n')}\n`;
}

export function consumerInstallSpecs(plan, { registryOnly = false } = {}) {
	return plan.packages.map((pkg) => {
		if (pkg.tarball && !registryOnly) {
			if (!pkg.snapshot || typeof pkg.tarball !== 'string') {
				throw new Error(`Consumer plan: only a snapshot package may use a local tarball (${pkg.name}).`);
			}
			return pkg.tarball;
		}
		return `${pkg.name}@${pkg.version}`;
	});
}

export function consumerTsConfig() {
	return {
		compilerOptions: {
			module: 'NodeNext',
			moduleResolution: 'NodeNext',
			target: 'ES2022',
			strict: true,
			noEmit: true,
			skipLibCheck: true
		},
		files: ['consumer.ts']
	};
}

export function runTypecheck(consumerRoot, tsc = join(consumerRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')) {
	try {
		execFileSync(tsc, ['--noEmit', '--project', join(consumerRoot, 'tsconfig.json'), '--pretty', 'false'], {
			cwd: consumerRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			encoding: 'utf8'
		});
	} catch (error) {
		const output = [error.stdout, error.stderr]
			.filter(Boolean)
			.map((value) => value.toString().trim())
			.filter(Boolean)
			.join('\n');
		throw new Error(`TypeScript consumer resolution failed:\n${output || error.message}`, { cause: error });
	}
}

/**
 * npm may return a stale registry view immediately after Changesets publishes.
 * Only an exact missing version is retryable; auth, network, and parsing errors
 * remain fatal so the gate does not conceal broken releases.
 */
export function registryVersionVisible(spec, npm = 'npm', run = execFileSync) {
	// An earlier preflight may have cached a negative npm metadata lookup before
	// Changesets published the version. A new cache per probe guarantees that
	// repeating `npm view` does not just reread the same stale local response.
	const cacheDir = mkdtempSync(join(tmpdir(), 'svforge-registry-probe-'));
	try {
		const output = run(npm, ['view', spec, 'version', '--json', '--prefer-online', '--cache', cacheDir], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const observed = JSON.parse(String(output).trim());
		const expected = spec.slice(spec.lastIndexOf('@') + 1);
		if (observed === expected) return true;
		console.log(`Registry not ready for ${spec}: npm view returned ${JSON.stringify(observed).slice(0, 250)}`);
		return false;
	} catch (error) {
		const details = [error?.stderr, error?.stdout, error?.message].filter(Boolean).map(String).join('\n');
		if (/\b(?:E404|ETARGET)\b|404 Not Found|No matching version found|No match found for version/i.test(details)) {
			console.log(`Registry not ready for ${spec}: npm view reported E404/ETARGET`);
			return false;
		}
		throw new Error(`Registry lookup failed for ${spec}: ${details.slice(0, 700)}`, { cause: error });
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
}

/**
 * The exact published TARBALL must be fetchable, not just the version metadata
 * (#628): npm exposed `svforge@2.2.5` metadata while `svforge-2.2.5.tgz` still
 * answered 404, and the consumer gate failed on a release that was already
 * published.
 *
 * Retry ONLY a verified 404/410 of the EXPECTED tarball resolved from the
 * registry metadata. A checksum mismatch, a non-gzip artifact, an unexpected
 * HTTP status, or a network/auth error stays fatal: those mean the published
 * artifact is broken, not that propagation is still in flight.
 */
export async function tarballAvailable(spec, npm = 'npm', { run = execFileSync, fetchImpl = fetch } = {}) {
	const cacheDir = mkdtempSync(join(tmpdir(), 'svforge-tarball-probe-'));
	let metadata;
	try {
		const output = run(
			npm,
			['view', spec, 'dist.tarball', 'dist.integrity', '--json', '--prefer-online', '--cache', cacheDir],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
		);
		metadata = JSON.parse(String(output).trim());
	} catch (error) {
		const details = [error?.stderr, error?.stdout, error?.message].filter(Boolean).map(String).join('\n');
		if (/\b(?:E404|ETARGET)\b|404 Not Found|No matching version found|No match found for version/i.test(details)) {
			console.log(`Registry not ready for ${spec}: npm view reported E404/ETARGET`);
			return false;
		}
		throw new Error(`Registry lookup failed for ${spec}: ${details.slice(0, 700)}`, { cause: error });
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}

	const url = metadata?.['dist.tarball'];
	const integrity = metadata?.['dist.integrity'];
	if (typeof url !== 'string' || !url) {
		throw new Error(`Registry metadata for ${spec} has no dist.tarball; refusing to guess a tarball URL.`);
	}
	if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) {
		throw new Error(`Registry metadata for ${spec} has no valid sha512 dist.integrity; refusing an unverified tarball.`);
	}

	let response;
	try {
		response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
	} catch (error) {
		throw new Error(`Tarball fetch failed for ${spec} (${url}): ${error?.message ?? error}`, { cause: error });
	}
	if (response.status === 404 || response.status === 410) {
		console.log(`Registry not ready for ${spec}: tarball ${url} returned HTTP ${response.status}`);
		return false;
	}
	if (!response.ok) {
		throw new Error(`Tarball fetch for ${spec} returned HTTP ${response.status} (${url})`);
	}

	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
		throw new Error(`Tarball for ${spec} is not a gzip artifact (${bytes.length} bytes from ${url}).`);
	}
	const digest = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
	if (digest !== integrity) {
		throw new Error(`Tarball integrity mismatch for ${spec}: registry ${integrity}, downloaded ${digest}.`);
	}
	try {
		gunzipSync(bytes);
	} catch (error) {
		throw new Error(`Tarball for ${spec} has an invalid gzip payload (${url}).`, { cause: error });
	}
	return true;
}

/**
 * Version metadata AND its exact tarball must be consumable before installing.
 *
 * @param {string} spec
 * @param {string} [npm]
 * @param {{ run?: typeof execFileSync, fetchImpl?: typeof fetch }} [options]
 */
export async function registryReleaseConsumable(spec, npm = 'npm', options = {}) {
	if (!registryVersionVisible(spec, npm, options.run ?? execFileSync)) return false;
	return tarballAvailable(spec, npm, options);
}

/**
 * @param {{packages: Array<{name: string, version: string, tarball?: string}>}} plan
 * @param {{
 *  registryOnly?: boolean, maxAttempts?: number, intervalMs?: number,
 *  probe?: (spec: string) => boolean | Promise<boolean>,
 *  pause?: (ms: number) => Promise<unknown>
 * }} [options]
 */
/** npm publish-time malware scanning can delay public availability 15+ minutes. */
export const REGISTRY_AVAILABILITY_MAX_ATTEMPTS = 180;

export async function waitForRegistryAvailability(plan, {
	registryOnly = false,
	maxAttempts = REGISTRY_AVAILABILITY_MAX_ATTEMPTS,
	intervalMs = 10000,
	probe = registryReleaseConsumable,
	pause = sleep
} = {}) {
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be positive.');
	const publishedSpecs = plan.packages
		.filter((pkg) => registryOnly || !pkg.tarball)
		.map((pkg) => `${pkg.name}@${pkg.version}`);
	let pending = publishedSpecs;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const missing = [];
		for (const spec of pending) {
			if (!(await probe(spec))) missing.push(spec);
		}
		if (missing.length === 0) return;
		if (attempt === maxAttempts) {
			throw new Error(`npm registry propagation timed out after ${maxAttempts} checks: ${missing.join(', ')}. ` +
					'Changesets publishing may have succeeded while npm publish-time scanning is still pending, held for manual review, or blocked. ' +
					'Check each exact package version in npmjs.com Versions/Staged Packages and any maintainer notifications before retrying the same approved release; do not bump versions.');
		}
		console.log(`Waiting for npm registry propagation (check ${attempt}/${maxAttempts}): ${missing.join(', ')}`);
		await pause(intervalMs);
		pending = missing;
	}
}

export function runConsumerSmoke(plan, npm = 'npm', { registryOnly = false } = {}) {
	const consumerRoot = mkdtempSync(join(tmpdir(), 'svforge-consumer-'));
	try {
		writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
		const exactPackages = consumerInstallSpecs(plan, { registryOnly });
		// TypeScript is a test-only dependency of the clean consumer. Stable
		// packages remain exact registry versions; canary snapshots may be
		// supplied as the exact npm tarballs that will be published.
		execFileSync(npm, ['install', '--ignore-scripts', '--no-package-lock', '--no-save', '--prefer-online', '--cache', join(consumerRoot, '.npm-cache'), 'typescript@6.0.3', ...exactPackages], {
			cwd: consumerRoot,
			stdio: 'inherit'
		});
		const missing = validateInstalledTypes(plan, consumerRoot);
		if (missing.length) throw new Error(`Consumer type smoke test failed:\n- ${missing.join('\n- ')}`);
		writeFileSync(join(consumerRoot, 'consumer.ts'), consumerSource(plan));
		writeFileSync(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify(consumerTsConfig(), null, 2)}\n`);
		runTypecheck(consumerRoot);
		console.log(`Consumer smoke test OK for ${plan.packages.length} package(s).`);
	} finally {
		rmSync(consumerRoot, { recursive: true, force: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const planFlagIndex = process.argv.indexOf('--plan');
	const planPath = planFlagIndex === -1 ? null : process.argv[planFlagIndex + 1];
	const registryOnly = process.argv.includes('--registry-only');
	if (!planPath) {
		console.error('Usage: node scripts/npm-consumer-smoke.mjs --plan <release-plan.json> [--registry-only]');
		process.exitCode = 1;
	} else {
		try {
			const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
			if (process.argv.includes('--wait-for-registry')) {
				await waitForRegistryAvailability(plan, { registryOnly });
			}
			runConsumerSmoke(plan, 'npm', { registryOnly });
		} catch (error) {
			console.error(`Consumer smoke test failed: ${error.message}`);
			process.exitCode = 1;
		}
	}
}
