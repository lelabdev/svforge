import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { officialBetterAuthRange } from '../scripts/better-auth-version.mjs';

/**
 * #547 — the Better Auth version is owned by the official `sv` add-on now, so
 * the security audit resolves the range from the installed CLI instead of a
 * repository pin.
 */
describe('official better-auth range resolution (#547)', () => {
	it('reads the range declared by the installed sv add-on bundle', () => {
		const root = mkdtempSync(join(tmpdir(), 'sf-sv-range-'));
		try {
			mkdirSync(join(root, 'node_modules', 'sv', 'dist'), { recursive: true });
			writeFileSync(
				join(root, 'node_modules', 'sv', 'dist', 'addons-abc.mjs'),
				'sv.devDependency("better-auth", "^1.6.24");\n'
			);
			expect(officialBetterAuthRange(root)).toBe('^1.6.24');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails loudly when sv is missing or no longer declares the dependency', () => {
		const root = mkdtempSync(join(tmpdir(), 'sf-sv-range-empty-'));
		try {
			expect(() => officialBetterAuthRange(root)).toThrow(/install dependencies/);
			mkdirSync(join(root, 'node_modules', 'sv', 'dist'), { recursive: true });
			writeFileSync(join(root, 'node_modules', 'sv', 'dist', 'addons-abc.mjs'), 'export const x = 1;\n');
			expect(() => officialBetterAuthRange(root)).toThrow(/update scripts\/better-auth-version/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('resolves against the real installed sv in this repository', () => {
		expect(officialBetterAuthRange(process.cwd())).toMatch(/^[\^~]?\d+\.\d+\.\d+/);
	});
});
