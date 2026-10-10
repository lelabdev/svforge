// @vitest-environment jsdom
/**
 * #420 — dashboard login `use:enhance` contract.
 *
 * `update()` returns `Promise<void>`: the action result (success / failure)
 * only lives on the callback argument. The generated page must therefore read
 * `result.type` from the callback, apply the response with `update()` (so
 * `form` is populated and the `<Feedback>` error shows), and only navigate on
 * a real success.
 *
 * This test mounts the ACTUAL `+page.svelte` shipped by the dashboard template
 * (imports swapped for local stubs, the same technique as web-hardening.test.ts)
 * and drives the captured `use:enhance` callback, so the regression is caught
 * behaviourally instead of by grepping the source.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compile } from 'svelte/compiler';
import { mount, unmount } from 'svelte';
import type { Component } from 'svelte';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LOGIN_PAGE = join(
	ROOT,
	'packages/svforge/templates/dashboard/src/routes/login/+page.svelte'
);
const BASE_WEB = join(ROOT, 'packages/svforge/templates/base/src/lib/utils/web.ts');
const GEN = join(ROOT, 'tests/__gen__');

type LoginProps = { form?: { message?: string } | null };
type SubmitFn = () => (args: { result: unknown; update: unknown }) => Promise<void>;
type FormsState = { submit: SubmitFn | null };

let LoginPage: Component<LoginProps>;
let formsState: FormsState;
let navCalls: string[];
let mounted: Record<string, unknown> | undefined;
let target: HTMLElement;

beforeAll(async () => {
	mkdirSync(GEN, { recursive: true });

	// Bindable UI stubs keep this focused on the generated login form's
	// enhance wiring while still compiling its layout and password snippets.
	const empty = `<script lang="ts">
	let { children, value = $bindable(''), ...rest } = $props();
</script>
<div {...rest}>{@render children?.()}</div>`;
	writeFileSync(
		join(GEN, 'login-harness-empty.js'),
		compile(empty, { generate: 'client', filename: 'Empty.svelte' }).js.code
	);
	writeFileSync(
		join(GEN, 'login-harness-ui.js'),
		`export { default as AuthLayout } from './login-harness-empty.js';\nexport { default as Feedback } from './login-harness-empty.js';`
	);
	writeFileSync(
		join(GEN, 'login-harness-primitives.js'),
		`export { default as Button } from './login-harness-empty.js';\nexport { default as Input } from './login-harness-empty.js';`
	);
	writeFileSync(
		join(GEN, 'login-harness-layout.js'),
		`export { default } from './login-harness-empty.js';`
	);
	writeFileSync(
		join(GEN, 'login-harness-icon.js'),
		`export { default } from './login-harness-empty.js';`
	);
	writeFileSync(
		join(GEN, 'login-harness-messages.js'),
		`export const login_title = () => 'Sign in';
export const login_welcome_back = () => 'Welcome back';
export const login_signin_hint = () => 'Sign in to continue';
export const login_label_email = () => 'Email';
export const login_placeholder_email = () => 'you@example.com';
export const login_label_password = () => 'Password';
export const login_signing_in = () => 'Signing in…';
export const login_sign_in = () => 'Sign in';
export const login_error_invalid_credentials = () => 'Invalid credentials';
export const login_error_invalid_input = () => 'Invalid input';
export const common_error = () => 'Something went wrong';
export const common_show_password = () => 'Show password';
export const common_hide_password = () => 'Hide password';
export const common_workspace = () => 'Workspace';
export const common_workspace_statement = () => 'Your workspace, all in one place.';`
	);
	writeFileSync(join(GEN, 'login-harness-web.ts'), readFileSync(BASE_WEB, 'utf8'));
	// `use:enhance={fn}` compiles to `enhance(formNode, fn)`: the mock captures
	// the component's submit factory so the test can drive it directly.
	writeFileSync(
		join(GEN, 'login-harness-forms.js'),
		`export const state = { submit: null };
export function enhance(_node, submit) {
	state.submit = submit;
	return {};
}`
	);
	writeFileSync(
		join(GEN, 'login-harness-nav.js'),
		`export const calls = [];
export function goto(url) {
	calls.push(url);
}`
	);

	const source = readFileSync(LOGIN_PAGE, 'utf8')
		.replace(/^import type \{ ActionData \} from '\.\/\$types';$/m, '')
		.replace("from '$app/forms'", "from './login-harness-forms.js'")
		.replace("from '$app/navigation'", "from './login-harness-nav.js'")
		.replace("from '$lib/paraglide/messages.js'", "from './login-harness-messages.js'")
		.replace("from '$lib/components/svforge/ui'", "from './login-harness-ui.js'")
		.replace("from '$lib/components/svforge/primitives'", "from './login-harness-primitives.js'")
		.replace(
			"from '$lib/components/svforge/layout/AuthLayout.svelte'",
			"from './login-harness-layout.js'"
		)
		.replace("from 'phosphor-svelte/lib/Eye'", "from './login-harness-icon.js'")
		.replace("from 'phosphor-svelte/lib/EyeSlash'", "from './login-harness-icon.js'")
		.replace("from '$lib/utils/web'", "from './login-harness-web'");
	writeFileSync(
		join(GEN, 'login-harness-page.js'),
		compile(source, { generate: 'client', filename: 'LoginPage.svelte' }).js.code
	);

	const forms = await import(/* @vite-ignore */ join(GEN, 'login-harness-forms.js'));
	const nav = await import(/* @vite-ignore */ join(GEN, 'login-harness-nav.js'));
	formsState = forms.state as FormsState;
	navCalls = nav.calls as string[];
	LoginPage = (await import(/* @vite-ignore */ join(GEN, 'login-harness-page.js'))).default;
});

afterAll(() => {
	rmSync(GEN, { recursive: true, force: true });
});

beforeEach(() => {
	navCalls.length = 0;
	window.history.pushState({}, '', '/login');
	target = document.createElement('div');
	document.body.append(target);
	mounted = mount(LoginPage, { target, props: { form: null } });
});

afterEach(() => {
	if (mounted) unmount(mounted);
	target.remove();
	mounted = undefined;
});

/** Runs the captured submit factory and returns the post-submit callback. */
function postSubmit() {
	if (!formsState.submit) throw new Error('use:enhance did not register a submit handler');
	return formsState.submit();
}

/** Records the calls made by a fake enhance `update`. */
function trackingUpdate() {
	const spy = { calls: 0, last: undefined as unknown };
	const fn = async (options?: { reset?: boolean }) => {
		spy.calls += 1;
		spy.last = options;
	};
	return { spy, fn };
}

describe('dashboard login enhance (#420)', () => {
	it('redirects to /admin after a successful login', async () => {
		await postSubmit()({ result: { type: 'success', data: {} }, update: async () => {} });
		expect(navCalls).toEqual(['/admin']);
	});

	it('applies the action result so failures stay visible (no silent errors)', async () => {
		const { spy, fn } = trackingUpdate();
		await postSubmit()({ result: { type: 'failure', data: { message: 'Invalid credentials' } }, update: fn });
		expect(spy.calls).toBe(1);
		expect(spy.last).toEqual({ reset: false });
		expect(navCalls).toEqual([]);
	});

	it('honours a safe internal callbackURL after success', async () => {
		window.history.pushState({}, '', '/login?callbackURL=%2Fadmin%2Fusers%3Ftab%3Dactive');
		await postSubmit()({ result: { type: 'success', data: {} }, update: async () => {} });
		expect(navCalls).toEqual(['/admin/users?tab=active']);
	});

	it('rejects an off-app callbackURL and falls back to /admin', async () => {
		window.history.pushState({}, '', '/login?callbackURL=%2F%2Fevil.example');
		await postSubmit()({ result: { type: 'success', data: {} }, update: async () => {} });
		expect(navCalls).toEqual(['/admin']);
	});

	it('never masks the void update() result with `as any` or an eslint-disable', () => {
		const source = readFileSync(LOGIN_PAGE, 'utf-8');
		expect(source).not.toMatch(/as any/);
		expect(source).not.toMatch(/eslint-disable/);
	});
});
