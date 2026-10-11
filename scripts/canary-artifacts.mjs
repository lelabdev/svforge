#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** Pack only immutable snapshot candidates and pin each tarball into the consumer plan. */
export function packCanaryCandidates(plan, root, outputDir, pack = defaultPack) {
	if (!Array.isArray(plan.candidates) || !plan.candidates.length) {
		throw new Error('Canary artifacts: release plan has no snapshot candidates.');
	}
	mkdirSync(outputDir, { recursive: true });
	const paths = new Map();
	for (const candidate of plan.candidates) {
		if (candidate.snapshot !== true) throw new Error(`Canary artifacts: ${candidate.name} is not marked as a snapshot candidate.`);
		const path = resolve(root, candidate.directory);
		const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
		if (manifest.name !== candidate.name || manifest.version !== candidate.version || manifest.private === true) {
			throw new Error(`Canary artifacts: ${candidate.name}@${candidate.version} does not match its publishable package manifest.`);
		}
		const result = pack(path, outputDir);
		if (result.name !== candidate.name || result.version !== candidate.version || typeof result.filename !== 'string') {
			throw new Error(`Canary artifacts: npm pack returned unexpected metadata for ${candidate.name}@${candidate.version}.`);
		}
		const tarball = isAbsolute(result.filename) ? result.filename : join(outputDir, result.filename);
		if (!existsSync(tarball)) throw new Error(`Canary artifacts: packed tarball is missing: ${tarball}.`);
		paths.set(candidate.name, tarball);
	}
	const packedPlan = {
		...plan,
		packages: plan.packages.map((pkg) => paths.has(pkg.name) ? { ...pkg, tarball: paths.get(pkg.name) } : pkg),
		candidates: plan.candidates.map((pkg) => ({ ...pkg, tarball: paths.get(pkg.name) }))
	};
	return packedPlan;
}

function defaultPack(packageDir, outputDir) {
	const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir], {
		cwd: packageDir,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		env: { ...process.env, npm_config_ignore_scripts: 'true' }
	});
	const result = JSON.parse(output)[0];
	return { name: result.name, version: result.version, filename: result.filename };
}

export function writeCanaryPlan(plan, path) {
	writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const value = (name) => {
		const index = args.indexOf(`--${name}`);
		return index === -1 ? undefined : args[index + 1];
	};
	const planPath = value('plan');
	const root = resolve(value('root') ?? process.cwd());
	const outputDir = resolve(value('output') ?? '/tmp/canary-tarballs');
	if (args[0] !== 'pack' || !planPath) {
		console.error('Usage: node scripts/canary-artifacts.mjs pack --plan <path> [--root <dir>] [--output <dir>]');
		process.exitCode = 1;
	} else {
		try {
			const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
			const packed = packCanaryCandidates(plan, root, outputDir);
			writeCanaryPlan(packed, resolve(planPath));
			console.log(`Packed ${packed.candidates.length} canary artifact(s) into ${outputDir}.`);
		} catch (error) {
			console.error(`Canary artifact packing failed: ${error.message}`);
			process.exitCode = 1;
		}
	}
}
