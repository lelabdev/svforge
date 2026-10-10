<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import AuthLayout from '$lib/components/svforge/layout/AuthLayout.svelte';
	import { Feedback } from '$lib/components/svforge/ui';
	import { Button, Input } from '$lib/components/svforge/primitives';
	import { Eye, EyeSlash } from '$lib/icons';
	import { normalizeInternalCallback } from '$lib/utils/web';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let email = $state(untrack(() => form?.email ?? ''));
	let password = $state('');
	let loading = $state(false);
	let passwordVisible = $state(false);

	function loginError(code: string | undefined) {
		switch (code) {
			case 'invalid_credentials':
				return m.login_error_invalid_credentials();
			case 'invalid_input':
				return m.login_error_invalid_input();
			default:
				return m.common_error();
		}
	}
</script>

<svelte:head>
	<title>{m.login_title()}</title>
</svelte:head>

<AuthLayout title={m.login_welcome_back()} description={m.login_signin_hint()}>
	{#if form?.code}
		<Feedback type="error" message={loginError(form.code)} class="mb-6" />
	{/if}

	<form
		method="POST"
		class="space-y-5"
		use:enhance={() => {
			loading = true;
			return async ({ result, update }) => {
				try {
					// Apply the response to keep the submitted email and show the localized error.
					await update({ reset: false });
					if (result.type === 'success') {
						const callbackURL = normalizeInternalCallback(
							new URLSearchParams(window.location.search).get('callbackURL')
						);
						goto(callbackURL || '/admin');
					}
				} finally {
					loading = false;
				}
			};
		}}
	>
		<Input
			label={m.login_label_email()}
			type="email"
			name="email"
			autocomplete="username"
			bind:value={email}
			placeholder={m.login_placeholder_email()}
			required
		/>
		<Input
			label={m.login_label_password()}
			type={passwordVisible ? 'text' : 'password'}
			name="password"
			autocomplete="current-password"
			bind:value={password}
			placeholder="••••••••"
			required
		>
			{#snippet trailing()}
				<Button
					type="button"
					variant="ghost"
					color="surface"
					class="size-11 shrink-0 p-0"
					aria-label={passwordVisible ? m.common_hide_password() : m.common_show_password()}
					aria-pressed={passwordVisible}
					onclick={() => (passwordVisible = !passwordVisible)}
				>
					{#if passwordVisible}<EyeSlash size={18} />{:else}<Eye size={18} />{/if}
				</Button>
			{/snippet}
		</Input>
		<div class="pt-2">
			<Button type="submit" class="min-h-11 w-full" loading={loading} loadingLabel={m.login_signing_in()}>
				{loading ? m.login_signing_in() : m.login_sign_in()}
			</Button>
		</div>
	</form>
</AuthLayout>
