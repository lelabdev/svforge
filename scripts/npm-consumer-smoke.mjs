#!/usr/bin/env node
/**
 * Install the exact release-plan versions in a clean consumer and compile
 * imports for every package through its declared TypeScript entry point.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

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

export function runConsumerSmoke(plan, npm = 'npm', { registryOnly = false } = {}) {
	const consumerRoot = mkdtempSync(join(tmpdir(), 'svforge-consumer-'));
	try {
		writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
		const exactPackages = consumerInstallSpecs(plan, { registryOnly });
		// TypeScript is a test-only dependency of the clean consumer. Stable
		// packages remain exact registry versions; canary snapshots may be
		// supplied as the exact npm tarballs that will be published.
		execFileSync(npm, ['install', '--ignore-scripts', '--no-package-lock', '--no-save', 'typescript@6.0.3', ...exactPackages], {
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
			runConsumerSmoke(JSON.parse(readFileSync(resolve(planPath), 'utf8')), 'npm', { registryOnly });
		} catch (error) {
			console.error(`Consumer smoke test failed: ${error.message}`);
			process.exitCode = 1;
		}
	}
}
