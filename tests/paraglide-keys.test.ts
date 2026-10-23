import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SCAFFOLD_LOCALES } from '../packages/svforge/src/i18n';

const ROOT = process.cwd();

/**
 * Paraglide key freshness (#271). svelte-check fails when a template calls
 * `m.some_key()` that no catalog declares. Templates are static (keys are
 * literal), so a regex scan is reliable — the guard runs on the base and
 * dashboard template sources whenever the detection is unambiguous.
 */

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (full.endsWith('.svelte') || full.endsWith('.ts')) out.push(full);
	}
	return out;
}

const TEMPLATE_ROOTS = [
	'packages/svforge/templates/base/src',
	'packages/svforge/templates/dashboard/src'
];

function usedKeys(): Set<string> {
	const keys = new Set<string>();
	for (const root of TEMPLATE_ROOTS) {
		if (!existsSync(join(ROOT, root))) continue;
		for (const file of walk(join(ROOT, root))) {
			const src = readFileSync(file, 'utf-8');
			// Literal m.<key>() / m.<key> usages in templates (static).
			for (const match of src.matchAll(/\bm\.([a-z][a-z0-9_]*)\b/g)) {
				keys.add(match[1]);
			}
		}
	}
	return keys;
}

describe('Paraglide key freshness (#271)', () => {
	it('every m.*() key used by base+dashboard templates exists in fr.json', () => {
		const catalog = JSON.parse(
			readFileSync(join(ROOT, 'packages/svforge/templates/base/root/messages/fr.json'), 'utf-8')
		);
		const missing = [...usedKeys()].filter((k) => !(k in catalog));
		expect(missing).toEqual([]);
	});

	it('every m.*() key used by base+dashboard templates exists in en.json', () => {
		const catalog = JSON.parse(
			readFileSync(join(ROOT, 'packages/svforge/templates/base/root/messages/en.json'), 'utf-8')
		);
		const missing = [...usedKeys()].filter((k) => !(k in catalog));
		expect(missing).toEqual([]);
	});

	it('FR and EN catalogs expose the same key set (parity)', () => {
		const fr = JSON.parse(
			readFileSync(join(ROOT, 'packages/svforge/templates/base/root/messages/fr.json'), 'utf-8')
		);
		const en = JSON.parse(
			readFileSync(join(ROOT, 'packages/svforge/templates/base/root/messages/en.json'), 'utf-8')
		);
		const frKeys = new Set(Object.keys(fr).filter((k) => k !== '$schema'));
		const enKeys = new Set(Object.keys(en).filter((k) => k !== '$schema'));
		expect([...frKeys].filter((k) => !enKeys.has(k))).toEqual([]);
		expect([...enKeys].filter((k) => !frKeys.has(k))).toEqual([]);
	});

	it('catalog key parity holds for EVERY scaffolded locale (#322, #547)', () => {
		const keySets = [...SCAFFOLD_LOCALES].map((locale) => {
			const catalog = JSON.parse(
				readFileSync(join(ROOT, `packages/svforge/templates/base/root/messages/${locale}.json`), 'utf-8')
			);
			return Object.keys(catalog).filter((k) => !k.startsWith('$')).sort().join('|');
		});
		expect(new Set(keySets).size).toBe(1);
	});

	it('dashboard templates contain no hard-coded UI copy (#267)', () => {
		// Known English UI strings from the pre-#267 dashboard must never come
		// back as literals in dashboard template sources — copy goes through
		// Paraglide (m.*). Server data (fail() messages) is out of scope.
		const dashRoot = join(ROOT, 'packages/svforge/templates/dashboard/src');
		const sentinels = [
			'Add User',
			'Welcome back',
			'Sign in to your account',
			'Create Admin',
			'Update Password',
			'Toggle sidebar',
			'No users found',
			'Manage Users',
			'Recent Users'
		];
		const offenders: string[] = [];
		for (const file of walk(dashRoot)) {
			const src = readFileSync(file, 'utf-8').replace(/<!--[\s\S]*?-->/g, '');
			for (const s of sentinels) if (src.includes(s)) offenders.push(`${file}: ${s}`);
		}
		expect(offenders).toEqual([]);
	});
});
