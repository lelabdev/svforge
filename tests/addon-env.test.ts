import { describe, expect, it } from 'vitest';
import { mergeEnvExample, mergeSvelteKitEnvVars } from '../packages/addon-kit/src/env';
import { patchDotEnv } from '../packages/svforge/src/modes/dashboard';
import { OFFICIAL_FOUNDATION_FILES } from './helpers/official-foundation';

// #547: the official integrations own .env.example; SVForge appends its
// SIGNUP_MODE/test-database guidance to it.
const dashboardExample = patchDotEnv(OFFICIAL_FOUNDATION_FILES['.env.example']);
const emailExample = {
	RESEND_API_KEY: { description: 'Resend API key', placeholder: 'your_resend_api_key' }
};
const oauthExample = {
	GOOGLE_CLIENT_ID: { description: 'Google OAuth client ID', placeholder: 'your_google_client_id' },
	GOOGLE_CLIENT_SECRET: { description: 'Google OAuth client secret', placeholder: 'replace_with_google_client_secret' },
	GITHUB_CLIENT_ID: { description: 'GitHub OAuth client ID', placeholder: 'your_github_client_id' },
	GITHUB_CLIENT_SECRET: { description: 'GitHub OAuth client secret', placeholder: 'replace_with_github_client_secret' }
};

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

describe('addon .env.example composition (#422)', () => {
	it('creates a documented placeholder block when the project has no example file', () => {
		const result = mergeEnvExample(undefined, 'email', emailExample);
		expect(result).toContain('# >>> svforge addon: email >>>');
		expect(result).toContain('# Resend API key');
		expect(result).toContain('RESEND_API_KEY=your_resend_api_key');
		expect(result).not.toContain('re_123');
	});

	it('preserves dashboard guidance and composes addon blocks deterministically and idempotently', () => {
		const emailFirst = mergeEnvExample(
			mergeEnvExample(dashboardExample, 'email', emailExample),
			'oauth',
			oauthExample
		);
		const oauthFirst = mergeEnvExample(
			mergeEnvExample(dashboardExample, 'oauth', oauthExample),
			'email',
			emailExample
		);

		expect(emailFirst).toBe(oauthFirst);
		expect(emailFirst.startsWith(dashboardExample.trimEnd())).toBe(true);
		// #547: the official add-ons own the foundation block; SVForge appends
		// its sign-up policy to it.
		expect(emailFirst).toContain('DATABASE_URL="postgres://');
		expect(emailFirst).toContain('SIGNUP_MODE="closed"');
		expect(emailFirst.indexOf('svforge addon: email')).toBeLessThan(emailFirst.indexOf('svforge addon: oauth'));
		expect(emailFirst.match(/^RESEND_API_KEY=/gm)).toHaveLength(1);
		expect(emailFirst.match(/^GOOGLE_CLIENT_SECRET=/gm)).toHaveLength(1);
		expect(mergeEnvExample(emailFirst, 'email', emailExample)).toBe(emailFirst);
	});

	it('rejects duplicate ownership instead of silently emitting an ambiguous variable', () => {
		expect(() =>
			mergeEnvExample('DATABASE_URL=postgres://localhost/app\n', 'email', {
				DATABASE_URL: { description: 'Email database', placeholder: 'your_database_url' }
			})
		).toThrow(/DATABASE_URL.*already defined/);
	});

	it('refuses a non-placeholder value for credential variables', () => {
		expect(() =>
			mergeEnvExample(undefined, 'email', {
				RESEND_API_KEY: { description: 'Resend API key', placeholder: 're_live_actual_credential' }
			})
		).toThrow(/placeholder/);
	});
});
