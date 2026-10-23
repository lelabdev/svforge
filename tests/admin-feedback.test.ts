import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { patchHooksServer } from '../packages/svforge/src/modes/dashboard';
import { OFFICIAL_FOUNDATION_FILES } from './helpers/official-foundation';

const ROOT = process.cwd();
const USERS_PAGE = join(
	ROOT,
	'packages/svforge/templates/dashboard/src/routes/(app)/admin/users/+page.svelte'
);
const USERS_SERVER = join(
	ROOT,
	'packages/svforge/templates/dashboard/src/routes/(app)/admin/users/+page.server.ts'
);
const LOGIN_SERVER = join(ROOT, 'packages/svforge/templates/dashboard/src/routes/login/+page.server.ts');
const SETTINGS_SERVER = join(
	ROOT,
	'packages/svforge/templates/dashboard/src/routes/(app)/admin/settings/+page.server.ts'
);
const SETUP_SERVER = join(ROOT, 'packages/svforge/templates/dashboard/src/routes/setup/+page.server.ts');
const LAYOUT = join(ROOT, 'packages/svforge/templates/dashboard/src/routes/(app)/+layout.svelte');

/**
 * Regression guards for #188 + #196.
 *
 * #188: SvelteKit action responses are `{ type, data }` — the message lives at
 * result.data.message, not result.message. Also: never leak e.message to the UI
 * (generic message instead); toggleVerify must have an error branch.
 *
 * #196: Svelte 5 runes — $app/stores is the legacy store form; $app/state is
 * the modern equivalent (no $ prefix on access).
 */
describe('admin action feedback (#188)', () => {
	const page = readFileSync(USERS_PAGE, 'utf-8');

	it('uses real SvelteKit form actions with use:enhance, never fetch().json() (#295)', () => {
		// #295: the golden reference — mutations are <form method="POST"> + use:enhance.
		expect(page).toMatch(/use:enhance=\{submitEnhance\}/);
		expect(page).toMatch(/method="POST"/);
		expect(page).toMatch(/action=\{modal === 'create' \? '\?\/create' : '\?\/update'\}/);
		expect(page).not.toMatch(/res\.json\(\)/);
		expect(page).not.toMatch(/fetch\('\?\/create'/);
	});

	it('maps stable server codes to Paraglide copy (no English UI strings) (#295)', () => {
		expect(page).toMatch(/function feedbackFor\(code: string \| undefined, isError: boolean\)/);
		expect(page).toMatch(/m\.users_email_exists\(\)/);
		expect(page).toMatch(/m\.users_email_taken\(\)/);
		expect(page).toMatch(/m\.users_self_deactivate\(\)/);
		expect(page).toMatch(/m\.users_not_found\(\)/);
		expect(page).toMatch(/m\.users_invalid_input\(\)/);
		expect(page).toMatch(/m\.users_verify_failed\(\)/);
	});

	it('toggleVerify is a real form action with hidden inputs (#295)', () => {
		expect(page).toMatch(/action="\?\/toggleVerify"/);
		expect(page).toMatch(/name="verified"/);
	});

	it('the server returns stable codes, never English copy (#295)', () => {
		const server = readFileSync(USERS_SERVER, 'utf-8');
		expect(server).not.toMatch(/message: `User \$\{name\} created`/);
		expect(server).not.toMatch(/'Email already exists'/);
		expect(server).toMatch(/code: 'email_exists'/);
		expect(server).toMatch(/code: 'created'/);
		expect(server).toMatch(/code: 'self_deactivate'/);
	});

	it('never exposes raw e.message to the UI (server actions)', () => {
		for (const f of [USERS_SERVER, LOGIN_SERVER, SETTINGS_SERVER, SETUP_SERVER]) {
			const src = readFileSync(f, 'utf-8');
			// e.message may appear in comments only; the actual catch must use
			// a generic message.
			const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
			expect(code, f).not.toMatch(/e\.message/);
			expect(code, f).not.toMatch(/instanceof Error \?/);
		}
	});
});

describe('auth hooks composition (#268 screenshots regression)', () => {
	it('hooks.server.ts composes better-auth inside the paraglide transform — locals.session must be populated', () => {
		// Found while capturing dashboard screenshots: `handle = handleParaglide`
		// meant better-auth never ran, so locals.session/locals.user were always
		// undefined and every protected route redirected to /login. #280 keeps
		// the session population inside the single composed handle, after the
		// paraglide request rewrite and before svelteKitHandler resolution.
		// #547: the official Better Auth add-on owns hooks.server.ts; SVForge
		// composes Paraglide and its disabled-identity guard around it.
		const hooks = patchHooksServer(OFFICIAL_FOUNDATION_FILES['src/hooks.server.ts']);
		expect(hooks).toContain('paraglideMiddleware(event.request');
		expect(hooks).toContain('svelteKitHandler({');
		expect(hooks).toContain('auth.api.getSession');
		expect(hooks).toContain('locals.session');
		expect(hooks).toContain('locals.user');
		expect(hooks).toContain('sequence(handleParaglide, handleBetterAuth, handleSvforgePolicy)');
	});
});

describe('PostgreSQL-safe dashboard queries (#268 regression)', () => {
	it('admin stats never interpolate raw Date.now() into SQL', () => {
		// Found while capturing screenshots: `expires_at > ${Date.now()}` sends a
		// bigint against a timestamptz column — PostgreSQL rejects it and the
		// dashboard 500s after login. Use now() / now() - interval.
		const page = readFileSync(join(ROOT, 'packages/svforge/templates/dashboard/src/routes/(app)/admin/+page.server.ts'), 'utf-8');
		expect(page).not.toMatch(/Date\.now\(\)/);
		expect(page).toMatch(/expires_at > now\(\)/);
		expect(page).toMatch(/created_at > now\(\) - interval '7 days'/);
	});
});

describe('Svelte 5 $app/state (#196)', () => {
	it('no $app/stores imports remain in the dashboard template', () => {
		const files = [USERS_PAGE, LAYOUT];
		for (const f of files) {
			expect(readFileSync(f, 'utf-8'), f).not.toMatch(/from '\$app\/stores'/);
		}
	});

	it('page is accessed without the $ store prefix', () => {
		const page = readFileSync(USERS_PAGE, 'utf-8');
		expect(page).toMatch(/\$app\/state/);
		expect(page).not.toMatch(/\$page\./);
	});
});
