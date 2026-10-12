#!/usr/bin/env node
/**
 * Install the exact release-plan versions in a clean consumer and compile
 * imports for every package through its declared TypeScript entry point.
 */
import { execFileSync } from 'node:child_process';
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
 * @param {{packages: Array<{name: string, version: string, tarball?: string}>}} plan
 * @param {{
 *  registryOnly?: boolean, maxAttempts?: number, intervalMs?: number,
 *  probe?: (spec: string) => boolean | Promise<boolean>,
 *  pause?: (ms: number) => Promise<unknown>
 * }} [options]
 */
export async function waitForRegistryAvailability(plan, {
	registryOnly = false,
	maxAttempts = 60,
	intervalMs = 10000,
	probe = registryVersionVisible,
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
			throw new Error(`npm registry propagation timed out after ${maxAttempts} checks: ${missing.join(', ')}`);
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
