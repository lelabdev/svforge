#!/usr/bin/env node
/**
 * Trace WHY a test demands every workspace's built output (#656).
 *
 * Prints the exact chain `test → helper(s) → file and instruction responsible`
 * so a dependency can be bounded on evidence instead of on a file name.
 *
 *   node scripts/trace-dist-requirements.mjs tests/base-vitest.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkspaces, distRequirementsForSource, declaresNoBuiltArtifacts, localImportSpecifiers, resolveLocalImport } from './affected-scope.mjs';

const root = process.cwd();
const workspaces = loadWorkspaces(root);

function offendingLine(source, reason) {
	if (reason.startsWith('dynamic import')) {
		const match = source.match(/\b(?:import|require)\(\s*[^'"`)\s][^\n]{0,60}/);
		return match?.[0].replace(/\s+/g, ' ');
	}
	if (reason.startsWith('subprocess')) {
		const match = source.match(/(?:execFileSync|execSync|spawnSync|spawn|exec)\([^\n]{0,80}/);
		return match?.[0].replace(/\s+/g, ' ');
	}
	if (reason.startsWith('conditional')) {
		const match = source.match(/existsSync\([^\n]{0,70}/);
		return match?.[0].replace(/\s+/g, ' ');
	}
	const match = source.match(/dist[^\n]{0,60}/);
	return match?.[0]?.trim();
}

const seen = new Set();

function trace(relativePath, chain) {
	if (seen.has(relativePath)) return false;
	seen.add(relativePath);
	const source = readFileSync(join(root, relativePath), 'utf8');
	if (declaresNoBuiltArtifacts(source)) {
		console.log(`  ${[...chain, relativePath].join(' → ')}  (declares @no-built-artifacts)`);
		return false;
	}
	const own = distRequirementsForSource(source, workspaces);
	if (own.kind === 'all') {
		console.log(`  ${[...chain, relativePath].join(' → ')}`);
		console.log(`      reason: ${own.reason}`);
		console.log(`      instruction: ${offendingLine(source, own.reason)}`);
		return true;
	}
	let found = false;
	for (const specifier of localImportSpecifiers(source)) {
		const resolved = resolveLocalImport(root, relativePath, specifier);
		if (!resolved) continue;
		if (trace(resolved, [...chain, relativePath])) found = true;
	}
	return found;
}

for (const file of process.argv.slice(2)) {
	console.log(`\n${file}`);
	if (!trace(file, [])) console.log('  bounded (no unbounded dependency found)');
}
