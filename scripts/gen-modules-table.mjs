#!/usr/bin/env node
// Generate the Modules + Presets markdown tables for the published package README from the
// machine-readable contract (svforge-modules.json, #236) so the docs can never
// drift from what SvelteForge actually installs (#257).
//
// Usage: node scripts/gen-modules-table.mjs   (prints the markdown block)
//        node scripts/gen-modules-table.mjs --write  (updates packages/svforge/README.md)
//        node scripts/gen-modules-table.mjs --write README.md  (select another target)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const manifest = JSON.parse(
	readFileSync(join(ROOT, 'packages/svforge/templates/base/root/svforge-modules.json'), 'utf-8')
);

const REQ_LABEL = { base: 'base', dashboard: '**dashboard**' };

function modulesTable() {
	const rows = Object.values(manifest.modules).map((m) => {
		const req = m.requires.map((r) => REQ_LABEL[r] ?? r).join(', ');
		const opt = m.optional.length > 0 ? m.optional.join(', ') : '—';
		return `| \`@svforge/${m.id}\` | ${m.description} | ${req} | ${opt} |`;
	});
	return [
		'| Package | What it adds | Requires | Optional integrations |',
		'|---------|--------------|----------|----------------------|',
		...rows
	].join('\n');
}

function presetsTable() {
	const rows = Object.entries(manifest.presets).map(([name, p]) => {
		const req = p.requires.map((r) => REQ_LABEL[r] ?? r).join(', ');
		const opt = p.optional.length > 0 ? ` (optional: ${p.optional.join(', ')})` : '';
		return `| \`${name}\` | ${p.description} | ${req} | ${p.modules.join(' + ')}${opt} |`;
	});
	return [
		'| Preset | Description | Requires | Composition |',
		'|--------|-------------|----------|-------------|',
		...rows
	].join('\n');
}

const modulesBlock = `<!-- MODULES-TABLE:START -->
${modulesTable()}
<!-- MODULES-TABLE:END -->`;

const presetsBlock = `<!-- PRESETS-TABLE:START -->
${presetsTable()}
<!-- PRESETS-TABLE:END -->`;

if (process.argv.includes('--write')) {
	const target = process.argv[process.argv.indexOf('--write') + 1];
	const readmePath = target ? join(ROOT, target) : join(ROOT, 'packages/svforge/README.md');
	let readme = readFileSync(readmePath, 'utf-8');

	function replaceBlock(readme, block) {
		const marker = block.split('\n')[0];
		const endMarker = marker.replace('START', 'END');
		const start = readme.indexOf(marker);
		const end = readme.indexOf(endMarker);
		if (start === -1 || end === -1) {
			console.error(`README.md is missing ${marker}`);
			process.exit(1);
		}
		return readme.slice(0, start) + block + readme.slice(end + endMarker.length);
	}

	readme = replaceBlock(readme, modulesBlock);
	readme = replaceBlock(readme, presetsBlock);
	writeFileSync(readmePath, readme);
	console.log('✅ README.md modules table updated');
} else {
	console.log(modulesBlock + '\n\n' + presetsBlock);
}
