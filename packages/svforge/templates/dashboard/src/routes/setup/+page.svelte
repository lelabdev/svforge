<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Card } from '$lib/components/svforge/ui';
	import { Button, Input } from '$lib/components/svforge/primitives';
	import ThemeToggle from '$lib/components/svforge/ui/ThemeToggle.svelte';
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.setup_title()}</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center p-4">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-2 text-center">
			<h1 class="h1">{m.setup_create_admin()}</h1>
			<p class="text-sm text-surface-700-300">{m.setup_hint()}</p>
		</div>

		<Card>
			<form method="POST" class="space-y-4" use:enhance>
				{#if form?.error}
					<p class="text-sm text-error-700-300">{form.error}</p>
				{/if}

				<Input name="name" label={m.users_label_name()} placeholder={m.users_placeholder_name()} required />
				<Input name="email" label={m.login_label_email()} type="email" placeholder={m.users_placeholder_email()} required />
				<Input name="password" label={m.login_label_password()} type="password" placeholder={m.common_min_chars()} required />
				<Button type="submit" class="w-full">{m.setup_submit()}</Button>
			</form>
		</Card>

		<div class="flex justify-center">
			<ThemeToggle />
		</div>

		<p class="text-center text-xs text-surface-700-300">
			{m.setup_dev_only()}
		</p>
	</div>
</main>
