/**
 * Test script: simulates sv add by copying template files to a directory.
 * Dashboard mode = base first, then fullstack overlay on top.
 * Usage: bun scripts/test-local.ts [mode] [output-dir]
 *   mode: base (default) or fullstack
 *   output-dir: target directory (default: /tmp/sf-test)
 */
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';

const mode = process.argv[2] || 'base';
const output = process.argv[3] || '/tmp/sf-test';
const templatesDir = join(import.meta.dirname, '..', 'templates');

console.log(`🧪 SvelteForge test — mode: ${mode}, output: ${output}`);

// Clean output
if (existsSync(output)) rmSync(output, { recursive: true });
mkdirSync(output, { recursive: true });

// Copy a template directory recursively into output
function copyDir(src: string, dest: string) {
	const items = execSync(`find "${src}" -type f`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
	let count = 0;
	for (const item of items) {
		const relative = item.slice(src.length + 1);
		const target = join(dest, relative);
		mkdirSync(dirname(target), { recursive: true });

		const content = execSync(`cat "${item}"`, { encoding: 'utf-8' });
		writeFileSync(target, content);
		count++;
	}
	return count;
}

// Always copy base first
let count = copyDir(join(templatesDir, 'base'), output);

// For fullstack, overlay on top of base
if (mode === 'dashboard') {
	count += copyDir(join(templatesDir, 'dashboard'), output);

	// Check the generated root-file manifest, not just the raw template tree:
	// prebuild must embed the workflow so real dashboard scaffolds receive it.
	const { dashboardRootFiles } = await import('../src/templates');
	const workflow = dashboardRootFiles['/.github/workflows/ci.yml'];
	if (!workflow) throw new Error('Dashboard CI workflow missing from generated root-file manifest.');
	for (const required of [
		'pull_request:',
		'push:',
		'bun install',
		'bun run check',
		'bun run test',
		'bun run build',
		'DATABASE_URL:',
		'TEST_DATABASE_URL:',
		'BETTER_AUTH_SECRET:',
		'image: postgres:17',
		'bunx drizzle-kit push --force'
	]) {
		if (!workflow.includes(required)) {
			throw new Error(`Dashboard CI workflow is missing required content: ${required}`);
		}
	}
	console.log('✅ Dashboard CI workflow present in generated root-file manifest');
}

console.log(`\n✅ ${count} files written to ${output}`);
console.log(`\nNext steps:`);
console.log(`  cd ${output}`);
console.log(`  bun install`);
console.log(`  bun dev`);
