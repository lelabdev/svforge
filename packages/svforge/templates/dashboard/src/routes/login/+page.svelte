<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';
	import { Card, Feedback } from '$lib/components/svforge/ui';
	import { Button, Input } from '$lib/components/svforge/primitives';
	import ThemeToggle from '$lib/components/svforge/ui/ThemeToggle.svelte';
	import { normalizeInternalCallback } from '$lib/utils/web';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let email = $state('');
	let password = $state('');
	let loading = $state(false);
</script>

<svelte:head>
	<title>{m.login_title()}</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-surface-50-950 p-4">
	<div class="w-full max-w-md">
		<div class="mb-4 flex justify-end">
			<ThemeToggle />
		</div>

		<Card variant="elevated">
			<div class="mb-6 text-center">
				<h1 class="h1">{m.login_welcome_back()}</h1>
				<p class="mt-1 text-surface-700-300">{m.login_signin_hint()}</p>
			</div>

			{#if form?.message}
				<Feedback type="error" message={form.message} class="mb-4" />
			{/if}

			<form method="POST" use:enhance={() => {
				loading = true;
				return async ({ result, update }) => {
					// update() returns Promise<void>: it applies the action response
					// to `form` (so failed logins stay visible) but the outcome is
					// read from the callback's `result`.
					await update({ reset: false });
					loading = false;
					if (result.type === 'success') {
						const callbackURL = normalizeInternalCallback(
							new URLSearchParams(window.location.search).get('callbackURL')
						);
						goto(callbackURL || '/admin');
					}
				};
			}} class="space-y-4">
				<Input label={m.login_label_email()} type="email" name="email" bind:value={email} placeholder={m.login_placeholder_email()} required />
				<Input label={m.login_label_password()} type="password" name="password" bind:value={password} placeholder="••••••••" required />
				<Button type="submit" class="w-full" disabled={loading}>
					{loading ? m.login_signing_in() : m.login_sign_in()}
				</Button>
			</form>
		</Card>
	</div>
</main>
