#!/usr/bin/env node
/**
 * Better Auth manual-bump helper (#319, #460).
 *
 * The scaffold pins better-auth with a concrete tilde range (never `latest`,
 * per #197). Since #460 there is NO autonomous dependency bot: a maintainer
 * bumps the pin in a normal PR and CI validates it (see
 * docs/better-auth-upgrades.md). This module keeps the shared logic the
 * manual bump and the drift tests rely on:
 *
 *   - the LIVE pin reader (`pin`),
 *   - the multi-carrier rewriter (`apply`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files carrying a better-auth stack pin; the manual `apply` rewrites all of them. */
export const PIN_FILES = [
	'packages/svforge/src/modes/dashboard.ts',
	'packages/svforge/templates/dashboard/package.json',
	'tests/helpers/fixtures.ts',
	'tests/doctor.test.ts'
];

/** Extracts every `sv.(dev)Dependency('<pkg>', '<range>')` pin from a source. */
export function readPinnedVersions(source) {
	const pins = [];
	const pattern = /sv\.(?:dev)?[Dd]ependency\(\s*'([^']+)',\s*'([^']+)'\s*\)/g;
	for (const match of source.matchAll(pattern)) {
		if (match[1] !== 'better-auth' && match[1] !== '@better-auth/cli') continue;
		pins.push({ name: match[1], range: match[2], version: match[2].replace(/^[~^]/, '') });
	}
	return pins;
}

/**
 * The LIVE better-auth pin, parsed from the dashboard mode source at call
 * time (#319 review): any prose claiming a "current pin" goes stale after
 * the pin changes — this never does. Fails loudly when the pin disappears
 * (a silent empty answer would mislead the bump helper).
 */
export function currentPin(root = ROOT) {
	const source = readFileSync(join(root, 'packages/svforge/src/modes/dashboard.ts'), 'utf8');
	const pin = readPinnedVersions(source).find((candidate) => candidate.name === 'better-auth');
	if (!pin) {
		throw new Error('currentPin: no better-auth pin found in packages/svforge/src/modes/dashboard.ts');
	}
	return pin;
}

/**
 * Rewrites the pin of ONE package inside an arbitrary carrier source
 * (sv.dependency call, package.json entry, or TS fixture object).
 * Idempotent: returns the source unchanged when the range already matches.
 * Throws when the package is not declared and `required` is set — a silent
 * no-op would leave one carrier stale while the rest moves.
 */
export function bumpRangeInSource(source, name, version, { required = true } = {}) {
	const nextRange = `~${version}`;

	// Match both styles: sv.dependency('better-auth', '~1.7.3') and
	// "better-auth": "~1.7.3" and { 'better-auth': '~1.7.3' }.
	const patterns = [
		{ pattern: new RegExp(`('${name}',\\s*)'[^']*'`, 'g'), quote: "'" },
		{ pattern: new RegExp(`("${name}"\\s*:\\s*)"[^"]*"`, 'g'), quote: '"' },
		{ pattern: new RegExp(`('${name}'\\s*:\\s*)'[^']*'`, 'g'), quote: "'" }
	];

	let changed = false;
	let out = source;
	for (const { pattern, quote } of patterns) {
		out = out.replace(pattern, (_match, prefix) => {
			changed = true;
			return `${prefix}${quote}${nextRange}${quote}`;
		});
	}
	if (!changed) {
		if (required) {
			throw new Error(`bumpRangeInSource: '${name}' not found in source — refusing to silently skip a pin carrier.`);
		}
		return source;
	}
	return out;
}

/**
 * Rewrites every pin carrier of the repository for the given upgrades.
 *
 * @param {string} root repository root (defaults to this checkout's root)
 * @param {Array<{name: string, version: string}>} upgrades
 * @returns {string[]} the files that were modified
 */
export function applyUpgrades(root = ROOT, upgrades) {
	const changed = [];
	for (const rel of PIN_FILES) {
		const path = join(root, rel);
		let source = readFileSync(path, 'utf8');
		const before = source;
		for (const { name, version } of upgrades) {
			// better-auth must be pinned by EVERY carrier; the CLI is optional
			// (some carriers only pin the runtime package).
			const required = name === 'better-auth';
			source = bumpRangeInSource(source, name, version, { required });
		}
		if (source !== before) {
			writeFileSync(path, source);
			changed.push(rel);
		}
	}
	return changed;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const command = args[0];
	const flag = (name) => {
		const index = args.indexOf(`--${name}`);
		return index === -1 ? undefined : args[index + 1];
	};

	if (command === 'pin') {
		const pin = currentPin(flag('root'));
		console.log(`${pin.name} ${pin.range} (live pin source: packages/svforge/src/modes/dashboard.ts)`);
	} else if (command === 'apply') {
		const root = flag('root') ?? ROOT;
		const upgrades = [];
		const betterAuth = flag('better-auth');
		const cli = flag('cli');
		if (betterAuth) upgrades.push({ name: 'better-auth', version: betterAuth });
		if (cli) upgrades.push({ name: '@better-auth/cli', version: cli });
		if (!upgrades.length) {
			console.error('Usage: better-auth-upgrade.mjs apply [--root DIR] [--better-auth 1.7.4] [--cli 1.4.22]');
			process.exitCode = 1;
		} else {
			const changed = applyUpgrades(root, upgrades);
			for (const file of changed) console.log(`bumped: ${file}`);
			if (!changed.length) console.log('no pin changed — repository already at target version');
		}
	} else {
		console.error('Usage: better-auth-upgrade.mjs pin | apply [--root DIR] [--better-auth VERSION] [--cli VERSION]');
		process.exitCode = 1;
	}
}
