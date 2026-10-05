import { describe, expect, it } from 'vitest';
import { mergeSvelteKitEnvVars } from '../packages/addon-kit/src/env';

describe('SvelteKit environment declarations for modules', () => {
	it('creates an optional environment manifest for a project without src/env.ts', () => {
		expect(mergeSvelteKitEnvVars(undefined, { RESEND_API_KEY: 'Resend API key' })).toContain(
			"RESEND_API_KEY: { description: \"Resend API key\", schema: (value) => value }"
		);
	});

	it('adds missing optional variables without losing existing declarations and is idempotent', () => {
		const existing = [
			"import { defineEnvVars } from '@sveltejs/kit/env';",
			'export const variables = defineEnvVars({',
			"\tDATABASE_URL: { description: 'Database URL' },",
			'});',
			''
		].join('\n');
		const once = mergeSvelteKitEnvVars(existing, {
			DATABASE_URL: 'Database URL',
			RESEND_API_KEY: 'Resend API key'
		});

		expect(once).toContain("DATABASE_URL: { description: 'Database URL' }");
		expect(once).toContain('RESEND_API_KEY:');
		expect(mergeSvelteKitEnvVars(once, { RESEND_API_KEY: 'Resend API key' })).toBe(once);
	});

	it('fails closed when an existing env module cannot be safely merged', () => {
		expect(() => mergeSvelteKitEnvVars('export const variables = {};', { RESEND_API_KEY: 'Resend API key' })).toThrow(
			/defineEnvVars/
		);
	});
});
