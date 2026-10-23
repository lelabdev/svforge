#!/usr/bin/env node
/**
 * Resolve the Better Auth range declared by the INSTALLED official `sv` add-on.
 *
 * #547: SVForge no longer pins Better Auth — the official `sv add better-auth`
 * integration owns the package and its version. The security audit must
 * therefore resolve the range the published CLI actually scaffolds, not a
 * repository pin.
 *
 * Usage: node scripts/better-auth-version.mjs   (prints the range)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} [root] repository root containing node_modules/sv
 * @returns {string} the better-auth range, e.g. "^1.6.24"
 */
export function officialBetterAuthRange(root = process.cwd()) {
	const distDir = join(resolve(root), 'node_modules', 'sv', 'dist');
	let entries;
	try {
		entries = readdirSync(distDir).filter((name) => name.startsWith('addons-') && name.endsWith('.mjs'));
	} catch {
		throw new Error('Cannot read the installed `sv` add-on bundle: install dependencies first (bun install).');
	}
	for (const entry of entries) {
		const source = readFileSync(join(distDir, entry), 'utf8');
		const match = source.match(/sv\.devDependency\(\s*["']better-auth["']\s*,\s*["']([^"']+)["']\s*\)/);
		if (match) return match[1];
	}
	throw new Error('The installed `sv` package no longer declares a better-auth dependency in its add-ons; update scripts/better-auth-version.mjs.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	console.log(officialBetterAuthRange());
}
